"""
Horus Web - FastAPI server
==========================
Moderan web frontend za Horus Binary telemetry decoder.
"""

import asyncio
import json
import logging
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from horus_bridge import HorusBridge
from flight_analyzer import FlightAnalyzer
from telemlogger import TelemetryLogger
from email_notifier import EmailNotifier

logging.basicConfig(
    format="%(asctime)s %(levelname)s: %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("horus-web")


class ConnectionManager:
    def __init__(self):
        self.active: set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.add(ws)
        log.info(f"WebSocket client connected. Total: {len(self.active)}")

    def disconnect(self, ws: WebSocket):
        self.active.discard(ws)
        log.info(f"WebSocket client disconnected. Total: {len(self.active)}")

    async def broadcast(self, message: dict):
        dead = []
        for ws in self.active:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()

analyzer = FlightAnalyzer()
bridge: Optional[HorusBridge] = None
main_loop: Optional[asyncio.AbstractEventLoop] = None
telem_logger: Optional[TelemetryLogger] = None
email_notifier: Optional[EmailNotifier] = None


# -----------------------------------------------------------------------------
# Startup Programs - automatsko pokretanje vanjskih programa (npr. SDR++)
# -----------------------------------------------------------------------------
def _startup_programs_config_path() -> Path:
    return Path(__file__).parent / "startup_programs.json"


def _load_startup_programs_config() -> dict:
    try:
        p = _startup_programs_config_path()
        if p.exists():
            return json.loads(p.read_text())
    except Exception as e:
        log.warning(f"Could not load startup programs config: {e}")
    return {"enabled": False, "programs": []}


def _save_startup_programs_config(data: dict):
    try:
        _startup_programs_config_path().write_text(json.dumps(data, indent=2))
    except Exception as e:
        log.warning(f"Could not save startup programs config: {e}")


def _launch_startup_programs():
    """Pokreni konfigurirane programe pri startu Horusa."""
    import subprocess as _sp
    import platform as _plat

    cfg = _load_startup_programs_config()
    if not cfg.get("enabled", False):
        return

    for prog in cfg.get("programs", []):
        if not prog.get("enabled", True):
            continue
        exe_path = prog.get("path", "").strip()
        if not exe_path:
            continue
        args = prog.get("args", "").strip()

        try:
            p = Path(exe_path)
            if not p.exists():
                log.warning(f"Startup program not found: {exe_path}")
                continue

            cmd = [str(p)]
            if args:
                cmd.extend(args.split())

            cwd = str(p.parent) if p.parent.exists() else None
            log.info(f"Launching startup program: {' '.join(cmd)}")

            if _plat.system() == "Windows":
                _sp.Popen(cmd, cwd=cwd, creationflags=0x00000008, close_fds=True)  # DETACHED_PROCESS
            else:
                _sp.Popen(cmd, cwd=cwd, start_new_session=True, close_fds=True)

            log.info(f"Startup program launched: {prog.get('name', exe_path)}")
        except Exception as e:
            log.warning(f"Failed to launch startup program '{exe_path}': {e}")


def _init_telem_logger():
    global telem_logger
    try:
        cfg_path = Path(__file__).parent / "logging_config.json"
        if cfg_path.exists():
            cfg = json.loads(cfg_path.read_text())
            telem_logger = TelemetryLogger(
                log_directory=cfg.get("log_directory", ""),
                log_format=cfg.get("log_format", "CSV"),
                enabled=cfg.get("enabled", False),
            )
            if cfg.get("enabled"):
                log.info(f"Telemetry logging active: {cfg.get('log_format')} → {cfg.get('log_directory')}")
        else:
            default_dir = str(Path(__file__).parent / "logs")
            os.makedirs(default_dir, exist_ok=True)
            telem_logger = TelemetryLogger(
                log_directory=default_dir, log_format="CSV", enabled=True,
            )
            cfg_path.write_text(json.dumps({
                "log_directory": default_dir, "log_format": "CSV", "enabled": True,
            }))
            log.info(f"Telemetry logging auto-enabled: CSV → {default_dir}")
    except Exception as e:
        log.warning(f"Could not init telemetry logger: {e}")
        telem_logger = TelemetryLogger(
            log_directory=str(Path(__file__).parent / "logs"),
            log_format="CSV", enabled=False,
        )


def _init_email_notifier():
    global email_notifier
    try:
        email_notifier = EmailNotifier()
        if email_notifier.enabled:
            log.info(f"Email notifikacije aktivne: → {email_notifier.config.get('to_email', '?')}")
    except Exception as e:
        log.warning(f"Could not init email notifier: {e}")
        email_notifier = EmailNotifier()


def on_packet(packet: dict):
    enriched = analyzer.add_packet(packet)

    # Email notifikacija za novu sondu
    if email_notifier:
        callsign = enriched.get("callsign", "UNKNOWN")
        email_notifier.notify_new_sonde(callsign, enriched)

    if telem_logger:
        log_packet = {k: v for k, v in enriched.items() if not k.startswith('_')}
        if 'from_station' in log_packet:
            fs = log_packet.pop('from_station')
            log_packet['bearing'] = fs.get('bearing')
            log_packet['elevation'] = fs.get('elevation')
            log_packet['range_km'] = fs.get('range_km')
        # Flatten custom_fields za logiranje
        if 'custom_fields' in log_packet:
            cf = log_packet.pop('custom_fields')
            for k, v in cf.items():
                log_packet[f'cf_{k}'] = v
        telem_logger.add(log_packet)

    if main_loop and main_loop.is_running():
        asyncio.run_coroutine_threadsafe(
            manager.broadcast({"type": "packet", "data": enriched}),
            main_loop,
        )
        # Provjeri alerte i pošalji ih
        alerts = analyzer.check_alerts(enriched)
        for alert in alerts:
            asyncio.run_coroutine_threadsafe(
                manager.broadcast({"type": "alert", "data": alert}),
                main_loop,
            )


def on_status(status: dict):
    if main_loop and main_loop.is_running():
        asyncio.run_coroutine_threadsafe(
            manager.broadcast({"type": "status", "data": status}),
            main_loop,
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    global bridge, main_loop
    main_loop = asyncio.get_running_loop()
    _init_telem_logger()
    _init_email_notifier()
    _load_alert_config()
    bridge = HorusBridge(packet_callback=on_packet, status_callback=on_status)
    log.info("Horus bridge initialized. Use /api/start to start decoding.")

    # Pokreni konfigurirane startup programe (npr. SDR++)
    _launch_startup_programs()

    # Background task: provjeri packet timeout svakih 10s
    async def _timeout_checker():
        while True:
            await asyncio.sleep(10)
            try:
                timeout_alerts = analyzer.check_packet_timeout()
                for alert in timeout_alerts:
                    await manager.broadcast({"type": "alert", "data": alert})
            except Exception:
                pass

    timeout_task = asyncio.create_task(_timeout_checker())

    yield

    timeout_task.cancel()
    if bridge:
        bridge.stop()
    if telem_logger:
        telem_logger.close()
    log.info("Horus bridge stopped.")


app = FastAPI(
    title="Horus Web",
    description="Moderan web UI za Horus Binary telemetry decoder",
    version="1.5",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


class StartRequest(BaseModel):
    audio_device: Optional[int] = None
    sample_rate: int = 48000
    modem: str = "Horus Binary v1/v2/v3"
    baud_rate: int = 100
    use_udp: bool = False
    udp_port: int = 7355


class StationConfig(BaseModel):
    callsign: str
    latitude: float
    longitude: float
    altitude: float = 0.0
    radio: str = ""
    antenna: str = ""
    sondehub_enabled: bool = False
    dial_freq_mhz: float = 0.0
    sondehub_blocklist: list[str] = []
    # Privatni server
    private_server_enabled: bool = False
    private_server_host: str = ""
    private_server_port: int = 0
    private_server_protocol: str = "udp"
    private_server_format: str = "json"


class WeatherConfig(BaseModel):
    api_key: str = ""


class ServerConfig(BaseModel):
    port: int = 8000


class MonitorRequest(BaseModel):
    device_index: int
    sample_rate: int = 48000


@app.get("/api/status")
async def api_status():
    return {
        "running": bridge.is_running() if bridge else False,
        "packet_count": analyzer.packet_count,
        "last_packet_time": analyzer.last_packet_time,
        "station": analyzer.station,
    }


@app.get("/api/audio-devices")
async def api_audio_devices():
    if not bridge:
        raise HTTPException(503, "Bridge not ready")
    return bridge.list_audio_devices()


@app.get("/api/modems")
async def api_modems():
    if not bridge:
        raise HTTPException(503, "Bridge not ready")
    return bridge.list_modems()


# -----------------------------------------------------------------------------
# Audio Monitor Output — preslušavanje ulaznog signala
# -----------------------------------------------------------------------------
@app.get("/api/audio-output-devices")
async def api_audio_output_devices():
    """Vrati listu audio output uređaja za monitor funkciju."""
    if not bridge:
        raise HTTPException(503, "Bridge not ready")
    return bridge.list_output_devices()


@app.post("/api/monitor/start")
async def api_monitor_start(req: MonitorRequest):
    """Pokreni audio monitor na odabranom output uređaju."""
    if not bridge:
        raise HTTPException(503, "Bridge not ready")
    try:
        bridge.start_monitor(
            device_index=req.device_index,
            sample_rate=req.sample_rate,
        )
        # Spremi monitor postavke u decoder config
        _save_monitor_config(True, req.device_index, req.sample_rate)
        return {"ok": True, "message": "Audio monitor started"}
    except Exception as e:
        log.exception("Failed to start audio monitor")
        raise HTTPException(500, str(e))


@app.post("/api/monitor/stop")
async def api_monitor_stop():
    """Zaustavi audio monitor."""
    if not bridge:
        raise HTTPException(503, "Bridge not ready")
    bridge.stop_monitor()
    # Spremi da je monitor ugašen
    _save_monitor_config(False, None, None)
    return {"ok": True, "message": "Audio monitor stopped"}


@app.get("/api/monitor/status")
async def api_monitor_status():
    """Vrati status audio monitora."""
    if not bridge:
        raise HTTPException(503, "Bridge not ready")
    return {
        "enabled": bridge.monitor_enabled,
        "device_index": bridge.monitor_device_index,
    }


def _save_monitor_config(enabled: bool, device_index, sample_rate):
    """Spremi monitor postavke u decoder_config.json (dodaje/ažurira monitor polja)."""
    try:
        cfg = _load_decoder_config()
        cfg["monitor_enabled"] = enabled
        if enabled and device_index is not None:
            cfg["monitor_device_index"] = device_index
            cfg["monitor_sample_rate"] = sample_rate
            # Spremi i ime uređaja za stabilnije matchanje
            try:
                devices = bridge.list_output_devices()
                for d in devices:
                    if d.get("index") == device_index:
                        cfg["monitor_device_name"] = d.get("name", "")
                        break
            except Exception:
                pass
        else:
            cfg["monitor_device_index"] = None
            cfg["monitor_device_name"] = ""
            cfg["monitor_sample_rate"] = None
        _save_decoder_config(cfg)
    except Exception as e:
        log.warning(f"Could not save monitor config: {e}")


# -----------------------------------------------------------------------------
# Decoder config (zapamćeni audio uređaj, modem, itd.)
# -----------------------------------------------------------------------------
def _decoder_config_path() -> Path:
    return Path(__file__).parent / "decoder_config.json"


def _save_decoder_config(data: dict):
    try:
        _decoder_config_path().write_text(json.dumps(data, indent=2))
    except Exception as e:
        log.warning(f"Could not save decoder config: {e}")


def _load_decoder_config() -> dict:
    try:
        p = _decoder_config_path()
        if p.exists():
            return json.loads(p.read_text())
    except Exception as e:
        log.warning(f"Could not load decoder config: {e}")
    return {}


@app.get("/api/decoder/config")
async def api_decoder_get_config():
    """Vrati zadnje korištene postavke dekodera (za auto-popunjavanje UI-ja)."""
    return _load_decoder_config()


@app.post("/api/start")
async def api_start(req: StartRequest):
    if not bridge:
        raise HTTPException(503, "Bridge not ready")
    try:
        bridge.start(
            audio_device=req.audio_device,
            sample_rate=req.sample_rate,
            modem=req.modem,
            baud_rate=req.baud_rate,
            use_udp=req.use_udp,
            udp_port=req.udp_port,
        )

        # Zapamti postavke - IME uređaja je stabilnije od indeksa.
        device_name = ""
        try:
            devices = bridge.list_audio_devices()
            for d in devices:
                if req.use_udp and d.get("udp"):
                    device_name = d.get("name", "")
                    break
                if not req.use_udp and d.get("index") == req.audio_device:
                    device_name = d.get("name", "")
                    break
        except Exception:
            pass

        _save_decoder_config({
            **_load_decoder_config(),  # zadrži postojeće postavke (npr. monitor)
            "audio_device_name": device_name,
            "audio_device_index": req.audio_device,
            "sample_rate": req.sample_rate,
            "modem": req.modem,
            "baud_rate": req.baud_rate,
            "use_udp": req.use_udp,
            "udp_port": req.udp_port,
        })

        return {"ok": True, "message": "Decoding started"}
    except Exception as e:
        log.exception("Failed to start decoding")
        raise HTTPException(500, str(e))


@app.post("/api/stop")
async def api_stop():
    if not bridge:
        raise HTTPException(503, "Bridge not ready")
    bridge.stop()
    return {"ok": True, "message": "Decoding stopped"}


@app.post("/api/refresh-payloads")
async def api_refresh_payloads():
    if not bridge:
        raise HTTPException(503, "Bridge not ready")
    bridge._init_payload_lists()
    return {"ok": True, "message": "Payload list refresh initiated"}


# -----------------------------------------------------------------------------
# Server konfiguracija (port) i Restart
# -----------------------------------------------------------------------------
def _server_config_path() -> Path:
    return Path(__file__).parent / "server_config.json"


def _load_server_config() -> dict:
    try:
        p = _server_config_path()
        if p.exists():
            return json.loads(p.read_text())
    except Exception as e:
        log.warning(f"Could not load server config: {e}")
    return {"port": 8000}


@app.get("/api/server/config")
async def api_server_get_config():
    return _load_server_config()


@app.post("/api/server/config")
async def api_server_set_config(cfg: ServerConfig):
    try:
        if cfg.port < 1 or cfg.port > 65535:
            raise HTTPException(400, "Port mora biti između 1 i 65535")
        _server_config_path().write_text(json.dumps({"port": cfg.port}))
        log.info(f"Server config saved: port={cfg.port}")
        return {"ok": True, "port": cfg.port, "message": "Spremljeno. Promjena porta se primjenjuje nakon restarta."}
    except HTTPException:
        raise
    except Exception as e:
        log.exception(f"Could not save server config: {e}")
        raise HTTPException(500, str(e))


@app.post("/api/server/restart")
async def api_server_restart():
    """
    Restartira server: pokrene novu instancu u zasebnom konzolnom prozoru
    pa ugasi trenutni proces. Pouzdanije od os.execv jer Uvicorn ne pušta
    uvijek čisto socket-e kad se koristi execv.
    """
    import subprocess
    import platform

    print("=" * 60, flush=True)
    print("SERVER RESTART REQUESTED via API", flush=True)
    print(f"Platform: {platform.system()}", flush=True)
    print(f"Python: {sys.executable}", flush=True)
    print(f"Script args: {sys.argv}", flush=True)
    print("=" * 60, flush=True)
    log.info("Server restart requested via API")
    sys.stdout.flush()
    sys.stderr.flush()

    async def do_restart():
        await asyncio.sleep(0.8)

        try:
            if bridge:
                try:
                    bridge.stop()
                    print("Bridge stopped.", flush=True)
                except Exception as e:
                    print(f"Bridge stop error (ignored): {e}", flush=True)
            if telem_logger:
                try:
                    telem_logger.close()
                    print("Telem logger closed.", flush=True)
                except Exception:
                    pass
        finally:
            sys.stdout.flush()

        script_path = os.path.abspath(sys.argv[0])
        script_dir = os.path.dirname(script_path)
        cmd = [sys.executable, script_path] + sys.argv[1:]

        print(f"Spawning new process: {cmd}", flush=True)
        print(f"Working dir: {script_dir}", flush=True)
        sys.stdout.flush()

        try:
            if platform.system() == "Windows":
                CREATE_NEW_CONSOLE = 0x00000010
                subprocess.Popen(
                    cmd, cwd=script_dir,
                    creationflags=CREATE_NEW_CONSOLE,
                    close_fds=True,
                )
                print("New process spawned in new console window.", flush=True)
            else:
                subprocess.Popen(
                    cmd, cwd=script_dir,
                    start_new_session=True,
                    close_fds=True,
                )
                print("New process spawned (detached).", flush=True)
            sys.stdout.flush()
        except Exception as e:
            print(f"Failed to spawn new process: {e}", flush=True)
            log.exception(f"Failed to spawn new process: {e}")
            sys.stdout.flush()
            return

        await asyncio.sleep(1.5)

        print("Exiting current process...", flush=True)
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(0)

    asyncio.create_task(do_restart())
    return {"ok": True, "message": "Restart initiated. New console window will open."}


# -----------------------------------------------------------------------------
# OpenWeather API
# -----------------------------------------------------------------------------
import httpx

@app.get("/api/weather/config")
async def api_weather_get_config():
    try:
        cfg_path = Path(__file__).parent / "weather_config.json"
        if cfg_path.exists():
            data = json.loads(cfg_path.read_text())
            api_key = data.get("api_key", "")
            return {
                "api_key_set": bool(api_key),
                "api_key_preview": f"{api_key[:4]}...{api_key[-4:]}" if len(api_key) >= 8 else "",
                "enabled": bool(api_key),
            }
    except Exception as e:
        log.warning(f"Could not load weather config: {e}")
    return {"api_key_set": False, "api_key_preview": "", "enabled": False}


@app.post("/api/weather/config")
async def api_weather_set_config(cfg: WeatherConfig):
    try:
        cfg_path = Path(__file__).parent / "weather_config.json"
        existing = {}
        if cfg_path.exists():
            try:
                existing = json.loads(cfg_path.read_text())
            except Exception:
                pass
        new_key = cfg.api_key
        if not new_key or new_key == "KEEP_EXISTING_PLACEHOLDER":
            new_key = existing.get("api_key", "")
        data = {"api_key": new_key, "enabled": bool(new_key)}
        cfg_path.write_text(json.dumps(data))
        log.info(f"Weather config saved: key_len={len(new_key)}")
        return {"ok": True, "api_key_set": bool(new_key)}
    except Exception as e:
        log.exception(f"Could not save weather config: {e}")
        raise HTTPException(500, str(e))


@app.delete("/api/weather/config")
async def api_weather_delete_config():
    try:
        cfg_path = Path(__file__).parent / "weather_config.json"
        cfg_path.write_text(json.dumps({"api_key": "", "enabled": False}))
        log.info("Weather API key cleared")
        return {"ok": True}
    except Exception as e:
        log.exception(f"Could not clear weather config: {e}")
        raise HTTPException(500, str(e))


def _load_weather_api_key() -> Optional[str]:
    try:
        cfg_path = Path(__file__).parent / "weather_config.json"
        if cfg_path.exists():
            data = json.loads(cfg_path.read_text())
            if data.get("api_key"):
                return data["api_key"]
    except Exception:
        pass
    return None


@app.get("/api/weather/current")
async def api_weather_current(lat: float, lon: float):
    api_key = _load_weather_api_key()
    if not api_key:
        raise HTTPException(400, "Weather API key nije postavljen")
    url = "https://api.openweathermap.org/data/2.5/weather"
    params = {"lat": lat, "lon": lon, "appid": api_key, "units": "metric", "lang": "hr"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, params=params)
            r.raise_for_status()
            return r.json()
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            raise HTTPException(401, "Nevaljani OpenWeather API key")
        raise HTTPException(502, f"OpenWeather API greška: {e.response.status_code}")
    except Exception as e:
        log.exception(f"Weather fetch error: {e}")
        raise HTTPException(502, str(e))


@app.get("/api/weather/tile-url")
async def api_weather_tile_url(layer: str = "clouds_new"):
    api_key = _load_weather_api_key()
    if not api_key:
        raise HTTPException(400, "Weather API key nije postavljen")
    valid_layers = ['clouds_new', 'precipitation_new', 'pressure_new', 'wind_new', 'temp_new']
    if layer not in valid_layers:
        raise HTTPException(400, f"Neispravan layer. Dostupni: {valid_layers}")
    tile_url = f"https://tile.openweathermap.org/map/{layer}/{{z}}/{{x}}/{{y}}.png?appid={api_key}"
    return {"tile_url": tile_url, "layer": layer}


# -----------------------------------------------------------------------------
# METAR — besplatni podaci s aerodroma (NOAA AWC)
# -----------------------------------------------------------------------------
import re as _re
import math as _math
from datetime import timezone as _tz

# Cache: { "key": { "data": [...], "ts": datetime } }
_metar_cache: dict = {}
_METAR_CACHE_TTL = 1800  # 30 min


def _haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat = _math.radians(lat2 - lat1)
    dlon = _math.radians(lon2 - lon1)
    a = _math.sin(dlat / 2) ** 2 + _math.cos(_math.radians(lat1)) * _math.cos(_math.radians(lat2)) * _math.sin(dlon / 2) ** 2
    return R * 2 * _math.atan2(_math.sqrt(a), _math.sqrt(1 - a))


def _parse_metar_clouds(raw: str) -> list:
    """Parsiraj cloud layer iz METAR stringa. Vraća listu dict-ova."""
    layers = []
    pattern = _re.compile(r'\b(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?\b')
    for m in pattern.finditer(raw):
        cover = m.group(1)
        alt_ft = int(m.group(2)) * 100
        cb = m.group(3) or ''
        cover_names = {
            'FEW': 'Few (1-2/8)', 'SCT': 'Scattered (3-4/8)',
            'BKN': 'Broken (5-7/8)', 'OVC': 'Overcast (8/8)',
            'VV': 'Vertical Vis.',
        }
        layers.append({
            'cover': cover,
            'cover_name': cover_names.get(cover, cover),
            'alt_ft': alt_ft,
            'alt_m': round(alt_ft * 0.3048),
            'cb': cb,
        })
    if not layers:
        if 'CLR' in raw or 'SKC' in raw or 'CAVOK' in raw or 'NCD' in raw:
            layers.append({'cover': 'CLR', 'cover_name': 'Clear', 'alt_ft': 0, 'alt_m': 0, 'cb': ''})
    return layers


def _parse_visibility(raw: str):
    """Parsiraj vidljivost iz METAR stringa."""
    # Metric: 9999 ili 4-digit metres
    m = _re.search(r'\b(\d{4})\b', raw)
    if m:
        val = int(m.group(1))
        if val == 9999:
            return {'value': 9999, 'unit': 'm', 'text': '10+ km'}
        return {'value': val, 'unit': 'm', 'text': f'{val} m' if val < 1000 else f'{val/1000:.1f} km'}
    # SM: statute miles
    sm = _re.search(r'(\d+)SM', raw)
    if sm:
        return {'value': int(sm.group(1)), 'unit': 'SM', 'text': f'{sm.group(1)} SM'}
    return None


def _parse_wind(raw: str):
    """Parsiraj vjetar iz METAR stringa."""
    m = _re.search(r'\b(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?KT\b', raw)
    if not m:
        return None
    direction = m.group(1)
    speed_kt = int(m.group(2))
    gust_kt = int(m.group(4)) if m.group(4) else None
    return {
        'direction': direction,
        'speed_kt': speed_kt,
        'speed_ms': round(speed_kt * 0.5144, 1),
        'gust_kt': gust_kt,
        'gust_ms': round(gust_kt * 0.5144, 1) if gust_kt else None,
    }


def _parse_temp_dewpoint(raw: str):
    """Parsiraj temperaturu i dewpoint iz METAR stringa."""
    m = _re.search(r'\b(M?\d{2})/(M?\d{2})\b', raw)
    if not m:
        return None, None
    def to_c(s):
        return -int(s[1:]) if s.startswith('M') else int(s)
    return to_c(m.group(1)), to_c(m.group(2))


def _parse_qnh(raw: str):
    """Parsiraj QNH (tlak) iz METAR stringa."""
    # Q1013
    m = _re.search(r'\bQ(\d{4})\b', raw)
    if m:
        return {'hpa': int(m.group(1))}
    # A2992 (inHg)
    m = _re.search(r'\bA(\d{4})\b', raw)
    if m:
        inhg = int(m.group(1)) / 100.0
        return {'hpa': round(inhg * 33.8639)}
    return None


def _parse_wx(raw: str) -> list:
    """Parsiraj posebne vremenske pojave (kiša, magla, grmljavina...)."""
    wx_codes = {
        'RA': 'Kiša', 'SN': 'Snijeg', 'DZ': 'Rosulja', 'FG': 'Magla',
        'BR': 'Sumaglica', 'HZ': 'Izmaglica', 'TS': 'Grmljavina',
        'SH': 'Pljuskovi', 'GR': 'Tuča', 'GS': 'Sitna tuča',
        'FZ': 'Ledeno', 'PE': 'Ledena zrna', 'PL': 'Ledene kuglice',
        'SA': 'Pijesak', 'DU': 'Prašina', 'SS': 'Pješčana oluja',
        '+': 'Jako', '-': 'Slabo', 'VC': 'U blizini',
    }
    phenomena = []
    pattern = _re.compile(r'(?:^|\s)([-+]?(?:VC)?(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)+)(?:\s|$)')
    for m in pattern.finditer(raw):
        code = m.group(1)
        desc_parts = []
        for key, val in wx_codes.items():
            if key in code:
                desc_parts.append(val)
        if desc_parts:
            phenomena.append({'code': code, 'desc': ' '.join(desc_parts)})
    return phenomena


def _parse_full_metar(raw: str, station_id: str, lat: float, lon: float, dist_km: float) -> dict:
    """Parsiraj kompletan METAR u strukturirani dict."""
    clouds = _parse_metar_clouds(raw)
    wind = _parse_wind(raw)
    vis = _parse_visibility(raw)
    temp, dewpoint = _parse_temp_dewpoint(raw)
    qnh = _parse_qnh(raw)
    wx = _parse_wx(raw)

    # Ceiling = najniži BKN, OVC ili VV layer
    ceiling = None
    for c in clouds:
        if c['cover'] in ('BKN', 'OVC', 'VV'):
            ceiling = c
            break

    return {
        'station_id': station_id,
        'lat': lat,
        'lon': lon,
        'distance_km': round(dist_km, 1),
        'raw': raw,
        'clouds': clouds,
        'ceiling': ceiling,
        'visibility': vis,
        'wind': wind,
        'temp_c': temp,
        'dewpoint_c': dewpoint,
        'qnh': qnh,
        'wx': wx,
    }


@app.get("/api/metar/nearby")
async def api_metar_nearby(lat: float, lon: float, radius: int = 150):
    """
    Dohvati METAR podatke za aerodrome u krugu od 'radius' km oko zadane pozicije.
    Koristi besplatni NOAA Aviation Weather Center — bez API ključa.
    """
    if radius > 500:
        radius = 500

    cache_key = f"{round(lat,1)}_{round(lon,1)}_{radius}"
    now = datetime.now(_tz.utc)

    # Provjeri cache
    if cache_key in _metar_cache:
        cached = _metar_cache[cache_key]
        age = (now - cached['ts']).total_seconds()
        if age < _METAR_CACHE_TTL:
            return {"stations": cached['data'], "cached": True, "age_sec": int(age)}

    # NOAA AWC endpoint — dohvati METAR-e u bounding box-u
    url = "https://aviationweather.gov/api/data/metar"
    params = {
        "format": "json",
        "hours": "2",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            # NOAA AWC /api/data/metar podržava bbox: minLat,minLon,maxLat,maxLon
            delta_deg = radius / 111.0  # grubi stupnjevi
            min_lat = lat - delta_deg
            min_lon = lon - delta_deg
            max_lat = lat + delta_deg
            max_lon = lon + delta_deg
            bbox = f"{min_lat:.2f},{min_lon:.2f},{max_lat:.2f},{max_lon:.2f}"
            params["bbox"] = bbox

            log.info(f"METAR fetch: url={url} bbox={bbox}, hours=2")
            r = await client.get(url, params=params)

            # NOAA vraća 204 kad nema podataka
            if r.status_code == 204:
                log.info("METAR: NOAA vratio 204 No Content")
                _metar_cache[cache_key] = {'data': [], 'ts': now}
                return {"stations": [], "cached": False, "count": 0}

            r.raise_for_status()

            # NOAA ponekad vraća prazan string ili tekst umjesto JSON-a
            content_type = r.headers.get("content-type", "")
            raw_text = r.text.strip()

            if not raw_text or raw_text == "[]":
                log.info("METAR: NOAA vratio prazan odgovor")
                _metar_cache[cache_key] = {'data': [], 'ts': now}
                return {"stations": [], "cached": False, "count": 0}

            try:
                raw_data = r.json()
            except Exception:
                log.warning(f"METAR: NOAA nije vratio validan JSON. Content-Type: {content_type}, body[:200]: {raw_text[:200]}")
                raise HTTPException(502, f"NOAA vratio neispravan odgovor (Content-Type: {content_type})")

        stations = []
        seen = set()
        for entry in raw_data:
            sid = entry.get("icaoId") or entry.get("stationId", "")
            if not sid or sid in seen:
                continue
            slat = entry.get("lat")
            slon = entry.get("lon")
            if slat is None or slon is None:
                continue

            dist = _haversine_km(lat, lon, slat, slon)
            if dist > radius:
                continue

            raw_metar = entry.get("rawOb", "")
            if not raw_metar:
                continue

            seen.add(sid)
            parsed = _parse_full_metar(raw_metar, sid, slat, slon, dist)

            # Dodaj NOAA metapodatke ako postoje
            parsed['station_name'] = entry.get("name", sid)
            parsed['observation_time'] = entry.get("reportTime", "")
            parsed['elev_m'] = entry.get("elev")

            stations.append(parsed)

        # Sortiraj po udaljenosti
        stations.sort(key=lambda s: s['distance_km'])

        # Spremi u cache
        _metar_cache[cache_key] = {'data': stations, 'ts': now}

        log.info(f"METAR: pronađeno {len(stations)} stanica u krugu od {radius} km (NOAA vratio {len(raw_data)} ukupno)")

        return {"stations": stations, "cached": False, "count": len(stations)}

    except httpx.HTTPStatusError as e:
        log.warning(f"METAR API error: {e.response.status_code}")
        raise HTTPException(502, f"NOAA AWC greška: {e.response.status_code}")
    except Exception as e:
        log.exception(f"METAR fetch error: {e}")
        raise HTTPException(502, str(e))


@app.get("/api/metar/station/{icao}")
async def api_metar_station(icao: str):
    """Dohvati METAR za jednu stanicu po ICAO kodu."""
    url = "https://aviationweather.gov/api/data/metar"
    params = {"ids": icao.upper(), "format": "json", "hours": "2"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, params=params)
            r.raise_for_status()
            data = r.json()
        if not data:
            raise HTTPException(404, f"Nema METAR podataka za {icao}")
        entry = data[0]
        raw_metar = entry.get("rawOb", "")
        slat = entry.get("lat", 0)
        slon = entry.get("lon", 0)
        parsed = _parse_full_metar(raw_metar, icao.upper(), slat, slon, 0)
        parsed['station_name'] = entry.get("name", icao)
        parsed['observation_time'] = entry.get("reportTime", "")
        parsed['elev_m'] = entry.get("elev")
        return parsed
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"NOAA AWC greška: {e.response.status_code}")
    except HTTPException:
        raise
    except Exception as e:
        log.exception(f"METAR station error: {e}")
        raise HTTPException(502, str(e))


@app.post("/api/station")
async def api_set_station(cfg: StationConfig):
    analyzer.set_station(
        callsign=cfg.callsign, latitude=cfg.latitude,
        longitude=cfg.longitude, altitude=cfg.altitude,
    )
    if bridge:
        bridge.set_sondehub_config(
            enabled=cfg.sondehub_enabled, callsign=cfg.callsign,
            latitude=cfg.latitude, longitude=cfg.longitude,
            altitude=cfg.altitude, radio=cfg.radio, antenna=cfg.antenna,
        )
        bridge.set_dial_frequency(cfg.dial_freq_mhz)
        bridge.set_sondehub_blocklist(cfg.sondehub_blocklist)
        bridge.set_private_server_config(
            enabled=cfg.private_server_enabled,
            host=cfg.private_server_host,
            port=cfg.private_server_port,
            protocol=cfg.private_server_protocol,
            fmt=cfg.private_server_format,
        )
    try:
        cfg_path = Path(__file__).parent / "station_config.json"
        cfg_path.write_text(json.dumps({
            "callsign": cfg.callsign, "latitude": cfg.latitude,
            "longitude": cfg.longitude, "altitude": cfg.altitude,
            "radio": cfg.radio, "antenna": cfg.antenna,
            "sondehub_enabled": cfg.sondehub_enabled,
            "dial_freq_mhz": cfg.dial_freq_mhz,
            "sondehub_blocklist": cfg.sondehub_blocklist,
            "private_server_enabled": cfg.private_server_enabled,
            "private_server_host": cfg.private_server_host,
            "private_server_port": cfg.private_server_port,
            "private_server_protocol": cfg.private_server_protocol,
            "private_server_format": cfg.private_server_format,
        }))
    except Exception as e:
        log.warning(f"Could not save station config: {e}")
    return {"ok": True}


@app.post("/api/station/upload")
async def api_station_upload():
    """Ručno uploadaj podatke o prijemnoj stanici na SondeHub.
    Korisno kad korisnik promijeni postavke stanice dok je dekoder pokrenut."""
    if not bridge:
        raise HTTPException(503, "Bridge not ready")
    result = bridge.upload_station_to_sondehub()
    if not result.get("ok"):
        raise HTTPException(400, result.get("error", "Upload nije uspio"))
    return result


@app.get("/api/station")
async def api_get_station():
    try:
        cfg_path = Path(__file__).parent / "station_config.json"
        if cfg_path.exists():
            data = json.loads(cfg_path.read_text())
            if not analyzer.station:
                analyzer.set_station(
                    callsign=data.get("callsign", ""),
                    latitude=data.get("latitude", 0),
                    longitude=data.get("longitude", 0),
                    altitude=data.get("altitude", 0),
                )
            if bridge:
                if data.get("dial_freq_mhz"):
                    bridge.set_dial_frequency(data["dial_freq_mhz"])
                if data.get("sondehub_blocklist"):
                    bridge.set_sondehub_blocklist(data["sondehub_blocklist"])
                if data.get("sondehub_enabled") and not bridge.sondehub_uploader:
                    bridge.set_sondehub_config(
                        enabled=data["sondehub_enabled"],
                        callsign=data.get("callsign", ""),
                        latitude=data.get("latitude", 0),
                        longitude=data.get("longitude", 0),
                        altitude=data.get("altitude", 0),
                        radio=data.get("radio", ""),
                        antenna=data.get("antenna", ""),
                    )
                if data.get("private_server_enabled"):
                    bridge.set_private_server_config(
                        enabled=data["private_server_enabled"],
                        host=data.get("private_server_host", ""),
                        port=data.get("private_server_port", 0),
                        protocol=data.get("private_server_protocol", "udp"),
                        fmt=data.get("private_server_format", "json"),
                    )
            return data
    except Exception as e:
        log.warning(f"Could not load station config: {e}")
    if analyzer.station:
        return analyzer.station
    return {}


@app.get("/api/flight")
async def api_flight():
    return analyzer.get_flight_data()


@app.get("/api/flight/{callsign}")
async def api_flight_by_callsign(callsign: str):
    data = analyzer.get_flight_data(callsign=callsign)
    if not data:
        raise HTTPException(404, f"No flight data for {callsign}")
    return data


@app.post("/api/flight/reset")
async def api_flight_reset():
    analyzer.reset()
    return {"ok": True}


@app.get("/api/flight/stats")
async def api_stats():
    return analyzer.get_link_stats()


@app.get("/api/flights")
async def api_all_flights():
    return analyzer.get_all_flights_data()


@app.get("/api/callsigns")
async def api_callsigns():
    return analyzer.get_all_callsigns()


# -----------------------------------------------------------------------------
# Alert konfiguracija
# -----------------------------------------------------------------------------
def _alert_config_path() -> Path:
    return Path(__file__).parent / "alert_config.json"


def _load_alert_config():
    """Učitaj alert pragove iz datoteke u analyzer."""
    try:
        p = _alert_config_path()
        if p.exists():
            data = json.loads(p.read_text())
            analyzer.set_alert_thresholds(data)
            log.info(f"Alert config loaded: {data}")
    except Exception as e:
        log.warning(f"Could not load alert config: {e}")


class AlertConfig(BaseModel):
    battery_low_v: float = 0.91
    temperature_low_c: float = -50.0
    snr_low_db: float = -5.0
    packet_timeout_s: int = 300
    enabled: bool = True


@app.get("/api/alerts/config")
async def api_alerts_get_config():
    return analyzer.get_alert_thresholds()


@app.post("/api/alerts/config")
async def api_alerts_set_config(cfg: AlertConfig):
    data = cfg.model_dump()
    analyzer.set_alert_thresholds(data)
    try:
        _alert_config_path().write_text(json.dumps(data, indent=2))
    except Exception as e:
        log.warning(f"Could not save alert config: {e}")
    return {"ok": True, **data}


# -----------------------------------------------------------------------------
# Email notifikacije za novu sondu
# -----------------------------------------------------------------------------
class EmailConfig(BaseModel):
    enabled: bool = False
    smtp_server: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    from_email: str = ""
    to_email: str = ""
    cooldown_hours: float = 6


@app.get("/api/email/config")
async def api_email_get_config():
    if not email_notifier:
        return EmailNotifier._default_config()
    return email_notifier.get_config_safe()


@app.post("/api/email/config")
async def api_email_set_config(cfg: EmailConfig):
    if not email_notifier:
        raise HTTPException(503, "Email notifier not ready")
    try:
        data = cfg.model_dump()
        email_notifier.save_config(data)
        return {"ok": True, "enabled": data["enabled"]}
    except Exception as e:
        log.exception(f"Could not save email config: {e}")
        raise HTTPException(500, str(e))


@app.post("/api/email/test")
async def api_email_test():
    if not email_notifier:
        raise HTTPException(503, "Email notifier not ready")
    result = email_notifier.send_test_email()
    if result["ok"]:
        return result
    else:
        raise HTTPException(400, result["error"])


# -----------------------------------------------------------------------------
# Startup Programs API
# -----------------------------------------------------------------------------
class StartupProgram(BaseModel):
    name: str = ""
    path: str = ""
    args: str = ""
    enabled: bool = True


class StartupProgramsConfig(BaseModel):
    enabled: bool = False
    programs: list[StartupProgram] = []


@app.get("/api/startup-programs/config")
async def api_startup_programs_get_config():
    return _load_startup_programs_config()


@app.post("/api/startup-programs/config")
async def api_startup_programs_set_config(cfg: StartupProgramsConfig):
    try:
        data = {
            "enabled": cfg.enabled,
            "programs": [p.model_dump() for p in cfg.programs],
        }
        _save_startup_programs_config(data)
        log.info(f"Startup programs config saved: enabled={cfg.enabled}, count={len(cfg.programs)}")
        return {"ok": True, "enabled": cfg.enabled, "count": len(cfg.programs)}
    except Exception as e:
        log.exception(f"Could not save startup programs config: {e}")
        raise HTTPException(500, str(e))


@app.post("/api/startup-programs/browse")
async def api_startup_programs_browse():
    """Vrati korisne programe pronađene na sustavu (za brzo dodavanje)."""
    import platform
    import glob

    found = []

    if platform.system() == "Windows":
        # Traži popularne SDR programe
        search_patterns = [
            ("SDR++", [
                r"C:\Program Files\sdrpp\sdrpp.exe",
                r"C:\Program Files (x86)\sdrpp\sdrpp.exe",
                os.path.expanduser(r"~\Desktop\sdrpp\sdrpp.exe"),
                os.path.expanduser(r"~\Downloads\sdrpp\sdrpp.exe"),
            ]),
            ("SDR# (SDRSharp)", [
                r"C:\Program Files\SDR#\SDRSharp.exe",
                r"C:\Program Files (x86)\SDR#\SDRSharp.exe",
                os.path.expanduser(r"~\Desktop\SDRSharp\SDRSharp.exe"),
            ]),
            ("GQRX", [
                r"C:\Program Files\gqrx\gqrx.exe",
                r"C:\Program Files (x86)\gqrx\gqrx.exe",
            ]),
            ("CubicSDR", [
                r"C:\Program Files\CubicSDR\CubicSDR.exe",
                r"C:\Program Files (x86)\CubicSDR\CubicSDR.exe",
            ]),
            ("VB-Cable / Voicemeeter", [
                r"C:\Program Files\VB\Voicemeeter\voicemeeter.exe",
                r"C:\Program Files (x86)\VB\Voicemeeter\voicemeeter.exe",
            ]),
        ]
    else:
        search_patterns = [
            ("SDR++", ["/usr/bin/sdrpp", "/usr/local/bin/sdrpp",
                       os.path.expanduser("~/sdrpp/sdrpp")]),
            ("GQRX", ["/usr/bin/gqrx", "/usr/local/bin/gqrx"]),
            ("CubicSDR", ["/usr/bin/CubicSDR", "/usr/local/bin/CubicSDR"]),
        ]

    for name, paths in search_patterns:
        for p in paths:
            if Path(p).exists():
                found.append({"name": name, "path": p})
                break

    return {"programs": found}


# -----------------------------------------------------------------------------
# Custom fields info
# -----------------------------------------------------------------------------
@app.get("/api/custom-fields")
async def api_custom_fields():
    """Vrati popis svih custom polja viđenih do sad."""
    return {"fields": analyzer.get_known_custom_fields()}


class BrowseRequest(BaseModel):
    path: str = ""


@app.post("/api/browse")
async def api_browse(req: BrowseRequest):
    """Vrati listu poddirektorija za zadanu putanju (za folder browser)."""
    import platform

    requested = req.path.strip()

    # Ako je prazno, vrati root direktorije (diskove na Windowsu, / na Linuxu)
    if not requested:
        if platform.system() == "Windows":
            import string
            drives = []
            for letter in string.ascii_uppercase:
                drive = f"{letter}:\\"
                if Path(drive).exists():
                    drives.append({"name": f"{letter}:\\", "path": drive, "is_drive": True})
            return {"current": "", "parent": "", "dirs": drives}
        else:
            requested = "/"

    p = Path(requested).resolve()
    if not p.exists() or not p.is_dir():
        raise HTTPException(400, f"Direktorij ne postoji: {requested}")

    dirs = []
    try:
        for item in sorted(p.iterdir()):
            if item.is_dir() and not item.name.startswith('.'):
                try:
                    list(item.iterdir())
                    dirs.append({"name": item.name, "path": str(item)})
                except PermissionError:
                    dirs.append({"name": item.name, "path": str(item), "locked": True})
    except PermissionError:
        raise HTTPException(403, f"Nema dozvole za čitanje: {requested}")

    parent = str(p.parent) if str(p) != str(p.parent) else ""
    return {"current": str(p), "parent": parent, "dirs": dirs}


class LoggingConfig(BaseModel):
    enabled: bool = True
    log_format: str = "CSV"
    log_directory: str = ""


@app.get("/api/logging/config")
async def api_logging_get_config():
    try:
        cfg_path = Path(__file__).parent / "logging_config.json"
        if cfg_path.exists():
            data = json.loads(cfg_path.read_text())
            return data
    except Exception:
        pass
    return {
        "enabled": telem_logger.enabled if telem_logger else False,
        "log_format": telem_logger.log_format if telem_logger else "CSV",
        "log_directory": telem_logger.log_directory if telem_logger else "",
    }


@app.post("/api/logging/config")
async def api_logging_set_config(cfg: LoggingConfig):
    global telem_logger
    log_dir = cfg.log_directory or str(Path(__file__).parent / "logs")
    os.makedirs(log_dir, exist_ok=True)
    if telem_logger:
        telem_logger.enabled = cfg.enabled
        telem_logger.log_format = cfg.log_format
        telem_logger.update_log_directory(log_dir)
    else:
        telem_logger = TelemetryLogger(
            log_directory=log_dir, log_format=cfg.log_format, enabled=cfg.enabled,
        )
    try:
        cfg_path = Path(__file__).parent / "logging_config.json"
        cfg_path.write_text(json.dumps({
            "log_directory": log_dir, "log_format": cfg.log_format, "enabled": cfg.enabled,
        }))
    except Exception as e:
        log.warning(f"Could not save logging config: {e}")
    return {"ok": True, "log_directory": log_dir}


@app.get("/api/logging/files")
async def api_logging_files():
    log_dir = telem_logger.log_directory if telem_logger else str(Path(__file__).parent / "logs")
    files = []
    try:
        p = Path(log_dir)
        if p.exists():
            for f in sorted(p.glob("*.*"), reverse=True):
                if f.suffix in ('.csv', '.json'):
                    files.append({
                        "name": f.name,
                        "size": f.stat().st_size,
                        "modified": datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
                    })
    except Exception as e:
        log.warning(f"Could not list log files: {e}")
    return files


@app.get("/api/logging/download/{filename}")
async def api_logging_download(filename: str):
    log_dir = telem_logger.log_directory if telem_logger else str(Path(__file__).parent / "logs")
    filepath = Path(log_dir) / filename
    if not filepath.resolve().parent == Path(log_dir).resolve():
        raise HTTPException(403, "Nedozvoljen pristup")
    if not filepath.exists():
        raise HTTPException(404, "Datoteka ne postoji")
    media = "text/csv" if filepath.suffix == '.csv' else "application/json"
    return FileResponse(filepath, media_type=media, filename=filename)


@app.post("/api/logging/load/{filename}")
async def api_logging_load(filename: str):
    """
    Učitaj stari log file u flight analyzer — za nastavak praćenja
    nakon restarta programa dok sonda još leti.
    Također registrira file u telemloggeru tako da se novi paketi
    nastavljaju dodavati u isti file.
    """
    log_dir = telem_logger.log_directory if telem_logger else str(Path(__file__).parent / "logs")
    filepath = Path(log_dir) / filename

    # Sigurnosna provjera — ne dozvoli path traversal
    if not filepath.resolve().parent == Path(log_dir).resolve():
        raise HTTPException(403, "Nedozvoljen pristup")
    if not filepath.exists():
        raise HTTPException(404, "Datoteka ne postoji")

    try:
        if filepath.suffix == '.csv':
            loaded = analyzer.load_from_csv(str(filepath))
        elif filepath.suffix == '.json':
            loaded = analyzer.load_from_json(str(filepath))
        else:
            raise HTTPException(400, "Nepodržani format. Samo CSV i JSON.")

        total = sum(loaded.values())
        callsigns = list(loaded.keys())
        log.info(f"Log loaded: {filename} → {total} paketa, callsigns: {callsigns}")

        # Registriraj file u telemloggeru tako da se novi paketi za iste
        # callsignove nastave dodavati u isti file (ne otvara novi).
        if telem_logger and telem_logger.enabled:
            for cs in callsigns:
                telem_logger.resume_file(str(filepath), cs)
            log.info(f"Telemlogger resumed for callsigns: {callsigns} → {filename}")

        # Obavijesti sve WebSocket klijente da osvježe podatke
        await manager.broadcast({
            "type": "log_loaded",
            "data": {
                "filename": filename,
                "total_packets": total,
                "callsigns": callsigns,
                "per_callsign": loaded,
            }
        })

        return {
            "ok": True,
            "filename": filename,
            "total_packets": total,
            "callsigns": callsigns,
            "per_callsign": loaded,
        }
    except HTTPException:
        raise
    except Exception as e:
        log.exception(f"Failed to load log file {filename}: {e}")
        raise HTTPException(500, f"Greška pri učitavanju: {str(e)}")


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    await ws.send_json({"type": "snapshot", "data": analyzer.get_flight_data()})
    try:
        while True:
            msg = await ws.receive_text()
            try:
                data = json.loads(msg)
                if data.get("type") == "ping":
                    await ws.send_json({"type": "pong"})
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        manager.disconnect(ws)


# Detektiraj frontend direktorij - radi u source modu I u PyInstaller EXE-u
def _find_frontend_dir() -> Path:
    # 1. PyInstaller frozen: frontend je u _internal/frontend
    if getattr(sys, 'frozen', False):
        _frozen = Path(sys._MEIPASS) / "frontend"
        if _frozen.exists():
            return _frozen
        # Fallback: pored EXE-a
        _exe = Path(sys.executable).parent / "frontend"
        if _exe.exists():
            return _exe
    # 2. Source mode: backend/ je parent, frontend/ je sibling
    _source = Path(__file__).parent.parent / "frontend"
    if _source.exists():
        return _source
    # 3. Još jedan fallback: frontend u istom direktoriju
    _same = Path(__file__).parent / "frontend"
    if _same.exists():
        return _same
    return _source  # vrati default čak i ako ne postoji


FRONTEND_DIR = _find_frontend_dir()
log.info(f"Frontend directory: {FRONTEND_DIR} (exists={FRONTEND_DIR.exists()})")

if FRONTEND_DIR.exists():
    app.mount(
        "/static",
        StaticFiles(directory=str(FRONTEND_DIR)),
        name="static",
    )

    @app.get("/")
    async def index():
        return FileResponse(FRONTEND_DIR / "index.html")


if __name__ == "__main__":
    import argparse
    import webbrowser
    import threading
    import uvicorn

    saved_cfg = _load_server_config()
    default_port = int(saved_cfg.get("port", 8000))

    parser = argparse.ArgumentParser(description="Horus Web server")
    parser.add_argument("--port", type=int, default=default_port,
                        help=f"Port (default iz konfiguracije: {default_port})")
    parser.add_argument("--host", type=str, default="0.0.0.0")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    # Detektiraj PyInstaller bundle. U frozen modu NE mozemo koristiti string
    # "main:app" jer PyInstaller ne izlaze 'main' kao importabilan modul na
    # sys.path - sav kod je spakiran u EXE. Umjesto toga proslijedujemo app
    # objekt direktno. U source modu zadrzavamo string da --reload radi.
    is_frozen = getattr(sys, 'frozen', False)

    # --reload zahtijeva string import (watchfiles prati fajlove), pa u frozen
    # modu mora biti iskljucen.
    if is_frozen and args.reload:
        log.warning("--reload opcija nije podrzana u PyInstaller EXE-u, ignoriram")
        args.reload = False

    if not args.no_browser:
        def open_browser():
            import time
            time.sleep(1.5)
            webbrowser.open(f"http://localhost:{args.port}")
        threading.Thread(target=open_browser, daemon=True).start()

    if is_frozen:
        # Direktan app objekt - radi u EXE-u
        uvicorn.run(app, host=args.host, port=args.port)
    else:
        # String import - radi u source modu i podrzava --reload
        uvicorn.run("main:app", host=args.host, port=args.port, reload=args.reload)
