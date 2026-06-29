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
import subprocess
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

# LoRa decoder — opcionalan, ne blokira rad ako nije dostupan
try:
    from lora_decoder import LoraDecoder
    LORA_AVAILABLE = True
except ImportError:
    logging.info("LoRa decoder module not available (lora_decoder.py not found)")
    LORA_AVAILABLE = False
    LoraDecoder = None  # type: ignore[misc,assignment]


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
    # LoRa APRS - prijem balona koji koriste LoRa modulaciju (433.775 MHz).
    # Ne koristi horusdemodlib nego vanjski lorarx alat preko subprocesa.
    "LoRa APRS 433": {
        "id": "LORA_APRS",
        "baud_rates": [7, 8, 9, 10, 11, 12],
        "default_baud_rate": 12,
        "default_tone_spacing": 0,
        "use_mask_estimator": False,
        "is_lora": True,
        "lora_frequency_mhz": 433.775,
        "lora_bandwidth_idx": 7,     # 125 kHz
        "lora_spread_factor": 12,    # default, UI override via baud_rate
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
        self.rtl_process: Optional[subprocess.Popen] = None
        self.rtl_thread: Optional[Thread] = None

        # LoRa mode
        self.is_lora_mode = False
        self.lora_decoder: Optional["LoraDecoder"] = None

        # FFT / spectrum tracking
        self.sample_rate = 48000
        # NFFT=8192 je ono što koristi originalni Horus GUI - puno bolja rezolucija
        # Na fs=48000, bin width = 48000/8192 = ~5.86 Hz (dovoljno za 270 Hz razmaknute 4FSK tonove)
        self.nfft = 8192
        self.fft_stride = 8192
        self.sample_buffer = bytearray(b"")
        self.fft_range = (100, 3500)  # Hz, gornji/donji limit prikaza (za audio mod)

        # RTL-SDR IQ mod za FFT — kad je aktivan, FFT radi na kompleksnom IQ
        # signalu i frekvencijska skala je centrirana oko RF frekvencije
        self.rtl_mode = False
        self.rtl_center_freq_hz = 0  # stvarna SDR tune frekvencija
        self.rtl_target_freq_hz = 0  # zadana RF frekvencija (npr. 437600000)
        self.rtl_offset_hz = 0       # offset = target - sdr_tune
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

        # Mrežni audio subscriberi — za slušanje u browseru na UDALJENOM računalu.
        # Svaki WebSocket klijent dobije svoj Queue u koji _feed_audio_subscribers
        # gura iste PCM blokove (int16 mono). Neovisno o lokalnom monitoru.
        self._audio_subscribers: "set[Queue]" = set()
        self._audio_subscribers_lock = __import__("threading").Lock()
        # Sample rate trenutnog audio streama — browser ga treba za reprodukciju.
        self.monitor_sample_rate = 48000
        # Audio monitor volume (glasnoća preslušavanja) — NEOVISAN o RF gainu.
        # Množi samo PCM koji ide u monitor/browser, NIKAD uzorke koji idu u
        # dekoder. 1.0 = bez promjene; <1.0 stišaj, >1.0 pojačaj (uz clip).
        self.monitor_volume = 1.0
        # FM-demoduliran IQ audio (RTL mod) izlazi znatno glasniji od UDP/audio
        # ulaza. Ovaj fiksni faktor izjednačava glasnoću preslušavanja s UDP-om
        # (RTL je ~30% glasniji). Primjenjuje se SAMO na RTL demod audio, povrh
        # korisnikovog volume slidera, i NE dira uzorke koji idu u dekoder.
        self._rtl_audio_attenuation = 0.1

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

    def get_lora_messages(self, limit: int = 100) -> list:
        """Dohvati zadnje LoRa poruke za log prozor. Prazno ako LoRa nije aktivna."""
        if self.lora_decoder and hasattr(self.lora_decoder, "get_message_log"):
            return self.lora_decoder.get_message_log(limit=limit)
        return []

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
            "name": "UDP Audio (127.0.0.1)",
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

    # ------------------------------------------------------------------
    # Mrežni audio (slušanje u browseru na udaljenom računalu)
    # ------------------------------------------------------------------
    def add_audio_subscriber(self) -> Queue:
        """
        Registriraj novog mrežnog slušatelja (WebSocket klijent u browseru).
        Vraća Queue iz kojeg WebSocket handler čita PCM blokove (int16 mono).
        Audio se gura neovisno o lokalnom monitoru.
        """
        q: Queue = Queue(maxsize=100)
        with self._audio_subscribers_lock:
            self._audio_subscribers.add(q)
        log.info(f"Network audio subscriber added. Total: {len(self._audio_subscribers)}")
        return q

    def remove_audio_subscriber(self, q: Queue):
        """Odjavi mrežnog slušatelja kad se WebSocket zatvori."""
        with self._audio_subscribers_lock:
            self._audio_subscribers.discard(q)
        log.info(f"Network audio subscriber removed. Total: {len(self._audio_subscribers)}")

    def _feed_audio_subscribers(self, data: bytes):
        """
        Gurni PCM blok u queue svakog mrežnog slušatelja.
        Ako je queue pun (klijent ne stiže čitati), preskoči blok za tog
        klijenta — nikad ne blokira dekoder.
        """
        # Kopija seta pod lockom da izbjegnemo mijenjanje tijekom iteracije
        with self._audio_subscribers_lock:
            subs = list(self._audio_subscribers)
        for q in subs:
            try:
                q.put_nowait(data)
            except Exception:
                pass  # queue pun — preskoči (drop) za tog klijenta

    def set_monitor_volume(self, volume: float):
        """
        Postavi glasnoću audio monitora (preslušavanja).

        Ovo je AUDIO gain — potpuno neovisan o RF gainu (rtl_fm -g). RF gain
        regulira pojačanje prijemnika (i smije se vidjeti u spektru), dok ovaj
        volume regulira samo koliko glasno čuješ u monitoru/browseru.

        Raspon: 0.0 (mute) do 1.0 (100%, puna glasnoća demoduliranog signala).
        """
        try:
            v = float(volume)
        except (TypeError, ValueError):
            return
        # Ograniči na razuman raspon
        self.monitor_volume = max(0.0, min(v, 1.0))
        log.info(f"Audio monitor volume set to {self.monitor_volume:.2f}")

    def _apply_volume(self, pcm: bytes) -> bytes:
        """
        Primijeni monitor_volume na PCM blok (int16 mono) za preslušavanje.
        Vraća skaliranu kopiju; NE dira originalni `pcm` koji ide u dekoder.
        Kad je volume 1.0, vraća original bez kopiranja (brzi put).
        """
        if self.monitor_volume == 1.0:
            return pcm
        try:
            arr = np.frombuffer(pcm, dtype=np.int16).astype(np.float32)
            arr *= self.monitor_volume
            np.clip(arr, -32768, 32767, out=arr)
            return arr.astype(np.int16).tobytes()
        except Exception:
            return pcm  # u slučaju greške vrati original (bolje nego tišina)

    def get_audio_stream_info(self) -> dict:
        """Info za browser: sample rate i broj kanala trenutnog audio streama."""
        return {
            "sample_rate": self.monitor_sample_rate,
            "channels": 1,
            "format": "s16le",
            "running": self.running,
        }

    def start(
        self,
        audio_device: Optional[int],
        sample_rate: int = 48000,
        modem: str = "Horus Binary v1/v2/v3",
        baud_rate: int = 100,
        use_udp: bool = False,
        udp_port: int = 7355,
        use_rtl_sdr: bool = False,
        rtl_frequency: float = 437.600,
        rtl_gain: int = 0,
        rtl_ppm: int = 0,
        rtl_device: int = 0,
        rtl_bandwidth: int = 3000,
        rtl_bias_tee: bool = False,
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

        # ---------------------------------------------------------------
        # LoRa modem -- ne koristi horusdemodlib nego vanjski lorarx alat
        # ---------------------------------------------------------------
        if modem_cfg.get("is_lora"):
            if not LORA_AVAILABLE or LoraDecoder is None:
                raise RuntimeError("LoRa decoder modul nije dostupan (provjeri lora_decoder.py)")

            self.is_lora_mode = True

            # Postavi FFT parametre za LoRa (1 MHz bandwidth, veći NFFT)
            self.rtl_mode = True
            self.sample_rate = 1_000_000
            self.nfft = 16384
            self.fft_stride = 16384
            # FM-demoduliran audio u RTL modu izlazi na IQ rate-u; browseru
            # ga šaljemo na tom rate-u (AudioContext će resamplati).
            self.monitor_sample_rate = 1_000_000

            freq_mhz = (
                rtl_frequency if (use_rtl_sdr and rtl_frequency)
                else modem_cfg.get("lora_frequency_mhz", 433.775)
            )

            freq_hz = int(freq_mhz * 1e6)
            self.rtl_center_freq_hz = freq_hz
            self.rtl_target_freq_hz = freq_hz
            self.rtl_offset_hz = 0
            self._init_fft()

            # FFT callback za spektar — konvertira u8 IQ u int16 za _process_fft_samples
            def _lora_fft_callback(raw_u8: bytes):
                try:
                    arr = np.frombuffer(raw_u8, dtype=np.uint8).astype(np.int16)
                    arr = (arr - 128) * 256  # u8 -> i16 centered
                    self._process_fft_samples(arr.tobytes())
                except Exception:
                    pass

            self.lora_decoder = LoraDecoder(
                packet_callback=self._on_lora_position,
                status_callback=self.status_callback,
                message_callback=self._on_lora_message,
                fft_callback=_lora_fft_callback,
            )

            # Koristi baud_rate iz UI kao spread_factor override
            sf = baud_rate if baud_rate in range(5, 13) else modem_cfg.get("lora_spread_factor", 12)

            self.lora_decoder.start(
                frequency_mhz=freq_mhz,
                rtl_device=rtl_device,
                rtl_gain=rtl_gain,
                rtl_ppm=rtl_ppm,
                bandwidth_idx=modem_cfg.get("lora_bandwidth_idx", 7),
                spread_factor=sf,
            )
            self.running = True
            log.info(f"LoRa decoder started: {modem} @ {freq_mhz} MHz (FFT enabled, 1 MHz BW)")
            return

        # ---------------------------------------------------------------
        # Horus / RTTY -- postojeća logika
        # ---------------------------------------------------------------
        mode_id = getattr(Mode, modem_cfg["id"])
        tone_spacing = modem_cfg["default_tone_spacing"]

        # Pamti sample rate i inicijaliziraj FFT state
        self.sample_rate = sample_rate
        # Audio koji ide browseru je na ulaznom sample rate-u (mono int16)
        self.monitor_sample_rate = sample_rate
        self._init_fft()

        # Setup modem
        # Kad je RTL-SDR aktivan, rtl_fm -M raw outputira IQ parove (I,Q,I,Q...)
        # pa moramo koristiti stereo_iq=True (ekvivalent -q flaga u horus_demod).
        # Ovo je kako rade sve novije oficijalne skripte (start_rtlsdr.sh, itd.)
        self.modem = HorusLib(
            mode=mode_id,
            rate=baud_rate,
            tone_spacing=tone_spacing,
            stereo_iq=use_rtl_sdr,
            callback=self._on_packet,
            sample_rate=sample_rate,
        )

        # VAŽNO: postavi running=True PRIJE pokretanja audio izvora
        # jer rtl_reader i udp_loop threadovi provjeravaju self.running u petlji
        self.running = True

        # Setup audio source
        if use_rtl_sdr:
            freq_hz = int(rtl_frequency * 1e6)
            self._start_rtl_sdr(
                frequency_hz=freq_hz,
                gain=rtl_gain,
                ppm_offset=rtl_ppm,
                device_index=rtl_device,
                bandwidth=rtl_bandwidth,
                bias_tee=rtl_bias_tee,
                sample_rate=sample_rate,
            )
        elif use_udp:
            self._start_udp(sample_rate, udp_port)
        else:
            self._start_pyaudio(audio_device, sample_rate)

        src = "RTL-SDR" if use_rtl_sdr else ("UDP" if use_udp else "PyAudio")
        log.info(f"Started: modem={modem} rate={baud_rate} fs={sample_rate} src={src}")

    def stop(self):
        if not self.running:
            return

        # LoRa mode - zaustavi lorarx i exit (ostala čišćenja nisu relevantna)
        if self.is_lora_mode:
            try:
                if self.lora_decoder:
                    self.lora_decoder.stop()
                    self.lora_decoder = None
            except Exception as e:
                log.exception(f"Error stopping LoRa: {e}")
            self.is_lora_mode = False
            self.running = False
            # Reset FFT state
            self.rtl_mode = False
            self.rtl_center_freq_hz = 0
            self.rtl_target_freq_hz = 0
            self.rtl_offset_hz = 0
            self.sample_buffer = bytearray(b"")
            self.peak_hold = None
            self.fft_window = None
            self.fft_scale = None
            self.fft_mask = None
            self.nfft = 8192
            self.fft_stride = 8192
            for attr in ('_fft_logged', '_fft_warning_logged'):
                if hasattr(self, attr):
                    delattr(self, attr)
            log.info("Stopped (LoRa mode).")
            return

        try:
            if self.stream:
                self.stream.stop_stream()
                self.stream.close()
                self.stream = None
        except Exception as e:
            log.exception(f"Error closing stream: {e}")

        # Zaustavi RTL-SDR ako je aktivan
        self._stop_rtl_sdr()

        try:
            if self.modem:
                self.modem.close()
                self.modem = None
        except Exception as e:
            log.exception(f"Error closing modem: {e}")

        # Zaustavi audio monitor ako je aktivan
        self.stop_monitor()

        self.running = False
        self.rtl_mode = False
        self.rtl_center_freq_hz = 0
        self.rtl_target_freq_hz = 0
        self.rtl_offset_hz = 0
        self.sample_buffer = bytearray(b"")
        self.peak_hold = None
        self.snr_history.clear()
        # Reset debug flagova
        for attr in ('_audio_logged', '_udp_first_logged', '_fft_logged', '_fft_warning_logged'):
            if hasattr(self, attr):
                delattr(self, attr)
        log.info("Stopped.")

    # ------------------------------------------------------------------
    # LoRa Packet Handlers
    # ------------------------------------------------------------------
    def _on_lora_position(self, decoded: dict):
        """
        Pozvano iz LoraDecoder-a za APRS position pakete.
        Tretira se kao Horus balon paket - prolazi kroz isti tok
        (flight_analyzer, sondehub, websocket).
        """
        try:
            self.packet_callback(decoded)
        except Exception as e:
            log.exception(f"Error in LoRa position callback: {e}")

    def _on_lora_message(self, msg: dict):
        """
        Pozvano iz LoraDecoder-a za sve pakete (position, status, message, raw).
        Emitira WebSocket status poruku za real-time log prikaz.
        """
        try:
            self.status_callback({
                "type": "lora_message",
                **msg,
            })
        except Exception as e:
            log.exception(f"Error in LoRa message callback: {e}")

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
        # Volume se primjenjuje samo na kopiju za preslušavanje; `data` koji je
        # već otišao u modem (gore) ostaje netaknut.
        if self.monitor_enabled or self._audio_subscribers:
            play_data = self._apply_volume(data)
            if self.monitor_enabled:
                try:
                    self._monitor_queue.put_nowait(play_data)
                except Exception:
                    pass  # queue pun, preskoči blok (bolje nego blokirati dekoder)
            # Mrežni audio subscriberi (browser na udaljenom računalu) — neovisno
            # o lokalnom monitoru. Gura iste PCM blokove u queue svakog klijenta.
            if self._audio_subscribers:
                self._feed_audio_subscribers(play_data)

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
                    # Audio monitor — stavi UDP audio u queue (skalirana kopija;
                    # uzorci u modem su već poslani gore i ostaju netaknuti)
                    if self.monitor_enabled or self._audio_subscribers:
                        play_data = self._apply_volume(data)
                        if self.monitor_enabled:
                            try:
                                self._monitor_queue.put_nowait(play_data)
                            except Exception:
                                pass
                        # Mrežni subscriberi (browser na udaljenom računalu)
                        if self._audio_subscribers:
                            self._feed_audio_subscribers(play_data)
                except socket.timeout:
                    continue
                except Exception as e:
                    log.exception(f"UDP loop error: {e}")
                    break
            s.close()

        self.udp_thread = Thread(target=udp_loop, daemon=True)
        self.udp_thread.start()

    # ------------------------------------------------------------------
    # RTL-SDR Direct — koristi rtl_fm za direktan prijem
    # ------------------------------------------------------------------
    @staticmethod
    def _find_rtl_tool(name: str) -> Optional[str]:
        """
        Pronađi RTL-SDR alat (rtl_fm, rtl_test itd.).
        Traži redom:
          1. Isti folder gdje je horus_bridge.py (backend root)
          2. backend/rtl-sdr/ podfolder
          3. PyInstaller _internal/rtl-sdr/ (frozen .exe build)
          4. Folder gdje je .exe (PyInstaller frozen)
          5. Sistemski PATH
        Na Windowsu dodaje .exe ako treba.
        """
        import platform
        import shutil

        base_dir = Path(__file__).parent
        exe = f"{name}.exe" if platform.system() == "Windows" else name

        # 1. Isti folder kao backend
        local = base_dir / exe
        if local.is_file():
            return str(local)

        # 2. rtl-sdr podfolder
        sub = base_dir / "rtl-sdr" / exe
        if sub.is_file():
            return str(sub)

        # 3. PyInstaller frozen: _MEIPASS / rtl-sdr
        if getattr(sys, 'frozen', False):
            meipass = Path(sys._MEIPASS)
            frozen_sub = meipass / "rtl-sdr" / exe
            if frozen_sub.is_file():
                return str(frozen_sub)
            # 4. Folder gdje je .exe
            exe_dir = Path(sys.executable).parent
            exe_local = exe_dir / exe
            if exe_local.is_file():
                return str(exe_local)
            exe_sub = exe_dir / "rtl-sdr" / exe
            if exe_sub.is_file():
                return str(exe_sub)

        # 5. Sistemski PATH
        found = shutil.which(name)
        if found:
            return found

        return None

    def _start_rtl_sdr(self, frequency_hz: int, gain: int = 0,
                       ppm_offset: int = 0, device_index: int = 0,
                       bandwidth: int = 3000, bias_tee: bool = False,
                       sample_rate: int = 48000):
        """
        Pokreni rtl_fm proces za Horus Binary dekodiranje.

        Koristi se identična konfiguracija kao u oficijlanoj docker_single.sh:
          rtl_fm -M raw -F9 -s 48000 -f <freq>

        -M raw = sirovi signed 16-bit IQ (interleaved I,Q,I,Q,...)
        -s 48000 = sample rate
        -F9 = FIR decimation filter size 9

        horus_demod (i HorusLib C wrapper) očekuje upravo ovaj format.
        """
        rtl_fm_path = self._find_rtl_tool("rtl_fm")
        if not rtl_fm_path:
            raise RuntimeError(
                "rtl_fm not found. Stavi rtl_fm(.exe) u isti folder kao main.py, "
                "ili u podfolder rtl-sdr/, ili instaliraj rtl-sdr alate u PATH."
            )

        # -M raw = signed int16 IQ parovi (I,Q,I,Q,...) — isti format
        # koji koristi oficijalna docker_single.sh skripta.
        # -F9 = FIR decimation filter
        # -s 48000 = sample rate
        #
        # Direktno tuniranje na traženu frekvenciju (bez offset-a)
        sdr_freq = frequency_hz

        # Postavi RTL mod za FFT — kompleksni IQ FFT s RF frekvencijskom osi
        self.rtl_mode = True
        self.rtl_center_freq_hz = sdr_freq
        self.rtl_target_freq_hz = frequency_hz
        self.rtl_offset_hz = 0

        cmd = [
            rtl_fm_path,
            "-M", "raw",
            "-F9",
            "-s", str(sample_rate),
            "-p", str(ppm_offset),
            "-d", str(device_index),
        ]
        if gain > 0:
            cmd.extend(["-g", str(gain)])
        if bias_tee:
            cmd.extend(["-T"])
        cmd.extend(["-f", str(sdr_freq)])

        log.info(f"RTL-SDR starting: {' '.join(cmd)}")
        log.info(f"  Target freq: {frequency_hz} Hz, SDR tuned: {sdr_freq} Hz (direct, no offset)")
        log.info(f"  Signal should appear at center of spectrum")

        try:
            self.rtl_process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
            )
        except Exception as e:
            raise RuntimeError(f"Failed to start rtl_fm: {e}")

        def rtl_reader():
            """Čitaj IQ podatke iz rtl_fm i šalji u modem + FFT + monitor."""
            # rtl_fm -M raw -s 48000 outputira signed int16 IQ parove
            # 48000 IQ parova/sek × 2 kanala × 2 bajta = 192000 bajtova/sek
            block_size = 8192 * 2
            blocks_read = 0
            prev_phase = 0.0  # za FM demodulaciju za audio monitor

            while self.running and self.rtl_process and self.rtl_process.poll() is None:
                try:
                    data = self.rtl_process.stdout.read(block_size)
                    if not data:
                        break
                    blocks_read += 1

                    if blocks_read <= 3:
                        iq = np.frombuffer(data, dtype=np.int16)
                        raw_peak = int(np.max(np.abs(iq))) if len(iq) > 0 else 0
                        log.info(
                            f"RTL-SDR block #{blocks_read}: {len(data)} bytes IQ, "
                            f"raw_peak={raw_peak}"
                        )

                    # 1) MODEM — šalji sirove IQ bajtove DIREKTNO
                    #    HorusLib interno radi FSK detekciju na IQ podacima
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
                            log.exception(f"RTL-SDR modem error: {e}")

                    # 2) FFT — šalji sirove IQ podatke DIREKTNO na FFT
                    #    U RTL modu, _process_fft_samples radi kompleksni FFT
                    #    na IQ parovima i prikazuje pravi RF spektar.
                    self._process_fft_samples(data)

                    # 3) AUDIO MONITOR — FM demodulacija IQ → mono audio
                    #    Za preslušavanje (lokalni zvučnik) i/ili mrežne
                    #    subscribere (browser na udaljenom računalu).
                    if self.monitor_enabled or self._audio_subscribers:
                        try:
                            iq = np.frombuffer(data, dtype=np.int16)
                            if len(iq) >= 4:
                                i_ch = iq[0::2].astype(np.float64)
                                q_ch = iq[1::2].astype(np.float64)

                                # Izračunaj instantanu fazu
                                phase = np.arctan2(q_ch, i_ch)

                                # FM demodulacija: diferencijalna faza
                                dphase = np.diff(phase)
                                dphase = np.where(dphase > np.pi, dphase - 2*np.pi, dphase)
                                dphase = np.where(dphase < -np.pi, dphase + 2*np.pi, dphase)

                                # Skaliraj na int16 raspon. RTL FM-demod audio je
                                # ~30% glasniji od UDP-a, pa primijeni atenuaciju
                                # da glasnoća preslušavanja bude usklađena.
                                audio = (
                                    dphase * (32767.0 / np.pi) * self._rtl_audio_attenuation
                                ).clip(-32767, 32767).astype(np.int16)
                                audio_data = audio.tobytes()

                                # AUDIO gain (monitor volume) — neovisno o RF gainu.
                                # Primijeni samo na kopiju za preslušavanje; uzorci
                                # koji su otišli u modem (gore) ostaju netaknuti.
                                play_data = self._apply_volume(audio_data)

                                if self.monitor_enabled:
                                    try:
                                        self._monitor_queue.put_nowait(play_data)
                                    except Exception:
                                        pass
                                if self._audio_subscribers:
                                    self._feed_audio_subscribers(play_data)
                        except Exception:
                            pass

                except Exception as e:
                    if self.running:
                        log.exception(f"RTL-SDR read error: {e}")
                    break

            log.info(f"RTL-SDR reader thread ended after {blocks_read} blocks.")

        def rtl_stderr_reader():
            """Čitaj rtl_fm stderr poruke (info, upozorenja) u realnom vremenu."""
            try:
                for line in iter(self.rtl_process.stderr.readline, b''):
                    msg = line.decode('utf-8', errors='replace').strip()
                    if msg:
                        log.info(f"rtl_fm: {msg}")
            except Exception:
                pass

        self.rtl_thread = Thread(target=rtl_reader, daemon=True)
        self.rtl_thread.start()
        # Stderr reader — da vidimo rtl_fm poruke u logu
        Thread(target=rtl_stderr_reader, daemon=True).start()

    def _stop_rtl_sdr(self):
        """Zaustavi rtl_fm proces."""
        if self.rtl_process:
            try:
                self.rtl_process.terminate()
                self.rtl_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.rtl_process.kill()
            except Exception as e:
                log.warning(f"Error stopping rtl_fm: {e}")
            self.rtl_process = None
        self.rtl_thread = None

    @staticmethod
    def detect_rtl_sdr_devices() -> list[dict]:
        """Detektiraj spojene RTL-SDR uređaje pomoću rtl_test."""
        result = []

        # Provjeri da li je rtl_fm dostupan
        rtl_fm_path = HorusBridge._find_rtl_tool("rtl_fm")
        if not rtl_fm_path:
            return result

        # Koristi rtl_test -t za detekciju uređaja (kratki test)
        rtl_test_path = HorusBridge._find_rtl_tool("rtl_test")

        # Pokušaj sa rtl_test prvo
        try:
            proc = subprocess.run(
                [rtl_test_path or "rtl_test", "-t"],
                capture_output=True, text=True, timeout=5,
            )
            output = proc.stderr + proc.stdout
            # Parsiraj output za uređaje
            # Tipični output: "Found 1 device(s):"
            #                  "  0:  Realtek, RTL2838UHIDIR, SN: 00000001"
            import re
            device_lines = re.findall(
                r'(\d+):\s+(.+?)(?:,\s*(.+?))?(?:,\s*SN:\s*(\S+))?$',
                output, re.MULTILINE,
            )
            for match in device_lines:
                idx = int(match[0])
                name = match[1].strip()
                model = match[2].strip() if match[2] else ""
                sn = match[3].strip() if match[3] else ""
                full_name = f"{name}"
                if model:
                    full_name += f" {model}"
                result.append({
                    "index": idx,
                    "name": full_name,
                    "serial": sn,
                })

            # Ako nismo dobili uređaje iz parsiranja, ali output sadrži "Found N device"
            if not result:
                found_match = re.search(r'Found (\d+) device', output)
                if found_match and int(found_match.group(1)) > 0:
                    # Parsiraj gain range
                    gain_match = re.search(
                        r'Supported gain values.*?:\s*([\d., ]+)', output
                    )
                    gain_range = gain_match.group(1).strip() if gain_match else ""
                    result.append({
                        "index": 0,
                        "name": "RTL-SDR",
                        "serial": "",
                        "gain_range": gain_range,
                    })

            # Dohvati gain range iz rtl_test outputa
            import re as _re
            gain_match = _re.search(
                r'Supported gain values.*?:\s*([\d., ]+)', output
            )
            if gain_match and result:
                gain_str = gain_match.group(1).strip()
                gains = [float(g.strip()) for g in gain_str.split(',') if g.strip()]
                for dev in result:
                    dev["gain_range"] = f"{min(gains):.1f}-{max(gains):.1f} dB" if gains else ""
                    dev["gains"] = gains

        except FileNotFoundError:
            log.warning("rtl_test not found, trying rtl_fm detection")
        except subprocess.TimeoutExpired:
            log.warning("rtl_test timed out")
        except Exception as e:
            log.warning(f"RTL-SDR detection error: {e}")

        return result

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
                software_version="1.9",
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
                software_version="1.9",
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

        if self.rtl_mode:
            # RTL-SDR IQ mod: FFT na kompleksnom signalu
            # Frekvencijski raspon je ±sample_rate/2 oko SDR tune frekvencije
            # fftfreq za complex FFT daje [-fs/2, ..., 0, ..., fs/2-1]
            baseband_freqs = np.fft.fftshift(
                np.fft.fftfreq(self.nfft, d=1.0 / self.sample_rate)
            )
            # Apsolutne RF frekvencije = SDR_tune_freq + baseband_offset
            self.fft_scale = baseband_freqs + self.rtl_center_freq_hz

            # Maska: prikaži ±(sample_rate/2 - 500) Hz oko centra SDR-a
            # tj. skoro cijeli raspon osim rubova
            margin = 500  # Hz od rubova
            freq_low = self.rtl_center_freq_hz - self.sample_rate / 2 + margin
            freq_high = self.rtl_center_freq_hz + self.sample_rate / 2 - margin
            self.fft_mask = (self.fft_scale >= freq_low) & (self.fft_scale <= freq_high)
            log.info(
                f"FFT init (RTL IQ mode): center={self.rtl_center_freq_hz} Hz, "
                f"target={self.rtl_target_freq_hz} Hz, "
                f"offset={self.rtl_offset_hz} Hz, "
                f"display range: {freq_low:.0f} - {freq_high:.0f} Hz"
            )
        else:
            # Audio mod: klasični prikaz 100-4000 Hz
            freqs = np.fft.fftshift(
                np.fft.fftfreq(self.nfft, d=1.0 / self.sample_rate)
            )
            self.fft_scale = freqs
            self.fft_mask = (freqs >= self.fft_range[0]) & (freqs <= self.fft_range[1])

        self.sample_buffer = bytearray(b"")
        self.fft_last_emit = 0.0

    def _process_fft_samples(self, raw_data: bytes):
        """
        Dodaj bytes u buffer i kad je dovoljno uzoraka, napravi FFT.
        Rezultat se šalje preko status_callback s tipom 'fft'.

        U RTL modu: raw_data su IQ parovi (int16 I, int16 Q, ...) i radi se
        kompleksni FFT koji prikazuje pravi RF spektar centriran oko tune frekvencije.

        U audio modu: raw_data je mono audio (int16) i radi se realni FFT.
        """
        if self.fft_window is None:
            if not hasattr(self, '_fft_warning_logged'):
                log.warning("FFT window not initialized!")
                self._fft_warning_logged = True
            return

        self.sample_buffer += raw_data

        if self.rtl_mode:
            # IQ mod: trebamo nfft IQ parova = nfft * 4 bytes (2x int16 po paru)
            bytes_needed = self.nfft * 4
        else:
            # Audio mod: trebamo nfft samplea = nfft * 2 bytes (int16)
            bytes_needed = self.nfft * 2

        if len(self.sample_buffer) < bytes_needed:
            return

        # Rate-limit
        now = time.time()
        if now - self.fft_last_emit < self.fft_min_interval:
            if self.rtl_mode:
                self.sample_buffer = self.sample_buffer[self.nfft * 4:]
            else:
                self.sample_buffer = self.sample_buffer[self.fft_stride * 2:]
            return
        self.fft_last_emit = now

        try:
            if self.rtl_mode:
                # === RTL IQ MOD: kompleksni FFT ===
                iq_raw = np.frombuffer(
                    bytes(self.sample_buffer[:bytes_needed]), dtype=np.int16
                ).astype(np.float64) / 32768.0
                self.sample_buffer = self.sample_buffer[self.nfft * 4:]

                # Razdvoji I i Q kanale i napravi kompleksni signal
                i_ch = iq_raw[0::2]
                q_ch = iq_raw[1::2]
                iq_complex = i_ch + 1j * q_ch

                # Peak dBFS iz IQ magnitude
                peak = float(np.abs(iq_complex).max())
                dbfs = 20.0 * np.log10(peak) if peak > 0 else -120.0

                # Kompleksni FFT — daje puni spektar oko centra
                spectrum = np.fft.fftshift(np.fft.fft(iq_complex * self.fft_window))
                magnitudes = np.abs(spectrum)
                magnitudes = np.where(magnitudes > 0, magnitudes, 1e-12)
                spectrum_db = 20.0 * np.log10(magnitudes) - 20.0 * np.log10(self.nfft)

            else:
                # === AUDIO MOD: realni FFT (originalni kod) ===
                samples = np.frombuffer(
                    bytes(self.sample_buffer[:self.nfft * 2]), dtype=np.int16
                ).astype(np.float64) / 32768.0
                self.sample_buffer = self.sample_buffer[self.fft_stride * 2:]

                peak = float(np.abs(samples).max())
                dbfs = 20.0 * np.log10(peak) if peak > 0 else -120.0

                spectrum = np.fft.fftshift(np.fft.fft(samples * self.fft_window))
                magnitudes = np.abs(spectrum)
                magnitudes = np.where(magnitudes > 0, magnitudes, 1e-12)
                spectrum_db = 20.0 * np.log10(magnitudes) - 20.0 * np.log10(self.nfft)

            # Ograniči na prikazni range (audio 100-4000 Hz ili IQ RF range)
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
                mode_str = "IQ" if self.rtl_mode else "audio"
                log.info(f"First FFT ({mode_str}): {len(freqs_small)} points, dBFS={dbfs:.1f}, bin_width={self.sample_rate/self.nfft:.1f} Hz")
                self._fft_logged = True

            fft_payload = {
                "type": "fft",
                "freqs": freqs_small.round(1).tolist(),
                "spectrum": spec_small.round(1).tolist(),
                "peak_hold": peak_small.round(1).tolist(),
                "dbfs": round(dbfs, 1),
                "peak_freq": float(freqs_out[int(np.argmax(spectrum_out))]),
                "peaks": top_peaks,
                "noise_floor": round(median_db, 1),
            }

            # U RTL modu dodaj info za frontend da zna prikazati RF frekvencije
            if self.rtl_mode:
                fft_payload["rtl_mode"] = True
                fft_payload["center_freq_hz"] = self.rtl_center_freq_hz
                fft_payload["target_freq_hz"] = self.rtl_target_freq_hz
                fft_payload["target_freq_mhz"] = self.rtl_target_freq_hz / 1e6

            self.status_callback(fft_payload)
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
