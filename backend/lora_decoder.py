"""
LoRa Decoder
============
Pomoćni modul za HorusBridge - dodaje LoRa APRS prijem.

LoRa APRS baloni (TTGO trackeri, DL1NUX format itd.) šalju standardne APRS
position pakete preko LoRa modulacije. Ovaj modul:

  1. Pokreće `rtl_sdr | lorarx` pipeline (lorarx je OE5DXL alat)
  2. Sluša UDP/JSON output od lorarx-a
  3. Parsira APRS frame iz base64 payload-a
  4. Vraća paket u ISTOM formatu kao horusdemodlib decode_packet/parse_ukhas_string
     (callsign, latitude, longitude, altitude, time, snr, ...) tako da ide
     ravno u postojeći flight_analyzer, mapu, povijest i grafove.

Lanac procesa:
    rtl_sdr  ->  pipe  ->  lorarx  ->  UDP/JSON  ->  ovaj modul  ->  packet_callback

`lorarx` se preuzima sa http://oe5dxl.hamspirit.at:8025/aprs/bin/
i stavlja u rtl-sdr/ podfolder (isti princip kao rtl_fm).

Trenutno podržava:
  - LoRa APRS (433.775 MHz, BW=125 kHz, SF=12, CR=from header)

Output paketa je u istom formatu kao Horus Binary paketi
(callsign, latitude, longitude, altitude, time, snr) pa ide ravno u
postojeći flight_analyzer / WebSocket / mapu.
"""

from __future__ import annotations

import base64
import json
import logging
import platform
import re
import shutil
import socket
import subprocess
import sys
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from threading import Thread
from typing import Callable, Optional

log = logging.getLogger("lora-decoder")


# -----------------------------------------------------------------------------
# Konfiguracija - LoRa APRS standardno
# -----------------------------------------------------------------------------
DEFAULT_FREQUENCY_MHZ = 433.775
DEFAULT_BANDWIDTH_IDX = 7    # -b 7 = 125 kHz
DEFAULT_SPREAD_FACTOR = 12   # -s 12
DEFAULT_SAMPLE_RATE = 1_000_000
DEFAULT_UDP_PORT = 5100

LORA_APRS_PREFIX = b"\xff\x01"  # OE5BPA framing prefix


# -----------------------------------------------------------------------------
# APRS Parser
# -----------------------------------------------------------------------------
# Minimalni parser za APRS position pakete (formati: !, =, /, @).
# Ne pokriva sve APRS specifikacije, ali je sasvim dovoljan za LoRa APRS
# trackere (DL1NUX, OE5BPA, TTGO T-Beam, APRS434 itd.).
#
# Primjer payload-a iz lorarx -v:
#   <FF><01>DL1NUX-12>APLT00,WIDE1-1:!5014.06N/01059.01E[165/000/A=001097 !wrx!
#   <FF><01>DL1NUX-11>APRS:!5014.07N/01059.02E>077/000/A=001100 Batt=3.67V LoRa 1W Tracker
#
# Prefiks <FF><01> je LoRa APRS framing (0xFF 0x01) iz OE5BPA specifikacije.

# Header: SOURCE>DEST[,DIGIPATH...]:INFO
APRS_HEADER_RE = re.compile(
    r"^(?P<src>[A-Z0-9\-]+)>(?P<dest>[A-Z0-9\-]+)(?:,(?P<path>[A-Z0-9\-,\*]+))?:(?P<info>.*)$",
    re.DOTALL,
)

# Position bez timestampa: ! ili = LAT SYM1 LON SYM2 [extension] [comment]
# Lat:  DDMM.mmN/S   Lon: DDDMM.mmE/W
# Primjer: !5014.06N/01059.01E[165/000/A=001097
POSITION_RE = re.compile(
    r"^[!=/@]?"
    r"(?P<lat>\d{4}\.\d{2,5})(?P<lat_dir>[NS])"
    r"(?P<sym_table>.)"
    r"(?P<lon>\d{5}\.\d{2,5})(?P<lon_dir>[EW])"
    r"(?P<sym_code>.)"
    r"(?P<rest>.*)$",
    re.DOTALL,
)

# Altitude /A=NNNNNN (feet)
ALTITUDE_RE = re.compile(r"/A=(\-?\d{6})")

# Course/speed: CCC/SSS (course 0-360, speed knots)
COURSE_SPEED_RE = re.compile(r"^(\d{3})/(\d{3})")


