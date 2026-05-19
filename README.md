> **⚠️ After updating to a new version**, open the application in your browser and press **`Ctrl + Shift + R`** (hard reload) to clear the cached files from the previous version. This ensures the latest frontend is loaded correctly.

# Horus Web — Balloon Telemetry Decoder

Modern web-based frontend for decoding and tracking high-altitude balloon (HAB) telemetry using the [Horus Binary](https://github.com/projecthorus/horusdemodlib) modem system.

Built as a full replacement for the original Horus GUI (Qt-based), Horus Web runs entirely in your browser and provides real-time telemetry decoding, mapping, charting, and flight analysis — all from a single `.exe` or Python script.

**Version:** 1.5  
**Author:** 9A6NDZ Zoran  
**License:** GPL-3.0

---

## Features

### Decoding & Audio
- Horus Binary v1/v2/v3 and RTTY (7N1, 7N2, 8N2) modem support
- Direct audio input from any sound card or via UDP audio stream (e.g. from SDR++)
- Configurable baud rate, tone spacing, and mask estimator
- Real-time FFT audio spectrum display with peak hold and tone detection
- Audio monitor output — listen to the incoming signal through a separate output device
- Automatic payload ID and custom field list download from SondeHub

### Live Map
- Interactive Leaflet map with real-time balloon position tracking
- Multiple map layers: Street, Satellite, Terrain, Dark, Light, Hybrid
- Multi-balloon tracking with color-coded paths
- Station marker with bearing, elevation angle, and range to balloon
- Radio horizon rings
- Follow mode — camera tracks the selected balloon
- OpenWeatherMap overlay (clouds, precipitation, pressure, wind, temperature)
- METAR data from nearby airports (via NOAA AWC)

### Flight Analysis
- Real-time altitude, climb rate, horizontal speed, and course calculation
- Automatic flight phase detection: pre-launch → ascent → burst → descent → landed
- Burst detection with max altitude and burst time logging
- Per-balloon statistics: max altitude, total distance, flight duration, packet count
- Configurable alert system: low battery, low temperature, low SNR, packet timeout

### Charts & Telemetry
- Real-time Chart.js graphs: altitude, SNR, battery voltage, temperature, satellites, climb rate
- Dynamic charts for Horus v2/v3 custom fields (humidity, pressure, analog inputs, etc.)
- Time range filter for all charts (last 5/15/30/60 min, all)
- Collapsible chart panels

### Data & Logging
- Automatic telemetry logging to CSV or JSON
- Log file browser with download and reload capability
- Resume tracking after restart by loading previous log files
- PDF flight report generation (altitude graph, SNR graph, flight summary table)
- SondeHub Amateur network upload with automatic station re-registration
- Private telemetry server forwarding via UDP or TCP (JSON or CSV format)

### User Interface
- Dark and light theme
- Multi-language support: Croatian (HR), English (EN), Polish (PL)
- Responsive layout for desktop and mobile
- Real-time WebSocket connection with auto-reconnect
- Email notifications when a new sonde is detected
- Configurable startup programs (auto-launch SDR++ or other software)
- Configurable server port with restart capability

---

## System Requirements

- **OS:** Windows 10 or Windows 11
- **Architecture:** 64-bit (x86_64)
- **Browser:** Any modern browser (Chrome, Firefox, Edge)
- **Audio:** Sound card or virtual audio cable for receiving audio from SDR software

No installation or Python required — everything is bundled in a single `.exe`.

---

## Quick Start

1. Download the latest `HorusWeb.exe` from the [Releases](https://github.com/9A6NDZ/Horus-WEB/releases) page
2. Run `HorusWeb.exe`
3. Your browser will open automatically at `http://localhost:8000`
4. Select your audio input device and modem type, then click **Start**

### Optional: SDR++ Integration

Configure SDR++ (or any SDR software) to output audio on a virtual audio cable, then select that device in Horus Web. Alternatively, use UDP audio mode (port 7355) for direct audio streaming from SDR++.

You can also configure Horus Web to auto-launch SDR++ on startup via Settings → Startup Programs.

---

## Project Structure

```
horus-web/
├── backend/
│   ├── main.py              # FastAPI server, REST API, WebSocket
│   ├── horus_bridge.py      # Audio capture, modem interface, FFT, SondeHub upload
│   ├── flight_analyzer.py   # Flight tracking, phase detection, alerts
│   ├── telemlogger.py       # CSV/JSON telemetry logging
│   ├── email_notifier.py    # SMTP email notifications
│   └── pdf_report.py        # PDF flight report generation
│
├── frontend/
│   ├── index.html           # Main HTML page
│   ├── css/
│   │   └── style.css        # Custom styles (on top of Tailwind)
│   └── js/
│       ├── app.js           # Main application logic
│       ├── map.js           # Leaflet map with multi-balloon tracking
│       ├── charts.js        # Chart.js real-time graphs
│       ├── spectrum.js      # Audio FFT spectrum display
│       ├── analytics.js     # UI analytics and statistics
│       └── i18n.js          # Internationalization (HR/EN/PL)
│
└── README.md
```

---

## Configuration Files

All configuration is stored as JSON files next to the executable (or `main.py`):

| File | Purpose |
|------|---------|
| `station_config.json` | Station callsign, position, SondeHub and private server settings |
| `decoder_config.json` | Last used audio device, modem, baud rate |
| `server_config.json` | Server port |
| `logging_config.json` | Telemetry logging directory, format (CSV/JSON), enabled state |
| `weather_config.json` | OpenWeatherMap API key |
| `email_config.json` | SMTP settings for email notifications |
| `startup_programs.json` | Programs to auto-launch on startup |
| `alert_config.json` | Alert thresholds (battery, temperature, SNR, timeout) |

---

## API Overview

Horus Web exposes a REST API on the same port as the web interface. All endpoints are under `/api/`.

**Decoder control:** `/api/start`, `/api/stop`, `/api/status`, `/api/audio-devices`, `/api/modems`

**Station:** `/api/station` (GET/POST), `/api/station/upload`

**Flight data:** `/api/flight`, `/api/flights`, `/api/callsigns`, `/api/flight/stats`, `/api/flight/reset`

**Logging:** `/api/logging/config`, `/api/logging/files`, `/api/logging/download/{filename}`, `/api/logging/load/{filename}`

**Weather:** `/api/weather/config`, `/api/weather/current`, `/api/weather/tile-url`

**METAR:** `/api/metar/nearby`, `/api/metar/station/{icao}`

**Other:** `/api/alerts/config`, `/api/email/config`, `/api/email/test`, `/api/startup-programs/config`, `/api/monitor/start`, `/api/monitor/stop`, `/api/server/config`, `/api/server/restart`, `/api/browse`

**WebSocket:** `ws://localhost:8000/ws` — real-time telemetry packets, FFT data, alerts, and status updates.

---

## Optional Services

### SondeHub Amateur

Upload decoded telemetry to the [SondeHub Amateur](https://amateur.sondehub.org/) network so others can track your balloon. Configure your station callsign, position, and enable SondeHub upload in Settings. A blocklist allows you to exclude test payloads from being uploaded.

### OpenWeatherMap

Add your free [OpenWeatherMap API key](https://openweathermap.org/api) in Settings to enable weather overlays on the map (clouds, precipitation, wind, pressure, temperature).

### Email Notifications

Configure SMTP settings to receive an email when a new sonde is first detected. Supports any SMTP provider (Gmail, Outlook, custom server).

### Private Telemetry Server

Forward decoded telemetry to your own server via UDP or TCP in JSON or CSV format. Useful for custom dashboards, logging infrastructure, or integration with other systems.

---

## License

This project is licensed under the **GNU General Public License v3.0** (GPL-3.0).

See [LICENSE](LICENSE) for the full text, or visit https://www.gnu.org/licenses/gpl-3.0.html.

This project is a derivative work that uses [horusdemodlib](https://github.com/projecthorus/horusdemodlib) by Mark Jessop VK5QI (Project Horus), which is licensed under GPL-3.0.

---

## Third-Party Libraries & Acknowledgments

### Python (backend)

| Library | License | Link |
|---------|---------|------|
| [horusdemodlib](https://github.com/projecthorus/horusdemodlib) | GPL-3.0 | Horus Binary/RTTY modem and decoder by Mark Jessop VK5QI |
| [FastAPI](https://fastapi.tiangolo.com/) | MIT | Web framework |
| [Uvicorn](https://www.uvicorn.org/) | BSD-3-Clause | ASGI server |
| [Pydantic](https://pydantic.dev/) | MIT | Data validation |
| [NumPy](https://numpy.org/) | BSD-3-Clause | FFT and numerical processing |
| [Matplotlib](https://matplotlib.org/) | PSF/BSD | PDF report chart generation |
| [ReportLab](https://www.reportlab.com/) | BSD-3-Clause | PDF generation |
| [PyAudio](https://people.csail.mit.edu/hubert/pyaudio/) | MIT | Audio input/output |
| [HTTPX](https://www.python-httpx.org/) | BSD-3-Clause | Async HTTP client (weather, METAR) |
| [PyInstaller](https://pyinstaller.org/) | GPL-2.0 (with bootloader exception) | .exe packaging |

### JavaScript (frontend, loaded via CDN)

| Library | License | Link |
|---------|---------|------|
| [Leaflet](https://leafletjs.com/) | BSD-2-Clause | Interactive maps |
| [Chart.js](https://www.chartjs.org/) | MIT | Real-time charts |
| [chartjs-adapter-date-fns](https://github.com/chartjs/chartjs-adapter-date-fns) | MIT | Date/time axis adapter |
| [Tailwind CSS](https://tailwindcss.com/) | MIT | Utility-first CSS framework |
| [Lucide Icons](https://lucide.dev/) | ISC | Icon set |

### Data Services

| Service | Usage |
|---------|-------|
| [SondeHub Amateur](https://amateur.sondehub.org/) | Telemetry upload and payload ID database |
| [OpenWeatherMap](https://openweathermap.org/) | Weather overlays (optional, requires API key) |
| [NOAA Aviation Weather Center](https://aviationweather.gov/) | METAR airport weather data (free, no key required) |
| [OpenStreetMap](https://www.openstreetmap.org/) | Map tiles via Leaflet (© OpenStreetMap contributors) |

---

## Acknowledgments

Special thanks to **Mark Jessop VK5QI** and the **Project Horus** team for creating and maintaining [horusdemodlib](https://github.com/projecthorus/horusdemodlib) and the Horus Binary telemetry system — the foundation this project is built upon.

Thanks to the **SondeHub** team for providing the amateur telemetry upload infrastructure and payload ID database.

---

## Contributing

Contributions, bug reports, and feature requests are welcome. Please open an issue or submit a pull request.

When contributing code, please note that this project is licensed under GPL-3.0 — all contributions must be compatible with this license.
