"""
Flight Analyzer
===============
Prima decoded pakete, akumulira putanju, računa:
- brzinu penjanja (climb rate)
- detekciju bursta (pucanje balona)
- statistiku kvalitete linka
"""

import math
import time
from collections import defaultdict, deque
from datetime import datetime
from typing import Optional


# -----------------------------------------------------------------------------
# Polja koja su "poznata" sustavu i ne spadaju u custom fields
# -----------------------------------------------------------------------------
KNOWN_FIELDS = {
    'callsign', 'time', 'latitude', 'longitude', 'altitude',
    'satellites', 'sats', 'num_sats', 'gps_sats', 'numSV',
    'battery_voltage', 'batt_voltage', 'battery', 'batt', 'vbatt', 'voltage', 'batt_volts',
    'temperature', 'temp', 'ext_temperature', 'int_temperature', 'board_temp',
    'temperature_ext', 'temperature_int',
    'snr', 'f_centre', 'ppm',
    'modulation_detail', 'raw_sentence', 'packet_format', 'ukhas_str',
    'custom_field_names', 'payload_id', 'sequence_number', 'crc_ok',
    # Derivirana polja (dodajemo ih mi)
    'climb_rate', 'horizontal_speed', 'course', 'phase',
    'from_station', 'no_gps_fix', '_rx_time', 'custom_fields',
}

# -----------------------------------------------------------------------------
# Alert sustav - defaultni pragovi
# -----------------------------------------------------------------------------
DEFAULT_ALERT_THRESHOLDS = {
    "battery_low_v": 0.91,
    "temperature_low_c": -50.0,
    "snr_low_db": -5.0,
    "packet_timeout_s": 300,
    "enabled": True,
}


# -----------------------------------------------------------------------------
# Geo helpers
# -----------------------------------------------------------------------------
EARTH_RADIUS = 6371000.0  # m


def haversine(lat1, lon1, lat2, lon2):
    """Udaljenost između dvije GPS točke (m)."""
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS * math.asin(math.sqrt(a))


def bearing(lat1, lon1, lat2, lon2):
    """Smjer (azimut) od točke 1 prema točki 2 (stupnjevi)."""
    lat1, lat2 = math.radians(lat1), math.radians(lat2)
    dlon = math.radians(lon2 - lon1)
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    brng = math.degrees(math.atan2(x, y))
    return (brng + 360) % 360


def elevation_angle(lat1, lon1, alt1, lat2, lon2, alt2):
    """Kut elevacije iz točke 1 prema točki 2 (stupnjevi)."""
    horizontal = haversine(lat1, lon1, lat2, lon2)
    vertical = alt2 - alt1
    if horizontal == 0:
        return 90.0 if vertical > 0 else -90.0
    return math.degrees(math.atan2(vertical, horizontal))



