// ----------------------------------------------------------------------------
// i18n.js  -  Internacionalizacija (HR / EN / PL)
// ----------------------------------------------------------------------------

const HorusI18n = (() => {
  const STORAGE_KEY = 'horus_language';
  let currentLang = localStorage.getItem(STORAGE_KEY) || 'hr';

  // ---------------------------------------------------------------------------
  // TRANSLATIONS
  // ---------------------------------------------------------------------------
  const translations = {
    // ===================== HEADER =====================
    'header.subtitle': {
      hr: 'Balloon Telemetry Decoder v1.4',
      en: 'Balloon Telemetry Decoder v1.4',
      pl: 'Balloon Telemetry Decoder v1.4',
    },
    'header.theme_toggle': {
      hr: 'Promijeni temu',
      en: 'Toggle theme',
      pl: 'Zmień motyw',
    },
    'header.settings': {
      hr: 'Postavke',
      en: 'Settings',
      pl: 'Ustawienia',
    },
    'header.history': {
      hr: 'Povijest letova',
      en: 'Flight history',
      pl: 'Historia lotów',
    },
    'header.about': {
      hr: 'O aplikaciji',
      en: 'About',
      pl: 'O aplikacji',
    },
    'header.connected': {
      hr: 'Spojeno',
      en: 'Connected',
      pl: 'Połączono',
    },
    'header.disconnected': {
      hr: 'Prekinuto',
      en: 'Disconnected',
      pl: 'Rozłączono',
    },

    // ===================== PANEL REORDER =====================
    'reorder.drag_hint': {
      hr: 'Povuci za promjenu redoslijeda',
      en: 'Drag to reorder',
      pl: 'Przeciągnij, aby zmienić kolejność',
    },

    // ===================== LEFT SIDEBAR =====================
    'sidebar.decoder': {
      hr: 'Dekoder',
      en: 'Decoder',
      pl: 'Dekoder',
    },
    'sidebar.start': {
      hr: 'Start',
      en: 'Start',
      pl: 'Start',
    },
    'sidebar.stop': {
      hr: 'Stop',
      en: 'Stop',
      pl: 'Stop',
    },
    'sidebar.ready': {
      hr: 'Spreman',
      en: 'Ready',
      pl: 'Gotowy',
    },
    'sidebar.decoding': {
      hr: 'Dekodiranje…',
      en: 'Decoding…',
      pl: 'Dekodowanie…',
    },
    'sidebar.stopped': {
      hr: 'Zaustavljeno',
      en: 'Stopped',
      pl: 'Zatrzymano',
    },

    // -- Audio
    'sidebar.audio': {
      hr: 'Audio',
      en: 'Audio',
      pl: 'Audio',
    },
    'sidebar.device': {
      hr: 'Uređaj',
      en: 'Device',
      pl: 'Urządzenie',
    },
    'sidebar.sample_rate': {
      hr: 'Sample rate (Hz)',
      en: 'Sample rate (Hz)',
      pl: 'Częstotliwość próbkowania (Hz)',
    },
    'sidebar.udp_port': {
      hr: 'UDP Port',
      en: 'UDP Port',
      pl: 'Port UDP',
    },
    'sidebar.udp_port_hint': {
      hr: 'Port na kojem se prima UDP audio (default: 7355 za GQRX)',
      en: 'Port for receiving UDP audio (default: 7355 for GQRX)',
      pl: 'Port do odbioru audio UDP (domyślnie: 7355 dla GQRX)',
    },
    'sidebar.audio_monitor': {
      hr: 'Audio Monitor',
      en: 'Audio Monitor',
      pl: 'Monitor Audio',
    },
    'sidebar.output_device': {
      hr: 'Output uređaj',
      en: 'Output device',
      pl: 'Urządzenie wyjściowe',
    },
    'sidebar.no_output_devices': {
      hr: 'Nema dostupnih output uređaja',
      en: 'No output devices available',
      pl: 'Brak dostępnych urządzeń wyjściowych',
    },
    'sidebar.select_output_first': {
      hr: 'Odaberi output uređaj',
      en: 'Select output device',
      pl: 'Wybierz urządzenie wyjściowe',
    },
    'sidebar.browser_audio_info': {
      hr: 'Zvuk se reproducira na ovom (udaljenom) računalu preko preglednika.',
      en: 'Audio plays on this (remote) computer through the browser.',
      pl: 'Dźwięk odtwarzany na tym (zdalnym) komputerze przez przeglądarkę.',
    },
    'sidebar.audio_volume': {
      hr: 'Glasnoća',
      en: 'Volume',
      pl: 'Głośność',
    },
    'sidebar.audio_volume_hint': {
      hr: 'Glasnoća preslušavanja (neovisno o RF gainu)',
      en: 'Monitor volume (independent of RF gain)',
      pl: 'Głośność monitora (niezależna od wzmocnienia RF)',
    },

    // -- Modem
    'sidebar.modem': {
      hr: 'Modem',
      en: 'Modem',
      pl: 'Modem',
    },
    'sidebar.mode': {
      hr: 'Mod',
      en: 'Mode',
      pl: 'Tryb',
    },
    'sidebar.baud_rate': {
      hr: 'Baud rate',
      en: 'Baud rate',
      pl: 'Baud rate',
    },

    // -- RTL-SDR Direct
    'sidebar.rtl_sdr_direct': {
      hr: 'RTL-SDR Direct',
      en: 'RTL-SDR Direct',
      pl: 'RTL-SDR Direct',
    },
    'sidebar.rtl_sdr_hint': {
      hr: 'Primi signal direktno iz RTL-SDR (isključuje audio/UDP)',
      en: 'Receive signal directly from RTL-SDR (disables audio/UDP)',
      pl: 'Odbierz sygnał bezpośrednio z RTL-SDR (wyłącza audio/UDP)',
    },
    'sidebar.rtl_frequency': {
      hr: 'Frekvencija (MHz)',
      en: 'Frequency (MHz)',
      pl: 'Częstotliwość (MHz)',
    },
    'sidebar.rtl_gain': {
      hr: 'Gain (0=AGC)',
      en: 'Gain (0=AGC)',
      pl: 'Gain (0=AGC)',
    },
    'sidebar.rtl_ppm': {
      hr: 'PPM offset',
      en: 'PPM offset',
      pl: 'PPM offset',
    },
    'sidebar.rtl_device': {
      hr: 'SDR device #',
      en: 'SDR device #',
      pl: 'SDR device #',
    },
    'sidebar.rtl_bandwidth': {
      hr: 'Bandwidth (Hz)',
      en: 'Bandwidth (Hz)',
      pl: 'Bandwidth (Hz)',
    },
    'sidebar.rtl_bias_tee': {
      hr: 'Bias Tee (LNA power)',
      en: 'Bias Tee (LNA power)',
      pl: 'Bias Tee (LNA power)',
    },
    'sidebar.rtl_detect': {
      hr: 'Detect RTL-SDR',
      en: 'Detect RTL-SDR',
      pl: 'Wykryj RTL-SDR',
    },

    // -- Station
    'sidebar.station': {
      hr: 'Prijemna stanica',
      en: 'Receiving station',
      pl: 'Stacja odbiorcza',
    },
    'sidebar.callsign': {
      hr: 'Callsign',
      en: 'Callsign',
      pl: 'Callsign',
    },
    'sidebar.lat': {
      hr: 'Lat',
      en: 'Lat',
      pl: 'Szer.',
    },
    'sidebar.lon': {
      hr: 'Lon',
      en: 'Lon',
      pl: 'Dł.',
    },
    'sidebar.antenna_alt': {
      hr: 'Visina antene (m)',
      en: 'Antenna altitude (m)',
      pl: 'Wysokość anteny (m)',
    },
    'sidebar.antenna_alt_hint': {
      hr: 'Nadmorska visina antene (za horizon rings)',
      en: 'Antenna elevation above sea level (for horizon rings)',
      pl: 'Wysokość anteny n.p.m. (dla pierścieni horyzontu)',
    },
    'sidebar.radio': {
      hr: 'Radio',
      en: 'Radio',
      pl: 'Radio',
    },
    'sidebar.antenna': {
      hr: 'Antena',
      en: 'Antenna',
      pl: 'Antena',
    },
    'sidebar.dial_freq': {
      hr: 'Frekvencija radija (MHz)',
      en: 'Radio dial freq (MHz)',
      pl: 'Częstotliwość radia (MHz)',
    },
    'sidebar.dial_freq_hint': {
      hr: 'Frekvencija radija u MHz (za SondeHub)',
      en: 'Radio frequency in MHz (for SondeHub)',
      pl: 'Częstotliwość radia w MHz (dla SondeHub)',
    },
    'sidebar.sondehub_upload': {
      hr: 'Upload na SondeHub Amateur',
      en: 'Upload to SondeHub Amateur',
      pl: 'Wysyłanie do SondeHub Amateur',
    },
    'sidebar.sondehub_hint': {
      hr: 'Zahtijeva valjani callsign (ne N0CALL)',
      en: 'Requires a valid callsign (not N0CALL)',
      pl: 'Wymaga prawidłowego callsigna (nie N0CALL)',
    },
    'sidebar.sondehub_blocklist': {
      hr: 'SondeHub blocklist callsignova',
      en: 'SondeHub callsign blocklist',
      pl: 'Lista blokowanych callsignów SondeHub',
    },
    'sidebar.sondehub_blocklist_hint': {
      hr: 'Callsignovi odvojeni zarezom — ovi se NEĆE slati na SondeHub.',
      en: 'Comma-separated callsigns — these will NOT be uploaded to SondeHub.',
      pl: 'Callsigny oddzielone przecinkami — te NIE będą wysyłane do SondeHub.',
    },

    // -- Station placeholders
    'sidebar.callsign_placeholder': { hr: '9A5XXX', en: 'W1ABC',
    pl: 'SP1XXX' },
    'sidebar.alt_placeholder': { hr: 'npr. 150', en: 'e.g. 150',
    pl: 'np. 150' },
    'sidebar.radio_placeholder': { hr: 'npr. Yaesu FT-991', en: 'e.g. Yaesu FT-991',
    pl: 'np. Yaesu FT-991' },
    'sidebar.antenna_placeholder': { hr: 'npr. Yagi 5el', en: 'e.g. Yagi 5el',
    pl: 'np. Yagi 5el' },
    'sidebar.dial_freq_placeholder': { hr: 'npr. 437.600', en: 'e.g. 437.600',
    pl: 'np. 437.600' },
    'sidebar.blocklist_placeholder': { hr: 'npr. 9A6NDZ-TEST, 9A6NDZ-DEV', en: 'e.g. W1ABC-TEST, W1ABC-DEV',
    pl: 'np. SP1ABC-TEST, SP1ABC-DEV' },

    'sidebar.save': {
      hr: 'Spremi',
      en: 'Save',
      pl: 'Zapisz',
    },
    'sidebar.upload_station': {
      hr: 'Upload stanice na SondeHub',
      en: 'Upload station to SondeHub',
      pl: 'Wyślij stację do SondeHub',
    },
    'sidebar.upload_station_hint': {
      hr: 'Ručno uploadaj podatke o stanici na SondeHub (korisno nakon promjene postavki)',
      en: 'Manually upload station info to SondeHub (useful after changing settings)',
      pl: 'Ręcznie wyślij dane stacji do SondeHub (przydatne po zmianie ustawień)',
    },

    // -- CSV Log
    'sidebar.csv_log': {
      hr: 'CSV Log',
      en: 'CSV Log',
      pl: 'CSV Log',
    },
    'sidebar.select_log': {
      hr: 'Odaberi log datoteku',
      en: 'Select log file',
      pl: 'Wybierz plik logu',
    },
    'sidebar.loading': {
      hr: 'Učitavanje…',
      en: 'Loading…',
      pl: 'Ładowanie…',
    },
    'sidebar.refresh_list': {
      hr: 'Osvježi popis',
      en: 'Refresh list',
      pl: 'Odśwież listę',
    },
    'sidebar.download_csv': {
      hr: 'Preuzmi CSV',
      en: 'Download CSV',
      pl: 'Pobierz CSV',
    },
    'sidebar.load_log': {
      hr: 'Učitaj log (nastavak leta)',
      en: 'Load log (resume flight)',
      pl: 'Wczytaj log (wznów lot)',
    },
    'sidebar.reset_flight': {
      hr: 'Resetiraj let',
      en: 'Reset flight',
      pl: 'Resetuj lot',
    },

    // ===================== MAIN CONTENT =====================
    // -- Telemetry panel
    'telemetry.last_packet': {
      hr: 'Zadnji paket',
      en: 'Last packet',
      pl: 'Ostatni pakiet',
    },
    'telemetry.sondehub_link': {
      hr: 'Otvori ovu sondu na SondeHub Amateur',
      en: 'Open this sonde on SondeHub Amateur',
      pl: 'Otwórz tę sondę na SondeHub Amateur',
    },
    'telemetry.callsign': { hr: 'Callsign', en: 'Callsign',
    pl: 'Callsign' },
    'telemetry.time': { hr: 'Vrijeme', en: 'Time',
    pl: 'Czas' },
    'telemetry.latitude': { hr: 'Latituda', en: 'Latitude',
    pl: 'Szerokość' },
    'telemetry.longitude': { hr: 'Longituda', en: 'Longitude',
    pl: 'Długość' },
    'telemetry.satellites': { hr: 'Sateliti', en: 'Satellites',
    pl: 'Satelity' },
    'telemetry.battery': { hr: 'Baterija', en: 'Battery',
    pl: 'Bateria' },
    'telemetry.temperature': { hr: 'Temperatura', en: 'Temperature',
    pl: 'Temperatura' },
    'telemetry.bearing': { hr: 'Bearing', en: 'Bearing',
    pl: 'Namiar' },
    'telemetry.elevation': { hr: 'Elevacija', en: 'Elevation',
    pl: 'Elewacja' },
    'telemetry.horiz_speed': { hr: 'Horiz. brzina', en: 'Horiz. speed',
    pl: 'Prędk. pozioma' },
    'telemetry.course': { hr: 'Smjer', en: 'Course',
    pl: 'Kurs' },
    'telemetry.snr': { hr: 'SNR', en: 'SNR',
    pl: 'SNR' },

    // -- KPI
    'kpi.title': { hr: 'Ključni pokazatelji', en: 'Key indicators',
    pl: 'Kluczowe wskaźniki' },
    'kpi.altitude': { hr: 'Visina', en: 'Altitude',
    pl: 'Wysokość' },
    'kpi.climb_rate': { hr: 'Brzina penjanja', en: 'Climb rate',
    pl: 'Prędkość wznoszenia' },
    'kpi.range': { hr: 'Udaljenost', en: 'Range',
    pl: 'Odległość' },
    'kpi.snr': { hr: 'SNR', en: 'SNR',
    pl: 'SNR' },

    // -- Flight info bar
    'flight.phase': { hr: 'Faza leta:', en: 'Flight phase:',
    pl: 'Faza lotu:' },
    'flight.packets': { hr: 'paketa', en: 'packets',
    pl: 'pakietów' },
    'flight.success': { hr: 'uspješno', en: 'success',
    pl: 'sukces' },
    'flight.waiting': { hr: 'Čekanje…', en: 'Waiting…',
    pl: 'Oczekiwanie…' },

    // -- Map
    'map.title': { hr: 'Karta i putanja', en: 'Map & trajectory',
    pl: 'Mapa i trajektoria' },
    'map.weather': { hr: 'Vrijeme:', en: 'Weather:',
    pl: 'Pogoda:' },
    'map.no_layer': { hr: 'Bez sloja', en: 'No layer',
    pl: 'Bez warstwy' },
    'map.clouds': { hr: 'Oblaci', en: 'Clouds',
    pl: 'Chmury' },
    'map.precipitation': { hr: 'Padaline', en: 'Precipitation',
    pl: 'Opady' },
    'map.pressure': { hr: 'Tlak', en: 'Pressure',
    pl: 'Ciśnienie' },
    'map.wind': { hr: 'Vjetar', en: 'Wind',
    pl: 'Wiatr' },
    'map.temperature': { hr: 'Temperatura', en: 'Temperature',
    pl: 'Temperatura' },
    'map.opacity': { hr: 'Prozirnost:', en: 'Opacity:',
    pl: 'Przezroczystość:' },
    'map.layer_title': { hr: 'Izgled karte', en: 'Map style',
    pl: 'Styl mapy' },
    'map.horizon_rings': { hr: 'Radio horizont balona', en: 'Balloon radio horizon',
    pl: 'Horyzont radiowy balonu' },
    'map.metar_stations': { hr: 'METAR stanice', en: 'METAR stations',
    pl: 'Stacje METAR' },
    'map.day_night': { hr: 'Dan/noć sjena', en: 'Day/night shadow',
    pl: 'Cień dnia/nocy' },
    'map.view_3d': { hr: '3D prikaz', en: '3D view',
    pl: 'Widok 3D' },
    'map.view_3d_tip': { hr: 'Otvori 3D prikaz leta u novom prozoru', en: 'Open 3D flight view in a new window',
    pl: 'Otwórz widok lotu 3D w nowym oknie' },
    'map.in_range': { hr: 'u dometu', en: 'in range',
    pl: 'w zasięgu' },
    'map.out_of_range': { hr: 'van dometa', en: 'out of range',
    pl: 'poza zasięgiem' },

    // -- Weather legends (map.js)
    'weather.clouds': { hr: 'Oblačnost', en: 'Cloud cover',
    pl: 'Zachmurzenie' },
    'weather.precipitation': { hr: 'Padaline', en: 'Precipitation',
    pl: 'Opady' },
    'weather.pressure': { hr: 'Tlak', en: 'Pressure',
    pl: 'Ciśnienie' },
    'weather.wind': { hr: 'Vjetar', en: 'Wind',
    pl: 'Wiatr' },
    'weather.temperature': { hr: 'Temperatura', en: 'Temperature',
    pl: 'Temperatura' },

    // -- METAR popup (map.js)
    'metar.wind': { hr: 'Vjetar', en: 'Wind',
    pl: 'Wiatr' },
    'metar.visibility': { hr: 'Vidljivost', en: 'Visibility',
    pl: 'Widoczność' },
    'metar.phenomena': { hr: 'Pojave', en: 'Phenomena',
    pl: 'Zjawiska' },
    'metar.elevation': { hr: 'Elevacija', en: 'Elevation',
    pl: 'Elewacja' },
    'metar.distance': { hr: 'Udaljenost', en: 'Distance',
    pl: 'Odległość' },
    'metar.clouds_ceiling': { hr: 'Oblaci / Ceiling', en: 'Clouds / Ceiling',
    pl: 'Chmury / Pułap' },
    'metar.no_data': { hr: 'Nema podataka', en: 'No data',
    pl: 'Brak danych' },
    'metar.no_coords': { hr: 'Nema koordinata', en: 'No coordinates',
    pl: 'Brak współrzędnych' },
    'metar.station': { hr: 'Stanica', en: 'Station',
    pl: 'Stacja' },

    // -- Spectrum
    'spectrum.title': { hr: 'Audio spektar', en: 'Audio spectrum',
    pl: 'Spektrum audio' },
    'spectrum.level': { hr: 'Razina:', en: 'Level:',
    pl: 'Poziom:' },
    'spectrum.max_freq': { hr: 'Max freq:', en: 'Max freq:',
    pl: 'Maks. częst.:' },
    'spectrum.tones': { hr: 'Detektirani tonovi:', en: 'Detected tones:',
    pl: 'Wykryte tony:' },
    'spectrum.no_signal': { hr: 'Nema signala', en: 'No signal',
    pl: 'Brak sygnału' },

    // -- Charts
    'charts.analysis': { hr: 'Analiza leta', en: 'Flight analysis',
    pl: 'Analiza lotu' },
    'charts.balloon': { hr: 'Balon:', en: 'Balloon:',
    pl: 'Balon:' },
    'charts.all': { hr: 'Svi', en: 'All',
    pl: 'Wszystkie' },
    'charts.all_balloons': { hr: 'Svi baloni', en: 'All balloons',
    pl: 'Wszystkie balony' },
    'charts.range': { hr: 'Raspon:', en: 'Range:',
    pl: 'Zakres:' },
    'charts.packets': { hr: 'paketa', en: 'packets',
    pl: 'pakietów' },
    'charts.altitude_profile': { hr: 'Profil visine', en: 'Altitude profile',
    pl: 'Profil wysokości' },
    'charts.snr_over_time': { hr: 'SNR kroz vrijeme', en: 'SNR over time',
    pl: 'SNR w czasie' },
    'charts.battery': { hr: 'Baterija (V)', en: 'Battery (V)',
    pl: 'Bateria (V)' },
    'charts.temperature': { hr: 'Temperatura (°C)', en: 'Temperature (°C)',
    pl: 'Temperatura (°C)' },
    'charts.gps_satellites': { hr: 'GPS sateliti', en: 'GPS satellites',
    pl: 'Satelity GPS' },
    'charts.climb_rate': { hr: 'Brzina penjanja (m/s)', en: 'Climb rate (m/s)',
    pl: 'Prędkość wznoszenia (m/s)' },
    'charts.speed': { hr: 'Brzina', en: 'Speed',
    pl: 'Prędkość' },
    'charts.ascent_rate_chart': { hr: 'Brzina uspona', en: 'Ascent rate',
    pl: 'Prędkość wznoszenia' },
    'charts.ext_humidity': { hr: 'Ext. vlažnost (%)', en: 'Ext. humidity (%)',
    pl: 'Zewn. wilgotność (%)' },
    'charts.ext_pressure': { hr: 'Ext. tlak (hPa)', en: 'Ext. pressure (hPa)',
    pl: 'Zewn. ciśnienie (hPa)' },
    'charts.crc_pass': { hr: 'CRC Pass', en: 'CRC Pass',
    pl: 'CRC Pass' },
    'charts.horiz_speed': { hr: 'Horiz. brzina (km/h)', en: 'Horiz. speed (km/h)',
    pl: 'Prędk. pozioma (km/h)' },

    // -- Time range options
    'range.5min': { hr: 'Zadnjih 5 min', en: 'Last 5 min',
    pl: 'Ostatnie 5 min' },
    'range.15min': { hr: 'Zadnjih 15 min', en: 'Last 15 min',
    pl: 'Ostatnie 15 min' },
    'range.1h': { hr: 'Zadnji 1 sat', en: 'Last 1 hour',
    pl: 'Ostatnia 1 godz.' },
    'range.3h': { hr: 'Zadnja 3 sata', en: 'Last 3 hours',
    pl: 'Ostatnie 3 godz.' },
    'range.6h': { hr: 'Zadnjih 6 sati', en: 'Last 6 hours',
    pl: 'Ostatnich 6 godz.' },
    'range.12h': { hr: 'Zadnjih 12 sati', en: 'Last 12 hours',
    pl: 'Ostatnich 12 godz.' },
    'range.24h': { hr: 'Zadnja 24 sata', en: 'Last 24 hours',
    pl: 'Ostatnie 24 godz.' },
    'range.2d': { hr: 'Zadnja 2 dana', en: 'Last 2 days',
    pl: 'Ostatnie 2 dni' },
    'range.7d': { hr: 'Zadnjih 7 dana', en: 'Last 7 days',
    pl: 'Ostatnich 7 dni' },
    'range.all': { hr: 'Svi podaci', en: 'All data',
    pl: 'Wszystkie dane' },

    // -- Console
    'console.title': { hr: 'Konzola', en: 'Console',
    pl: 'Konsola' },
    'console.clear': { hr: 'Očisti', en: 'Clear',
    pl: 'Wyczyść' },

    // ===================== SETTINGS MODAL =====================
    'settings.title': { hr: 'Postavke', en: 'Settings',
    pl: 'Ustawienia' },
    'settings.close': { hr: 'Zatvori', en: 'Close',
    pl: 'Zamknij' },

    // -- Language
    'settings.language': { hr: 'Jezik sučelja', en: 'Interface language',
    pl: 'Język interfejsu' },
    'settings.language_hint': { hr: 'Promjena jezika se primjenjuje odmah.', en: 'Language change applies immediately.',
    pl: 'Zmiana języka jest natychmiastowa.' },

    // -- Server
    'settings.server': { hr: 'Server', en: 'Server',
    pl: 'Serwer' },
    'settings.server_port': { hr: 'Port servera', en: 'Server port',
    pl: 'Port serwera' },
    'settings.server_current': { hr: 'Trenutni:', en: 'Current:',
    pl: 'Aktualny:' },
    'settings.server_restart_hint': {
      hr: 'Promjena se aktivira tek <strong class="text-amber-400">nakon što ručno ponovno pokreneš program</strong>.',
      en: 'Change takes effect only <strong class="text-amber-400">after you manually restart the program</strong>.',
      pl: 'Zmiana zadziała dopiero <strong class="text-amber-400">po ręcznym ponownym uruchomieniu programu</strong>.',
    },
    'settings.save_port': { hr: 'Spremi port', en: 'Save port',
    pl: 'Zapisz port' },

    // -- Private server
    'settings.private_server': { hr: 'Privatni server', en: 'Private server',
    pl: 'Prywatny serwer' },
    'settings.private_server_enabled': { hr: 'Slanje telemetrije na privatni server', en: 'Send telemetry to private server',
    pl: 'Wysyłanie telemetrii na prywatny serwer' },
    'settings.private_server_hint': { hr: 'Šalje dekodirane pakete na vaš server paralelno sa SondeHub-om.', en: 'Sends decoded packets to your server in parallel with SondeHub.',
    pl: 'Wysyła zdekodowane pakiety na Twój serwer równolegle z SondeHub.' },
    'settings.private_server_host': { hr: 'Adresa (host/IP)', en: 'Address (host/IP)',
    pl: 'Adres (host/IP)' },
    'settings.private_server_host_placeholder': { hr: '192.168.1.100', en: '192.168.1.100',
    pl: '192.168.1.100' },
    'settings.private_server_port': { hr: 'Port', en: 'Port',
    pl: 'Port' },
    'settings.private_server_protocol': { hr: 'Protokol', en: 'Protocol',
    pl: 'Protokół' },
    'settings.private_server_format': { hr: 'Format podataka', en: 'Data format',
    pl: 'Format danych' },
    'settings.private_server_info': {
      hr: 'UDP: fire-and-forget, brže. TCP: pouzdanije, ali sporije.<br>JSON šalje sva polja iz paketa. CSV šalje: callsign, time, lat, lon, alt, speed, heading, snr, battery, temp, sats.',
      en: 'UDP: fire-and-forget, faster. TCP: more reliable, but slower.<br>JSON sends all packet fields. CSV sends: callsign, time, lat, lon, alt, speed, heading, snr, battery, temp, sats.',
      pl: 'UDP: fire-and-forget, szybszy. TCP: bardziej niezawodny, ale wolniejszy.<br>JSON wysyła wszystkie pola pakietu. CSV wysyła: callsign, time, lat, lon, alt, speed, heading, snr, battery, temp, sats.',
    },
    'settings.private_server_note': { hr: 'Postavke privatnog servera se spremaju zajedno sa stanicom (Spremi u sidebaru).', en: 'Private server settings are saved together with the station (Save in sidebar).',
    pl: 'Ustawienia prywatnego serwera są zapisywane razem ze stacją (Zapisz w panelu bocznym).' },

    // -- Logging
    'settings.logging': { hr: 'Logiranje telemetrije', en: 'Telemetry logging',
    pl: 'Logowanie telemetrii' },
    'settings.logging_enabled': { hr: 'Aktivno logiranje dolaznih paketa', en: 'Active logging of incoming packets',
    pl: 'Aktywne logowanie przychodzących pakietów' },
    'settings.logging_disabled_hint': { hr: 'Kad je isključeno, novi paketi se neće spremati u datoteke.', en: 'When disabled, new packets will not be saved to files.',
    pl: 'Po wyłączeniu nowe pakiety nie będą zapisywane do plików.' },
    'settings.log_directory': { hr: 'Direktorij za spremanje/čitanje logova', en: 'Directory for saving/reading logs',
    pl: 'Katalog do zapisu/odczytu logów' },
    'settings.log_dir_select': { hr: 'Odaberi', en: 'Browse',
    pl: 'Przeglądaj' },
    'settings.log_dir_hint': {
      hr: 'Apsolutna putanja. Ako direktorij ne postoji, bit će napravljen. Ostavi prazno za default (<code class="text-slate-400">backend/logs/</code>).',
      en: 'Absolute path. If directory doesn\'t exist, it will be created. Leave empty for default (<code class="text-slate-400">backend/logs/</code>).',
      pl: 'Ścieżka bezwzględna. Jeśli katalog nie istnieje, zostanie utworzony. Pozostaw puste dla domyślnego (<code class="text-slate-400">backend/logs/</code>).',
    },
    'settings.log_dir_current': { hr: 'Trenutno:', en: 'Current:',
    pl: 'Aktualny:' },
    'settings.log_format': { hr: 'Format logova', en: 'Log format',
    pl: 'Format logów' },
    'settings.log_format_csv': { hr: 'CSV (jedan red = jedan paket)', en: 'CSV (one row = one packet)',
    pl: 'CSV (jeden wiersz = jeden pakiet)' },
    'settings.log_format_json': { hr: 'JSON (jedan red = jedan paket)', en: 'JSON (one row = one packet)',
    pl: 'JSON (jeden wiersz = jeden pakiet)' },
    'settings.save_logging': { hr: 'Spremi postavke logiranja', en: 'Save logging settings',
    pl: 'Zapisz ustawienia logowania' },

    // -- Alerts
    'settings.alerts': { hr: 'Alerti i upozorenja', en: 'Alerts & warnings',
    pl: 'Alerty i ostrzeżenia' },
    'settings.alerts_enabled': { hr: 'Aktiviraj alerte', en: 'Enable alerts',
    pl: 'Włącz alerty' },
    'settings.alerts_hint': { hr: 'Toast notifikacija + zvuk kad se prekorači prag.', en: 'Toast notification + sound when threshold is exceeded.',
    pl: 'Powiadomienie toast + dźwięk po przekroczeniu progu.' },
    'settings.battery_min': { hr: 'Baterija min (V)', en: 'Battery min (V)',
    pl: 'Bateria min (V)' },
    'settings.temp_min': { hr: 'Temperatura min (°C)', en: 'Temperature min (°C)',
    pl: 'Temperatura min (°C)' },
    'settings.snr_min': { hr: 'SNR min (dB)', en: 'SNR min (dB)',
    pl: 'SNR min (dB)' },
    'settings.timeout': { hr: 'Timeout paketa (s)', en: 'Packet timeout (s)',
    pl: 'Timeout pakietów (s)' },
    'settings.alerts_info': {
      hr: 'Alerte: burst detektiran, GPS fix izgubljen, baterija/temp/SNR ispod praga, gubitak paketa.',
      en: 'Alerts: burst detected, GPS fix lost, battery/temp/SNR below threshold, packet loss.',
      pl: 'Alerty: burst wykryty, utrata GPS fix, bateria/temp/SNR poniżej progu, utrata pakietów.',
    },
    'settings.save_alerts': { hr: 'Spremi alerte', en: 'Save alerts',
    pl: 'Zapisz alerty' },

    // -- Email notifications
    'settings.email': { hr: 'Email notifikacije — nova sonda', en: 'Email notifications — new radiosonde',
    pl: 'Powiadomienia email — nowa sonda' },
    'settings.email_enabled': { hr: 'Aktiviraj email notifikacije', en: 'Enable email notifications',
    pl: 'Włącz powiadomienia email' },
    'settings.email_hint': { hr: 'Šalje email kad se detektira nova sonda u zraku (prvi paket).', en: 'Sends an email when a new radiosonde is detected in the air (first packet).',
    pl: 'Wysyła email po wykryciu nowej sondy w powietrzu (pierwszy pakiet).' },
    'settings.smtp_server': { hr: 'SMTP server', en: 'SMTP server',
    pl: 'Serwer SMTP' },
    'settings.smtp_port': { hr: 'SMTP port', en: 'SMTP port',
    pl: 'Port SMTP' },
    'settings.smtp_port_hint': { hr: '587 (STARTTLS) ili 465 (SSL)', en: '587 (STARTTLS) or 465 (SSL)',
    pl: '587 (STARTTLS) lub 465 (SSL)' },
    'settings.cooldown': { hr: 'Cooldown (sati)', en: 'Cooldown (hours)',
    pl: 'Cooldown (godziny)' },
    'settings.cooldown_hint': { hr: 'Min. razmak između emailova za istu sondu', en: 'Min. interval between emails for the same radiosonde',
    pl: 'Min. przerwa między emailami dla tej samej sondy' },
    'settings.smtp_user': { hr: 'SMTP korisnik (email za login)', en: 'SMTP user (email for login)',
    pl: 'Użytkownik SMTP (email do logowania)' },
    'settings.smtp_password': { hr: 'SMTP lozinka', en: 'SMTP password',
    pl: 'Hasło SMTP' },
    'settings.smtp_password_placeholder': { hr: 'App Password ili lozinka', en: 'App Password or password',
    pl: 'App Password lub hasło' },
    'settings.smtp_password_set': { hr: '✓ lozinka postavljena', en: '✓ password set',
    pl: '✓ hasło ustawione' },
    'settings.gmail_hint': {
      hr: 'Za Gmail koristi <a href="https://myaccount.google.com/apppasswords" target="_blank" class="text-brand-500 hover:underline">App Password</a> (potrebna je 2FA).',
      en: 'For Gmail use <a href="https://myaccount.google.com/apppasswords" target="_blank" class="text-brand-500 hover:underline">App Password</a> (2FA required).',
      pl: 'Dla Gmaila użyj <a href="https://myaccount.google.com/apppasswords" target="_blank" class="text-brand-500 hover:underline">App Password</a> (wymagane 2FA).',
    },
    'settings.from_email': { hr: 'Pošiljatelj (From)', en: 'Sender (From)',
    pl: 'Nadawca (From)' },
    'settings.from_placeholder': { hr: 'Ostavi prazno = SMTP korisnik', en: 'Leave empty = SMTP user',
    pl: 'Pozostaw puste = użytkownik SMTP' },
    'settings.to_email': { hr: 'Primatelj (To)', en: 'Recipient (To)',
    pl: 'Odbiorca (To)' },
    'settings.to_email_placeholder': { hr: 'tvoj@email.com', en: 'your@email.com',
    pl: 'twoj@email.com' },
    'settings.save_email': { hr: 'Spremi', en: 'Save',
    pl: 'Zapisz' },
    'settings.test_email': { hr: 'Test email', en: 'Test email',
    pl: 'Test email' },

    // -- Startup programs
    'settings.startup': { hr: 'Automatsko pokretanje programa', en: 'Auto-start programs',
    pl: 'Automatyczne uruchamianie programów' },
    'settings.startup_enabled': { hr: 'Pokreni programe zajedno s Horusom', en: 'Start programs together with Horus',
    pl: 'Uruchom programy razem z Horusem' },
    'settings.startup_hint': { hr: 'Konfigurirani programi (npr. SDR++) pokrenut će se automatski kad Horus startuje.', en: 'Configured programs (e.g. SDR++) will start automatically when Horus starts.',
    pl: 'Skonfigurowane programy (np. SDR++) uruchomią się automatycznie przy starcie Horusa.' },
    'settings.add_program': { hr: 'Dodaj program', en: 'Add program',
    pl: 'Dodaj program' },
    'settings.find_programs': { hr: 'Pronađi', en: 'Detect',
    pl: 'Wykryj' },
    'settings.save_startup': { hr: 'Spremi postavke pokretanja', en: 'Save startup settings',
    pl: 'Zapisz ustawienia uruchamiania' },
    'settings.no_programs': {
      hr: 'Nema dodanih programa. Klikni "Dodaj program" ili "Pronađi" za početak.',
      en: 'No programs added. Click "Add program" or "Detect" to get started.',
      pl: 'Brak dodanych programów. Kliknij "Dodaj program" lub "Wykryj" aby rozpocząć.',
    },
    'settings.exe_path': { hr: 'Putanja do izvršne datoteke', en: 'Path to executable',
    pl: 'Ścieżka do pliku wykonywalnego' },

    // -- OpenWeather
    'settings.weather': { hr: 'OpenWeather', en: 'OpenWeather',
    pl: 'OpenWeather' },
    'settings.weather_api_key': { hr: 'API Key', en: 'API Key',
    pl: 'Klucz API' },
    'settings.weather_placeholder': { hr: 'Upiši svoj API ključ', en: 'Enter your API key',
    pl: 'Wpisz swój klucz API' },
    'settings.weather_get_key': { hr: 'Dobij besplatan API ključ', en: 'Get a free API key',
    pl: 'Uzyskaj darmowy klucz API' },
    'settings.weather_set': { hr: '✓ postavljen', en: '✓ set',
    pl: '✓ ustawiony' },
    'settings.weather_hint': { hr: 'Kad je ključ postavljen, vremenski slojevi se automatski nude u izborniku filtra na karti.', en: 'When key is set, weather layers are automatically offered in the map filter menu.',
    pl: 'Gdy klucz jest ustawiony, warstwy pogodowe są automatycznie dostępne w menu filtrów mapy.' },
    'settings.save_weather': { hr: 'Spremi ključ', en: 'Save key',
    pl: 'Zapisz klucz' },

    // ===================== UPDATE CHECK =====================
    'settings.update': { hr: 'Provjera ažuriranja', en: 'Update Check',
    pl: 'Sprawdzanie aktualizacji' },
    'settings.update_auto': { hr: 'Automatski provjeri pri pokretanju', en: 'Automatically check on startup',
    pl: 'Automatycznie sprawdź przy uruchomieniu' },
    'settings.update_hint': { hr: 'Provjera šalje jedan HTTP zahtjev na GitHub prilikom otvaranja aplikacije.', en: 'Check sends one HTTP request to GitHub when the app opens.',
    pl: 'Sprawdzenie wysyła jedno żądanie HTTP do GitHub przy otwarciu aplikacji.' },
    'settings.save_update': { hr: 'Spremi', en: 'Save',
    pl: 'Zapisz' },
    'settings.check_now': { hr: 'Provjeri sada', en: 'Check now',
    pl: 'Sprawdź teraz' },
    'app.update_saved_message': { hr: 'Postavke provjere ažuriranja su spremljene.', en: 'Update check settings saved.',
    pl: 'Ustawienia sprawdzania aktualizacji zostały zapisane.' },
    'app.update_checking': { hr: 'Provjeravam...', en: 'Checking...',
    pl: 'Sprawdzam...' },
    'app.update_available': { hr: 'Dostupna nova verzija: {0}', en: 'New version available: {0}',
    pl: 'Dostępna nowa wersja: {0}' },
    'app.update_notes': { hr: 'Bilješke: {0}', en: 'Notes: {0}',
    pl: 'Uwagi: {0}' },
    'app.update_download': { hr: 'Preuzmi s GitHuba', en: 'Download from GitHub',
    pl: 'Pobierz z GitHub' },
    'app.update_current': { hr: 'Imaš najnoviju verziju ({0}).', en: 'You have the latest version ({0}).',
    pl: 'Masz najnowszą wersję ({0}).' },
    'app.update_error': { hr: 'Greška pri provjeri: {0}', en: 'Check failed: {0}',
    pl: 'Błąd sprawdzania: {0}' },

    // ===================== ABOUT MODAL =====================
    'header.about': {
      hr: 'O aplikaciji',
      en: 'About',
      pl: 'O aplikacji',
    },
    'about.title': {
      hr: 'O aplikaciji',
      en: 'About',
      pl: 'O aplikacji',
    },
    'about.subtitle': {
      hr: 'Balloon Telemetry Decoder',
      en: 'Balloon Telemetry Decoder',
      pl: 'Balloon Telemetry Decoder',
    },
    'about.version': {
      hr: 'Verzija',
      en: 'Version',
      pl: 'Wersja',
    },
    'about.author': {
      hr: 'Autor',
      en: 'Author',
      pl: 'Autor',
    },
    'about.based_on': {
      hr: 'Bazirano na',
      en: 'Based on',
      pl: 'Oparte na',
    },
    'about.license': {
      hr: 'Licenca',
      en: 'License',
      pl: 'Licencja',
    },
    'about.source_code': {
      hr: 'Izvorni kod na GitHubu',
      en: 'Source code on GitHub',
      pl: 'Kod źródłowy na GitHubie',
    },
    'about.close': {
      hr: 'Zatvori',
      en: 'Close',
      pl: 'Zamknij',
    },

    // ===================== FOLDER BROWSER MODAL =====================
    'folder.title': { hr: 'Odaberi direktorij', en: 'Select directory',
    pl: 'Wybierz katalog' },
    'folder.loading': { hr: 'Učitavanje...', en: 'Loading...',
    pl: 'Ładowanie...' },
    'folder.no_subdirs': { hr: 'Nema poddirektorija', en: 'No subdirectories',
    pl: 'Brak podkatalogów' },
    'folder.not_selected': { hr: 'Nije odabrano', en: 'Not selected',
    pl: 'Nie wybrano' },
    'folder.selected': { hr: 'Odabrano:', en: 'Selected:',
    pl: 'Wybrano:' },
    'folder.root': { hr: '(Root — odaberi disk)', en: '(Root — select drive)',
    pl: '(Root — wybierz dysk)' },
    'folder.cancel': { hr: 'Odustani', en: 'Cancel',
    pl: 'Anuluj' },
    'folder.use': { hr: 'Koristi ovaj folder', en: 'Use this folder',
    pl: 'Użyj tego folderu' },

    // ===================== DYNAMIC JS STRINGS (app.js) =====================
    'app.decoder_running': { hr: 'Dekoder je već pokrenut', en: 'Decoder is already running',
    pl: 'Dekoder jest już uruchomiony' },
    'app.last_device_used': { hr: 'Zadnje korišteni:', en: 'Last used:',
    pl: 'Ostatnio używane:' },
    'app.last_device_missing': { hr: 'Zadnje korišteni uređaj nije dostupan', en: 'Last used device is not available',
    pl: 'Ostatnio używane urządzenie jest niedostępne' },
    'app.logging_active': { hr: 'aktivno', en: 'active',
    pl: 'aktywne' },
    'app.logging_disabled': { hr: 'isključeno', en: 'disabled',
    pl: 'wyłączone' },
    'app.dir_empty': { hr: 'Direktorij je prazan (još nema log datoteka)', en: 'Directory is empty (no log files yet)',
    pl: 'Katalog jest pusty (brak plików logu)' },
    'app.dir_files': { hr: 'U direktoriju postoji {0} log datoteka ({1} KB ukupno)', en: 'Directory contains {0} log file(s) ({1} KB total)',
    pl: 'Katalog zawiera {0} plików logu ({1} KB łącznie)' },
    'app.save_logging_error': { hr: 'Greška pri spremanju postavki logiranja:', en: 'Error saving logging settings:',
    pl: 'Błąd zapisu ustawień logowania:' },
    'app.keep_existing_key': { hr: 'Ostavi prazno za zadržati postojeći', en: 'Leave empty to keep existing',
    pl: 'Pozostaw puste aby zachować istniejący' },
    'app.enter_api_key': { hr: 'Upiši svoj API ključ', en: 'Enter your API key',
    pl: 'Wpisz swój klucz API' },
    'app.key_set': { hr: '✓ postavljen', en: '✓ set',
    pl: '✓ ustawiony' },
    'app.keep_existing_password': { hr: 'Ostavi prazno za zadržati postojeću', en: 'Leave empty to keep existing',
    pl: 'Pozostaw puste aby zachować istniejące' },
    'app.sending_test': { hr: 'Šaljem test email…', en: 'Sending test email…',
    pl: 'Wysyłanie testowego emaila…' },
    'app.test_sent': { hr: 'Test email poslan!', en: 'Test email sent!',
    pl: 'Testowy email wysłany!' },
    'app.unknown_error': { hr: 'Nepoznata greška', en: 'Unknown error',
    pl: 'Nieznany błąd' },
    'app.port_invalid': { hr: 'Port mora biti broj između 1 i 65535', en: 'Port must be a number between 1 and 65535',
    pl: 'Port musi być liczbą od 1 do 65535' },
    'app.port_saved': { hr: 'Port spremljen: {0}. Promjena se aktivira kad ručno ponovno pokreneš program.', en: 'Port saved: {0}. Change takes effect after you manually restart the program.',
    pl: 'Port zapisany: {0}. Zmiana zadziała po ręcznym ponownym uruchomieniu programu.' },
    'app.port_restart_steps': {
      hr: 'Port promijenjen na {0}.\n\nZa primjenu:\n1. Zatvori server (zatvori CMD prozor ili Ctrl+C)\n2. Pokreni ponovo: python main.py --port {0}\n3. Otvori http://localhost:{0}',
      en: 'Port changed to {0}.\n\nTo apply:\n1. Close server (close CMD window or Ctrl+C)\n2. Restart: python main.py --port {0}\n3. Open http://localhost:{0}',
      pl: 'Port zmieniony na {0}.\n\nAby zastosować:\n1. Zamknij serwer (zamknij okno CMD lub Ctrl+C)\n2. Uruchom ponownie: python main.py --port {0}\n3. Otwórz http://localhost:{0}',
    },
    'app.error': { hr: 'Greška:', en: 'Error:',
    pl: 'Błąd:' },

    // Save success toast messages
    'app.save_success_title': { hr: 'Spremljeno', en: 'Saved',
    pl: 'Zapisano' },
    'app.logging_saved_message': { hr: 'Postavke logiranja su spremljene.', en: 'Logging settings saved.',
    pl: 'Ustawienia logowania zostały zapisane.' },
    'app.alerts_saved_message': { hr: 'Postavke alerti su spremljene.', en: 'Alert settings saved.',
    pl: 'Ustawienia alertów zostały zapisane.' },
    'app.email_saved_message': { hr: 'Email postavke su spremljene.', en: 'Email settings saved.',
    pl: 'Ustawienia email zostały zapisane.' },
    'app.server_saved_message': { hr: 'Server postavke su spremljene.', en: 'Server settings saved.',
    pl: 'Ustawienia serwera zostały zapisane.' },
    'app.station_saved_message': { hr: 'Stanica je spremljena.', en: 'Station saved.',
    pl: 'Stacja została zapisana.' },
    'app.weather_saved_message': { hr: 'Weather postavke su spremljene.', en: 'Weather settings saved.',
    pl: 'Ustawienia pogody zostały zapisane.' },
    'app.startup_saved_message': { hr: 'Startup postavke su spremljene.', en: 'Startup settings saved.',
    pl: 'Ustawienia uruchamiania zostały zapisane.' },

    'app.confirm_delete_weather': { hr: 'Stvarno obrisati spremljeni OpenWeather API ključ?', en: 'Really delete the saved OpenWeather API key?',
    pl: 'Na pewno usunąć zapisany klucz API OpenWeather?' },
    'app.confirm_reset_flight': { hr: 'Stvarno obrisati sve podatke o trenutnom letu?', en: 'Really delete all data about the current flight?',
    pl: 'Na pewno usunąć wszystkie dane o bieżącym locie?' },
    'app.no_log_files': { hr: 'Nema log datoteka', en: 'No log files',
    pl: 'Brak plików logu' },
    'app.select_log_download': { hr: 'Odaberi log datoteku za preuzimanje', en: 'Select a log file to download',
    pl: 'Wybierz plik logu do pobrania' },
    'app.select_log_to_load': { hr: 'Odaberi log datoteku za učitavanje', en: 'Select a log file to load',
    pl: 'Wybierz plik logu do wczytania' },
    'app.confirm_load_log': { hr: 'Učitati log "{0}" u sustav?\n\nOvo će dodati sve pakete iz loga u trenutno praćenje.\nKorisno nakon restarta programa dok sonda još leti.', en: 'Load log "{0}" into system?\n\nThis will add all packets from the log to current tracking.\nUseful after program restart while sonde is still in flight.',
    pl: 'Wczytać log "{0}" do systemu?\n\nTo doda wszystkie pakiety z logu do bieżącego śledzenia.\nPrzydatne po restarcie programu gdy sonda wciąż leci.' },
    'app.log_loaded_success': { hr: '📂 Log učitan: {0} — {1} paketa, callsigns: {2}', en: '📂 Log loaded: {0} — {1} packets, callsigns: {2}',
    pl: '📂 Log wczytany: {0} — {1} pakietów, callsigny: {2}' },
    'app.log_load_error': { hr: 'Greška pri učitavanju loga', en: 'Error loading log',
    pl: 'Błąd wczytywania logu' },
    'app.log_loaded_ws': { hr: '📂 Log učitan (drugi klijent): {0} — {1} paketa, callsigns: {2}', en: '📂 Log loaded (other client): {0} — {1} packets, callsigns: {2}',
    pl: '📂 Log wczytany (inny klient): {0} — {1} pakietów, callsigny: {2}' },
    'app.ws_connected': { hr: 'WebSocket spojen', en: 'WebSocket connected',
    pl: 'WebSocket połączony' },
    'app.ws_disconnected': { hr: 'WebSocket prekinut, pokušavam ponovno za 3s', en: 'WebSocket disconnected, reconnecting in 3s',
    pl: 'WebSocket rozłączony, ponowne łączenie za 3s' },
    'app.ws_error': { hr: 'WebSocket greška', en: 'WebSocket error',
    pl: 'Błąd WebSocket' },
    'app.no_gps': { hr: 'NEMA GPS FIXA', en: 'NO GPS FIX',
    pl: 'BRAK GPS FIX' },
    'app.decoder_started': { hr: 'Dekoder pokrenut', en: 'Decoder started',
    pl: 'Dekoder uruchomiony' },
    'app.decoder_stopped': { hr: 'Dekoder zaustavljen', en: 'Decoder stopped',
    pl: 'Dekoder zatrzymany' },
    'app.unknown_device': { hr: 'nepoznat uređaj', en: 'unknown device',
    pl: 'nieznane urządzenie' },
    'app.rtl_sdr_enabled': { hr: 'RTL-SDR Direct uključen — audio/UDP inputi isključeni', en: 'RTL-SDR Direct enabled — audio/UDP inputs disabled',
    pl: 'RTL-SDR Direct włączony — wejścia audio/UDP wyłączone' },
    'app.rtl_sdr_disabled': { hr: 'RTL-SDR Direct isključen — audio/UDP inputi dostupni', en: 'RTL-SDR Direct disabled — audio/UDP inputs available',
    pl: 'RTL-SDR Direct wyłączony — wejścia audio/UDP dostępne' },
    'app.rtl_detecting': { hr: 'Tražim RTL-SDR uređaje...', en: 'Detecting RTL-SDR devices...',
    pl: 'Wykrywanie urządzeń RTL-SDR...' },
    'app.rtl_not_found': { hr: 'RTL-SDR uređaj nije pronađen (ili rtl_fm nije instaliran)', en: 'No RTL-SDR devices found (or rtl_fm not installed)',
    pl: 'Nie znaleziono urządzeń RTL-SDR (lub rtl_fm nie zainstalowany)' },
    'app.rtl_devices_found': { hr: 'uređaj(a) pronađen(o)', en: 'device(s) found',
    pl: 'urządzeń znaleziono' },
    'app.lora_tools_found': { hr: 'LoRa alati pronađeni', en: 'LoRa tools found',
    pl: 'Narzędzia LoRa znalezione' },
    'app.lora_details': { hr: 'Frekvencija: {0} MHz, SF{1}, BW 125 kHz', en: 'Frequency: {0} MHz, SF{1}, BW 125 kHz',
    pl: 'Częstotliwość: {0} MHz, SF{1}, BW 125 kHz' },
    'app.lora_tracker_examples': { hr: 'Tracker primjeri: DL1NUX, OE5XOL, TTGO T-Beam', en: 'Tracker examples: DL1NUX, OE5XOL, TTGO T-Beam',
    pl: 'Przykłady trackerów: DL1NUX, OE5XOL, TTGO T-Beam' },
    'app.lora_missing': { hr: 'Fali: {0}', en: 'Missing: {0}',
    pl: 'Brakuje: {0}' },
    'app.lora_linux_only': { hr: 'LoRa alati nisu pronađeni — LoRa dekodiranje radi samo na Linuxu.',
    en: 'LoRa tools not found — LoRa decoding works only on Linux.',
    pl: 'Nie znaleziono narzędzi LoRa — dekodowanie LoRa działa tylko w systemie Linux.' },
    'app.lora_download_hint': { hr: 'Skini <code>lorarx</code> sa <a href="http://oe5dxl.hamspirit.at:8025/aprs/bin/" target="_blank" class="text-brand-400">oe5dxl.hamspirit.at</a> i stavi u <code>rtl-sdr/</code> folder zajedno s <code>rtl_fm</code>.',
    en: 'Download <code>lorarx</code> from <a href="http://oe5dxl.hamspirit.at:8025/aprs/bin/" target="_blank" class="text-brand-400">oe5dxl.hamspirit.at</a> and place in <code>rtl-sdr/</code> folder alongside <code>rtl_fm</code>.',
    pl: 'Pobierz <code>lorarx</code> z <a href="http://oe5dxl.hamspirit.at:8025/aprs/bin/" target="_blank" class="text-brand-400">oe5dxl.hamspirit.at</a> i umieść w folderze <code>rtl-sdr/</code> obok <code>rtl_fm</code>.' },
    'app.audio_devices': { hr: 'Dostupno {0} audio uređaja', en: '{0} audio device(s) available',
    pl: 'Dostępnych {0} urządzeń audio' },
    'app.weather_key_saved': { hr: 'Weather API ključ spremljen', en: 'Weather API key saved',
    pl: 'Klucz API pogody zapisany' },
    'app.weather_key_deleted': { hr: 'Weather API ključ obrisan', en: 'Weather API key deleted',
    pl: 'Klucz API pogody usunięty' },
    'app.detect_no_programs': { hr: 'Nije pronađen nijedan poznati SDR program na uobičajenim lokacijama.\nMožeš ručno dodati program klikom na "Dodaj program".', en: 'No known SDR programs found at common locations.\nYou can manually add a program by clicking "Add program".',
    pl: 'Nie znaleziono żadnych znanych programów SDR w typowych lokalizacjach.\nMożesz ręcznie dodać program klikając "Dodaj program".' },
    'app.detect_found': { hr: 'Pronađeno {0} program(a):', en: 'Found {0} program(s):',
    pl: 'Znaleziono {0} programów:' },
    'app.detect_already_added': { hr: 'Svi pronađeni programi su već dodani na listu.', en: 'All found programs are already on the list.',
    pl: 'Wszystkie znalezione programy są już na liście.' },
    'app.startup_saved': { hr: 'Startup programi spremljeni: {0}, {1} program(a)', en: 'Startup programs saved: {0}, {1} program(s)',
    pl: 'Programy startowe zapisane: {0}, {1} programów' },
    'app.email_activated': { hr: 'aktivirane', en: 'activated',
    pl: 'aktywowane' },
    'app.email_deactivated': { hr: 'deaktivirane', en: 'deactivated',
    pl: 'dezaktywowane' },
    'app.not_set': { hr: '(nije postavljeno)', en: '(not set)',
    pl: '(nie ustawiono)' },
    'app.detect_none_log': { hr: 'Automatska detekcija: nije pronađen nijedan poznati SDR program.', en: 'Auto-detection: no known SDR programs found.',
    pl: 'Automatyczne wykrywanie: nie znaleziono żadnego znanego programu SDR.' },
    'app.all_detected_added': { hr: 'Svi pronađeni programi su već na listi.', en: 'All detected programs are already on the list.',
    pl: 'Wszystkie wykryte programy są już na liście.' },
    'app.detect_error': { hr: 'Greška pri detekciji:', en: 'Detection error:',
    pl: 'Błąd wykrywania:' },

    // -- METAR (app.js)
    'app.metar_loading': { hr: 'METAR: dohvaćam podatke oko ({0}, {1}), r=200km...', en: 'METAR: fetching data around ({0}, {1}), r=200km...',
    pl: 'METAR: pobieranie danych wokół ({0}, {1}), r=200km...' },
    'app.metar_no_airports': { hr: 'METAR: nema aerodroma u krugu od 200 km — pokušaj promijeniti koordinate stanice', en: 'METAR: no airports within 200 km — try changing station coordinates',
    pl: 'METAR: brak lotnisk w promieniu 200 km — spróbuj zmienić współrzędne stacji' },
    'app.metar_error': { hr: 'METAR greška:', en: 'METAR error:',
    pl: 'Błąd METAR:' },
    'app.log_files_found': { hr: 'Pronađeno {0} log datoteka', en: 'Found {0} log file(s)',
    pl: 'Znaleziono {0} plików logu' },

    // ===================== ANALYTICS.JS =====================
    'analytics.pre_launch': { hr: 'PRE-LAUNCH', en: 'PRE-LAUNCH',
    pl: 'PRZED STARTEM' },
    'analytics.ascent': { hr: 'USPON', en: 'ASCENT',
    pl: 'WZNOSZENIE' },
    'analytics.burst': { hr: 'BURST', en: 'BURST',
    pl: 'BURST' },
    'analytics.descent': { hr: 'PAD', en: 'DESCENT',
    pl: 'OPADANIE' },
    'analytics.landed': { hr: 'SLIJETANJE', en: 'LANDED',
    pl: 'LĄDOWANIE' },
    'analytics.just_now': { hr: 'upravo sad', en: 'just now',
    pl: 'właśnie teraz' },
    'analytics.seconds_ago': { hr: 'prije {0}s', en: '{0}s ago',
    pl: '{0}s temu' },
    'analytics.minutes_ago': { hr: 'prije {0} min', en: '{0} min ago',
    pl: '{0} min temu' },
    'analytics.set_station': { hr: 'postavi stanicu', en: 'set station',
    pl: 'ustaw stację' },
    'analytics.no_gps_fix': { hr: '⚠ nema fix', en: '⚠ no fix',
    pl: '⚠ brak fix' },
    'analytics.ext_humidity': { hr: 'Ext. vlažnost', en: 'Ext. humidity',
    pl: 'Zewn. wilgotność' },
    'analytics.ext_pressure': { hr: 'Ext. tlak', en: 'Ext. pressure',
    pl: 'Zewn. ciśnienie' },
    'analytics.speed': { hr: 'Brzina', en: 'Speed',
    pl: 'Prędkość' },
    'analytics.ascent_rate': { hr: 'Brzina uspona', en: 'Ascent rate',
    pl: 'Prędkość wznoszenia' },
    'analytics.climb_rate': { hr: 'Brzina penjanja', en: 'Climb rate',
    pl: 'Prędkość wznoszenia' },
    'analytics.close_alert': { hr: 'Zatvori', en: 'Close',
    pl: 'Zamknij' },
    'analytics.clear_all_alerts': { hr: 'Očisti sve', en: 'Clear all',
    pl: 'Wyczyść wszystkie' },

    // ===================== CHARTS.JS =====================
    'charts.packet_count': { hr: '{0} / {1} paketa', en: '{0} / {1} packets',
    pl: '{0} / {1} pakietów' },
    'charts.no_packets': { hr: '0 paketa', en: '0 packets',
    pl: '0 pakietów' },
    'charts.altitude_label': { hr: 'Visina (m)', en: 'Altitude (m)',
    pl: 'Wysokość (m)' },
    'charts.battery_label': { hr: 'Napon (V)', en: 'Voltage (V)',
    pl: 'Napięcie (V)' },
    'charts.temperature_label': { hr: 'Temperatura (°C)', en: 'Temperature (°C)',
    pl: 'Temperatura (°C)' },
    'charts.satellites_label': { hr: 'Sateliti', en: 'Satellites',
    pl: 'Satelity' },
    'charts.climb_label': { hr: 'Climb (m/s)', en: 'Climb (m/s)',
    pl: 'Wznoszenie (m/s)' },
    'charts.snr_label': { hr: 'SNR (dB)', en: 'SNR (dB)',
    pl: 'SNR (dB)' },
    'charts.time_range_all': { hr: 'Svi', en: 'All',
    pl: 'Wszystkie' },

    // ===================== SPECTRUM.JS =====================
    'spectrum.dataset_spectrum': { hr: 'Spektar', en: 'Spectrum',
    pl: 'Spektrum' },
    'spectrum.dataset_tones': { hr: 'Tonovi', en: 'Tones',
    pl: 'Tony' },
    'spectrum.tone_tooltip': { hr: 'Ton: {0} dB', en: 'Tone: {0} dB',
    pl: 'Ton: {0} dB' },
    'spectrum.freq_axis': { hr: 'Frekvencija (Hz)', en: 'Frequency (Hz)',
    pl: 'Częstotliwość (Hz)' },
    'spectrum.mag_axis': { hr: 'Magnituda (dB)', en: 'Magnitude (dB)',
    pl: 'Magnituda (dB)' },
    'spectrum.clipping': { hr: 'KLIPUJE', en: 'CLIPPING',
    pl: 'PRZESTEROWANIE' },
    'spectrum.signal_ok': { hr: 'Signal OK', en: 'Signal OK',
    pl: 'Sygnał OK' },
    'spectrum.signal_weak': { hr: 'Slab signal', en: 'Weak signal',
    pl: 'Słaby sygnał' },
    'spectrum.signal_none': { hr: 'Nema signala', en: 'No signal',
    pl: 'Brak sygnału' },
    'spectrum.waterfall_title': { hr: 'Waterfall', en: 'Waterfall',
    pl: 'Wodospad' },
    'spectrum.waterfall_hint': { hr: '(novije gore)', en: '(newest on top)',
    pl: '(najnowsze na górze)' },
    'spectrum.waterfall_weak': { hr: 'slab', en: 'weak',
    pl: 'słaby' },
    'spectrum.waterfall_strong': { hr: 'jak', en: 'strong',
    pl: 'silny' },

    // ===================== APP.JS — HARDCODED CONSOLE STRINGS =====================
    'app.chart_time_range': { hr: 'Vremenski raspon grafova: {0}', en: 'Chart time range: {0}',
    pl: 'Zakres czasowy wykresów: {0}' },
    'app.logging_status': { hr: 'Logiranje {0}: {1} → {2}', en: 'Logging {0}: {1} → {2}',
    pl: 'Logowanie {0}: {1} → {2}' },
    'app.alerts_status': { hr: 'Alerti {0}: batt<{1}V, temp<{2}°C, SNR<{3}dB, timeout>{4}s', en: 'Alerts {0}: batt<{1}V, temp<{2}°C, SNR<{3}dB, timeout>{4}s',
    pl: 'Alerty {0}: bat<{1}V, temp<{2}°C, SNR<{3}dB, timeout>{4}s' },
    'app.alerts_activated': { hr: 'aktivirani', en: 'activated',
    pl: 'aktywowane' },
    'app.alerts_deactivated': { hr: 'deaktivirani', en: 'deactivated',
    pl: 'dezaktywowane' },
    'app.generic_error': { hr: 'Greška', en: 'Error',
    pl: 'Błąd' },
    'app.test_email_sent_log': { hr: '✉ Test email poslan', en: '✉ Test email sent',
    pl: '✉ Testowy email wysłany' },
    'app.test_email_failed': { hr: '✉ Test email neuspješan: {0}', en: '✉ Test email failed: {0}',
    pl: '✉ Testowy email nieudany: {0}' },
    'app.test_email_error': { hr: '✉ Test email greška: {0}', en: '✉ Test email error: {0}',
    pl: '✉ Błąd testowego emaila: {0}' },
    'app.audio_devices_error': { hr: 'Audio uređaji: {0}', en: 'Audio devices: {0}',
    pl: 'Urządzenia audio: {0}' },
    'app.monitor_started': { hr: '🔊 Audio monitor pokrenut', en: '🔊 Audio monitor started',
    pl: '🔊 Monitor audio uruchomiony' },
    'app.monitor_stopped': { hr: '🔇 Audio monitor zaustavljen', en: '🔇 Audio monitor stopped',
    pl: '🔇 Monitor audio zatrzymany' },
    'app.monitor_active': { hr: 'Monitor aktivan', en: 'Monitor active',
    pl: 'Monitor aktywny' },
    'app.browser_audio_started': { hr: '🔊 Slušanje u browseru pokrenuto', en: '🔊 Browser audio started',
    pl: '🔊 Odtwarzanie w przeglądarce uruchomione' },
    'app.browser_audio_stopped': { hr: '🔇 Slušanje u browseru zaustavljeno', en: '🔇 Browser audio stopped',
    pl: '🔇 Odtwarzanie w przeglądarce zatrzymane' },
    'app.browser_audio_active': { hr: 'Slušanje na ovom računalu', en: 'Listening on this computer',
    pl: 'Odtwarzanie na tym komputerze' },
    'app.browser_audio_error': { hr: 'Greška audio streama', en: 'Audio stream error',
    pl: 'Błąd strumienia audio' },
    'app.modems_error': { hr: 'Modemi: {0}', en: 'Modems: {0}',
    pl: 'Modemy: {0}' },
    'app.start_failed': { hr: 'Pokretanje nije uspjelo: {0}', en: 'Start failed: {0}',
    pl: 'Uruchomienie nie powiodło się: {0}' },
    'app.station_saved': { hr: 'Stanica spremljena: {0}{1}', en: 'Station saved: {0}{1}',
    pl: 'Stacja zapisana: {0}{1}' },
    'app.station_uploaded': { hr: 'Podaci o stanici uploadani na SondeHub', en: 'Station info uploaded to SondeHub',
    pl: 'Dane stacji wysłane do SondeHub' },
    'app.station_uploaded_title': { hr: 'SondeHub upload', en: 'SondeHub upload',
    pl: 'SondeHub upload' },
    'app.station_upload_failed': { hr: 'Upload stanice nije uspio: {0}', en: 'Station upload failed: {0}',
    pl: 'Wysyłanie stacji nie powiodło się: {0}' },
    'app.station_upload_failed_title': { hr: 'Upload greška', en: 'Upload error',
    pl: 'Błąd wysyłania' },
    'app.sondehub_active': { hr: 'SondeHub upload AKTIVAN', en: 'SondeHub upload ACTIVE',
    pl: 'Wysyłanie SondeHub AKTYWNE' },
    'app.private_server_active': { hr: 'Privatni server → {0}:{1}', en: 'Private server → {0}:{1}',
    pl: 'Prywatny serwer → {0}:{1}' },
    'app.antenna_height': { hr: 'antena {0}m', en: 'antenna {0}m',
    pl: 'antena {0}m' },
    'app.blocklist_status': { hr: '⚠ {0} callsign(ova) blokirano: {1}', en: '⚠ {0} callsign(s) blocked: {1}',
    pl: '⚠ {0} callsignów zablokowanych: {1}' },
    'app.weather_layer': { hr: 'Vremenski sloj: {0}', en: 'Weather layer: {0}',
    pl: 'Warstwa pogodowa: {0}' },
    'app.horizon_activated': { hr: 'Balloon horizon ring aktiviran (antena {0}m)', en: 'Balloon horizon ring activated (antenna {0}m)',
    pl: 'Pierścień horyzontu balonu aktywowany (antena {0}m)' },
    'app.metar_deactivated': { hr: 'METAR sloj deaktiviran', en: 'METAR layer deactivated',
    pl: 'Warstwa METAR dezaktywowana' },
    'app.metar_no_station_coords': { hr: 'METAR: unesite koordinate stanice (lat/lon) prije aktiviranja METAR sloja', en: 'METAR: please enter station coordinates (lat/lon) before enabling METAR layer',
    pl: 'METAR: wprowadź współrzędne stacji (szer./dł.) przed włączeniem warstwy METAR' },
    'app.flight_reset': { hr: 'Podaci o letu resetirani', en: 'Flight data reset',
    pl: 'Dane lotu zresetowane' },
    'app.downloaded': { hr: 'Preuzeto: {0}', en: 'Downloaded: {0}',
    pl: 'Pobrano: {0}' },
    'app.startup_remove': { hr: 'Ukloni', en: 'Remove',
    pl: 'Usuń' },
    'app.startup_browse_file': { hr: 'Odaberi datoteku', en: 'Select file',
    pl: 'Wybierz plik' },
    'app.startup_args_label': { hr: 'Argumenti (opcionalno)', en: 'Arguments (optional)',
    pl: 'Argumenty (opcjonalne)' },

    // ===================== ANALYTICS.JS — CUSTOM FIELD LABELS =====================
    'analytics.modulation': { hr: 'Modulacija', en: 'Modulation',
    pl: 'Modulacja' },
    'analytics.ext_temp': { hr: 'Ext. temp.', en: 'Ext. temp.', pl: 'Zewn. temp.' },
    'analytics.int_temp': { hr: 'Int. temp.', en: 'Int. temp.', pl: 'Wewn. temp.' },
    'analytics.max_alt': { hr: 'max {0} m', en: 'max {0} m', pl: 'maks. {0} m' },
    'analytics.bearing_elev': { hr: 'brng {0}° • el {1}°', en: 'brng {0}° • el {1}°', pl: 'nam. {0}° • el {1}°' },

    // -- app.js hardcoded strings
    'app.metar_stations_count': { hr: 'METAR: {0} stanica{1}', en: 'METAR: {0} stations{1}', pl: 'METAR: {0} stacji{1}' },
    'app.metar_cached': { hr: ' (cache)', en: ' (cache)', pl: ' (cache)' },
    'app.email_log': { hr: 'Email notifikacije {0}: → {1}, cooldown {2}h', en: 'Email notifications {0}: → {1}, cooldown {2}h', pl: 'Powiadomienia email {0}: → {1}, cooldown {2}h' },
    'app.blocklist_short': { hr: 'blocklist: {0} cs', en: 'blocklist: {0} cs', pl: 'blocklist: {0} cs' },
    'app.startup_name_placeholder': { hr: 'Naziv (npr. SDR++)', en: 'Name (e.g. SDR++)', pl: 'Nazwa (np. SDR++)' },
    'app.startup_path_placeholder': { hr: 'npr. C:\\Program Files\\sdrpp\\sdrpp.exe', en: 'e.g. C:\\Program Files\\sdrpp\\sdrpp.exe', pl: 'np. C:\\Program Files\\sdrpp\\sdrpp.exe' },
    'app.startup_args_placeholder': { hr: 'npr. --server --port 5555', en: 'e.g. --server --port 5555', pl: 'np. --server --port 5555' },
    'settings.log_dir_placeholder': { hr: 'npr. C:\\Users\\Zoran\\Documents\\HorusLogs', en: 'e.g. C:\\Users\\Documents\\HorusLogs', pl: 'np. C:\\Users\\Dokumenty\\HorusLogs' },

    // ===================== MAP.JS =====================
    'map.station_fallback': { hr: 'Stanica', en: 'Station',
    pl: 'Stacja' },
    'metar.temp_dew': { hr: 'Temp / Dew', en: 'Temp / Dew',
    pl: 'Temp / Punkt rosy' },

    // ===================== ALERT NOTIFICATIONS (from backend) =====================
    'alert.burst_title': { hr: 'BURST DETEKTIRAN', en: 'BURST DETECTED',
    pl: 'BURST WYKRYTY' },
    'alert.burst_message': { hr: '{0} — burst na {1} m', en: '{0} — burst at {1} m',
    pl: '{0} — burst na {1} m' },
    'alert.battery_title': { hr: 'NISKA BATERIJA', en: 'LOW BATTERY',
    pl: 'NISKI POZIOM BATERII' },
    'alert.battery_message': { hr: '{0} — {1} V (prag: {2} V)', en: '{0} — {1} V (threshold: {2} V)',
    pl: '{0} — {1} V (próg: {2} V)' },
    'alert.temperature_title': { hr: 'NISKA TEMPERATURA', en: 'LOW TEMPERATURE',
    pl: 'NISKA TEMPERATURA' },
    'alert.temperature_message': { hr: '{0} — {1} °C (prag: {2} °C)', en: '{0} — {1} °C (threshold: {2} °C)',
    pl: '{0} — {1} °C (próg: {2} °C)' },
    'alert.snr_title': { hr: 'SLAB SIGNAL', en: 'WEAK SIGNAL',
    pl: 'SŁABY SYGNAŁ' },
    'alert.snr_message': { hr: '{0} — SNR {1} dB (prag: {2} dB)', en: '{0} — SNR {1} dB (threshold: {2} dB)',
    pl: '{0} — SNR {1} dB (próg: {2} dB)' },
    'alert.gps_title': { hr: 'GPS FIX IZGUBLJEN', en: 'GPS FIX LOST',
    pl: 'UTRATA GPS FIX' },
    'alert.gps_message': { hr: '{0} — nema GPS fixa (lat/lon ≈ 0)', en: '{0} — no GPS fix (lat/lon ≈ 0)',
    pl: '{0} — brak GPS fix (lat/lon ≈ 0)' },
    'alert.timeout_title': { hr: 'GUBITAK PAKETA', en: 'PACKET LOSS',
    pl: 'UTRATA PAKIETÓW' },
    'alert.timeout_message': { hr: '{0} — nema paketa {1}s (prag: {2}s)', en: '{0} — no packets {1}s (threshold: {2}s)',
    pl: '{0} — brak pakietów {1}s (próg: {2}s)' },

    // ===================== HISTORY =====================
    'history.title': { hr: 'Povijest letova', en: 'Flight history', pl: 'Historia lotów' },
    'history.refresh': { hr: 'Osvježi', en: 'Refresh', pl: 'Odśwież' },
    'history.tab_list': { hr: 'Tablica sondi', en: 'Sondes table', pl: 'Tabela sond' },
    'history.tab_analyze': { hr: 'Analiza leta', en: 'Flight analysis', pl: 'Analiza lotu' },
    'history.tab_compare': { hr: 'Usporedba', en: 'Comparison', pl: 'Porównanie' },
    'history.tab_replay': { hr: 'Repriza leta', en: 'Flight replay', pl: 'Powtórka lotu' },
    'history.tab_polar': { hr: 'Polarni dijagram', en: 'Polar plot', pl: 'Wykres polarny' },

    // ===================== POLAR PLOT =====================
    'polar.title': {
      hr: 'Otvorenost prijemnika po stranama svijeta',
      en: 'Receiver coverage by direction',
      pl: 'Pokrycie odbiornika według kierunku',
    },
    'polar.subtitle': {
      hr: 'Maksimalni domet prijema (km) iz svih spremljenih logova, relativno na lokaciju stanice.',
      en: 'Maximum reception range (km) across all saved logs, relative to the station location.',
      pl: 'Maksymalny zasięg odbioru (km) ze wszystkich zapisanych logów, względem lokalizacji stacji.',
    },
    'polar.sectors_label': { hr: 'Smjerova:', en: 'Sectors:', pl: 'Sektory:' },
    'polar.refresh': { hr: 'Osvježi', en: 'Refresh', pl: 'Odśwież' },
    'polar.range_label': { hr: 'Domet [km]', en: 'Range [km]', pl: 'Zasięg [km]' },
    'polar.best_dir': { hr: 'Najbolji smjer', en: 'Best direction', pl: 'Najlepszy kierunek' },
    'polar.max_range': { hr: 'maks. domet', en: 'max range', pl: 'maks. zasięg' },
    'polar.per_direction': { hr: 'Po smjerovima (maks. km)', en: 'By direction (max km)', pl: 'Według kierunku (maks. km)' },
    'polar.points': { hr: 'Točaka:', en: 'Points:', pl: 'Punktów:' },
    'polar.points_short': { hr: 'toč.', en: 'pts', pl: 'pkt' },
    'polar.files': { hr: 'Logova:', en: 'Logs:', pl: 'Logów:' },
    'polar.station': { hr: 'Stanica:', en: 'Station:', pl: 'Stacja:' },
    'polar.empty': { hr: 'Nema podataka za prikaz', en: 'No data to display', pl: 'Brak danych do wyświetlenia' },
    'polar.empty_hint': {
      hr: 'Provjerite je li lokacija stanice postavljena i postoje li spremljeni logovi.',
      en: 'Check that the station location is set and that saved logs exist.',
      pl: 'Sprawdź, czy ustawiono lokalizację stacji i czy istnieją zapisane logi.',
    },
    'polar.no_station': { hr: 'Lokacija stanice nije postavljena', en: 'Station location not set', pl: 'Lokalizacja stacji nie ustawiona' },
    'polar.no_station_hint': {
      hr: 'Postavite koordinate stanice u Postavkama da bi se mogao izračunati domet i smjer.',
      en: 'Set the station coordinates in Settings so range and direction can be computed.',
      pl: 'Ustaw współrzędne stacji w Ustawieniach, aby obliczyć zasięg i kierunek.',
    },

    'history.search_placeholder': { hr: 'Pretraži po callsignu ili imenu fajla...', en: 'Search by callsign or filename...', pl: 'Szukaj po znaku lub nazwie pliku...' },
    'history.format_all': { hr: 'Svi formati', en: 'All formats', pl: 'Wszystkie formaty' },
    'history.files': { hr: 'datoteka', en: 'files', pl: 'plików' },
    'history.loading': { hr: 'Učitavanje...', en: 'Loading...', pl: 'Ładowanie...' },
    'history.empty': { hr: 'Nema log datoteka', en: 'No log files', pl: 'Brak plików logów' },

    'history.col_file': { hr: 'Datoteka', en: 'File', pl: 'Plik' },
    'history.col_callsign': { hr: 'Callsign', en: 'Callsign', pl: 'Znak' },
    'history.col_packets': { hr: 'Paketi', en: 'Packets', pl: 'Pakiety' },
    'history.col_max_alt': { hr: 'Max visina', en: 'Max altitude', pl: 'Maks. wysokość' },
    'history.col_distance': { hr: 'Udaljenost', en: 'Distance', pl: 'Odległość' },
    'history.col_duration': { hr: 'Trajanje', en: 'Duration', pl: 'Czas trwania' },
    'history.col_phase': { hr: 'Faza', en: 'Phase', pl: 'Faza' },
    'history.col_date': { hr: 'Datum', en: 'Date', pl: 'Data' },
    'history.col_actions': { hr: 'Akcije', en: 'Actions', pl: 'Akcje' },

    'history.btn_analyze': { hr: 'Analiziraj', en: 'Analyze', pl: 'Analizuj' },
    'history.btn_replay': { hr: 'Repriza', en: 'Replay', pl: 'Powtórka' },
    'history.btn_download': { hr: 'Preuzmi', en: 'Download', pl: 'Pobierz' },
    'history.btn_delete': { hr: 'Obriši', en: 'Delete', pl: 'Usuń' },
    'history.btn_load': { hr: 'Učitaj u glavni prikaz', en: 'Load into main view', pl: 'Załaduj do głównego widoku' },

    'history.confirm_delete': { hr: 'Obrisati datoteku "{0}"? Ova akcija je nepovratna.', en: 'Delete file "{0}"? This action is irreversible.', pl: 'Usunąć plik "{0}"? Ta akcja jest nieodwracalna.' },
    'history.deleted': { hr: 'Datoteka obrisana.', en: 'File deleted.', pl: 'Plik usunięty.' },
    'history.delete_failed': { hr: 'Greška pri brisanju datoteke.', en: 'Failed to delete file.', pl: 'Błąd usuwania pliku.' },

    'history.analyze_empty': { hr: 'Nije odabran nijedan let', en: 'No flight selected', pl: 'Nie wybrano lotu' },
    'history.analyze_empty_hint': { hr: 'Vrati se na karticu "Tablica sondi" i klikni "Analiza" na nekom letu.', en: 'Go back to "Sondes table" tab and click "Analyze" on a flight.', pl: 'Wróć do zakładki "Tabela sond" i kliknij "Analizuj" przy locie.' },

    'history.k_packets': { hr: 'Paketa', en: 'Packets', pl: 'Pakiety' },
    'history.k_max_alt': { hr: 'Max visina', en: 'Max altitude', pl: 'Maks. wysokość' },
    'history.k_distance': { hr: 'Udaljenost', en: 'Distance', pl: 'Odległość' },
    'history.k_duration': { hr: 'Trajanje', en: 'Duration', pl: 'Czas trwania' },
    'history.k_avg_climb': { hr: 'Avg climb', en: 'Avg climb', pl: 'Śr. wznosz.' },
    'history.k_avg_speed': { hr: 'Avg brzina', en: 'Avg speed', pl: 'Śr. prędkość' },

    'history.chart_altitude': { hr: 'Visina (m)', en: 'Altitude (m)', pl: 'Wysokość (m)' },
    'history.chart_temp': { hr: 'Temperatura (°C)', en: 'Temperature (°C)', pl: 'Temperatura (°C)' },
    'history.chart_battery': { hr: 'Baterija (V)', en: 'Battery (V)', pl: 'Bateria (V)' },
    'history.chart_climb': { hr: 'Climb rate (m/s)', en: 'Climb rate (m/s)', pl: 'Prędkość wznoszenia (m/s)' },
    'history.chart_speed': { hr: 'Horiz. brzina (km/h)', en: 'Horiz. speed (km/h)', pl: 'Prędkość pozioma (km/h)' },
    'history.chart_snr': { hr: 'SNR (dB)', en: 'SNR (dB)', pl: 'SNR (dB)' },

    'history.chart_altitude_cmp': { hr: 'Visina (m) — preklopljeno', en: 'Altitude (m) — overlaid', pl: 'Wysokość (m) — nakładka' },
    'history.chart_climb_cmp': { hr: 'Climb rate (m/s) — preklopljeno', en: 'Climb rate (m/s) — overlaid', pl: 'Pr. wznoszenia (m/s) — nakładka' },
    'history.chart_temp_cmp': { hr: 'Temperatura (°C) — preklopljeno', en: 'Temperature (°C) — overlaid', pl: 'Temperatura (°C) — nakładka' },
    'history.chart_speed_cmp': { hr: 'Horiz. brzina (km/h) — preklopljeno', en: 'Horiz. speed (km/h) — overlaid', pl: 'Pr. pozioma (km/h) — nakładka' },

    'history.compare_title': { hr: 'Usporedba letova', en: 'Flight comparison', pl: 'Porównanie lotów' },
    'history.selected': { hr: 'odabrano', en: 'selected', pl: 'wybranych' },
    'history.compare_clear': { hr: 'Očisti', en: 'Clear', pl: 'Wyczyść' },
    'history.compare_hint': { hr: 'Vrati se na karticu "Tablica sondi" i checkbox-om odaberi 2 ili više letova za usporedbu.', en: 'Go to "Sondes table" tab and use checkboxes to select 2+ flights to compare.', pl: 'Wróć do zakładki "Tabela sond" i zaznacz 2+ lotów do porównania.' },
    'history.compare_empty': { hr: 'Odaberi 2+ letova iz tablice za usporedbu', en: 'Select 2+ flights from the table to compare', pl: 'Wybierz 2+ lotów z tabeli do porównania' },

    'history.replay_empty': { hr: 'Nije odabran nijedan let', en: 'No flight selected', pl: 'Nie wybrano lotu' },
    'history.replay_empty_hint': { hr: 'Vrati se na karticu "Tablica sondi" i klikni "Repriza" na nekom letu.', en: 'Go to "Sondes table" tab and click "Replay" on a flight.', pl: 'Wróć do zakładki "Tabela sond" i kliknij "Powtórka" przy locie.' },
    'history.replay_balloon': { hr: 'Balon', en: 'Balloon', pl: 'Balon' },
    'history.replay_time': { hr: 'Vrijeme', en: 'Time', pl: 'Czas' },
    'history.replay_altitude': { hr: 'Visina', en: 'Altitude', pl: 'Wysokość' },
    'history.replay_climb': { hr: 'Climb', en: 'Climb', pl: 'Wznoszenie' },
    'history.replay_speed': { hr: 'Brzina', en: 'Speed', pl: 'Prędkość' },
    'history.replay_progress': { hr: 'Paket', en: 'Packet', pl: 'Pakiet' },
    'history.replay_speed_label': { hr: 'Brzina:', en: 'Speed:', pl: 'Prędkość:' },
    'history.replay_play': { hr: 'Pokreni/Pauziraj', en: 'Play/Pause', pl: 'Odtwórz/Pauza' },
    'history.replay_restart': { hr: 'Vrati na početak', en: 'Restart', pl: 'Restart' },

    'history.phase.pre_launch': { hr: 'Pre-launch', en: 'Pre-launch', pl: 'Przed startem' },
    'history.phase.ascent': { hr: 'Uspon', en: 'Ascent', pl: 'Wznoszenie' },
    'history.phase.burst': { hr: 'Burst', en: 'Burst', pl: 'Pęknięcie' },
    'history.phase.descent': { hr: 'Spuštanje', en: 'Descent', pl: 'Opadanie' },
    'history.phase.landed': { hr: 'Sletjelo', en: 'Landed', pl: 'Wylądował' },
  };

  // ---------------------------------------------------------------------------
  // CORE API
  // ---------------------------------------------------------------------------

  /**
   * Get translated string. Supports {0}, {1} placeholders.
   * @param {string} key - translation key
   * @param {...any} args - placeholder values
   * @returns {string}
   */
  function t(key, ...args) {
    const entry = translations[key];
    if (!entry) return key; // fallback: return key itself
    let text = entry[currentLang] || entry['hr'] || key;
    args.forEach((arg, i) => {
      text = text.replaceAll(`{${i}}`, arg);
    });
    return text;
  }

  /**
   * Set language and apply to all data-i18n elements.
   * @param {string} lang - 'hr' or 'en'
   */
  function setLanguage(lang) {
    if (lang !== 'hr' && lang !== 'en' && lang !== 'pl') return;
    currentLang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
    applyTranslations();
  }

  function getLang() {
    return currentLang;
  }

  /**
   * Get locale string for toLocaleTimeString etc.
   * @returns {string} 'hr-HR' or 'en-GB'
   */
  function getLocale() {
    return currentLang === 'en' ? 'en-GB' : currentLang === 'pl' ? 'pl-PL' : 'hr-HR';
  }

  /**
   * Scan all elements with data-i18n, data-i18n-placeholder, data-i18n-title,
   * data-i18n-html and replace their content.
   */
  function applyTranslations() {
    // Text content
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    });
    // innerHTML (for rich text with HTML)
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const key = el.getAttribute('data-i18n-html');
      if (key) el.innerHTML = t(key);
    });
    // Placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.placeholder = t(key);
    });
    // Title attributes
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.title = t(key);
    });

    // Update language selector if exists
    const langSelect = document.getElementById('settingsLanguageSelect');
    if (langSelect) langSelect.value = currentLang;

    // Update CSS ::before content for layer switcher title
    const layerBase = document.querySelector('.leaflet-control-layers-base');
    if (layerBase) layerBase.setAttribute('data-layer-title', t('map.layer_title'));
  }

  /**
   * Initialize: set HTML lang, apply initial translations.
   */
  function init() {
    document.documentElement.lang = currentLang;
    applyTranslations();
  }

  return { t, setLanguage, getLang, getLocale, applyTranslations, init };
})();
