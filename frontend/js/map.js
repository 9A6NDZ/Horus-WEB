// ----------------------------------------------------------------------------
// map.js  -  Leaflet karta
//   - SVG balon ikone s callsign labelom iznad (umjesto obične točke)
//   - Layer switcher (Street/Satellite/Terrain/Dark/Light/Hybrid)
//   - Radio horizont s velikim čitljivim labelom
//   - Multi-balloon tracking
//   - Filtriranje paketa bez GPS fix-a (lat=0, lon=0 → preskače se)
// ----------------------------------------------------------------------------

const HorusMap = (() => {
  let map;
  let stationMarker;
  let weatherLayer = null;
  let weatherOpacity = 0.85;
  let currentWeatherLayerName = '';
  let showHorizonRings = false;
  let stationAltitude = 0;

  // --- Follow mode: drži odabranu sondu na karti ---
  let followedCallsign = null;    // callsign koji se prati (null = ne prati nijednu)

  const balloons = {};

  const BALLOON_COLORS = [
    '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
    '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
  ];
  let colorIndex = 0;

  // ---------------------------------------------------------------------------
  // TILE LAYER DEFINICIJE
  //   darkFilter: true  -> dodaje CSS filter koji tamni svijetle mape (Street)
  //   darkFilter: false -> mapa ide u originalnim bojama (sateliti, dark tiles)
  // ---------------------------------------------------------------------------
  const LAYER_DEFS = {
    'Street': {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: { maxZoom: 19, attribution: '© OpenStreetMap' },
      darkFilter: true,
    },
    'Satellite': {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      options: { maxZoom: 19, attribution: '© Esri World Imagery' },
      darkFilter: false,
    },
    'Terrain': {
      url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      options: { maxZoom: 17, attribution: '© OpenTopoMap (CC-BY-SA)' },
      darkFilter: false,
    },
    'Dark': {
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      options: { maxZoom: 20, attribution: '© CartoDB', subdomains: 'abcd' },
      darkFilter: false,
    },
    'Light': {
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      options: { maxZoom: 20, attribution: '© CartoDB', subdomains: 'abcd' },
      darkFilter: false,
    },
    'Hybrid': {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      options: { maxZoom: 19, attribution: '© Esri World Imagery' },
      darkFilter: false,
      // Overlay sloj s nazivima mjesta i cestama preko satelita
      overlayUrl: 'https://stamen-tiles.a.ssl.fastly.net/toner-hybrid/{z}/{x}/{y}.png',
      overlayOptions: { maxZoom: 18, attribution: '© Stamen Toner Labels' },
    },
  };

  const DEFAULT_LAYER = 'Street';
  const LAYER_STORAGE_KEY = 'horus_map_layer';

  let currentBaseLayer = null;
  let currentOverlayLabels = null;
  let currentLayerName = DEFAULT_LAYER;

  // ---------------------------------------------------------------------------
  // SVG BALON IKONA
  //   - Pravokutnik s callsign tekstom iznad balona
  //   - Balon u boji (ili "puknut" oblik kad je burst/descent)
  //   - Vrat, konop, payload (kućište) s antenom ispod
  //   - Pulsirajući prsten tijekom uspona
  //   - Anchor je na poziciji payloada (gdje je stvarno GPS modul)
  // ---------------------------------------------------------------------------
  function makeBalloonIcon(color, callsign, phase) {
    const isBurst = phase === 'burst' || phase === 'descent';
    const isLanded = phase === 'landed';

    const payloadColor = '#1e293b';
    const payloadBorder = '#f1f5f9';

    const balloonShape = isBurst
      ? `<path d="M 20 6 Q 32 6 32 20 Q 32 30 28 34 Q 26 36 20 36 Q 14 36 12 34 Q 8 30 8 20 Q 8 6 20 6 Z" fill="${color}" stroke="#0f172a" stroke-width="1.5" opacity="0.85"/>
         <path d="M 15 10 Q 20 14 25 10" fill="none" stroke="#0f172a" stroke-width="1" opacity="0.4"/>`
      : `<ellipse cx="20" cy="20" rx="12" ry="14" fill="${color}" stroke="#0f172a" stroke-width="1.5"/>`;

    const pulseCircle = (!isBurst && !isLanded)
      ? `<circle cx="20" cy="20" r="16" fill="${color}" opacity="0.25">
           <animate attributeName="r" from="14" to="22" dur="2s" repeatCount="indefinite"/>
           <animate attributeName="opacity" from="0.4" to="0" dur="2s" repeatCount="indefinite"/>
         </circle>`
      : '';

    const labelText = callsign || '?';
    const labelWidth = Math.max(labelText.length * 7 + 10, 40);
    const labelX = 20 - labelWidth / 2;
    const iconWidth = Math.max(labelWidth, 40);

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${iconWidth}" height="72" viewBox="${20 - iconWidth/2} 0 ${iconWidth} 72" style="overflow:visible">
        <!-- Callsign label -->
        <rect x="${labelX}" y="0" width="${labelWidth}" height="16"
              rx="4" ry="4"
              fill="rgba(15, 23, 42, 0.9)"
              stroke="${color}" stroke-width="1.5"/>
        <text x="20" y="11.5"
              text-anchor="middle"
              font-family="ui-monospace, 'SF Mono', Consolas, monospace"
              font-size="10" font-weight="700"
              fill="${color}" letter-spacing="0.5">${escapeXml(labelText)}</text>

        <!-- Strelica iz labela prema balonu -->
        <path d="M 17 16 L 23 16 L 20 20 Z" fill="rgba(15, 23, 42, 0.9)" stroke="${color}" stroke-width="1"/>

        <!-- Balon (offset 22px dolje od labela) -->
        <g transform="translate(0, 22)">
          ${pulseCircle}
          ${balloonShape}
          <!-- Highlight refleks na balonu -->
          <ellipse cx="16" cy="15" rx="3" ry="5" fill="rgba(255,255,255,0.4)"/>
          <!-- Vrat balona -->
          <path d="M 17 33 L 23 33 L 22 36 L 18 36 Z" fill="${color}" stroke="#0f172a" stroke-width="1"/>
          <!-- Konop -->
          <line x1="20" y1="36" x2="20" y2="42" stroke="#64748b" stroke-width="1.2" stroke-dasharray="1,1"/>
          <!-- Payload (kućište) -->
          <rect x="16" y="42" width="8" height="6" fill="${payloadColor}" stroke="${payloadBorder}" stroke-width="1" rx="1"/>
          <!-- Antena -->
          <line x1="20" y1="42" x2="20" y2="40" stroke="${payloadBorder}" stroke-width="0.8"/>
          <circle cx="20" cy="40" r="0.8" fill="${payloadBorder}"/>
        </g>
      </svg>
    `.trim();

    return L.divIcon({
      className: 'horus-balloon-icon',
      html: svg,
      iconSize: [iconWidth, 72],
      // Anchor = pozicija payloada (GPS modul) - to je prava koordinata balona
      iconAnchor: [iconWidth / 2, 67],
      popupAnchor: [0, -60],
    });
  }

  function escapeXml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function makeLaunchIcon(color) {
    return L.divIcon({
      className: 'launch-icon',
      html: `<div style="
        background: ${color};
        border: 2px solid #fff;
        width: 12px; height: 12px;
        border-radius: 50%;
        opacity: 0.65;
        box-shadow: 0 0 4px rgba(0,0,0,0.5);
      "></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
  }

  const stationIcon = L.divIcon({
    className: 'station-icon',
    html: `<div style="
      width: 20px; height: 20px;
      display: flex; align-items: center; justify-content: center;
    "><svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 2 L18 16 L10 12 L2 16 Z" fill="#a855f7" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
    </svg></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });

  // ---------------------------------------------------------------------------
  // LAYER SWITCHING
  // ---------------------------------------------------------------------------
  function applyLayer(layerName) {
    const def = LAYER_DEFS[layerName];
    if (!def) return;

    if (currentBaseLayer) { map.removeLayer(currentBaseLayer); currentBaseLayer = null; }
    if (currentOverlayLabels) { map.removeLayer(currentOverlayLabels); currentOverlayLabels = null; }

    currentBaseLayer = L.tileLayer(def.url, def.options).addTo(map);

    if (def.overlayUrl) {
      currentOverlayLabels = L.tileLayer(def.overlayUrl, def.overlayOptions).addTo(map);
    }

    // Dark filter se aktivira SAMO za slojeve koji ga trebaju (Street je jedini svijetao)
    if (def.darkFilter) {
      document.body.classList.add('map-dark-filter');
    } else {
      document.body.classList.remove('map-dark-filter');
    }

    currentLayerName = layerName;

    try { localStorage.setItem(LAYER_STORAGE_KEY, layerName); } catch (_) {}

    // Weather layer uvijek iznad base layera
    if (weatherLayer) weatherLayer.bringToFront();
  }

  function loadSavedLayer() {
    try {
      const saved = localStorage.getItem(LAYER_STORAGE_KEY);
      if (saved && LAYER_DEFS[saved]) return saved;
    } catch (_) {}
    return DEFAULT_LAYER;
  }

  function setupLayerControl() {
    // Dummy layer groups - pravi tile layeri se upravljaju u applyLayer()
    // zbog overlay labels (Hybrid) i dark filter klase.
    const baseLayers = {};
    Object.keys(LAYER_DEFS).forEach(name => { baseLayers[name] = L.layerGroup(); });

    // Aktiviraj trenutni da Leaflet zna koji je "selected"
    map.addLayer(baseLayers[currentLayerName]);

    L.control.layers(baseLayers, null, {
      position: 'topright',
      collapsed: true,
    }).addTo(map);

    // Set translated title for CSS ::before pseudo-element
    const layerBase = document.querySelector('.leaflet-control-layers-base');
    if (layerBase) layerBase.setAttribute('data-layer-title', HorusI18n.t('map.layer_title'));

    map.on('baselayerchange', (e) => {
      applyLayer(e.name);
    });
  }

  // ---------------------------------------------------------------------------
  function init() {
    map = L.map('map', {
      center: [45.815, 15.982],
      zoom: 7,
      zoomControl: true,
    });

    currentLayerName = loadSavedLayer();
    applyLayer(currentLayerName);
    setupLayerControl();
  }

  function ensureBalloon(callsign) {
    if (balloons[callsign]) return balloons[callsign];
    const color = BALLOON_COLORS[colorIndex % BALLOON_COLORS.length];
    colorIndex++;
    balloons[callsign] = {
      color,
      pathLine: L.polyline([], { color, weight: 3, opacity: 0.8 }).addTo(map),
      marker: null,
      launchMarker: null,
      horizonRing: null,
      horizonLabel: null,
      currentPhase: null,
    };
    return balloons[callsign];
  }

  function updatePath(packets) {
    if (!packets || packets.length === 0) return;

    // Filtriraj pakete bez GPS fix-a (lat=0, lon=0 = "Null Island", nije prava pozicija).
    // Backend ih šalje u 'packet' poruci da frontend logira grešku, ali NE idu na kartu.
    const validPackets = packets.filter(p =>
      !p.no_gps_fix &&
      !(Math.abs(p.latitude || 0) < 0.001 && Math.abs(p.longitude || 0) < 0.001)
    );
    if (validPackets.length === 0) return;

    const byCallsign = {};
    validPackets.forEach(p => {
      const cs = p.callsign || 'UNKNOWN';
      if (!byCallsign[cs]) byCallsign[cs] = [];
      byCallsign[cs].push(p);
    });

    Object.entries(byCallsign).forEach(([cs, pkts]) => {
      const b = ensureBalloon(cs);
      const points = pkts.map(p => [p.latitude, p.longitude]);
      b.pathLine.setLatLngs(points);

      const lastPhase = pkts[pkts.length - 1]?.phase;
      const phaseColor = {
        'pre_launch': '#64748b',
        'ascent': b.color,
        'burst': '#ef4444',
        'descent': '#f59e0b',
        'landed': '#10b981',
      }[lastPhase] || b.color;
      b.pathLine.setStyle({ color: phaseColor });

      const last = pkts[pkts.length - 1];

      // Re-kreiraj marker kad se promijeni faza da se SVG ažurira
      // (burst shape se razlikuje od ascent, pulsirajući prsten se gasi)
      const needsRecreate = !b.marker || b.currentPhase !== lastPhase;

      if (needsRecreate) {
        if (b.marker) map.removeLayer(b.marker);
        b.marker = L.marker(
          [last.latitude, last.longitude],
          { icon: makeBalloonIcon(phaseColor, cs, lastPhase), zIndexOffset: 1000 }
        ).addTo(map);
        b.currentPhase = lastPhase;
      } else {
        b.marker.setLatLng([last.latitude, last.longitude]);
      }

      b.marker.bindTooltip(
        `<div style="font-family: ui-monospace, monospace; font-size: 11px;">
          <div style="font-weight: bold; color: ${phaseColor}; margin-bottom: 4px;">${cs}</div>
          <div>📍 ${last.latitude.toFixed(4)}, ${last.longitude.toFixed(4)}</div>
          <div>⬆ ${last.altitude.toFixed(0)} m</div>
          ${last.climb_rate != null ? `<div>📈 ${last.climb_rate > 0 ? '+' : ''}${last.climb_rate.toFixed(1)} m/s</div>` : ''}
          <div>📡 ${(lastPhase || '').toUpperCase()}</div>
        </div>`,
        { direction: 'right', offset: [15, -30] }
      );

      updateBalloonHorizon(cs, last.latitude, last.longitude, last.altitude);

      // Ako je ova sonda u follow modu, drži je na karti
      _autoFollowUpdate(cs);

      if (pkts.length > 0 && !b.launchMarker) {
        const first = pkts[0];
        b.launchMarker = L.marker([first.latitude, first.longitude], { icon: makeLaunchIcon(b.color) })
          .addTo(map)
          .bindTooltip(`${cs} — prvi paket`, { direction: 'top' });
      }
    });
  }

  function updateAllFlights(flightsData) {
    if (!flightsData || !flightsData.flights) return;
    Object.entries(flightsData.flights).forEach(([cs, flightInfo]) => {
      if (flightInfo.packets && flightInfo.packets.length > 0) {
        updatePath(flightInfo.packets);
      }
    });
  }

  function updateStation(station) {
    if (!station || (station.latitude === 0 && station.longitude === 0)) return;
    if (!stationMarker) {
      stationMarker = L.marker([station.latitude, station.longitude], { icon: stationIcon })
        .addTo(map)
        .bindTooltip(`📡 ${station.callsign || HorusI18n.t('map.station_fallback')}`, { direction: 'top' });
    } else {
      stationMarker.setLatLng([station.latitude, station.longitude]);
    }
    if (typeof station.altitude === 'number') stationAltitude = station.altitude;
  }

  function centerOnBalloon(callsign) {
    if (callsign && balloons[callsign]?.marker) {
      map.setView(balloons[callsign].marker.getLatLng(), Math.max(map.getZoom(), 11));
      return;
    }
    for (const b of Object.values(balloons)) {
      if (b.marker) { map.setView(b.marker.getLatLng(), Math.max(map.getZoom(), 11)); return; }
    }
  }

  /**
   * Pokreni follow mode za jednu sondu:
   *  - centrira kartu na sondu
   *  - zumira na fiksni nivo 12 (malo bliže od default prikaza)
   *  - svaki novi paket za tu sondu automatski pomiče kartu da sonda ostane vidljiva
   */
  const FOLLOW_ZOOM = 12;

  function followBalloon(callsign) {
    if (!callsign) { unfollowBalloon(); return; }
    followedCallsign = callsign;
    const b = balloons[callsign];
    if (b?.marker) {
      map.setView(b.marker.getLatLng(), FOLLOW_ZOOM, { animate: true });
    }
  }

  /**
   * Zaustavi follow mode — karta se više ne pomiče automatski.
   */
  function unfollowBalloon() {
    followedCallsign = null;
  }

  /**
   * Ako je follow aktivan, provjeri je li sonda još uvijek vidljiva na karti.
   * Ako nije (ili se približila rubu), lagano pomakni kartu da ostane centrirana.
   */
  function _autoFollowUpdate(callsign) {
    if (!followedCallsign || followedCallsign !== callsign) return;
    const b = balloons[callsign];
    if (!b?.marker) return;

    const markerLatLng = b.marker.getLatLng();
    const bounds = map.getBounds();

    // Izračunaj "siguran" prostor — 25% padding od rubova
    const latPad = (bounds.getNorth() - bounds.getSouth()) * 0.25;
    const lngPad = (bounds.getEast() - bounds.getWest()) * 0.25;
    const safeBounds = L.latLngBounds(
      [bounds.getSouth() + latPad, bounds.getWest() + lngPad],
      [bounds.getNorth() - latPad, bounds.getEast() - lngPad]
    );

    if (!safeBounds.contains(markerLatLng)) {
      // Sonda je blizu ruba ili izvan — lagano pomakni (panTo animira)
      map.panTo(markerLatLng, { animate: true, duration: 0.5 });
    }
  }

  function fitPath(callsigns) {
    // Ako je poslan niz callsignova, fitaj samo te
    const targets = callsigns && callsigns.length > 0
      ? callsigns.filter(cs => balloons[cs])
      : Object.keys(balloons);

    const allBounds = [];
    targets.forEach(cs => {
      const b = balloons[cs];
      if (b?.pathLine && b.pathLine.getLatLngs().length > 0) allBounds.push(b.pathLine.getBounds());
    });
    if (allBounds.length > 0) {
      let combined = allBounds[0];
      for (let i = 1; i < allBounds.length; i++) combined = combined.extend(allBounds[i]);
      // Dodaj i stanicu u bounds ako postoji
      if (stationMarker) combined = combined.extend(stationMarker.getLatLng());
      map.fitBounds(combined, { padding: [40, 40] });
    }
  }

  function getFollowedCallsign() {
    return followedCallsign;
  }

  function reset() {
    followedCallsign = null;
    Object.keys(balloons).forEach(cs => {
      const b = balloons[cs];
      [b.pathLine, b.marker, b.launchMarker, b.horizonRing, b.horizonLabel]
        .forEach(layer => { if (layer) map.removeLayer(layer); });
    });
    Object.keys(balloons).forEach(cs => delete balloons[cs]);
    colorIndex = 0;
  }

  // ---------------------------------------------------------------------------
  // WEATHER LEGEND DEFINICIJE
  // ---------------------------------------------------------------------------
  function getWeatherLegendTitle(layerName) {
    const map = {
      'clouds_new': 'weather.clouds',
      'precipitation_new': 'weather.precipitation',
      'pressure_new': 'weather.pressure',
      'wind_new': 'weather.wind',
      'temp_new': 'weather.temperature',
    };
    return map[layerName] ? HorusI18n.t(map[layerName]) : layerName;
  }

  const WEATHER_LEGENDS = {
    'clouds_new': {
      get title() { return HorusI18n.t('weather.clouds'); },
      unit: '%',
      stops: [
        { color: 'rgba(255,255,255,0)',   label: '0' },
        { color: 'rgba(200,200,220,0.3)', label: '25' },
        { color: 'rgba(170,170,195,0.5)', label: '50' },
        { color: 'rgba(130,130,160,0.7)', label: '75' },
        { color: 'rgba(90,90,120,0.9)',   label: '100' },
      ],
    },
    'precipitation_new': {
      get title() { return HorusI18n.t('weather.precipitation'); },
      unit: 'mm/h',
      stops: [
        { color: 'rgba(120,200,255,0.1)', label: '0' },
        { color: '#61b3ff',               label: '0.5' },
        { color: '#3deb3d',               label: '1' },
        { color: '#fcf400',               label: '2' },
        { color: '#ff9900',               label: '5' },
        { color: '#ff0000',               label: '10' },
        { color: '#c800c8',               label: '20+' },
      ],
    },
    'pressure_new': {
      get title() { return HorusI18n.t('weather.pressure'); },
      unit: 'hPa',
      stops: [
        { color: '#0000ff', label: '950' },
        { color: '#00aaff', label: '980' },
        { color: '#00ff00', label: '1000' },
        { color: '#ffff00', label: '1013' },
        { color: '#ff9900', label: '1030' },
        { color: '#ff0000', label: '1050' },
        { color: '#880000', label: '1070' },
      ],
    },
    'wind_new': {
      get title() { return HorusI18n.t('weather.wind'); },
      unit: 'm/s',
      stops: [
        { color: 'rgba(255,255,255,0.1)', label: '0' },
        { color: '#aef1f9',               label: '1' },
        { color: '#96f7dc',               label: '5' },
        { color: '#96f7b4',               label: '10' },
        { color: '#6ff46f',               label: '15' },
        { color: '#f5d800',               label: '25' },
        { color: '#ff9900',               label: '40' },
        { color: '#ff0000',               label: '60' },
        { color: '#d400d4',               label: '100+' },
      ],
    },
    'temp_new': {
      get title() { return HorusI18n.t('weather.temperature'); },
      unit: '°C',
      stops: [
        { color: '#821692', label: '−40' },
        { color: '#0000ff', label: '−20' },
        { color: '#01b0ff', label: '−10' },
        { color: '#00fffe', label: '0' },
        { color: '#00ff00', label: '10' },
        { color: '#ffff00', label: '20' },
        { color: '#ff9900', label: '30' },
        { color: '#ff0000', label: '40' },
        { color: '#7f0000', label: '50' },
      ],
    },
  };

  let weatherLegendControl = null;

  function buildLegendHtml(layerName) {
    const def = WEATHER_LEGENDS[layerName];
    if (!def) return '';

    const gradientColors = def.stops.map(s => s.color).join(', ');
    const labelsHtml = def.stops.map(s =>
      `<span class="weather-legend-tick">${s.label}</span>`
    ).join('');

    return `
      <div class="weather-legend-box">
        <div class="weather-legend-title">${def.title} <span class="weather-legend-unit">(${def.unit})</span></div>
        <div class="weather-legend-bar" style="background: linear-gradient(to right, ${gradientColors})"></div>
        <div class="weather-legend-labels">${labelsHtml}</div>
      </div>
    `;
  }

  function showWeatherLegend(layerName) {
    hideWeatherLegend();
    if (!layerName || !WEATHER_LEGENDS[layerName]) return;

    const LegendControl = L.Control.extend({
      options: { position: 'bottomleft' },
      onAdd() {
        const div = L.DomUtil.create('div', 'weather-legend-control');
        div.innerHTML = buildLegendHtml(layerName);
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return div;
      },
    });

    weatherLegendControl = new LegendControl();
    map.addControl(weatherLegendControl);
  }

  function hideWeatherLegend() {
    if (weatherLegendControl) {
      map.removeControl(weatherLegendControl);
      weatherLegendControl = null;
    }
  }

  async function setWeatherLayer(layerName) {
    if (weatherLayer) {
      map.removeLayer(weatherLayer);
      weatherLayer = null;
      currentWeatherLayerName = '';
      document.body.classList.remove('weather-active');
    }
    hideWeatherLegend();
    if (!layerName) return;
    try {
      const r = await fetch(`/api/weather/tile-url?layer=${encodeURIComponent(layerName)}`);
      if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.detail || 'Weather sloj nije dostupan'); }
      const { tile_url } = await r.json();
      weatherLayer = L.tileLayer(tile_url, { maxZoom: 19, opacity: weatherOpacity, attribution: '© OpenWeatherMap' }).addTo(map);
      currentWeatherLayerName = layerName;
      document.body.classList.add('weather-active');
      weatherLayer.bringToFront();
      showWeatherLegend(layerName);
    } catch (e) { console.error('Weather layer error:', e); throw e; }
  }

  function setWeatherOpacity(opacity) {
    weatherOpacity = Math.max(0, Math.min(1, opacity));
    if (weatherLayer) weatherLayer.setOpacity(weatherOpacity);
  }

  function updateBalloonHorizon(callsign, lat, lon, balloonAltitudeM) {
    const b = balloons[callsign];
    if (!b) return;
    if (b.horizonRing)  { map.removeLayer(b.horizonRing); b.horizonRing = null; }
    if (b.horizonLabel) { map.removeLayer(b.horizonLabel); b.horizonLabel = null; }
    if (!showHorizonRings || !lat || !lon || !balloonAltitudeM || balloonAltitudeM <= 0) return;

    const antHeight = Math.max(0, stationAltitude);
    const distKm = 3.57 * (Math.sqrt(antHeight) + Math.sqrt(balloonAltitudeM));
    const distM = distKm * 1000;

    let color = b.color;
    let statusText = '';
    if (stationMarker) {
      const stationLatLng = stationMarker.getLatLng();
      const distToStation = map.distance([lat, lon], stationLatLng);
      if (distToStation <= distM) {
        color = '#22c55e';
        statusText = ` - ${HorusI18n.t('map.in_range')}`;
      } else {
        color = '#f97316';
        statusText = ` - ${((distToStation - distM) / 1000).toFixed(1)} km ${HorusI18n.t('map.out_of_range')}`;
      }
    }

    b.horizonRing = L.circle([lat, lon], {
      radius: distM, color, weight: 2, opacity: 0.7,
      fillOpacity: 0.08, fillColor: color, dashArray: '8, 6',
      interactive: false,
    }).addTo(map);

    const labelLat = lat + (distKm / 111.0);
    b.horizonLabel = L.marker([labelLat, lon], {
      icon: L.divIcon({
        className: 'balloon-horizon-label',
        html: `<div style="transform:translate(-50%,-100%);display:inline-block;background:rgba(15,23,42,0.88);border:1px solid ${color};color:${color};padding:3px 10px;border-radius:6px;font-size:12px;font-weight:600;font-family:'Segoe UI',system-ui,sans-serif;white-space:nowrap;pointer-events:none;text-align:center">${callsign} ${distKm.toFixed(0)} km${statusText}</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
      interactive: false,
    }).addTo(map);
  }

  function setHorizonRings(enabled, antHeight) {
    showHorizonRings = !!enabled;
    if (typeof antHeight === 'number') stationAltitude = antHeight;
    if (!showHorizonRings) {
      Object.values(balloons).forEach(b => {
        if (b.horizonRing)  { map.removeLayer(b.horizonRing); b.horizonRing = null; }
        if (b.horizonLabel) { map.removeLayer(b.horizonLabel); b.horizonLabel = null; }
      });
    }
  }

  function clearWeatherLayer() {
    if (weatherLayer) { map.removeLayer(weatherLayer); weatherLayer = null; }
    hideWeatherLegend();
  }

  function getTrackedCallsigns() { return Object.keys(balloons); }

  // ---------------------------------------------------------------------------
  // METAR SLOJ — markeri aerodroma s cloud ceiling, vjetar, visibility itd.
  // ---------------------------------------------------------------------------
  let metarLayerGroup = null;
  let metarEnabled = false;
  let metarRefreshTimer = null;
  let metarLastCenter = null;

  function makeMetarIcon(station) {
    const ceil = station.ceiling;
    const clouds = station.clouds || [];
    const isClear = clouds.length === 1 && clouds[0].cover === 'CLR';

    // Boja prema ceiling visini (za balone bitno)
    let color = '#22c55e'; // zelena = clear ili visoko
    let ringClass = 'metar-clear';
    if (ceil) {
      const ft = ceil.alt_ft;
      if (ft < 1000) { color = '#ef4444'; ringClass = 'metar-low'; }
      else if (ft < 3000) { color = '#f59e0b'; ringClass = 'metar-mid'; }
      else if (ft < 10000) { color = '#3b82f6'; ringClass = 'metar-high'; }
      else { color = '#22c55e'; ringClass = 'metar-vhigh'; }
    }

    // Tekst u ikoni
    let label = station.station_id;
    let sublabel = '';
    if (isClear) {
      sublabel = 'CLR';
    } else if (ceil) {
      sublabel = `${ceil.alt_ft} ft`;
    } else if (clouds.length > 0) {
      sublabel = `${clouds[0].cover} ${clouds[0].alt_ft}ft`;
    }

    return L.divIcon({
      className: 'metar-icon',
      html: `<div class="metar-marker ${ringClass}" style="--metar-color: ${color}">
        <div class="metar-dot" style="background: ${color}"></div>
        <div class="metar-label">
          <span class="metar-id">${label}</span>
          <span class="metar-ceil" style="color: ${color}">${sublabel}</span>
        </div>
      </div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
  }

  function buildMetarPopup(s) {
    const clouds = (s.clouds || []).map(c => {
      let txt = `${c.cover_name} @ ${c.alt_ft} ft (${c.alt_m} m)`;
      if (c.cb) txt += ` <span class="metar-cb">${c.cb}</span>`;
      return `<div class="metar-cloud-row">${txt}</div>`;
    }).join('');

    const windHtml = s.wind
      ? `<div class="metar-row"><span class="metar-key">${HorusI18n.t('metar.wind')}</span><span class="metar-val">${s.wind.direction}° ${s.wind.speed_kt} kt (${s.wind.speed_ms} m/s)${s.wind.gust_kt ? ' G' + s.wind.gust_kt + 'kt' : ''}</span></div>`
      : '';

    const visHtml = s.visibility
      ? `<div class="metar-row"><span class="metar-key">${HorusI18n.t('metar.visibility')}</span><span class="metar-val">${s.visibility.text}</span></div>`
      : '';

    const tempHtml = s.temp_c != null
      ? `<div class="metar-row"><span class="metar-key">${HorusI18n.t('metar.temp_dew')}</span><span class="metar-val">${s.temp_c}°C / ${s.dewpoint_c}°C</span></div>`
      : '';

    const qnhHtml = s.qnh
      ? `<div class="metar-row"><span class="metar-key">QNH</span><span class="metar-val">${s.qnh.hpa} hPa</span></div>`
      : '';

    const wxHtml = (s.wx || []).length > 0
      ? `<div class="metar-row"><span class="metar-key">${HorusI18n.t('metar.phenomena')}</span><span class="metar-val">${s.wx.map(w => w.desc).join(', ')}</span></div>`
      : '';

    const elevHtml = s.elev_m != null
      ? `<div class="metar-row"><span class="metar-key">${HorusI18n.t('metar.elevation')}</span><span class="metar-val">${s.elev_m} m</span></div>`
      : '';

    const distHtml = s.distance_km > 0
      ? `<div class="metar-row"><span class="metar-key">${HorusI18n.t('metar.distance')}</span><span class="metar-val">${s.distance_km} km</span></div>`
      : '';

    const timeHtml = s.observation_time
      ? `<div class="metar-obs-time">${s.observation_time}</div>`
      : '';

    return `
      <div class="metar-popup">
        <div class="metar-popup-header">
          <span class="metar-popup-icao">${s.station_id}</span>
          <span class="metar-popup-name">${s.station_name || ''}</span>
        </div>
        ${timeHtml}
        <div class="metar-section-title">${HorusI18n.t('metar.clouds_ceiling')}</div>
        <div class="metar-clouds">${clouds || `<div class="metar-cloud-row">${HorusI18n.t('metar.no_data')}</div>`}</div>
        ${windHtml}${visHtml}${tempHtml}${qnhHtml}${wxHtml}${elevHtml}${distHtml}
        <div class="metar-raw">${s.raw || ''}</div>
      </div>
    `;
  }

  async function loadMetarStations(lat, lon, radius) {
    if (!lat || !lon) return { ok: false, error: HorusI18n.t('metar.no_coords') };
    try {
      const r = await fetch(`/api/metar/nearby?lat=${lat}&lon=${lon}&radius=${radius || 150}`);
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        const msg = err.detail || `HTTP ${r.status}`;
        console.error('METAR API error:', msg);
        return { ok: false, error: msg };
      }
      const data = await r.json();
      const stations = data.stations || [];
      displayMetarStations(stations);
      return { ok: true, count: stations.length, cached: data.cached || false };
    } catch (e) {
      console.error('METAR load error:', e);
      return { ok: false, error: e.message };
    }
  }

  function displayMetarStations(stations) {
    if (metarLayerGroup) {
      map.removeLayer(metarLayerGroup);
      metarLayerGroup = null;
    }
    if (!stations.length) return;

    metarLayerGroup = L.layerGroup();

    stations.forEach(s => {
      const icon = makeMetarIcon(s);
      const marker = L.marker([s.lat, s.lon], { icon, zIndexOffset: -500 });
      marker.bindPopup(buildMetarPopup(s), {
        maxWidth: 340,
        minWidth: 260,
        className: 'metar-popup-container',
      });
      metarLayerGroup.addLayer(marker);
    });

    metarLayerGroup.addTo(map);
    // Weather i baloni iznad METAR-a
    if (weatherLayer) weatherLayer.bringToFront();
  }

  async function setMetarEnabled(enabled, centerLat, centerLon) {
    metarEnabled = !!enabled;
    if (metarEnabled) {
      metarLastCenter = { lat: centerLat, lon: centerLon };
      const result = await loadMetarStations(centerLat, centerLon, 200);
      // Auto-refresh svakih 10 min
      clearInterval(metarRefreshTimer);
      metarRefreshTimer = setInterval(() => {
        if (metarLastCenter) {
          loadMetarStations(metarLastCenter.lat, metarLastCenter.lon, 200);
        }
      }, 600000);
      return result;
    } else {
      clearInterval(metarRefreshTimer);
      if (metarLayerGroup) {
        map.removeLayer(metarLayerGroup);
        metarLayerGroup = null;
      }
      return { ok: true, count: 0 };
    }
  }

  function updateMetarCenter(lat, lon) {
    if (!metarEnabled || !lat || !lon) return;
    metarLastCenter = { lat, lon };
    // Refresh samo ako se dovoljno pomaknuo (>30 km)
    loadMetarStations(lat, lon, 200);
  }

  function invalidateSize() {
    if (map) map.invalidateSize();
  }

  return {
    init, updatePath, updateAllFlights, updateStation,
    centerOnBalloon, fitPath, reset,
    followBalloon, unfollowBalloon, getFollowedCallsign,
    setWeatherLayer, setWeatherOpacity, clearWeatherLayer,
    setHorizonRings, getTrackedCallsigns,
    setMetarEnabled, updateMetarCenter, loadMetarStations,
    invalidateSize,
  };
})();