# -----------------------------------------------------------------------------
# Flight Analyzer
# -----------------------------------------------------------------------------
class FlightAnalyzer:
    """Analizira dolazne telemetrijske pakete."""

    def __init__(self):
        self.flights: dict[str, dict] = defaultdict(self._new_flight)
        self.current_callsign: Optional[str] = None
        self.packet_count = 0
        self.crc_fail_count = 0
        self.last_packet_time: Optional[str] = None
        self.station: Optional[dict] = None
        # Alert sustav
        self.alert_thresholds = dict(DEFAULT_ALERT_THRESHOLDS)
        self._last_alert_times: dict[str, float] = {}  # cooldown po tipu
        self._alert_cooldown_s = 30  # ne ponavljaj isti alert unutar 30s
        self._timeout_fired: set[str] = set()  # callsignovi za koje je timeout alert već poslan
        # Custom field tracking (za dinamičke grafove)
        self.known_custom_fields: set[str] = set()

    def _new_flight(self) -> dict:
        return {
            "packets": [],
            "max_altitude": 0.0,
            "max_altitude_time": None,
            "burst_detected": False,
            "burst_time": None,
            "phase": "pre_launch",  # pre_launch | ascent | burst | descent | landed
            "launch_time": None,
            "total_distance_m": 0.0,
            "last_nogps_packet": None,  # zadnji paket bez GPS fix-a (za telemetry prikaz)
        }

    # ------------------------------------------------------------------
    def set_station(self, callsign: str, latitude: float, longitude: float, altitude: float = 0.0):
        self.station = {
            "callsign": callsign,
            "latitude": latitude,
            "longitude": longitude,
            "altitude": altitude,
        }

    def reset(self):
        self.flights.clear()
        self.current_callsign = None
        self.packet_count = 0
        self.crc_fail_count = 0
        self.last_packet_time = None
        self._last_alert_times.clear()
        self._timeout_fired.clear()
        self.known_custom_fields.clear()

    def _normalize_fields(self, packet: dict):
        """
        Horus paketi mogu koristiti različita imena za ista polja.
        Mapiramo ih na standardna imena koja frontend očekuje.
        Custom fieldovi iz Horus v2/v3 mogu imati još drugih imena.
        """
        # Battery voltage - moguća imena
        batt_candidates = ['battery_voltage', 'batt_voltage', 'battery', 'batt',
                           'vbatt', 'voltage', 'batt_volts']
        for name in batt_candidates:
            if name in packet and packet[name] is not None:
                try:
                    val = float(packet[name])
                    # Ako vrijednost izgleda kao mV (npr. 3800), pretvori u V
                    if val > 100:
                        val = val / 1000.0
                    packet['battery_voltage'] = val
                    break
                except (ValueError, TypeError):
                    pass

        # Temperature
        temp_candidates = ['temperature', 'temp', 'ext_temperature', 'int_temperature',
                           'board_temp', 'temperature_ext', 'temperature_int']
        for name in temp_candidates:
            if name in packet and packet[name] is not None:
                try:
                    packet['temperature'] = float(packet[name])
                    break
                except (ValueError, TypeError):
                    pass

        # Satellites
        sat_candidates = ['satellites', 'sats', 'num_sats', 'gps_sats', 'numSV']
        for name in sat_candidates:
            if name in packet and packet[name] is not None:
                try:
                    packet['satellites'] = int(packet[name])
                    break
                except (ValueError, TypeError):
                    pass

        # -------------------------------------------------------------------
        # Custom fields: sve što NIJE u KNOWN_FIELDS je custom polje
        # (ext_humidity, ext_pressure, analog_X, itd.)
        # -------------------------------------------------------------------
        custom = {}
        for key, val in packet.items():
            if key in KNOWN_FIELDS or key.startswith('_'):
                continue
            if val is None:
                continue
            try:
                numeric_val = float(val)
                custom[key] = numeric_val
                self.known_custom_fields.add(key)
            except (ValueError, TypeError):
                # Nije numeričko - spremi kao string
                custom[key] = val
        if custom:
            packet['custom_fields'] = custom

    def _update_phase(self, flight: dict, packet: dict, climb_rate: Optional[float]):
        """Heuristika: detektiraj fazu leta."""
        alt = packet["altitude"]

        if flight["phase"] == "pre_launch":
            # Launch kad altitude poraste iznad 500m ili climb_rate > 2 m/s
            if alt > 500 or (climb_rate and climb_rate > 2):
                flight["phase"] = "ascent"
                flight["launch_time"] = packet["_rx_time"]

        elif flight["phase"] == "ascent":
            # Burst = padaju više od 2 uzastopna paketa, trenutna visina < 95% max
            if len(flight["packets"]) >= 2 and climb_rate is not None and climb_rate < -5:
                if alt < flight["max_altitude"] * 0.97:
                    flight["phase"] = "descent"
                    flight["burst_detected"] = True
                    flight["burst_time"] = flight["max_altitude_time"]

        elif flight["phase"] == "descent":
            # Slijetanje: ispod 500m i mala brzina
            if alt < 500 and climb_rate is not None and abs(climb_rate) < 2:
                flight["phase"] = "landed"

    # ------------------------------------------------------------------
    def get_flight_data(self, callsign: Optional[str] = None) -> Optional[dict]:
        cs = callsign or self.current_callsign
        if not cs or cs not in self.flights:
            return {
                "callsign": None,
                "packets": [],
                "stats": self.get_link_stats(),
                "station": self.station,
            }

        flight = self.flights[cs]
        return {
            "callsign": cs,
            "packets": flight["packets"],
            "max_altitude": flight["max_altitude"],
            "max_altitude_time": flight["max_altitude_time"],
            "burst_detected": flight["burst_detected"],
            "burst_time": flight["burst_time"],
            "phase": flight["phase"],
            "launch_time": flight["launch_time"],
            "total_distance_m": round(flight["total_distance_m"], 1),
            "last_nogps_packet": flight.get("last_nogps_packet"),
            "stats": self.get_link_stats(),
            "station": self.station,
        }

    def get_all_callsigns(self) -> list[str]:
        """Vrati listu svih callsignova koji su primljeni."""
        return list(self.flights.keys())

    def get_all_flights_data(self) -> dict:
        """Vrati podatke za SVE balone odjednom (za multi-balloon prikaz na karti)."""
        result = {
            "callsigns": list(self.flights.keys()),
            "flights": {},
            "station": self.station,
            "stats": self.get_link_stats(),
        }
        for cs in self.flights:
            flight = self.flights[cs]
            result["flights"][cs] = {
                "callsign": cs,
                "packets": flight["packets"],
                "max_altitude": flight["max_altitude"],
                "phase": flight["phase"],
                "burst_detected": flight["burst_detected"],
                "total_distance_m": round(flight["total_distance_m"], 1),
                "last_nogps_packet": flight.get("last_nogps_packet"),
            }
        return result

    def get_link_stats(self) -> dict:
        """Statistika kvalitete linka."""
        all_packets = []
        for f in self.flights.values():
            all_packets.extend(f["packets"])

        if not all_packets:
            return {
                "total_packets": 0,
                "crc_fails": self.crc_fail_count,
                "success_rate": None,
                "snr_min": None,
                "snr_max": None,
                "snr_avg": None,
                "snr_current": None,
            }

        snrs = [p["snr"] for p in all_packets if p.get("snr") is not None]
        total = len(all_packets) + self.crc_fail_count

        return {
            "total_packets": len(all_packets),
            "crc_fails": self.crc_fail_count,
            "success_rate": round(len(all_packets) / total * 100, 1) if total else None,
            "snr_min": round(min(snrs), 1) if snrs else None,
            "snr_max": round(max(snrs), 1) if snrs else None,
            "snr_avg": round(sum(snrs) / len(snrs), 1) if snrs else None,
            "snr_current": round(snrs[-1], 1) if snrs else None,
        }

    # ------------------------------------------------------------------
    # Alert sustav
    # ------------------------------------------------------------------
    def _should_fire_alert(self, alert_type: str) -> bool:
        """Cooldown: ne ponavljaj isti tip alerta prečesto."""
        now = time.time()
        last = self._last_alert_times.get(alert_type, 0)
        if now - last < self._alert_cooldown_s:
            return False
        self._last_alert_times[alert_type] = now
        return True

    def check_alerts(self, packet: dict) -> list[dict]:
        """Provjeri paket i vrati listu alerta koji trebaju biti emitirani."""
        if not self.alert_thresholds.get("enabled", True):
            return []

        alerts = []
        now = time.time()
        callsign = packet.get("callsign", "UNKNOWN")
        th = self.alert_thresholds

        # 1. Burst detektiran
        flight = self.flights.get(callsign)
        if flight and flight["burst_detected"] and flight.get("burst_time"):
            # Fire samo jednom - kad je burst_time svjež (zadnjih 5s)
            if now - flight["burst_time"] < 5 and self._should_fire_alert(f"burst_{callsign}"):
                alerts.append({
                    "level": "critical",
                    "type": "burst",
                    "title_key": "alert.burst_title",
                    "message_key": "alert.burst_message",
                    "message_args": [callsign, f"{flight['max_altitude']:.0f}"],
                    "callsign": callsign,
                    "icon": "zap",
                })

        # 2. Baterija ispod praga
        batt = packet.get("battery_voltage")
        if batt is not None and batt > 0:
            if batt < th.get("battery_low_v", 3.3):
                if self._should_fire_alert(f"batt_{callsign}"):
                    alerts.append({
                        "level": "warning",
                        "type": "battery_low",
                        "title_key": "alert.battery_title",
                        "message_key": "alert.battery_message",
                        "message_args": [callsign, f"{batt:.2f}", f"{th['battery_low_v']:.1f}"],
                        "callsign": callsign,
                        "icon": "battery-warning",
                    })

        # 3. Temperatura ispod praga
        temp = packet.get("temperature")
        if temp is not None:
            if temp < th.get("temperature_low_c", -40.0):
                if self._should_fire_alert(f"temp_{callsign}"):
                    alerts.append({
                        "level": "warning",
                        "type": "temperature_low",
                        "title_key": "alert.temperature_title",
                        "message_key": "alert.temperature_message",
                        "message_args": [callsign, f"{temp:.1f}", f"{th['temperature_low_c']:.0f}"],
                        "callsign": callsign,
                        "icon": "thermometer-snowflake",
                    })

        # 4. SNR ispod praga
        snr = packet.get("snr")
        if snr is not None:
            if snr < th.get("snr_low_db", 0.0):
                if self._should_fire_alert(f"snr_{callsign}"):
                    alerts.append({
                        "level": "warning",
                        "type": "snr_low",
                        "title_key": "alert.snr_title",
                        "message_key": "alert.snr_message",
                        "message_args": [callsign, f"{snr:.1f}", f"{th['snr_low_db']:.0f}"],
                        "callsign": callsign,
                        "icon": "signal-low",
                    })

        # 5. GPS fix izgubljen
        if packet.get("no_gps_fix"):
            if self._should_fire_alert(f"gps_{callsign}"):
                alerts.append({
                    "level": "warning",
                    "type": "gps_lost",
                    "title_key": "alert.gps_title",
                    "message_key": "alert.gps_message",
                    "message_args": [callsign],
                    "callsign": callsign,
                    "icon": "map-pin-off",
                })

        return alerts

    def check_packet_timeout(self) -> list[dict]:
        """Provjeri za svaki callsign je li prošlo previše vremena od zadnjeg paketa."""
        if not self.alert_thresholds.get("enabled", True):
            return []

        alerts = []
        now = time.time()
        timeout_s = self.alert_thresholds.get("packet_timeout_s", 60)

        for cs, flight in self.flights.items():
            if not flight["packets"]:
                continue
            last_rx = flight["packets"][-1].get("_rx_time", 0)
            gap = now - last_rx
            if gap > timeout_s and flight["phase"] not in ("landed",):
                # Fire samo jednom — resetira se kad dođe novi paket u add_packet()
                if cs not in self._timeout_fired:
                    self._timeout_fired.add(cs)
                    alerts.append({
                        "level": "warning",
                        "type": "packet_timeout",
                        "title_key": "alert.timeout_title",
                        "message_key": "alert.timeout_message",
                        "message_args": [cs, f"{gap:.0f}", str(timeout_s)],
                        "callsign": cs,
                        "icon": "wifi-off",
                    })
        return alerts

    def set_alert_thresholds(self, thresholds: dict):
        """Ažuriraj pragove za alerte."""
        self.alert_thresholds.update(thresholds)

    def get_alert_thresholds(self) -> dict:
        return dict(self.alert_thresholds)

    def get_known_custom_fields(self) -> list[str]:
        """Vrati sortirani popis svih custom polja viđenih do sad."""
        return sorted(self.known_custom_fields)

    # ------------------------------------------------------------------
    # Log import — učitavanje starih logova nakon restarta
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_date_from_filename(filepath: str) -> Optional[str]:
        """
        Izvuci datum (YYYYMMDD) iz naziva log fajla.
        Format: 20250514-143022_CALLSIGN.csv → '20250514'
        """
        import re
        basename = filepath.rsplit('/', 1)[-1].rsplit('\\', 1)[-1]
        m = re.match(r'(\d{8})-\d{6}_', basename)
        if m:
            return m.group(1)
        return None

    @staticmethod
    def _parse_rx_time(time_str: str, date_str: Optional[str] = None) -> Optional[float]:
        """
        Pretvori time string iz paketa (HH:MM:SS) u Unix timestamp.
        Ako imamo datum iz naziva datoteke, koristimo ga. Inače koristimo danas.
        """
        import re
        if not time_str:
            return None

        # Probaj HH:MM:SS format
        m = re.match(r'(\d{1,2}):(\d{2}):(\d{2})', time_str)
        if m:
            h, mi, s = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if date_str and len(date_str) == 8:
                try:
                    y = int(date_str[0:4])
                    mo = int(date_str[4:6])
                    d = int(date_str[6:8])
                    dt = datetime(y, mo, d, h, mi, s)
                    return dt.timestamp()
                except (ValueError, OverflowError):
                    pass
            # Fallback: koristimo današnji datum
            today = datetime.utcnow().date()
            dt = datetime(today.year, today.month, today.day, h, mi, s)
            return dt.timestamp()

        # Probaj ISO format (2025-05-14T14:30:22)
        try:
            dt = datetime.fromisoformat(time_str.replace('Z', '+00:00'))
            return dt.timestamp()
        except (ValueError, TypeError):
            pass

        return None

    def load_from_csv(self, filepath: str) -> dict:
        """
        Učitaj CSV log datoteku i rekonstruiraj flight stanje.
        Rekonstruira _rx_time iz time polja i naziva datoteke.
        Vraća dict s brojem učitanih paketa po callsign-u.
        """
        import csv as _csv

        date_str = self._extract_date_from_filename(filepath)
        loaded: dict[str, int] = {}
        prev_rx_time: dict[str, float] = {}  # zadnji _rx_time po callsignu

        with open(filepath, "r", newline="", encoding="utf-8") as f:
            reader = _csv.DictReader(f)
            for row in reader:
                packet = self._csv_row_to_packet(row)
                if not packet:
                    continue

                # Rekonstruiraj _rx_time iz time polja
                cs = packet.get("callsign", "UNKNOWN")
                rx = self._parse_rx_time(packet.get("time", ""), date_str)
                if rx is not None:
                    # Osiguraj monotono rastući timestamp (GPS ponekad ponavlja)
                    if cs in prev_rx_time and rx <= prev_rx_time[cs]:
                        rx = prev_rx_time[cs] + 0.5
                    prev_rx_time[cs] = rx
                    packet["_rx_time"] = rx

                self.add_packet(packet)
                loaded[cs] = loaded.get(cs, 0) + 1

        return loaded

    def load_from_json(self, filepath: str) -> dict:
        """
        Učitaj JSON log datoteku (jedan JSON objekt po liniji) i rekonstruiraj flight stanje.
        """
        import json as _json

        date_str = self._extract_date_from_filename(filepath)
        loaded: dict[str, int] = {}
        prev_rx_time: dict[str, float] = {}

        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    packet = _json.loads(line)
                except Exception:
                    continue

                # Rekonstruiraj numeričke tipove
                for key in ("latitude", "longitude", "altitude", "battery_voltage",
                            "temperature", "snr", "satellites"):
                    if key in packet and packet[key] is not None:
                        try:
                            packet[key] = float(packet[key])
                        except (ValueError, TypeError):
                            pass

                # Rekonstruiraj _rx_time
                cs = packet.get("callsign", "UNKNOWN")
                rx = self._parse_rx_time(packet.get("time", ""), date_str)
                if rx is not None:
                    if cs in prev_rx_time and rx <= prev_rx_time[cs]:
                        rx = prev_rx_time[cs] + 0.5
                    prev_rx_time[cs] = rx
                    packet["_rx_time"] = rx

                # Ukloni derivirana polja — add_packet će ih preračunati
                for key in ("climb_rate", "horizontal_speed", "course", "phase",
                            "from_station", "no_gps_fix"):
                    packet.pop(key, None)

                self.add_packet(packet)
                loaded[cs] = loaded.get(cs, 0) + 1

        return loaded

    def add_packet(self, packet: dict) -> dict:
        """Dodaj paket i vrati obogaćenu verziju s derivirianim vrijednostima."""
        # Normaliziraj nazive polja - horusdemodlib može koristiti različita imena
        self._normalize_fields(packet)

        callsign = packet.get("callsign", "UNKNOWN")
        self.current_callsign = callsign
        self.packet_count += 1
        self.last_packet_time = datetime.utcnow().isoformat()

        # Resetiraj timeout alert flag — stigao je novi paket za ovaj callsign
        self._timeout_fired.discard(callsign)

        # GPS fix check
        lat = packet.get("latitude", 0) or 0
        lon = packet.get("longitude", 0) or 0
        no_gps_fix = abs(lat) < 0.001 and abs(lon) < 0.001
        packet["no_gps_fix"] = no_gps_fix

        # Vrijeme primitka — koristi postojeći _rx_time ako je postavljen (npr. iz log importa),
        # inače postavi na trenutno vrijeme (live paket)
        if "_rx_time" not in packet or packet["_rx_time"] is None:
            packet["_rx_time"] = time.time()
        now = packet["_rx_time"]

        if no_gps_fix:
            packet["climb_rate"] = None
            packet["horizontal_speed"] = None
            packet["course"] = None
            flight = self.flights[callsign]
            packet["phase"] = flight["phase"] if callsign in self.flights else "pre_launch"

            if flight["packets"]:
                last_valid = flight["packets"][-1]
                packet["_last_known_lat"] = last_valid["latitude"]
                packet["_last_known_lon"] = last_valid["longitude"]
                packet["_last_known_alt"] = last_valid["altitude"]

            flight["last_nogps_packet"] = packet
            return packet

        flight = self.flights[callsign]
        flight["last_nogps_packet"] = None

        # Izračunaj climb rate iz prethodnog paketa
        climb_rate = None
        horizontal_speed = None
        course = None
        if flight["packets"]:
            prev = flight["packets"][-1]
            dt = now - prev["_rx_time"]
            if dt > 0:
                dalt = packet["altitude"] - prev["altitude"]
                climb_rate = dalt / dt
                dist = haversine(
                    prev["latitude"], prev["longitude"],
                    packet["latitude"], packet["longitude"],
                )
                horizontal_speed = dist / dt
                course = bearing(
                    prev["latitude"], prev["longitude"],
                    packet["latitude"], packet["longitude"],
                )
                flight["total_distance_m"] += dist

        packet["climb_rate"] = round(climb_rate, 2) if climb_rate is not None else None
        packet["horizontal_speed"] = round(horizontal_speed, 2) if horizontal_speed is not None else None
        packet["course"] = round(course, 1) if course is not None else None

        # Ažuriraj max visinu
        if packet["altitude"] > flight["max_altitude"]:
            flight["max_altitude"] = packet["altitude"]
            flight["max_altitude_time"] = now

        # Fazna detekcija
        self._update_phase(flight, packet, climb_rate)
        packet["phase"] = flight["phase"]

        # Ako imamo stanicu, izračunaj bearing/elevation/range
        if self.station:
            packet["from_station"] = {
                "bearing": round(bearing(
                    self.station["latitude"], self.station["longitude"],
                    packet["latitude"], packet["longitude"],
                ), 1),
                "elevation": round(elevation_angle(
                    self.station["latitude"], self.station["longitude"], self.station["altitude"],
                    packet["latitude"], packet["longitude"], packet["altitude"],
                ), 1),
                "range_km": round(haversine(
                    self.station["latitude"], self.station["longitude"],
                    packet["latitude"], packet["longitude"],
                ) / 1000.0, 2),
            }

        flight["packets"].append(packet)
        return packet

    @staticmethod
    def _csv_row_to_packet(row: dict) -> Optional[dict]:
        """Pretvori CSV redak u packet dict pogodan za add_packet()."""
        if not row.get("callsign") or not row.get("latitude"):
            return None

        packet: dict = {}

        # Osnovna polja — string
        packet["callsign"] = row["callsign"]
        packet["time"] = row.get("time", "")

        # Numerička polja
        float_fields = [
            "latitude", "longitude", "altitude",
            "battery_voltage", "temperature", "snr",
        ]
        for key in float_fields:
            val = row.get(key)
            if val is not None and val != "":
                try:
                    packet[key] = float(val)
                except (ValueError, TypeError):
                    pass

        int_fields = ["satellites"]
        for key in int_fields:
            val = row.get(key)
            if val is not None and val != "":
                try:
                    packet[key] = int(float(val))
                except (ValueError, TypeError):
                    pass

        # Custom fields (cf_ prefix iz telemloggera)
        for key, val in row.items():
            if key.startswith("cf_") and val is not None and val != "":
                real_key = key[3:]  # ukloni cf_ prefix
                try:
                    packet[real_key] = float(val)
                except (ValueError, TypeError):
                    packet[real_key] = val

        # NE prenosimo derivirana polja (climb_rate, phase, bearing, elevation,
        # range_km, horizontal_speed, course) — add_packet() će ih preračunati.

        return packet