def _parse_aprs_lat(lat_str: str, direction: str) -> float:
    """DDMM.mm -> decimalni stupnjevi."""
    deg = int(lat_str[:2])
    minutes = float(lat_str[2:])
    val = deg + minutes / 60.0
    if direction == "S":
        val = -val
    return val


def _parse_aprs_lon(lon_str: str, direction: str) -> float:
    """DDDMM.mm -> decimalni stupnjevi."""
    deg = int(lon_str[:3])
    minutes = float(lon_str[3:])
    val = deg + minutes / 60.0
    if direction == "W":
        val = -val
    return val


def parse_aprs_packet(payload: bytes) -> Optional[dict]:
    """
    Parsira sirovi LoRa frame.

    Podržava:
      - LoRa APRS (tekstualni APRS frame s callsignom, pozicijom, itd.)
      - LoRaWAN (binarni MAC frame - prikazuje se kao hex dump)

    Vraća dict sa `_aprs_type` poljem:
      - "position": ima koordinate (lat/lon) → ide na mapu kao balon paket
      - "message" / "status" / "telemetry" / "raw": samo za tekstualni log
      - "lorawan": LoRaWAN MAC frame (hex dump)
    """
    try:
        # Provjeri da li je LoRaWAN frame (binarni, ne ASCII)
        # LoRaWAN MHDR: MType (3 bita) + RFU (3 bita) + Major (2 bita)
        # Tipovi: 0x00=JoinReq, 0x20=JoinAccept, 0x40=UnconfDataUp, 0x60=UnconfDataDown,
        #         0x80=ConfDataUp, 0xA0=ConfDataDown
        if len(payload) >= 5 and not payload.startswith(LORA_APRS_PREFIX):
            mhdr = payload[0]
            mtype = (mhdr >> 5) & 0x07
            if mtype in (0, 1, 2, 3, 4, 5):  # Poznati LoRaWAN MType vrijednosti
                # Provjeri da li je stvarno binarno (ne ASCII tekst)
                try:
                    text_check = payload.decode("ascii")
                    # Ako je čisti ASCII s APRS headerom, nije LoRaWAN
                    if ">" in text_check and ":" in text_check:
                        pass  # Nastavi s APRS parsingom
                    elif not text_check.isprintable():
                        raise UnicodeDecodeError("ascii", b"", 0, 1, "binary")
                except (UnicodeDecodeError, ValueError):
                    # Binarni podaci - LoRaWAN frame
                    frame_types = {
                        0: "Join Request", 1: "Join Accept",
                        2: "Unconf Data Up", 3: "Unconf Data Down",
                        4: "Conf Data Up", 5: "Conf Data Down",
                    }
                    result = {
                        "_aprs_type": "lorawan",
                        "callsign": "LoRaWAN",
                        "raw_text": payload.hex(),
                        "raw_hex": payload.hex(),
                        "payload_len": len(payload),
                        "lorawan_mhdr": f"0x{mhdr:02X}",
                        "lorawan_mtype": mtype,
                        "lorawan_frame_type": frame_types.get(mtype, f"Unknown({mtype})"),
                    }
                    # DevAddr za data frame-ove (MType 2-5)
                    if mtype >= 2 and len(payload) >= 5:
                        dev_addr = payload[4:0:-1].hex()  # Little-endian
                        result["lorawan_dev_addr"] = dev_addr
                    return result

        # Ukloni LoRa APRS prefix ako postoji
        # Varijante: \x3C\xFF\x01 (OE5DXL 3-byte) ili \xFF\x01 (OE5BPA 2-byte)
        if payload[:3] == b"\x3c\xff\x01":
            payload = payload[3:]
        elif payload.startswith(LORA_APRS_PREFIX):
            payload = payload[len(LORA_APRS_PREFIX):]

        text = payload.decode("utf-8", errors="replace").rstrip("\r\n\x00")
        if not text:
            return None

        # Header parse
        m = APRS_HEADER_RE.match(text)
        if not m:
            # Nije parsabilno - vrati raw
            return {
                "_aprs_type": "raw",
                "raw_text": text,
                "callsign": "?",
            }

        src = m.group("src")
        dest = m.group("dest")
        path = m.group("path") or ""
        info = m.group("info")

        if not info:
            return {
                "_aprs_type": "raw",
                "raw_text": text,
                "callsign": src,
            }

        # Određi APRS tip iz prvog znaka info polja
        info_type = info[0] if info else ""

        # Status message (>)
        if info_type == ">":
            return {
                "_aprs_type": "status",
                "callsign": src,
                "destination": dest,
                "path": path,
                "info": info[1:],  # bez '>'
                "raw_text": text,
            }

        # Message (:)
        if info_type == ":":
            return {
                "_aprs_type": "message",
                "callsign": src,
                "destination": dest,
                "path": path,
                "info": info[1:],
                "raw_text": text,
            }

        # Telemetry (T)
        if info_type == "T":
            return {
                "_aprs_type": "telemetry",
                "callsign": src,
                "destination": dest,
                "path": path,
                "info": info,
                "raw_text": text,
            }

        # Pokušaj parsati position (!, =, /, @)
        pos_m = POSITION_RE.match(info)
        if not pos_m:
            return {
                "_aprs_type": "raw",
                "callsign": src,
                "destination": dest,
                "path": path,
                "info": info,
                "raw_text": text,
            }

        # Parse koordinata
        lat = _parse_aprs_lat(pos_m.group("lat"), pos_m.group("lat_dir"))
        lon = _parse_aprs_lon(pos_m.group("lon"), pos_m.group("lon_dir"))
        rest = pos_m.group("rest")

        # Altitude (/A=NNNNNN u feet, konvertiraj u metre)
        alt_m = ALTITUDE_RE.search(rest)
        altitude = int(alt_m.group(1)) * 0.3048 if alt_m else 0.0

        # Course/speed
        course = 0
        speed_knots = 0
        cs_m = COURSE_SPEED_RE.match(rest)
        if cs_m:
            course = int(cs_m.group(1))
            speed_knots = int(cs_m.group(2))

        # Comment (sve nakon course/speed i altitude)
        comment = rest
        if cs_m:
            comment = rest[len(cs_m.group(0)):]
        comment = comment.strip()

        now = datetime.now(timezone.utc)

        return {
            "_aprs_type": "position",
            "callsign": src,
            "destination": dest,
            "path": path,
            "latitude": lat,
            "longitude": lon,
            "altitude": altitude,
            "course": course,
            "speed_knots": speed_knots,
            "comment": comment,
            "time": now.strftime("%H:%M:%S"),
            "raw_text": text,
            # Horus-kompatibilna polja za flight_analyzer
            "sequence_number": 0,
            "modulation": "LoRa APRS",
        }

    except Exception as e:
        log.exception(f"APRS parse error: {e}")
        return None


