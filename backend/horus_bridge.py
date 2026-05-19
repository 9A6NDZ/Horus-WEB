"""
Horus Bridge
============
Most između FastAPI servera i postojeće Horus-GUI logike.
Koristi iste module kao originalni GUI (horusdemodlib, pyaudio),
ali bez Qt dijela.

Prilagodba: Očekuje da su originalni horusgui moduli dostupni u Python pathu.
Dodaj roditeljski direktorij horus-gui repoa u PYTHONPATH, ili instaliraj
horus-gui kao paket.
"""

import logging
import sys
import time
from collections import deque
from pathlib import Path
from queue import Queue
from threading import Thread
from typing import Callable, Optional

import numpy as np

# Ako je horus-gui source tree u susjednom direktoriju, dodaj ga u path.
# Prilagodi put prema svojoj instalaciji.
POSSIBLE_HORUS_PATHS = [
    Path(__file__).parent.parent.parent / "horus-gui",
    Path(__file__).parent.parent.parent / "horus-gui" / "horusgui",
    Path.home() / "horus-gui",
]
for p in POSSIBLE_HORUS_PATHS:
    if p.exists() and str(p) not in sys.path:
        sys.path.insert(0, str(p.parent))
        sys.path.insert(0, str(p))

try:
    import pyaudio
    from horusdemodlib.demod import HorusLib, Mode
    from horusdemodlib.decoder import parse_ukhas_string, decode_packet
    from horusdemodlib.payloads import (
        download_latest_payload_id_list,
        download_latest_custom_field_list,
    )
    from horusdemodlib.sondehubamateur import SondehubAmateurUploader
    import horusdemodlib.payloads
    HORUS_AVAILABLE = True
except ImportError as e:
    logging.warning(f"Horus libraries not available: {e}")
    logging.warning("Running in simulation mode.")
    HORUS_AVAILABLE = False
    SondehubAmateurUploader = None


log = logging.getLogger("horus-bridge")


# Popis modema (kopirano iz modem.py u originalnom projektu)
MODEM_LIST = {
    "Horus Binary v1/v2/v3": {
        "id": "BINARY_V1",
        "baud_rates": [50, 100, 300],
        "default_baud_rate": 100,
        "default_tone_spacing": 270,
        "use_mask_estimator": True,
    },
    "RTTY (7N1)": {
        "id": "RTTY_7N1",
        "baud_rates": [50, 75, 100, 200, 300, 600, 1000],
        "default_baud_rate": 100,
        "default_tone_spacing": 425,
        "use_mask_estimator": False,
    },
    "RTTY (7N2)": {
        "id": "RTTY_7N2",
        "baud_rates": [50, 75, 100, 200, 300, 600, 1000],
        "default_baud_rate": 100,
        "default_tone_spacing": 425,
        "use_mask_estimator": False,
    },
    "RTTY (8N2)": {
        "id": "RTTY_8N2",
        "baud_rates": [50, 75, 100, 200, 300, 600, 1000],
        "default_baud_rate": 100,
        "default_tone_spacing": 425,
        "use_mask_estimator": False,
    },
}