# -----------------------------------------------------------------------------
# LoRa Decoder klasa
# -----------------------------------------------------------------------------
class LoraDecoder:
    """
    Pokreće rtl_sdr | lorarx pipeline, prima UDP/JSON pakete,
    parsira APRS i poziva callbacke.
    """

    def __init__(
        self,
        packet_callback: Callable[[dict], None],
        status_callback: Callable[[dict], None],
        message_callback: Optional[Callable[[dict], None]] = None,
        fft_callback: Optional[Callable[[bytes], None]] = None,
    ):
        self.packet_callback = packet_callback
        self.status_callback = status_callback
        self.message_callback = message_callback or (lambda x: None)
        self.fft_callback = fft_callback

        self.running = False
        self.rtl_process: Optional[subprocess.Popen] = None
        self.lorarx_process: Optional[subprocess.Popen] = None
        self.rtl_stderr_thread: Optional[Thread] = None
        self.lorarx_stderr_thread: Optional[Thread] = None
        self.udp_thread: Optional[Thread] = None
        self.tee_thread: Optional[Thread] = None
        self.udp_sock: Optional[socket.socket] = None

        self.current_frequency_mhz = DEFAULT_FREQUENCY_MHZ
        self.udp_port = DEFAULT_UDP_PORT
        self.packet_count = 0
        self.last_packet_time = 0.0
        self.message_log: deque = deque(maxlen=500)

    # -----------------------------------------------------------------
    # Tool discovery
    # -----------------------------------------------------------------
    @staticmethod
    def _find_tool(name: str) -> Optional[str]:
        """Pronađi izvršnu datoteku (rtl_sdr, lorarx) u poznatim lokacijama."""
        base_dir = Path(__file__).parent
        exe = f"{name}.exe" if platform.system() == "Windows" else name

        candidates = [
            base_dir / exe,
            base_dir / "rtl-sdr" / exe,
            base_dir / "lora" / exe,
        ]

        if getattr(sys, "frozen", False):
            meipass = Path(sys._MEIPASS)  # type: ignore[attr-defined]
            candidates.extend([
                meipass / "rtl-sdr" / exe,
                meipass / "lora" / exe,
                Path(sys.executable).parent / exe,
                Path(sys.executable).parent / "rtl-sdr" / exe,
                Path(sys.executable).parent / "lora" / exe,
            ])

        for c in candidates:
            if c.is_file():
                return str(c)

        return shutil.which(name)

    @staticmethod
    def check_availability() -> dict:
        """Provjeri dostupnost rtl_sdr i lorarx alata."""
        is_linux = platform.system() == "Linux"
        rtl_sdr = LoraDecoder._find_tool("rtl_sdr")
        lorarx = LoraDecoder._find_tool("lorarx")
        return {
            "available": bool(is_linux and rtl_sdr and lorarx),
            "platform": platform.system(),
            "linux_only": True,
            "is_linux": is_linux,
            "rtl_sdr": rtl_sdr,
            "lorarx": lorarx,
            "missing": [
                name for name, path in [("rtl_sdr", rtl_sdr), ("lorarx", lorarx)]
                if not path
            ],
        }

    # -----------------------------------------------------------------
    # Start / Stop
    # -----------------------------------------------------------------
    def start(
        self,
        frequency_mhz: float = DEFAULT_FREQUENCY_MHZ,
        rtl_device: int = 0,
        rtl_gain: int = 0,
        rtl_ppm: int = 0,
        bandwidth_idx: int = DEFAULT_BANDWIDTH_IDX,
        spread_factor: int = DEFAULT_SPREAD_FACTOR,
        sample_rate: int = DEFAULT_SAMPLE_RATE,
        udp_port: int = DEFAULT_UDP_PORT,
    ):
        """Pokreni rtl_sdr | lorarx pipeline."""
        if self.running:
            raise RuntimeError("LoraDecoder already running")

        rtl_sdr_path = self._find_tool("rtl_sdr")
        lorarx_path = self._find_tool("lorarx")

        if not rtl_sdr_path:
            raise RuntimeError(
                "rtl_sdr alat nije pronađen. Stavi ga u rtl-sdr/ podfolder."
            )
        if not lorarx_path:
            raise RuntimeError(
                "lorarx nije pronađen. Skini ga sa "
                "http://oe5dxl.hamspirit.at:8025/aprs/bin/ i stavi u rtl-sdr/ "
                "(ili lora/) podfolder. Za Windows treba kompajlirati iz izvora."
            )

        self.current_frequency_mhz = frequency_mhz
        self.udp_port = udp_port

        # rtl_sdr -> stdout (sirovi IQ u8)
        rtl_cmd = [
            rtl_sdr_path,
        ]
        if rtl_gain > 0:
            rtl_cmd.extend(["-g", str(rtl_gain)])
        rtl_cmd.extend([
            "-f", str(int(frequency_mhz * 1e6)),
            "-s", str(sample_rate),
            "-p", str(rtl_ppm),
            "-d", str(rtl_device),
            "-b", "2000",
            "-",
        ])

        # lorarx <- stdin (IQ u8) -> UDP JSON
        lorarx_stdin_arg = "/dev/stdin" if platform.system() != "Windows" else "-"
        lorarx_cmd = [
            lorarx_path,
            "-i", lorarx_stdin_arg,
            "-f", "u8",
            "-v",
            "-N",
            "-b", str(bandwidth_idx),
            "-s", str(spread_factor),
            "-w", "64",
            "-r", str(sample_rate),
            "-W", "50",
            "-J", f"127.0.0.1:{udp_port}",
            "-M", f"{frequency_mhz}",
        ]

        log.info(f"rtl_sdr cmd: {' '.join(rtl_cmd)}")
        log.info(f"lorarx cmd: {' '.join(lorarx_cmd)}")

        # UDP listener PRIJE procesa (da uhvatimo prvi paket)
        self.running = True
        self._start_udp_listener()

        try:
            self.rtl_process = subprocess.Popen(
                rtl_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
            )
        except Exception as e:
            self.running = False
            raise RuntimeError(f"Failed to start rtl_sdr: {e}")

        # Ako imamo fft_callback, koristimo tee thread da IQ podaci
        # idu i u lorarx i u FFT callback istovremeno
        if self.fft_callback:
            try:
                self.lorarx_process = subprocess.Popen(
                    lorarx_cmd,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    bufsize=0,
                )
            except Exception as e:
                self._stop_processes()
                self.running = False
                raise RuntimeError(f"Failed to start lorarx: {e}")

            # Tee thread čita iz rtl_sdr stdout i šalje u oba mjesta
            self.tee_thread = Thread(
                target=self._tee_reader,
                daemon=True,
            )
            self.tee_thread.start()
        else:
            # Bez FFT - direktni pipe
            try:
                self.lorarx_process = subprocess.Popen(
                    lorarx_cmd,
                    stdin=self.rtl_process.stdout,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    bufsize=0,
                )
                # Zatvori rtl stdout u parent procesu jer lorarx ga koristi
                if self.rtl_process.stdout:
                    self.rtl_process.stdout.close()
            except Exception as e:
                self._stop_processes()
                self.running = False
                raise RuntimeError(f"Failed to start lorarx: {e}")

        # Stderr readeri za logging
        self.rtl_stderr_thread = Thread(
            target=self._stderr_reader,
            args=(self.rtl_process, "rtl_sdr"),
            daemon=True,
        )
        self.rtl_stderr_thread.start()

        self.lorarx_stderr_thread = Thread(
            target=self._stderr_reader,
            args=(self.lorarx_process, "lorarx"),
            daemon=True,
        )
        self.lorarx_stderr_thread.start()

        log.info(
            f"LoraDecoder started: freq={frequency_mhz} MHz, "
            f"SF={spread_factor}, BW_idx={bandwidth_idx}, UDP={udp_port}"
        )

    def stop(self):
        """Zaustavi sve procese i threadove."""
        if not self.running:
            return
        log.info("Stopping LoraDecoder...")
        self.running = False
        self._stop_processes()
        log.info("LoraDecoder stopped.")

    def _stop_processes(self):
        """Zaustavi subprocess-e."""
        for proc_attr in ("lorarx_process", "rtl_process"):
            proc = getattr(self, proc_attr, None)
            if proc:
                try:
                    proc.terminate()
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                except Exception:
                    pass
                setattr(self, proc_attr, None)

        if self.udp_sock:
            try:
                self.udp_sock.close()
            except Exception:
                pass
            self.udp_sock = None

    # -----------------------------------------------------------------
    # Tee reader — razdvaja IQ stream u lorarx + FFT callback
    # -----------------------------------------------------------------
    def _tee_reader(self):
        """Čita IQ blokove iz rtl_sdr, šalje u lorarx stdin i fft_callback."""
        BLOCK_SIZE = 16384
        try:
            rtl_stdout = self.rtl_process.stdout
            lorarx_stdin = self.lorarx_process.stdin if self.lorarx_process else None
            if not rtl_stdout:
                return

            while self.running:
                data = rtl_stdout.read(BLOCK_SIZE)
                if not data:
                    break

                # Prosljeđuj u lorarx za dekodiranje
                if lorarx_stdin:
                    try:
                        lorarx_stdin.write(data)
                    except (BrokenPipeError, OSError):
                        break

                # Prosljeđuj u FFT callback za spektar
                if self.fft_callback:
                    try:
                        self.fft_callback(data)
                    except Exception:
                        pass

        except Exception as e:
            if self.running:
                log.exception(f"Tee reader error: {e}")
        finally:
            # Zatvori lorarx stdin kad rtl_sdr prestane slati
            if self.lorarx_process and self.lorarx_process.stdin:
                try:
                    self.lorarx_process.stdin.close()
                except Exception:
                    pass

    # -----------------------------------------------------------------
    # UDP Listener
    # -----------------------------------------------------------------
    def _start_udp_listener(self):
        """Pokreni UDP listener thread za JSON pakete od lorarx-a."""
        self.udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.udp_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.udp_sock.settimeout(2.0)
        self.udp_sock.bind(("127.0.0.1", self.udp_port))
        log.info(f"LoRa UDP listener on 127.0.0.1:{self.udp_port}")

        self.udp_thread = Thread(target=self._udp_loop, daemon=True)
        self.udp_thread.start()

    def _udp_loop(self):
        """Glavni loop UDP listenera."""
        while self.running:
            try:
                data, addr = self.udp_sock.recvfrom(4096)
            except socket.timeout:
                continue
            except OSError:
                break

            try:
                obj = json.loads(data.decode("utf-8"))
                self._handle_lorarx_packet(obj)
            except json.JSONDecodeError as e:
                log.warning(f"Invalid JSON from lorarx: {e}")
            except Exception as e:
                log.exception(f"Error in UDP handler: {e}")

    def _handle_lorarx_packet(self, obj: dict):
        """Obradi JSON paket od lorarx-a."""
        try:
            # lorarx JSON format: {sf, cr, crc, snr, lev, payload, ...}
            payload_b64 = obj.get("payload", "")
            if not payload_b64:
                return

            raw = base64.b64decode(payload_b64)
            if not raw:
                return

            # CRC check
            crc_ok = obj.get("crc", 0)
            if not crc_ok:
                log.debug(f"LoRa packet with bad CRC, ignoring")
                return

            snr_val = obj.get("snr", 0.0)
            now = datetime.now(timezone.utc)

            # Parsaj APRS
            decoded = parse_aprs_packet(raw)
            if not decoded:
                return

            decoded["snr"] = snr_val
            decoded["_lora_sf"] = obj.get("sf")
            decoded["_lora_cr"] = obj.get("cr")
            decoded["_lora_level"] = obj.get("lev")

            aprs_type = decoded.get("_aprs_type", "raw")

            # Position paketi → kao Horus telemetrija
            if aprs_type == "position":
                self.packet_count += 1
                self.last_packet_time = time.time()

                log.info(
                    f"LoRa APRS pos: {decoded.get('callsign', '?')} "
                    f"@ {decoded.get('latitude', 0):.5f},{decoded.get('longitude', 0):.5f} "
                    f"alt={decoded.get('altitude', 0):.0f}m "
                    f"SNR={snr_val:.1f}"
                )

                self.packet_callback(decoded)

            elif aprs_type == "lorawan":
                self.packet_count += 1
                self.last_packet_time = time.time()

                log.info(
                    f"LoRaWAN {decoded.get('lorawan_frame_type', '?')}: "
                    f"DevAddr={decoded.get('lorawan_dev_addr', '?')} "
                    f"{decoded.get('payload_len', 0)}B "
                    f"SNR={snr_val:.1f}"
                )
            else:
                # Tekstualni paket - ide u message log prozor
                log.info(
                    f"LoRa {aprs_type}: {decoded.get('callsign', '?')} "
                    f"{decoded.get('raw_text', '')[:60]}"
                )

            # Uvijek emitiraj message callback (i pozicijski paketi se prikazuju
            # u text log prozoru radi pregleda)
            self.message_callback({
                "rx_time": now.strftime("%H:%M:%S"),
                "type": aprs_type,
                "callsign": decoded.get("callsign", "?"),
                "raw_text": decoded.get("raw_text", ""),
                "snr": snr_val,
                "sf": obj.get("sf"),
                "level": obj.get("lev"),
                "latitude": decoded.get("latitude"),
                "longitude": decoded.get("longitude"),
                "altitude": decoded.get("altitude"),
                "comment": decoded.get("comment"),
            })

            # Dodaj u interni log buffer
            self.message_log.append({
                "rx_time": now.strftime("%H:%M:%S"),
                "type": aprs_type,
                "callsign": decoded.get("callsign", "?"),
                "raw_text": decoded.get("raw_text", ""),
                "raw_hex": decoded.get("raw_hex", ""),
                "snr": snr_val,
                "sf": obj.get("sf"),
                "latitude": decoded.get("latitude"),
                "longitude": decoded.get("longitude"),
                "altitude": decoded.get("altitude"),
                "comment": decoded.get("comment"),
            })

        except Exception as e:
            log.exception(f"Error handling lorarx packet: {e}")

    def get_message_log(self, limit: int = 100) -> list:
        """Vrati zadnjih `limit` poruka iz log buffer-a (za UI poll)."""
        msgs = list(self.message_log)
        return msgs[-limit:]

    # -----------------------------------------------------------------
    # Stderr readers
    # -----------------------------------------------------------------
    def _stderr_reader(self, proc: subprocess.Popen, name: str):
        """Čita stderr od subprocess-a i logira."""
        try:
            if proc.stderr is None:
                return
            for line in iter(proc.stderr.readline, b""):
                if not self.running:
                    break
                msg = line.decode("utf-8", errors="replace").rstrip()
                if msg:
                    log.info(f"{name}: {msg}")
        except Exception:
            pass