class HorusBridge:
    """Upravlja audio streamom i Horus modemom."""

    def __init__(
        self,
        packet_callback: Callable[[dict], None],
        status_callback: Callable[[dict], None],
    ):
        self.packet_callback = packet_callback
        self.status_callback = status_callback
        self.running = False
        self.audio = None
        self.stream = None
        self.modem = None
        self.udp_thread: Optional[Thread] = None

        # FFT / spectrum tracking
        self.sample_rate = 48000
        # NFFT=8192 je ono što koristi originalni Horus GUI - puno bolja rezolucija
        # Na fs=48000, bin width = 48000/8192 = ~5.86 Hz (dovoljno za 270 Hz razmaknute 4FSK tonove)
        self.nfft = 8192
        self.fft_stride = 8192
        self.sample_buffer = bytearray(b"")
        self.fft_range = (100, 4000)  # Hz, gornji/donji limit prikaza
        self.fft_window = None
        self.fft_scale = None
        self.fft_mask = None
        self.fft_last_emit = 0.0
        self.fft_min_interval = 0.08  # sekundi između frame-ova (~12 fps, stabilniji prikaz)
        # Peak hold - pamti max vrijednosti kroz kratko vrijeme da se vide tonovi jasnije
        self.peak_hold = None
        self.peak_decay = 0.92    # koliko brzo pada peak (0.9=brzo, 0.99=sporo)

        # SNR buffer - pamti zadnjih N SNR očitanja iz modema.
        # Koristimo ga za "peak SNR" kad stigne paket (kao originalni GUI)
        # Modem šalje stats otprilike 2x/s, zato pamtimo zadnjih 10 sekundi = 20 očitanja
        self.snr_history = deque(maxlen=20)

        # SondeHub Amateur uploader
        self.sondehub_uploader = None
        self.sondehub_config = {
            "enabled": False,
            "callsign": "",
            "latitude": 0.0,
            "longitude": 0.0,
            "altitude": 0.0,
            "radio": "",
            "antenna": "",
        }

        # Radio dial frekvencija u MHz (npr. 437.600) - za SondeHub f_centre field.
        # Stvarna frekvencija signala = dial_freq + freq_estimator_offset (iz audio spektra)
        self.dial_freq_mhz = 0.0
        # Zadnje procijenjeni freq estimator offset iz modema (Hz)
        self.last_fest_average = 0.0

        # Blocklist callsignova koji se NE šalju na SondeHub (za testiranje na zemlji)
        self.sondehub_blocklist: set[str] = set()

        # Privatni server - slanje telemetrije preko UDP JSON
        self.private_server_config = {
            "enabled": False,
            "host": "",
            "port": 0,
            "protocol": "udp",  # "udp" ili "tcp"
            "format": "json",   # "json" ili "csv"
        }
        self._private_udp_socket = None

        # Audio monitor output — preslušavanje ulaznog signala
        self.monitor_stream = None
        self.monitor_enabled = False
        self.monitor_device_index = None
        self._monitor_queue = Queue(maxsize=50)  # buffer za audio blokove
        self._monitor_thread: Optional[Thread] = None
        self._monitor_running = False

        # Automatski re-upload stanice na SondeHub svakih 6 sati
        self._station_upload_interval = 6 * 3600  # 6 sati u sekundama
        self._last_station_upload_time = 0.0       # unix timestamp zadnjeg uploada
        self._station_reupload_thread: Optional[Thread] = None
        self._station_reupload_running = False

        # Preuzmi payload listu sa SondeHuba (za prevođenje payload_id -> callsign)
        # Radimo u backgroundu da ne blokira startup
        if HORUS_AVAILABLE:
            Thread(target=self._init_payload_lists, daemon=True).start()

    def _init_payload_lists(self):
        """
        Preuzmi najnoviju listu Horus payload ID-jeva i custom field definicija
        sa SondeHuba i instaliraj ih u horusdemodlib.
        Bez ovoga, svi paketi su označeni kao UNKNOWN_PAYLOAD_ID.
        """
        try:
            log.info("Downloading latest payload ID list from SondeHub...")
            payload_list = download_latest_payload_id_list(timeout=5)
            if payload_list and 0 in payload_list:
                horusdemodlib.payloads.HORUS_PAYLOAD_LIST = payload_list
                log.info(f"Payload list loaded: {len(payload_list)} entries")
            else:
                log.warning("Could not download payload list - UNKNOWN_PAYLOAD_ID errors expected")
        except Exception as e:
            log.exception(f"Error loading payload list: {e}")

        try:
            log.info("Downloading latest custom field list from SondeHub...")
            custom_fields = download_latest_custom_field_list(timeout=5)
            if custom_fields and "4FSKTEST-V2" in custom_fields:
                horusdemodlib.payloads.HORUS_CUSTOM_FIELDS = custom_fields
                log.info(f"Custom field list loaded: {len(custom_fields)} entries")
            else:
                log.warning("Could not download custom field list")
        except Exception as e:
            log.exception(f"Error loading custom field list: {e}")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def is_running(self) -> bool:
        return self.running

    def list_audio_devices(self) -> list[dict]:
        if not HORUS_AVAILABLE:
            return [{"index": -1, "name": "Simulation mode", "sample_rates": [48000]}]

        if not self.audio:
            self.audio = pyaudio.PyAudio()

        devices = []
        for i in range(self.audio.get_device_count()):
            info = self.audio.get_device_info_by_index(i)
            if info["maxInputChannels"] > 0:
                devices.append({
                    "index": i,
                    "name": info["name"],
                    "default_sample_rate": int(info["defaultSampleRate"]),
                    "max_channels": info["maxInputChannels"],
                })
        # Dodaj UDP opciju (GQRX)
        devices.append({
            "index": -1,
            "name": "UDP Audio (GQRX 127.0.0.1:7355)",
            "default_sample_rate": 48000,
            "udp": True,
        })
        return devices

    def list_modems(self) -> list[dict]:
        return [
            {"name": name, **cfg}
            for name, cfg in MODEM_LIST.items()
        ]

    def list_output_devices(self) -> list[dict]:
        """Vrati listu audio OUTPUT uređaja za monitor funkciju."""
        if not HORUS_AVAILABLE:
            return []

        if not self.audio:
            self.audio = pyaudio.PyAudio()

        devices = []
        for i in range(self.audio.get_device_count()):
            info = self.audio.get_device_info_by_index(i)
            if info["maxOutputChannels"] > 0:
                devices.append({
                    "index": i,
                    "name": info["name"],
                    "default_sample_rate": int(info["defaultSampleRate"]),
                    "max_channels": info["maxOutputChannels"],
                })
        return devices

    def start_monitor(self, device_index: int, sample_rate: int = 48000):
        """Pokreni audio monitor — preslušavanje ulaznog signala na odabranom output uređaju."""
        self.stop_monitor()  # zatvori prethodni ako postoji

        if not HORUS_AVAILABLE:
            log.warning("Audio monitor not available in simulation mode.")
            return

        if not self.audio:
            self.audio = pyaudio.PyAudio()

        try:
            stream = self.audio.open(
                format=pyaudio.paInt16,
                channels=1,
                rate=sample_rate,
                output=True,
                output_device_index=device_index,
                frames_per_buffer=8192,
            )
            self.monitor_stream = stream
            self.monitor_device_index = device_index

            # Pokreni zasebni thread koji čita iz queue-a i piše na output.
            # Ovo sprječava crash na Windowsu — callback nikad direktno ne piše
            # na output stream, samo stavlja podatke u queue.
            self._monitor_running = True
            # Isprazni queue od eventualnih starih podataka
            while not self._monitor_queue.empty():
                try:
                    self._monitor_queue.get_nowait()
                except Exception:
                    break

            def _monitor_writer():
                while self._monitor_running:
                    try:
                        data = self._monitor_queue.get(timeout=0.5)
                        if self.monitor_stream and self._monitor_running:
                            try:
                                self.monitor_stream.write(data)
                            except Exception:
                                pass  # stream zatvoren, izlazi tiho
                    except Exception:
                        pass  # queue.get timeout, normalno

            self._monitor_thread = Thread(target=_monitor_writer, daemon=True)
            self._monitor_thread.start()
            self.monitor_enabled = True
            log.info(f"Audio monitor started on output device {device_index} @ {sample_rate} Hz")
        except Exception as e:
            log.exception(f"Failed to start audio monitor: {e}")
            self.monitor_enabled = False
            self._monitor_running = False
            raise

    def stop_monitor(self):
        """Zaustavi audio monitor output."""
        if not self.monitor_enabled and not self.monitor_stream:
            return  # ništa za gasiti

        # 1. Signaliziraj writeru da stane
        self.monitor_enabled = False
        self._monitor_running = False

        # 2. Čekaj da writer thread završi (max 2 sekunde)
        if self._monitor_thread and self._monitor_thread.is_alive():
            try:
                self._monitor_thread.join(timeout=2.0)
            except Exception:
                pass
        self._monitor_thread = None

        # 3. Isprazni queue
        while not self._monitor_queue.empty():
            try:
                self._monitor_queue.get_nowait()
            except Exception:
                break

        # 4. Zatvori stream TEK nakon što writer sigurno ne piše više
        if self.monitor_stream:
            try:
                self.monitor_stream.stop_stream()
                self.monitor_stream.close()
            except Exception as e:
                log.warning(f"Error closing monitor stream: {e}")
            self.monitor_stream = None

        self.monitor_device_index = None
        log.info("Audio monitor stopped.")

    def start(
        self,
        audio_device: Optional[int],
        sample_rate: int = 48000,
        modem: str = "Horus Binary v1/v2/v3",
        baud_rate: int = 100,
        use_udp: bool = False,
        udp_port: int = 7355,
    ):
        if self.running:
            log.warning("Already running, ignoring start request.")
            return

        if not HORUS_AVAILABLE:
            log.warning("Horus not available. Starting simulation mode.")
            self._start_simulation()
            return

        modem_cfg = MODEM_LIST.get(modem)
        if not modem_cfg:
            raise ValueError(f"Unknown modem: {modem}")

        mode_id = getattr(Mode, modem_cfg["id"])
        tone_spacing = modem_cfg["default_tone_spacing"]

        # Pamti sample rate i inicijaliziraj FFT state
        self.sample_rate = sample_rate
        self._init_fft()

        # Setup modem
        self.modem = HorusLib(
            mode=mode_id,
            rate=baud_rate,
            tone_spacing=tone_spacing,
            callback=self._on_packet,
            sample_rate=sample_rate,
        )

        # Setup audio
        if use_udp:
            self._start_udp(sample_rate, udp_port)
        else:
            self._start_pyaudio(audio_device, sample_rate)

        self.running = True
        log.info(f"Started: modem={modem} rate={baud_rate} fs={sample_rate}")

    def stop(self):
        if not self.running:
            return

        try:
            if self.stream:
                self.stream.stop_stream()
                self.stream.close()
                self.stream = None
        except Exception as e:
            log.exception(f"Error closing stream: {e}")

        try:
            if self.modem:
                self.modem.close()
                self.modem = None
        except Exception as e:
            log.exception(f"Error closing modem: {e}")

        # Zaustavi audio monitor ako je aktivan
        self.stop_monitor()

        self.running = False
        self.sample_buffer = bytearray(b"")
        self.peak_hold = None
        self.snr_history.clear()
        # Reset debug flagova
        for attr in ('_audio_logged', '_udp_first_logged', '_fft_logged', '_fft_warning_logged'):
            if hasattr(self, attr):
                delattr(self, attr)
        log.info("Stopped.")

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _on_packet(self, frame):
        """Pozove se iz Horus modema kad stigne novi paket."""
        try:
            # Provjeri CRC
            if hasattr(frame, 'crc_pass') and not frame.crc_pass:
                self.status_callback({"type": "crc_fail"})
                return

            if not frame.data or len(frame.data) == 0:
                return

            decoded = None

            if isinstance(frame.data, str):
                # RTTY - string (UKHAS format)
                try:
                    decoded = parse_ukhas_string(frame.data)
                except Exception as e:
                    log.error(f"RTTY parse failed: {e}")
                    self.status_callback({"type": "decode_fail", "error": str(e)})
                    return
            elif isinstance(frame.data, bytes):
                # Horus Binary - raw bytes, treba ih dekodirati
                try:
                    decoded = decode_packet(frame.data)
                except Exception as e:
                    # decode_packet može baciti CRC Failure error
                    if "CRC Failure" in str(e):
                        self.status_callback({"type": "crc_fail"})
                    else:
                        log.error(f"Binary decode failed: {e}")
                        self.status_callback({"type": "decode_fail", "error": str(e)})
                    return
            else:
                log.warning(f"Unknown frame.data type: {type(frame.data)}")
                return

            if not decoded:
                return

            # Peak SNR strategija - kao što to radi originalni Horus GUI.
            # Uzmi MAX SNR iz zadnjih ~4 sekundi (8 mjerenja jer modem stats stiže ~2/s).
            # Ovo pokazuje peak SNR tijekom primanja paketa, ne SNR nakon što je završilo.
            # Za Horus Binary koristimo kraći lookback, za RTTY duži (ima veći buffer).
            if isinstance(frame.data, str):
                # RTTY - duži lookback
                lookback = 30
            else:
                # Horus Binary
                lookback = 8

            if self.snr_history:
                recent = list(self.snr_history)[-lookback:]
                peak_snr = max(recent) if recent else float(getattr(frame, "snr", 0.0))
            else:
                peak_snr = float(getattr(frame, "snr", 0.0))

            # Dodaj metadata
            decoded["snr"] = peak_snr
            decoded["crc_pass"] = True

            # Dodaj f_centre ako imamo dial frequency (kao originalni GUI).
            # Stvarna RF freq = dial * 1e6 + audio offset (fest)
            if self.dial_freq_mhz > 0:
                f_centre = self.dial_freq_mhz * 1e6
                if self.last_fest_average > 0:
                    f_centre += self.last_fest_average
                decoded["f_centre"] = f_centre

            # DEBUG: ispiši sva polja iz paketa da znamo imena polja za battery, temperature itd.
            log.info(f"Decoded packet: {decoded.get('callsign', '?')} alt={decoded.get('altitude', '?')} SNR={peak_snr:.1f}")
            if "f_centre" in decoded:
                log.info(f"  f_centre = {decoded['f_centre']/1e6:.5f} MHz")
            log.info(f"  Sva polja u paketu: {list(decoded.keys())}")
            # Ispiši i vrijednosti ključnih polja (ako ih ima)
            for key in ['battery_voltage', 'batt_voltage', 'battery', 'batt',
                        'temperature', 'temp', 'ext_temperature',
                        'satellites', 'sats']:
                if key in decoded:
                    log.info(f"  {key} = {decoded[key]}")

            # Upload na SondeHub (ako je aktivirano u konfiguraciji)
            self.upload_to_sondehub(decoded)

            # Upload na privatni server (ako je konfiguriran)
            self.upload_to_private_server(decoded)

            self.packet_callback(decoded)

        except Exception as e:
            log.exception(f"Error handling packet: {e}")

    def _start_pyaudio(self, device_index: int, sample_rate: int):
        if not self.audio:
            self.audio = pyaudio.PyAudio()

        self.stream = self.audio.open(
            format=pyaudio.paInt16,
            channels=1,
            rate=sample_rate,
            frames_per_buffer=8192,
            input=True,
            input_device_index=device_index,
            stream_callback=self._audio_callback,
        )
        self.stream.start_stream()

    def _audio_callback(self, data, frame_count, time_info, status):
        # DEBUG: Loguj prvi audio blok da znamo da callback radi
        if not hasattr(self, '_audio_logged'):
            log.info(f"First audio block received! {len(data)} bytes, frames={frame_count}")
            self._audio_logged = True

        if self.modem:
            try:
                _stats = self.modem.add_samples(data)
                if _stats is not None:
                    try:
                        snr = float(_stats.snr)
                        # Spremi SNR u history buffer za "peak SNR" kad stigne paket
                        self.snr_history.append(snr)
                        self.status_callback({"type": "modem_stats", "snr": snr})
                    except (AttributeError, TypeError):
                        pass
                    # Freq estimator offset (za f_centre na SondeHubu)
                    try:
                        f_ests = _stats.extended_stats.f_est
                        valid_fests = [float(f) for f in f_ests if float(f) != 0.0]
                        if valid_fests:
                            self.last_fest_average = sum(valid_fests) / len(valid_fests)
                    except (AttributeError, TypeError):
                        pass
            except Exception as e:
                log.exception(f"Modem add_samples error: {e}")
        # FFT analiza paralelno s modemom
        self._process_fft_samples(data)

        # Audio monitor — stavi sample u queue (writer thread ih piše na output)
        if self.monitor_enabled:
            try:
                self._monitor_queue.put_nowait(data)
            except Exception:
                pass  # queue pun, preskoči blok (bolje nego blokirati dekoder)

        return (None, pyaudio.paContinue)

    def _start_udp(self, sample_rate: int, port: int):
        import socket

        def udp_loop():
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
            except Exception:
                pass
            s.bind(("127.0.0.1", port))
            s.settimeout(1.0)
            log.info(f"UDP audio listener on 127.0.0.1:{port}")
            while self.running:
                try:
                    data, _ = s.recvfrom(65535)
                    if not hasattr(self, '_udp_first_logged'):
                        log.info(f"First UDP audio block received! {len(data)} bytes")
                        self._udp_first_logged = True
                    if self.modem:
                        try:
                            _stats = self.modem.add_samples(data)
                            if _stats is not None:
                                try:
                                    snr = float(_stats.snr)
                                    self.snr_history.append(snr)
                                    self.status_callback({"type": "modem_stats", "snr": snr})
                                except (AttributeError, TypeError):
                                    pass
                                try:
                                    f_ests = _stats.extended_stats.f_est
                                    valid_fests = [float(f) for f in f_ests if float(f) != 0.0]
                                    if valid_fests:
                                        self.last_fest_average = sum(valid_fests) / len(valid_fests)
                                except (AttributeError, TypeError):
                                    pass
                        except Exception as e:
                            log.exception(f"UDP modem error: {e}")
                    self._process_fft_samples(data)
                    # Audio monitor — stavi UDP audio u queue
                    if self.monitor_enabled:
                        try:
                            self._monitor_queue.put_nowait(data)
                        except Exception:
                            pass
                except socket.timeout:
                    continue
                except Exception as e:
                    log.exception(f"UDP loop error: {e}")
                    break
            s.close()

        self.udp_thread = Thread(target=udp_loop, daemon=True)
        self.udp_thread.start()

    # ------------------------------------------------------------------
    # SondeHub Amateur uploader
    # ------------------------------------------------------------------
    def set_sondehub_config(self, enabled: bool, callsign: str,
                            latitude: float, longitude: float, altitude: float = 0.0,
                            radio: str = "", antenna: str = ""):
        """Konfiguriraj SondeHub Amateur uploader."""
        self.sondehub_config = {
            "enabled": enabled,
            "callsign": callsign,
            "latitude": latitude,
            "longitude": longitude,
            "altitude": altitude,
            "radio": radio,
            "antenna": antenna,
        }

        if not HORUS_AVAILABLE or SondehubAmateurUploader is None:
            log.warning("SondeHub uploader not available (horusdemodlib not loaded)")
            return

        # Ako je uploader već kreiran, samo ažuriraj inhibit flag
        if self.sondehub_uploader is not None:
            self.sondehub_uploader.inhibit = not enabled
            log.info(f"SondeHub uploader: {'ENABLED' if enabled else 'DISABLED (inhibit)'}")
            # Upravljaj auto-upload timerom
            if enabled and callsign and callsign != "N0CALL":
                self._start_station_reupload_timer()
            else:
                self._stop_station_reupload_timer()
            return

        # Inače kreiraj novi
        if not callsign or callsign == "N0CALL":
            log.warning("SondeHub uploader: callsign is empty ili N0CALL - uploads će biti odbačeni")

        try:
            user_position = None
            if latitude != 0.0 or longitude != 0.0:
                user_position = [latitude, longitude, altitude]

            self.sondehub_uploader = SondehubAmateurUploader(
                upload_rate=2,
                user_callsign=callsign or "N0CALL",
                user_position=user_position,
                user_radio=radio or "",
                user_antenna=antenna,
                software_name="Horus-Web",
                software_version="1.5",
            )
            self.sondehub_uploader.inhibit = not enabled
            log.info(f"SondeHub uploader created: callsign={callsign} enabled={enabled}")
            # Pokreni auto-upload timer ako je SondeHub aktivan
            if enabled and callsign and callsign != "N0CALL":
                self._start_station_reupload_timer()
        except Exception as e:
            log.exception(f"Could not create SondeHub uploader: {e}")
            self.sondehub_uploader = None

    def upload_to_sondehub(self, decoded: dict):
        """Pošalji paket na SondeHub ako je uploader aktivan i callsign nije blokiran."""
        if self.sondehub_uploader is None:
            return
        if not self.sondehub_config.get("enabled"):
            return

        # Provjeri GPS fix - ne šalji pakete bez GPS fix-a na SondeHub
        # (lat=0, lon=0 je "Null Island" u Gvinejskom zaljevu, ne stvarna pozicija).
        # Prag 0.001° (~111 m) pokriva float noise i male odstupanja.
        try:
            lat = float(decoded.get("latitude", 0))
            lon = float(decoded.get("longitude", 0))
            if abs(lat) < 0.001 and abs(lon) < 0.001:
                log.info(f"SondeHub upload PRESKOCEN za '{decoded.get('callsign', '?')}': nema GPS fix-a (lat/lon = 0)")
                return
        except (ValueError, TypeError):
            log.warning(f"SondeHub upload PRESKOCEN: nevažeće koordinate u paketu")
            return

        # Provjeri blocklist - case-insensitive match
        packet_callsign = str(decoded.get("callsign", "")).strip().upper()
        if packet_callsign and packet_callsign in self.sondehub_blocklist:
            log.info(f"SondeHub upload BLOKIRAN za '{packet_callsign}' (na blocklisti)")
            return

        try:
            self.sondehub_uploader.add(decoded)
            # SondeHub vidi aktivnost stanice i kroz telemetrijske pakete,
            # pa resetiraj timer da ne šaljemo redundantne station uploade
            self._last_station_upload_time = time.time()
        except Exception as e:
            log.exception(f"SondeHub upload error: {e}")

    def upload_station_to_sondehub(self) -> dict:
        """Ručno uploadaj podatke o stanici na SondeHub (bez čekanja na paket).
        Ovo rekreira uploader s trenutnom konfiguracijom kako bi SondeHub
        odmah primio ažurirane podatke o stanici."""
        cfg = self.sondehub_config
        if not cfg.get("enabled"):
            return {"ok": False, "error": "SondeHub upload nije aktiviran"}
        if not cfg.get("callsign") or cfg["callsign"] == "N0CALL":
            return {"ok": False, "error": "Callsign nije postavljen (N0CALL)"}

        if not HORUS_AVAILABLE or SondehubAmateurUploader is None:
            return {"ok": False, "error": "horusdemodlib nije dostupan"}

        try:
            user_position = None
            lat = cfg.get("latitude", 0.0)
            lon = cfg.get("longitude", 0.0)
            alt = cfg.get("altitude", 0.0)
            if lat != 0.0 or lon != 0.0:
                user_position = [lat, lon, alt]

            radio = cfg.get("radio", "")
            antenna = cfg.get("antenna", "")

            # Rekreiraj uploader s ažuriranim podacima
            old_uploader = self.sondehub_uploader
            self.sondehub_uploader = SondehubAmateurUploader(
                upload_rate=2,
                user_callsign=cfg["callsign"],
                user_position=user_position,
                user_radio=radio or "",
                user_antenna=antenna,
                software_name="Horus-Web",
                software_version="1.5",
            )
            self.sondehub_uploader.inhibit = not cfg.get("enabled", False)

            # Zatvori stari uploader ako postoji
            if old_uploader is not None:
                try:
                    old_uploader.close()
                except Exception:
                    pass

            log.info(f"SondeHub station upload: callsign={cfg['callsign']} "
                     f"pos=[{lat}, {lon}, {alt}] radio='{radio}' antenna='{antenna}'")
            self._last_station_upload_time = time.time()
            return {"ok": True, "message": f"Stanica uploadana: {cfg['callsign']}"}
        except Exception as e:
            log.exception(f"SondeHub station upload error: {e}")
            return {"ok": False, "error": str(e)}

    def _start_station_reupload_timer(self):
        """Pokreni background thread koji re-uploadira poziciju stanice
        na SondeHub svakih 6 sati. SondeHub briše stanice koje se ne
        javljaju duže vrijeme, pa ovaj timer osigurava da stanica
        ostane vidljiva na mapi čak i kad nema aktivnog leta."""
        if self._station_reupload_running:
            return  # već radi

        self._station_reupload_running = True

        def _reupload_loop():
            # Ako još nismo slali, pošalji odmah pri startu timera
            if self._last_station_upload_time == 0.0:
                try:
                    result = self.upload_station_to_sondehub()
                    if result.get("ok"):
                        log.info("SondeHub station auto-upload: inicijalni upload uspješan")
                    else:
                        log.warning(f"SondeHub station auto-upload: inicijalni upload neuspješan - {result.get('error', '?')}")
                except Exception as e:
                    log.warning(f"SondeHub station auto-upload error: {e}")

            while self._station_reupload_running:
                # Spavaj u kratkim intervalima da se thread može brzo ugasiti
                for _ in range(60):  # provjera svake minute
                    if not self._station_reupload_running:
                        return
                    time.sleep(1)

                # Provjeri je li prošlo dovoljno vremena od zadnjeg uploada
                if self._last_station_upload_time == 0.0:
                    elapsed = self._station_upload_interval + 1  # forsira upload
                else:
                    elapsed = time.time() - self._last_station_upload_time

                if elapsed >= self._station_upload_interval:
                    cfg = self.sondehub_config
                    if cfg.get("enabled") and cfg.get("callsign") and cfg["callsign"] != "N0CALL":
                        try:
                            result = self.upload_station_to_sondehub()
                            if result.get("ok"):
                                log.info(f"SondeHub station auto-upload: uspješno (interval {self._station_upload_interval/3600:.0f}h)")
                            else:
                                log.warning(f"SondeHub station auto-upload neuspješan: {result.get('error', '?')}")
                        except Exception as e:
                            log.warning(f"SondeHub station auto-upload error: {e}")

        self._station_reupload_thread = Thread(target=_reupload_loop, daemon=True)
        self._station_reupload_thread.start()
        log.info(f"SondeHub station auto-upload timer pokrenut (interval: {self._station_upload_interval/3600:.0f}h)")

    def _stop_station_reupload_timer(self):
        """Zaustavi background thread za re-upload stanice."""
        self._station_reupload_running = False
        if self._station_reupload_thread and self._station_reupload_thread.is_alive():
            try:
                self._station_reupload_thread.join(timeout=3.0)
            except Exception:
                pass
        self._station_reupload_thread = None
        log.info("SondeHub station auto-upload timer zaustavljen")

    def set_dial_frequency(self, dial_freq_mhz: float):
        """Postavi radio dial frekvenciju u MHz (npr. 437.600)."""
        try:
            self.dial_freq_mhz = float(dial_freq_mhz)
            if self.dial_freq_mhz > 0:
                log.info(f"Radio dial frequency set to {self.dial_freq_mhz:.4f} MHz")
        except (ValueError, TypeError):
            self.dial_freq_mhz = 0.0

    def set_sondehub_blocklist(self, callsigns: list):
        """Postavi blocklist callsignova - paketi s tim callsignovima NE idu na SondeHub.
        Korisno za testiranje sondi na zemlji da se ne pojavljuju kao lažni letovi."""
        try:
            # Normaliziraj: uppercase, strip whitespace, ignore prazne
            self.sondehub_blocklist = set(
                cs.strip().upper() for cs in callsigns if cs and cs.strip()
            )
            if self.sondehub_blocklist:
                log.info(f"SondeHub blocklist: {len(self.sondehub_blocklist)} callsignova blokirano ({', '.join(sorted(self.sondehub_blocklist))})")
            else:
                log.info("SondeHub blocklist: prazan (svi callsignovi se šalju)")
        except Exception as e:
            log.warning(f"Invalid blocklist: {e}")
            self.sondehub_blocklist = set()

    # ------------------------------------------------------------------
    # Privatni server - UDP/TCP forwarding telemetrije
    # ------------------------------------------------------------------
    def set_private_server_config(self, enabled: bool, host: str, port: int,
                                   protocol: str = "udp", fmt: str = "json"):
        """Konfiguriraj slanje telemetrije na privatni server."""
        self.private_server_config = {
            "enabled": enabled,
            "host": host.strip(),
            "port": int(port) if port else 0,
            "protocol": protocol.lower().strip() or "udp",
            "format": fmt.lower().strip() or "json",
        }

        # Zatvori stari socket ako postoji
        if self._private_udp_socket:
            try:
                self._private_udp_socket.close()
            except Exception:
                pass
            self._private_udp_socket = None

        if not enabled or not host or not port:
            if not enabled:
                log.info("Private server: DISABLED")
            return

        # Kreiraj UDP socket (reuse za sve pakete, lightweight)
        if self.private_server_config["protocol"] == "udp":
            try:
                import socket
                self._private_udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                log.info(f"Private server: UDP -> {host}:{port} (format={fmt}) ENABLED")
            except Exception as e:
                log.exception(f"Could not create UDP socket for private server: {e}")
                self._private_udp_socket = None
        else:
            log.info(f"Private server: TCP -> {host}:{port} (format={fmt}) ENABLED")

    def upload_to_private_server(self, decoded: dict):
        """Pošalji paket na privatni server ako je konfiguriran."""
        cfg = self.private_server_config
        if not cfg.get("enabled") or not cfg.get("host") or not cfg.get("port"):
            return

        try:
            import json as _json

            # Pripremi podatke za slanje
            if cfg["format"] == "csv":
                # CSV format: callsign,time,lat,lon,alt,speed,heading,snr,battery,...
                fields = [
                    str(decoded.get("callsign", "")),
                    str(decoded.get("time", "")),
                    str(decoded.get("latitude", 0)),
                    str(decoded.get("longitude", 0)),
                    str(decoded.get("altitude", 0)),
                    str(decoded.get("speed", 0)),
                    str(decoded.get("heading", 0)),
                    str(decoded.get("snr", 0)),
                    str(decoded.get("battery_voltage", decoded.get("batt_voltage", ""))),
                    str(decoded.get("temperature", decoded.get("temp", ""))),
                    str(decoded.get("satellites", decoded.get("sats", ""))),
                ]
                payload_bytes = ",".join(fields).encode("utf-8")
            else:
                # JSON format - pošalji sve što imamo
                payload_bytes = _json.dumps(decoded, default=str).encode("utf-8")

            if cfg["protocol"] == "udp":
                if self._private_udp_socket:
                    self._private_udp_socket.sendto(
                        payload_bytes, (cfg["host"], cfg["port"])
                    )
            else:
                # TCP - kreiraj kratkotrajnu konekciju
                import socket
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(3)
                    s.connect((cfg["host"], cfg["port"]))
                    s.sendall(payload_bytes + b"\n")

            log.debug(f"Private server: sent {len(payload_bytes)} bytes to {cfg['host']}:{cfg['port']}")
        except Exception as e:
            log.warning(f"Private server upload error: {e}")


    def _init_fft(self):
        """Inicijaliziraj FFT prozor i frekvencijsku skalu."""
        self.fft_window = np.hanning(self.nfft).astype(np.float64)
        # Frekvencije bin-ova (neg./poz., pa shift da raste redom)
        freqs = np.fft.fftshift(np.fft.fftfreq(self.nfft, d=1.0 / self.sample_rate))
        self.fft_scale = freqs
        # Maska za range 100-4000 Hz (samo taj dio šaljemo na frontend)
        self.fft_mask = (freqs >= self.fft_range[0]) & (freqs <= self.fft_range[1])
        self.sample_buffer = bytearray(b"")
        self.fft_last_emit = 0.0

    def _process_fft_samples(self, raw_data: bytes):
        """
        Dodaj bytes u buffer i kad je dovoljno uzoraka, napravi FFT.
        Rezultat se šalje preko status_callback s tipom 'fft'.
        """
        if self.fft_window is None:
            if not hasattr(self, '_fft_warning_logged'):
                log.warning("FFT window not initialized!")
                self._fft_warning_logged = True
            return

        self.sample_buffer += raw_data
        bytes_needed = self.nfft * 2  # int16 = 2 bytes
        if len(self.sample_buffer) < bytes_needed:
            return

        # Rate-limit
        now = time.time()
        if now - self.fft_last_emit < self.fft_min_interval:
            self.sample_buffer = self.sample_buffer[self.fft_stride * 2:]
            return
        self.fft_last_emit = now

        try:
            samples = np.frombuffer(
                bytes(self.sample_buffer[:bytes_needed]), dtype=np.int16
            ).astype(np.float64) / 32768.0
            self.sample_buffer = self.sample_buffer[self.fft_stride * 2:]

            # Peak dBFS iz time domain-a
            peak = float(np.abs(samples).max())
            dbfs = 20.0 * np.log10(peak) if peak > 0 else -120.0

            # FFT u dB
            spectrum = np.fft.fftshift(np.fft.fft(samples * self.fft_window))
            magnitudes = np.abs(spectrum)
            magnitudes = np.where(magnitudes > 0, magnitudes, 1e-12)
            spectrum_db = 20.0 * np.log10(magnitudes) - 20.0 * np.log10(self.nfft)

            # Ograniči na audio range
            freqs_out = self.fft_scale[self.fft_mask]
            spectrum_out = spectrum_db[self.fft_mask]

            # Peak hold - pamti max vrijednosti s decay-em
            if self.peak_hold is None or len(self.peak_hold) != len(spectrum_out):
                self.peak_hold = spectrum_out.copy()
            else:
                # Peak decay - novi peak ako je veći, inače polako pada
                decayed = self.peak_hold - (1 - self.peak_decay) * 100  # -8 dB po frame-u kad decay=0.92
                self.peak_hold = np.maximum(decayed, spectrum_out)

            # Downsample na ~600 točaka za bolji prikaz 4FSK tonova
            # (na bin_width 5.86 Hz, range 100-4000 Hz ima ~665 bin-ova, šaljemo sve)
            target_points = 600
            step = max(1, len(freqs_out) // target_points)
            freqs_small = freqs_out[::step]
            spec_small = spectrum_out[::step]
            peak_small = self.peak_hold[::step]

            # Detektiraj top peak-ove (tonove)
            # Pronađi sve lokalne maksimume koji su barem 15 dB iznad mediana
            median_db = float(np.median(spectrum_out))
            threshold = median_db + 15

            # Jednostavna detekcija top N peak-ova
            top_peaks = []
            try:
                # Nađi lokalne maksimume
                peaks_mask = np.zeros(len(spectrum_out), dtype=bool)
                for i in range(2, len(spectrum_out) - 2):
                    if (spectrum_out[i] > threshold and
                        spectrum_out[i] > spectrum_out[i-1] and
                        spectrum_out[i] > spectrum_out[i+1] and
                        spectrum_out[i] > spectrum_out[i-2] and
                        spectrum_out[i] > spectrum_out[i+2]):
                        peaks_mask[i] = True

                peak_indices = np.where(peaks_mask)[0]
                if len(peak_indices) > 0:
                    # Sortiraj po jačini, uzmi top 6
                    sorted_peaks = sorted(
                        peak_indices,
                        key=lambda i: -spectrum_out[i]
                    )[:6]
                    # Vrati po frekvenciji
                    sorted_peaks = sorted(sorted_peaks, key=lambda i: freqs_out[i])
                    top_peaks = [
                        {"freq": float(freqs_out[i]), "db": float(spectrum_out[i])}
                        for i in sorted_peaks
                    ]
            except Exception:
                pass

            if not hasattr(self, '_fft_logged'):
                log.info(f"First FFT: {len(freqs_small)} points, dBFS={dbfs:.1f}, bin_width={self.sample_rate/self.nfft:.1f} Hz")
                self._fft_logged = True

            self.status_callback({
                "type": "fft",
                "freqs": freqs_small.round(1).tolist(),
                "spectrum": spec_small.round(1).tolist(),
                "peak_hold": peak_small.round(1).tolist(),
                "dbfs": round(dbfs, 1),
                "peak_freq": float(freqs_out[int(np.argmax(spectrum_out))]),
                "peaks": top_peaks,
                "noise_floor": round(median_db, 1),
            })
        except Exception as e:
            log.exception(f"FFT error: {e}")

    def _start_simulation(self):
        """Ako horusdemodlib nije dostupan, generiraj lažne pakete za testiranje UI-ja."""
        import random

        self.running = True

        def sim_loop():
            t = 0
            lat, lon, alt = 45.815, 15.982, 300.0  # Zagreb
            climbing = True
            while self.running:
                time.sleep(3)
                if climbing:
                    alt += random.uniform(4, 6)
                    if alt > 30000:
                        climbing = False
                else:
                    alt -= random.uniform(5, 15)
                    if alt < 300:
                        self.running = False
                        break

                # Laički pomak prema istoku
                lat += random.uniform(-0.001, 0.003)
                lon += random.uniform(0.002, 0.008)

                packet = {
                    "callsign": "SIM01",
                    "time": time.strftime("%H:%M:%S"),
                    "latitude": lat,
                    "longitude": lon,
                    "altitude": alt,
                    "satellites": random.randint(6, 12),
                    "battery_voltage": round(random.uniform(3.6, 4.2), 2),
                    "temperature": round(-20 - (alt / 1000) * 3 + random.uniform(-2, 2), 1),
                    "snr": round(random.uniform(5, 20), 1),
                    "crc_pass": True,
                }
                self.packet_callback(packet)

        Thread(target=sim_loop, daemon=True).start()
