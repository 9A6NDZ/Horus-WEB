// ----------------------------------------------------------------------------
// history.js  -  History modal: tablica, analiza, usporedba, replay s kartom
// ----------------------------------------------------------------------------

const HorusHistory = (() => {
  // -------------------- STATE --------------------
  let isOpen = false;
  let logFiles = [];           // [{name, size, modified}]
  let parsedCache = {};        // filename -> parsed result
  let selectedForCompare = new Set();   // set of "filename|callsign"

  let sortField = 'modified';
  let sortDir = 'desc';
  let searchTerm = '';
  let formatFilter = 'all';

  // Analyze tab
  let analyzeContext = null;   // { filename, callsign }
  const analyzeCharts = {};

  // Compare tab
  const compareCharts = {};

  // Replay tab
  let replayMap = null;
  let replayMapBaseLayer = null;
  let replayMapOverlay = null;
  let replayPath = null;
  let replayBalloonMarker = null;
  let replayLaunchMarker = null;
  let replayLandingMarker = null;
  let replayContext = null;    // { filename, callsign, packets, color }
  let replayState = {
    playing: false,
    speed: 100,
    pktIdx: 0,
    lastTickRealMs: 0,         // performance.now() reference
    lastTickSimMs: 0,          // simulated time relative to first packet (ms)
  };
  let replayRafId = null;
  let replayMapInited = false;

  // Layer definicije — iste kao glavna karta, BEZ weather/METAR/horizon overlaya
  const LAYER_DEFS = {
    'Street': {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: { maxZoom: 19, attribution: '© OpenStreetMap' },
    },
    'Satellite': {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      options: { maxZoom: 19, attribution: '© Esri World Imagery' },
    },
    'Terrain': {
      url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      options: { maxZoom: 17, attribution: '© OpenTopoMap (CC-BY-SA)' },
    },
    'Dark': {
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      options: { maxZoom: 20, attribution: '© CartoDB', subdomains: 'abcd' },
    },
    'Light': {
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      options: { maxZoom: 20, attribution: '© CartoDB', subdomains: 'abcd' },
    },
    'Hybrid': {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      options: { maxZoom: 19, attribution: '© Esri World Imagery' },
      overlayUrl: 'https://stamen-tiles.a.ssl.fastly.net/toner-hybrid/{z}/{x}/{y}.png',
      overlayOptions: { maxZoom: 18, attribution: '© Stamen Toner Labels' },
    },
  };
  const DEFAULT_LAYER = 'Street';

  const BALLOON_COLORS = [
    '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
    '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
  ];

  // Map filename|callsign -> color (stabilan kroz cache)
  const colorMap = {};
  let colorIndex = 0;
  function colorForFlight(filename, callsign) {
    const key = `${filename}|${callsign}`;
    if (!colorMap[key]) {
      colorMap[key] = BALLOON_COLORS[colorIndex % BALLOON_COLORS.length];
      colorIndex++;
    }
    return colorMap[key];
  }

  // -------------------- HELPERS --------------------
  function t(key) {
    return (window.HorusI18n && HorusI18n.t) ? HorusI18n.t(key) : key;
  }

  function fmtBytes(b) {
    if (!b) return '0 B';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(2) + ' MB';
  }
  function fmtDuration(s) {
    if (!s || s < 0) return '—';
    s = Math.floor(s);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
  }
  function fmtMMSS(s) {
    if (!s || s < 0) return '00:00';
    s = Math.floor(s);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }
  function fmtAlt(m) {
    if (m == null || isNaN(m)) return '—';
    return Math.round(m).toLocaleString() + ' m';
  }
  function fmtKm(m) {
    if (m == null || isNaN(m)) return '—';
    if (m < 1000) return Math.round(m) + ' m';
    return (m / 1000).toFixed(2) + ' km';
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch { return iso; }
  }
  function escHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[c]));
  }
  function phaseColor(phase) {
    return {
      'pre_launch': '#64748b',
      'ascent': '#3b82f6',
      'burst': '#ef4444',
      'descent': '#f59e0b',
      'landed': '#10b981',
    }[phase] || '#64748b';
  }
  function phaseBadge(phase) {
    if (!phase) return '<span class="text-slate-500">—</span>';
    const color = phaseColor(phase);
    const label = t('history.phase.' + phase) || phase;
    return `<span class="px-2 py-0.5 rounded-full text-xs font-semibold" style="background:${color}22;color:${color};border:1px solid ${color}55">${escHtml(label)}</span>`;
  }

  // Pravi SVG balon ikonu sličnu glavnoj karti, ali jednostavniju (replay)
  function makeBalloonIcon(color, callsign, phase) {
    const isBurst = phase === 'burst' || phase === 'descent';
    const balloonShape = isBurst
      ? `<path d="M 20 6 Q 32 6 32 20 Q 32 30 28 34 Q 26 36 20 36 Q 14 36 12 34 Q 8 30 8 20 Q 8 6 20 6 Z" fill="${color}" stroke="#0f172a" stroke-width="1.5"/>`
      : `<ellipse cx="20" cy="20" rx="12" ry="14" fill="${color}" stroke="#0f172a" stroke-width="1.5"/>`;
    const labelText = callsign || '?';
    const labelWidth = Math.max(labelText.length * 7 + 10, 40);
    const labelX = 20 - labelWidth / 2;
    const iconWidth = Math.max(labelWidth, 40);
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${iconWidth}" height="72" viewBox="${20 - iconWidth/2} 0 ${iconWidth} 72" style="overflow:visible">
        <rect x="${labelX}" y="0" width="${labelWidth}" height="16" rx="4" ry="4"
              fill="rgba(15, 23, 42, 0.9)" stroke="${color}" stroke-width="1.5"/>
        <text x="20" y="11.5" text-anchor="middle"
              font-family="ui-monospace, monospace" font-size="10" font-weight="700"
              fill="${color}">${escHtml(labelText)}</text>
        <path d="M 17 16 L 23 16 L 20 20 Z" fill="rgba(15, 23, 42, 0.9)" stroke="${color}" stroke-width="1"/>
        <g transform="translate(0, 22)">
          ${balloonShape}
          <ellipse cx="16" cy="15" rx="3" ry="5" fill="rgba(255,255,255,0.4)"/>
          <path d="M 17 33 L 23 33 L 22 36 L 18 36 Z" fill="${color}" stroke="#0f172a" stroke-width="1"/>
          <line x1="20" y1="36" x2="20" y2="42" stroke="#64748b" stroke-width="1.2" stroke-dasharray="1,1"/>
          <rect x="16" y="42" width="8" height="6" fill="#1e293b" stroke="#f1f5f9" stroke-width="1" rx="1"/>
        </g>
      </svg>
    `.trim();
    return L.divIcon({
      className: 'horus-balloon-icon',
      html: svg,
      iconSize: [iconWidth, 72],
      iconAnchor: [iconWidth / 2, 67],
    });
  }

  function makeMarkerIcon(color, type) {
    const symbol = type === 'launch' ? 'L' : 'X';
    return L.divIcon({
      className: 'history-marker-icon',
      html: `<div style="
        background:${color};border:2px solid #fff;color:#fff;
        width:18px;height:18px;border-radius:50%;
        font-family:ui-monospace,monospace;font-size:10px;font-weight:700;
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 0 6px rgba(0,0,0,0.6);
      ">${symbol}</div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
  }

  // -------------------- API CALLS --------------------
  async function fetchLogFiles() {
    try {
      const r = await fetch('/api/logging/files');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      console.error('History: fetchLogFiles failed', e);
      return [];
    }
  }

  async function fetchParsed(filename) {
    if (parsedCache[filename]) return parsedCache[filename];
    try {
      const r = await fetch('/api/history/parse/' + encodeURIComponent(filename));
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail || ('HTTP ' + r.status));
      }
      const data = await r.json();
      parsedCache[filename] = data;
      return data;
    } catch (e) {
      console.error('History: fetchParsed failed', filename, e);
      return null;
    }
  }

  async function deleteFile(filename) {
    try {
      const r = await fetch('/api/logging/file/' + encodeURIComponent(filename), {
        method: 'DELETE'
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail || ('HTTP ' + r.status));
      }
      delete parsedCache[filename];
      return true;
    } catch (e) {
      console.error('History: deleteFile failed', filename, e);
      return false;
    }
  }

  // -------------------- TABLE RENDER --------------------
  function applyFilters(files) {
    return files.filter(f => {
      if (formatFilter !== 'all') {
        if (!f.name.toLowerCase().endsWith('.' + formatFilter)) return false;
      }
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        if (!f.name.toLowerCase().includes(term)) {
          // Also check parsed callsigns if available
          const parsed = parsedCache[f.name];
          if (parsed && parsed.callsigns) {
            const match = parsed.callsigns.some(cs => cs.toLowerCase().includes(term));
            if (!match) return false;
          } else {
            return false;
          }
        }
      }
      return true;
    });
  }

  function applySort(files) {
    const f = sortField;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...files].sort((a, b) => {
      let av, bv;
      if (f === 'name') { av = a.name; bv = b.name; }
      else if (f === 'modified') { av = a.modified || ''; bv = b.modified || ''; }
      else if (f === 'callsign') {
        const ac = parsedCache[a.name]?.callsigns?.[0] || '';
        const bc = parsedCache[b.name]?.callsigns?.[0] || '';
        av = ac; bv = bc;
      }
      else { av = a.name; bv = b.name; }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  async function renderTable() {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;

    const filtered = applyFilters(logFiles);
    const sorted = applySort(filtered);

    const countEl = document.getElementById('historyFileCount');
    if (countEl) countEl.textContent = sorted.length;

    if (sorted.length === 0) {
      tbody.innerHTML = `
        <tr><td colspan="9" class="text-center text-slate-500 py-12">
          <i data-lucide="inbox" class="w-10 h-10 mx-auto opacity-40 mb-2"></i>
          <div>${t('history.empty')}</div>
        </td></tr>`;
      if (window.lucide) lucide.createIcons();
      return;
    }

    // Renderaj retke - prvo bez parsed podataka, onda async dopuni
    const rows = sorted.map(f => {
      const parsed = parsedCache[f.name];
      return renderRow(f, parsed);
    });
    tbody.innerHTML = rows.join('');
    if (window.lucide) lucide.createIcons();

    // Bind eventove
    bindRowEvents();

    // Lazy-parse u pozadini za sve fileove koji još nisu cachirani (max 5 paralelno)
    const toParse = sorted.filter(f => !parsedCache[f.name]).slice(0, 50);
    let inFlight = 0;
    const queue = [...toParse];
    const next = async () => {
      if (queue.length === 0) return;
      if (inFlight >= 5) return;
      const f = queue.shift();
      inFlight++;
      const data = await fetchParsed(f.name);
      inFlight--;
      if (data) {
        // Update redak u tablici
        updateRow(f.name);
      }
      next();
    };
    for (let i = 0; i < 5; i++) next();
  }

  function renderRow(f, parsed) {
    const fileEsc = escHtml(f.name);
    const fmt = f.name.toLowerCase().endsWith('.csv') ? 'CSV' : 'JSON';
    const fmtBadge = `<span class="text-[10px] px-1.5 py-0.5 rounded ${fmt==='CSV'?'bg-emerald-900/40 text-emerald-400':'bg-blue-900/40 text-blue-400'}">${fmt}</span>`;

    if (!parsed) {
      // Placeholder dok parsiranje radi
      return `<tr data-filename="${fileEsc}">
        <td>
          <div class="flex items-center gap-2">
            ${fmtBadge}
            <span class="font-mono text-xs">${fileEsc}</span>
          </div>
          <div class="text-[10px] text-slate-500 mt-0.5">${fmtBytes(f.size)} • ${fmtDate(f.modified)}</div>
        </td>
        <td colspan="6" class="text-xs text-slate-500 italic">
          <i data-lucide="loader-2" class="w-3 h-3 inline animate-spin"></i> ${t('history.loading')}
        </td>
        <td class="text-xs text-slate-500">${fmtDate(f.modified)}</td>
        <td class="text-right">
          <div class="inline-flex gap-1">
            <button class="p-1.5 rounded hover:bg-slate-800 text-slate-400" disabled title="Loading...">
              <i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>
            </button>
          </div>
        </td>
      </tr>`;
    }

    // Parsed — možda više callsignova → jedan redak po callsignu
    const callsigns = parsed.callsigns || [];
    if (callsigns.length === 0) {
      return `<tr data-filename="${fileEsc}">
        <td>
          <div class="flex items-center gap-2">
            ${fmtBadge}
            <span class="font-mono text-xs">${fileEsc}</span>
          </div>
          <div class="text-[10px] text-slate-500 mt-0.5">${fmtBytes(f.size)}</div>
        </td>
        <td colspan="6" class="text-xs text-slate-500 italic">— prazno —</td>
        <td class="text-xs text-slate-500">${fmtDate(f.modified)}</td>
        <td class="text-right">
          <button class="px-2 py-1 rounded bg-red-900/30 hover:bg-red-900/50 text-red-400 text-xs btn-delete" data-filename="${fileEsc}" title="${t('history.btn_delete')}">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </td>
      </tr>`;
    }

    return callsigns.map((cs, i) => {
      const fl = parsed.flights[cs];
      if (!fl) return '';
      const key = `${f.name}|${cs}`;
      const isCompared = selectedForCompare.has(key);
      const color = colorForFlight(f.name, cs);
      const csEsc = escHtml(cs);

      // Prvi red za file pokazuje meta info; ostali redci samo callsign
      const fileCell = i === 0 ? `
        <td rowspan="${callsigns.length}" style="vertical-align: top;">
          <div class="flex items-center gap-2">
            ${fmtBadge}
            <span class="font-mono text-xs break-all">${fileEsc}</span>
          </div>
          <div class="text-[10px] text-slate-500 mt-0.5">${fmtBytes(f.size)}</div>
          <div class="text-[10px] text-slate-500">${fmtDate(f.modified)}</div>
        </td>` : '';

      const dateCell = i === 0 ? `<td rowspan="${callsigns.length}" class="text-xs text-slate-400" style="vertical-align: top;">${fmtDate(f.modified)}</td>` : '';

      return `<tr data-filename="${fileEsc}" data-callsign="${csEsc}">
        ${fileCell}
        <td>
          <div class="flex items-center gap-2">
            <input type="checkbox" class="accent-brand-500 cmp-checkbox" data-filename="${fileEsc}" data-callsign="${csEsc}" ${isCompared?'checked':''} title="${t('history.tab_compare')}">
            <span class="w-2.5 h-2.5 rounded-full inline-block" style="background:${color}"></span>
            <span class="font-mono font-semibold">${csEsc}</span>
          </div>
        </td>
        <td class="font-mono text-xs">${fl.packet_count}</td>
        <td class="font-mono text-xs">${fmtAlt(fl.max_altitude)}</td>
        <td class="font-mono text-xs">${fmtKm(fl.total_distance_m)}</td>
        <td class="font-mono text-xs">${fmtDuration(fl.duration_s)}</td>
        <td>${phaseBadge(fl.phase)}</td>
        ${dateCell}
        <td class="text-right">
          <div class="inline-flex gap-1">
            <button class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs btn-analyze" data-filename="${fileEsc}" data-callsign="${csEsc}" title="${t('history.btn_analyze')}">
              <i data-lucide="line-chart" class="w-3.5 h-3.5"></i>
            </button>
            <button class="px-2 py-1 rounded bg-brand-600/80 hover:bg-brand-600 text-xs btn-replay" data-filename="${fileEsc}" data-callsign="${csEsc}" title="${t('history.btn_replay')}">
              <i data-lucide="play" class="w-3.5 h-3.5"></i>
            </button>
            <a class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs btn-download inline-flex items-center" href="/api/logging/download/${encodeURIComponent(f.name)}" download="${fileEsc}" title="${t('history.btn_download')}">
              <i data-lucide="download" class="w-3.5 h-3.5"></i>
            </a>
            ${i === 0 ? `<button class="px-2 py-1 rounded bg-red-900/30 hover:bg-red-900/50 text-red-400 text-xs btn-delete" data-filename="${fileEsc}" title="${t('history.btn_delete')}">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  function updateRow(filename) {
    // Pronađi sve retke s tim filename i zamijeni
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;
    const f = logFiles.find(x => x.name === filename);
    if (!f) return;
    const parsed = parsedCache[filename];
    const newRow = renderRow(f, parsed);

    // Ukloni stare retke za ovaj file (može ih biti više)
    const oldRows = tbody.querySelectorAll(`tr[data-filename="${CSS.escape(filename)}"]`);
    if (oldRows.length === 0) return;

    // Stavi novi HTML prije prvog starog retka, pa ukloni stare
    const tmp = document.createElement('tbody');
    tmp.innerHTML = newRow;
    const newRows = Array.from(tmp.children);
    oldRows[0].parentNode.insertBefore(tmp, oldRows[0]);
    while (tmp.firstChild) {
      oldRows[0].parentNode.insertBefore(tmp.firstChild, oldRows[0]);
    }
    oldRows.forEach(r => r.remove());

    if (window.lucide) lucide.createIcons();
    bindRowEvents();
  }

  function bindRowEvents() {
    document.querySelectorAll('#historyTableBody .btn-analyze').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        showAnalyze(btn.dataset.filename, btn.dataset.callsign);
      };
    });
    document.querySelectorAll('#historyTableBody .btn-replay').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        showReplay(btn.dataset.filename, btn.dataset.callsign);
      };
    });
    document.querySelectorAll('#historyTableBody .btn-delete').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const fname = btn.dataset.filename;
        if (!confirm(t('history.confirm_delete').replace('{0}', fname))) return;
        const ok = await deleteFile(fname);
        if (ok) {
          // Ukloni iz selected for compare
          [...selectedForCompare].forEach(k => {
            if (k.startsWith(fname + '|')) selectedForCompare.delete(k);
          });
          await loadFiles();
        } else {
          alert(t('history.delete_failed'));
        }
      };
    });
    document.querySelectorAll('#historyTableBody .cmp-checkbox').forEach(cb => {
      cb.onchange = (e) => {
        const key = `${cb.dataset.filename}|${cb.dataset.callsign}`;
        if (cb.checked) selectedForCompare.add(key);
        else selectedForCompare.delete(key);
        updateCompareUI();
      };
    });
  }

  // -------------------- TABS --------------------
  function switchTab(tabName) {
    document.querySelectorAll('.history-tab-btn').forEach(b => {
      const active = b.dataset.tab === tabName;
      b.classList.toggle('active', active);
      b.classList.toggle('border-brand-500', active);
      b.classList.toggle('text-white', active);
      b.classList.toggle('border-transparent', !active);
      b.classList.toggle('text-slate-400', !active);
    });
    document.querySelectorAll('.history-tab-content').forEach(el => {
      el.classList.add('hidden');
    });
    const target = document.getElementById('historyTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
    if (target) target.classList.remove('hidden');

    // Pauziraj replay kad se napušta replay tab
    if (tabName !== 'replay' && replayState.playing) {
      pauseReplay();
    }

    if (tabName === 'replay') {
      // Mapa treba biti inicijalizirana i osvježena
      setTimeout(() => {
        if (!replayMapInited) initReplayMap();
        if (replayMap) replayMap.invalidateSize();
      }, 50);
    }
    if (tabName === 'compare') {
      renderCompare();
    }
  }

  // -------------------- ANALYZE --------------------
  async function showAnalyze(filename, callsign) {
    switchTab('analyze');
    document.getElementById('historyAnalyzeEmpty').classList.add('hidden');
    document.getElementById('historyAnalyzeContent').classList.remove('hidden');

    const parsed = await fetchParsed(filename);
    if (!parsed || !parsed.flights[callsign]) {
      document.getElementById('historyAnalyzeEmpty').classList.remove('hidden');
      document.getElementById('historyAnalyzeContent').classList.add('hidden');
      return;
    }

    const fl = parsed.flights[callsign];
    const color = colorForFlight(filename, callsign);
    analyzeContext = { filename, callsign };

    document.getElementById('historyAnalyzeCallsign').textContent = callsign;
    document.getElementById('historyAnalyzeFilename').textContent = filename;
    document.getElementById('historyAnalyzeColor').style.background = color;

    // KPI vrijednosti
    const validPkts = fl.packets.filter(p => !p.no_gps_fix);
    const climbs = validPkts.map(p => p.climb_rate).filter(v => v != null);
    const speeds = validPkts.map(p => p.horizontal_speed).filter(v => v != null);
    const avgClimb = climbs.length ? climbs.reduce((a,b)=>a+b,0)/climbs.length : null;
    const avgSpeed = speeds.length ? speeds.reduce((a,b)=>a+b,0)/speeds.length : null;

    document.getElementById('historyKPackets').textContent = fl.packet_count;
    document.getElementById('historyKMaxAlt').textContent = fmtAlt(fl.max_altitude);
    document.getElementById('historyKDistance').textContent = fmtKm(fl.total_distance_m);
    document.getElementById('historyKDuration').textContent = fmtDuration(fl.duration_s);
    document.getElementById('historyKAvgClimb').textContent = (avgClimb != null) ? avgClimb.toFixed(2) + ' m/s' : '—';
    document.getElementById('historyKAvgSpeed').textContent = (avgSpeed != null) ? (avgSpeed * 3.6).toFixed(1) + ' km/h' : '—';

    // Grafovi
    drawAnalyzeCharts(fl.packets, color);

    // Replay shortcut
    const replayBtn = document.getElementById('historyAnalyzeReplayBtn');
    if (replayBtn) {
      replayBtn.onclick = () => showReplay(filename, callsign);
    }

    if (window.lucide) lucide.createIcons();
  }

  function drawAnalyzeCharts(packets, color) {
    const validPkts = packets.filter(p => !p.no_gps_fix && p._rx_time != null);
    // Koristimo pravo UTC vrijeme iz paketa umjesto relativnog od 00:00
    const labels = validPkts.map(p => {
      if (p.time) {
        // time je "HH:MM:SS" — prikaži samo "HH:MM"
        const parts = p.time.split(':');
        return parts.length >= 2 ? parts[0] + ':' + parts[1] : p.time;
      }
      // Fallback na relativne sekunde ako nema time polja
      const t0 = validPkts[0]?._rx_time || 0;
      return fmtMMSS(Math.round(p._rx_time - t0));
    });

    const altData = validPkts.map(p => p.altitude);
    const tempData = validPkts.map(p => p.temperature != null ? p.temperature : null);
    const battData = validPkts.map(p => p.battery_voltage != null ? p.battery_voltage : null);
    const climbData = validPkts.map(p => p.climb_rate != null ? p.climb_rate : null);
    const speedData = validPkts.map(p => p.horizontal_speed != null ? p.horizontal_speed * 3.6 : null);
    const snrData = validPkts.map(p => p.snr != null ? p.snr : null);

    const baseOpts = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { intersect: false, mode: 'index' } },
      scales: {
        x: {
          ticks: { color: '#94a3b8', maxTicksLimit: 8 },
          grid: { color: '#1e293b' }
        },
        y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } }
      }
    };

    drawOrUpdateChart('historyAltChart', 'alt', { labels, datasets: [{ label: 'Visina (m)', data: altData, borderColor: color, backgroundColor: color + '33', tension: 0.1, pointRadius: 0, fill: true }] }, baseOpts);
    drawOrUpdateChart('historyTempChart', 'temp', { labels, datasets: [{ label: 'Temp (°C)', data: tempData, borderColor: '#ef4444', backgroundColor: '#ef444433', tension: 0.1, pointRadius: 0 }] }, baseOpts);
    drawOrUpdateChart('historyBattChart', 'batt', { labels, datasets: [{ label: 'Bat (V)', data: battData, borderColor: '#10b981', backgroundColor: '#10b98133', tension: 0.1, pointRadius: 0 }] }, baseOpts);
    drawOrUpdateChart('historyClimbChart', 'climb', { labels, datasets: [{ label: 'Climb (m/s)', data: climbData, borderColor: '#8b5cf6', backgroundColor: '#8b5cf633', tension: 0.1, pointRadius: 0 }] }, baseOpts);
    drawOrUpdateChart('historySpeedChart', 'speed', { labels, datasets: [{ label: 'Speed (km/h)', data: speedData, borderColor: '#06b6d4', backgroundColor: '#06b6d433', tension: 0.1, pointRadius: 0 }] }, baseOpts);
    drawOrUpdateChart('historySnrChart', 'snr', { labels, datasets: [{ label: 'SNR (dB)', data: snrData, borderColor: '#ec4899', backgroundColor: '#ec489933', tension: 0.1, pointRadius: 0 }] }, baseOpts);
  }

  function drawOrUpdateChart(canvasId, key, data, options) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (analyzeCharts[key]) {
      analyzeCharts[key].destroy();
    }
    analyzeCharts[key] = new Chart(canvas, { type: 'line', data, options });
  }

  // -------------------- COMPARE --------------------
  function updateCompareUI() {
    const count = selectedForCompare.size;
    const countEl = document.getElementById('historyCompareCount');
    if (countEl) countEl.textContent = count;
  }

  async function renderCompare() {
    const chips = document.getElementById('historyCompareChips');
    const emptyEl = document.getElementById('historyCompareEmpty');
    const contentEl = document.getElementById('historyCompareContent');
    const tbody = document.getElementById('historyCompareTableBody');

    // Chip lista
    const keys = [...selectedForCompare];
    if (chips) {
      chips.innerHTML = keys.map(k => {
        const [fname, cs] = k.split('|');
        const color = colorForFlight(fname, cs);
        return `<div class="history-compare-chip">
          <span class="w-2 h-2 rounded-full inline-block" style="background:${color}"></span>
          <span class="font-mono font-semibold">${escHtml(cs)}</span>
          <span class="text-slate-500 text-[10px]">${escHtml(fname)}</span>
          <button data-key="${escHtml(k)}" class="cmp-chip-remove">
            <i data-lucide="x" class="w-3 h-3"></i>
          </button>
        </div>`;
      }).join('');

      chips.querySelectorAll('.cmp-chip-remove').forEach(btn => {
        btn.onclick = () => {
          selectedForCompare.delete(btn.dataset.key);
          updateCompareUI();
          renderCompare();
          // Re-render tablice za checkbox sync
          renderTable();
        };
      });
    }
    if (window.lucide) lucide.createIcons();
    updateCompareUI();

    if (keys.length < 2) {
      emptyEl?.classList.remove('hidden');
      contentEl?.classList.add('hidden');
      return;
    }
    emptyEl?.classList.add('hidden');
    contentEl?.classList.remove('hidden');

    // Učitaj sve podatke
    const flightsData = [];
    for (const k of keys) {
      const [fname, cs] = k.split('|');
      const parsed = await fetchParsed(fname);
      if (parsed && parsed.flights[cs]) {
        flightsData.push({
          filename: fname,
          callsign: cs,
          color: colorForFlight(fname, cs),
          flight: parsed.flights[cs],
        });
      }
    }

    // Tablica
    if (tbody) {
      tbody.innerHTML = flightsData.map(d => {
        const fl = d.flight;
        const validPkts = fl.packets.filter(p => !p.no_gps_fix);
        const climbs = validPkts.map(p => p.climb_rate).filter(v => v != null);
        const speeds = validPkts.map(p => p.horizontal_speed).filter(v => v != null);
        const avgClimb = climbs.length ? climbs.reduce((a,b)=>a+b,0)/climbs.length : null;
        const avgSpeed = speeds.length ? speeds.reduce((a,b)=>a+b,0)/speeds.length : null;
        return `<tr>
          <td>
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full inline-block" style="background:${d.color}"></span>
              <span class="font-mono font-semibold">${escHtml(d.callsign)}</span>
              <span class="text-[10px] text-slate-500">${escHtml(d.filename)}</span>
            </div>
          </td>
          <td class="font-mono text-xs">${fl.packet_count}</td>
          <td class="font-mono text-xs">${fmtAlt(fl.max_altitude)}</td>
          <td class="font-mono text-xs">${fmtKm(fl.total_distance_m)}</td>
          <td class="font-mono text-xs">${fmtDuration(fl.duration_s)}</td>
          <td class="font-mono text-xs">${avgClimb != null ? avgClimb.toFixed(2)+' m/s' : '—'}</td>
          <td class="font-mono text-xs">${avgSpeed != null ? (avgSpeed*3.6).toFixed(1)+' km/h' : '—'}</td>
          <td>${phaseBadge(fl.phase)}</td>
        </tr>`;
      }).join('');
    }

    // Grafovi - overlay
    drawCompareCharts(flightsData);
  }

  function drawCompareCharts(flightsData) {
    const baseOpts = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: true, labels: { color: '#cbd5e1', font: { family: 'ui-monospace, monospace' } } }, tooltip: { intersect: false, mode: 'index' } },
      scales: {
        x: {
          ticks: { color: '#94a3b8', maxTicksLimit: 8, callback: (v) => fmtMMSS(v) },
          grid: { color: '#1e293b' },
          title: { display: true, text: 'Vrijeme od početka', color: '#64748b' }
        },
        y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } }
      }
    };

    function buildDatasets(field, transform) {
      return flightsData.map(d => {
        const pkts = d.flight.packets.filter(p => !p.no_gps_fix && p._rx_time != null);
        const t0 = pkts[0]?._rx_time || 0;
        const points = pkts.map(p => ({
          x: Math.round(p._rx_time - t0),
          y: transform ? transform(p[field]) : p[field]
        })).filter(pt => pt.y != null && !isNaN(pt.y));
        return {
          label: d.callsign,
          data: points,
          borderColor: d.color,
          backgroundColor: d.color + '22',
          tension: 0.1,
          pointRadius: 0,
          showLine: true,
        };
      });
    }

    drawCmpChart('historyCmpAltChart', 'alt', { datasets: buildDatasets('altitude') }, baseOpts);
    drawCmpChart('historyCmpClimbChart', 'climb', { datasets: buildDatasets('climb_rate') }, baseOpts);
    drawCmpChart('historyCmpTempChart', 'temp', { datasets: buildDatasets('temperature') }, baseOpts);
    drawCmpChart('historyCmpSpeedChart', 'speed', { datasets: buildDatasets('horizontal_speed', v => v != null ? v * 3.6 : null) }, baseOpts);
  }

  function drawCmpChart(canvasId, key, data, options) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (compareCharts[key]) compareCharts[key].destroy();
    compareCharts[key] = new Chart(canvas, { type: 'line', data, options: { ...options, parsing: false } });
  }

  // -------------------- REPLAY MAP --------------------
  function initReplayMap() {
    if (replayMapInited) return;
    const el = document.getElementById('historyMap');
    if (!el) return;
    if (el._leaflet_id) {
      // već postoji - reset
      return;
    }

    replayMap = L.map('historyMap', {
      center: [45.815, 15.982],
      zoom: 7,
      zoomControl: true,
    });

    // Učitaj saved layer (isti storage key kao glavna karta da bude konzistentno)
    let initialLayer = DEFAULT_LAYER;
    try {
      const saved = localStorage.getItem('horus_map_layer');
      if (saved && LAYER_DEFS[saved]) initialLayer = saved;
    } catch {}
    applyReplayLayer(initialLayer);

    // Layer switcher
    const baseLayers = {};
    Object.keys(LAYER_DEFS).forEach(name => {
      baseLayers[name] = L.layerGroup();
    });
    replayMap.addLayer(baseLayers[initialLayer]);
    L.control.layers(baseLayers, null, {
      position: 'topright',
      collapsed: true,
    }).addTo(replayMap);
    replayMap.on('baselayerchange', (e) => applyReplayLayer(e.name));

    replayMapInited = true;
  }

  function applyReplayLayer(layerName) {
    const def = LAYER_DEFS[layerName];
    if (!def || !replayMap) return;
    if (replayMapBaseLayer) { replayMap.removeLayer(replayMapBaseLayer); replayMapBaseLayer = null; }
    if (replayMapOverlay) { replayMap.removeLayer(replayMapOverlay); replayMapOverlay = null; }

    replayMapBaseLayer = L.tileLayer(def.url, def.options).addTo(replayMap);
    if (def.overlayUrl) {
      replayMapOverlay = L.tileLayer(def.overlayUrl, def.overlayOptions).addTo(replayMap);
    }
  }

  function clearReplayLayers() {
    if (replayPath) { replayMap.removeLayer(replayPath); replayPath = null; }
    if (replayBalloonMarker) { replayMap.removeLayer(replayBalloonMarker); replayBalloonMarker = null; }
    if (replayLaunchMarker) { replayMap.removeLayer(replayLaunchMarker); replayLaunchMarker = null; }
    if (replayLandingMarker) { replayMap.removeLayer(replayLandingMarker); replayLandingMarker = null; }
  }

  // -------------------- REPLAY --------------------
  async function showReplay(filename, callsign) {
    switchTab('replay');
    document.getElementById('historyReplayEmpty').classList.add('hidden');
    document.getElementById('historyReplayContent').classList.remove('hidden');

    const parsed = await fetchParsed(filename);
    if (!parsed || !parsed.flights[callsign]) {
      document.getElementById('historyReplayEmpty').classList.remove('hidden');
      document.getElementById('historyReplayContent').classList.add('hidden');
      return;
    }

    const fl = parsed.flights[callsign];
    const color = colorForFlight(filename, callsign);

    // Filtriraj pakete - samo s GPS fix-om i timestamp-om
    const pkts = fl.packets.filter(p => !p.no_gps_fix && p._rx_time != null
      && p.latitude != null && p.longitude != null
      && !(Math.abs(p.latitude) < 0.001 && Math.abs(p.longitude) < 0.001));

    if (pkts.length === 0) {
      alert('Nema validnih GPS paketa za reprizu.');
      return;
    }

    stopReplay();
    replayContext = { filename, callsign, packets: pkts, color };
    replayState.pktIdx = 0;
    replayState.lastTickSimMs = 0;

    document.getElementById('historyReplayCallsign').textContent = callsign;
    document.getElementById('historyReplayColor').style.background = color;
    document.getElementById('historyReplayPktTotal').textContent = pkts.length;

    // Vremenski raspon
    const duration = pkts[pkts.length - 1]._rx_time - pkts[0]._rx_time;
    document.getElementById('historyReplayTimeStart').textContent = fmtMMSS(0);
    document.getElementById('historyReplayTimeEnd').textContent = fmtMMSS(duration);

    // Slider
    const slider = document.getElementById('historyReplaySlider');
    slider.max = pkts.length - 1;
    slider.value = 0;

    // Pripremi mapu
    if (!replayMapInited) initReplayMap();
    setTimeout(() => { if (replayMap) replayMap.invalidateSize(); }, 100);

    clearReplayLayers();

    // Path - prazan na početku, popunjava se kroz replay
    replayPath = L.polyline([], { color, weight: 3, opacity: 0.8 }).addTo(replayMap);

    // Launch marker (zelena točka - prva validna pozicija)
    const first = pkts[0];
    replayLaunchMarker = L.marker([first.latitude, first.longitude], {
      icon: makeMarkerIcon('#10b981', 'launch')
    }).addTo(replayMap).bindTooltip(callsign + ' — prvi paket', { direction: 'top' });

    // Landing marker - samo ako je flight završio (landed ili descent posljednji paket)
    if (fl.phase === 'landed' || fl.phase === 'descent') {
      const last = pkts[pkts.length - 1];
      replayLandingMarker = L.marker([last.latitude, last.longitude], {
        icon: makeMarkerIcon('#ef4444', 'land')
      }).addTo(replayMap).bindTooltip(callsign + ' — zadnji paket', { direction: 'top' });
    }

    // Fit bounds na cijelu putanju
    const bounds = L.latLngBounds(pkts.map(p => [p.latitude, p.longitude]));
    replayMap.fitBounds(bounds, { padding: [50, 50], maxZoom: 13 });

    // Renderaj prvi paket
    renderReplayFrame(0);
  }

  function renderReplayFrame(idx) {
    if (!replayContext) return;
    const pkts = replayContext.packets;
    if (idx < 0) idx = 0;
    if (idx >= pkts.length) idx = pkts.length - 1;

    const pkt = pkts[idx];

    // Update path do trenutnog paketa
    const pathPoints = pkts.slice(0, idx + 1).map(p => [p.latitude, p.longitude]);
    replayPath.setLatLngs(pathPoints);

    // Update balon marker
    const phase = pkt.phase || 'ascent';
    const phColor = phase === 'burst' || phase === 'descent' ? '#f59e0b'
                  : phase === 'landed' ? '#10b981'
                  : replayContext.color;

    if (!replayBalloonMarker) {
      replayBalloonMarker = L.marker([pkt.latitude, pkt.longitude], {
        icon: makeBalloonIcon(phColor, replayContext.callsign, phase),
        zIndexOffset: 1000,
      }).addTo(replayMap);
      replayBalloonMarker._lastPhase = phase;
    } else {
      // Re-create marker kad se faza promijeni
      if (replayBalloonMarker._lastPhase !== phase) {
        replayMap.removeLayer(replayBalloonMarker);
        replayBalloonMarker = L.marker([pkt.latitude, pkt.longitude], {
          icon: makeBalloonIcon(phColor, replayContext.callsign, phase),
          zIndexOffset: 1000,
        }).addTo(replayMap);
        replayBalloonMarker._lastPhase = phase;
      } else {
        replayBalloonMarker.setLatLng([pkt.latitude, pkt.longitude]);
      }
    }

    // Update info bar
    const t0 = pkts[0]._rx_time;
    const tRel = pkt._rx_time - t0;
    document.getElementById('historyReplayClock').textContent = pkt.time || fmtMMSS(tRel);
    document.getElementById('historyReplayAlt').textContent = fmtAlt(pkt.altitude);
    document.getElementById('historyReplayClimb').textContent = (pkt.climb_rate != null) ? pkt.climb_rate.toFixed(1) + ' m/s' : '—';
    document.getElementById('historyReplaySpeed').textContent = (pkt.horizontal_speed != null) ? (pkt.horizontal_speed * 3.6).toFixed(1) + ' km/h' : '—';
    document.getElementById('historyReplayPktIdx').textContent = idx + 1;
    document.getElementById('historyReplayTimeStart').textContent = fmtMMSS(tRel);

    // Slider
    const slider = document.getElementById('historyReplaySlider');
    if (slider && document.activeElement !== slider) {
      slider.value = idx;
    }
  }

  function playReplay() {
    if (!replayContext || replayState.playing) return;
    replayState.playing = true;
    replayState.lastTickRealMs = performance.now();

    const pkts = replayContext.packets;
    const t0 = pkts[0]._rx_time;
    replayState.lastTickSimMs = (pkts[replayState.pktIdx]._rx_time - t0) * 1000;

    // Zamijeni ikonu play→pause bez globalnog lucide.createIcons()
    // koji može baciti grešku na već-procesiranom SVG elementu
    try {
      const playBtn = document.getElementById('historyReplayPlayBtn');
      if (playBtn) {
        playBtn.innerHTML = '<i data-lucide="pause" class="w-5 h-5" id="historyReplayPlayIcon"></i>';
        if (window.lucide) lucide.createIcons({ nodes: [playBtn] });
      }
    } catch (e) { console.warn('Replay icon swap error:', e); }

    function step() {
      if (!replayState.playing || !replayContext) return;
      const now = performance.now();
      const dt = (now - replayState.lastTickRealMs) * replayState.speed;
      replayState.lastTickRealMs = now;
      replayState.lastTickSimMs += dt;

      // Pronađi idx koji odgovara trenutnom sim time
      const t0_local = replayContext.packets[0]._rx_time;
      const targetT = t0_local + replayState.lastTickSimMs / 1000;

      // Linearno traži unaprijed od trenutnog idx
      let idx = replayState.pktIdx;
      while (idx < replayContext.packets.length - 1
             && replayContext.packets[idx + 1]._rx_time <= targetT) {
        idx++;
      }
      replayState.pktIdx = idx;
      renderReplayFrame(idx);

      // Kraj?
      if (idx >= replayContext.packets.length - 1) {
        pauseReplay();
        return;
      }
      replayRafId = requestAnimationFrame(step);
    }
    replayRafId = requestAnimationFrame(step);
  }

  function pauseReplay() {
    replayState.playing = false;
    if (replayRafId) {
      cancelAnimationFrame(replayRafId);
      replayRafId = null;
    }
    try {
      const pauseBtn = document.getElementById('historyReplayPlayBtn');
      if (pauseBtn) {
        pauseBtn.innerHTML = '<i data-lucide="play" class="w-5 h-5" id="historyReplayPlayIcon"></i>';
        if (window.lucide) lucide.createIcons({ nodes: [pauseBtn] });
      }
    } catch (e) { console.warn('Replay icon swap error:', e); }
  }

  function stopReplay() {
    pauseReplay();
    replayState.pktIdx = 0;
    replayState.lastTickSimMs = 0;
  }

  function restartReplay() {
    pauseReplay();
    replayState.pktIdx = 0;
    replayState.lastTickSimMs = 0;
    renderReplayFrame(0);
  }

  function setReplaySpeed(speed) {
    replayState.speed = speed;
    document.querySelectorAll('.history-speed-btn').forEach(btn => {
      const active = parseInt(btn.dataset.speed) === speed;
      btn.classList.toggle('active', active);
      btn.classList.toggle('bg-brand-600', active);
      btn.classList.toggle('text-white', active);
    });
    // Reset sim reference da se trenutna brzina primijeni od idućeg frame-a
    if (replayContext) {
      const t0 = replayContext.packets[0]._rx_time;
      replayState.lastTickSimMs = (replayContext.packets[replayState.pktIdx]._rx_time - t0) * 1000;
      replayState.lastTickRealMs = performance.now();
    }
  }

  // -------------------- MODAL OPEN / CLOSE --------------------
  async function loadFiles() {
    logFiles = await fetchLogFiles();
    await renderTable();
  }

  async function open() {
    if (isOpen) return;
    const modal = document.getElementById('historyModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    isOpen = true;
    switchTab('list');
    await loadFiles();
    if (window.lucide) lucide.createIcons();
  }

  function close() {
    const modal = document.getElementById('historyModal');
    if (modal) modal.classList.add('hidden');
    isOpen = false;
    pauseReplay();
  }

  // -------------------- INIT / EVENT BINDING --------------------
  function init() {
    const btn = document.getElementById('historyBtn');
    if (btn) btn.addEventListener('click', open);

    const closeBtn = document.getElementById('closeHistoryBtn');
    if (closeBtn) closeBtn.addEventListener('click', close);

    const refreshBtn = document.getElementById('historyRefreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', async () => {
      parsedCache = {};
      await loadFiles();
    });

    // Tab switching
    document.querySelectorAll('.history-tab-btn').forEach(b => {
      b.addEventListener('click', () => switchTab(b.dataset.tab));
    });

    // Modal click outside to close
    const modal = document.getElementById('historyModal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
      });
    }

    // Search + filter
    const searchInput = document.getElementById('historySearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchTerm = e.target.value;
        renderTable();
      });
    }
    const formatSel = document.getElementById('historyFilterFormat');
    if (formatSel) {
      formatSel.addEventListener('change', (e) => {
        formatFilter = e.target.value;
        renderTable();
      });
    }

    // Sort headers
    document.querySelectorAll('#historyTabList th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const field = th.dataset.sort;
        if (sortField === field) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortField = field;
          sortDir = 'asc';
        }
        renderTable();
      });
    });

    // Compare clear
    const cmpClear = document.getElementById('historyCompareClearBtn');
    if (cmpClear) cmpClear.addEventListener('click', () => {
      selectedForCompare.clear();
      updateCompareUI();
      renderCompare();
      renderTable();
    });

    // Replay controls
    const playBtn = document.getElementById('historyReplayPlayBtn');
    if (playBtn) playBtn.addEventListener('click', () => {
      if (replayState.playing) pauseReplay();
      else playReplay();
    });
    const restartBtn = document.getElementById('historyReplayRestartBtn');
    if (restartBtn) restartBtn.addEventListener('click', restartReplay);

    const slider = document.getElementById('historyReplaySlider');
    if (slider) {
      slider.addEventListener('input', (e) => {
        if (!replayContext) return;
        pauseReplay();
        const idx = parseInt(e.target.value);
        replayState.pktIdx = idx;
        const t0 = replayContext.packets[0]._rx_time;
        replayState.lastTickSimMs = (replayContext.packets[idx]._rx_time - t0) * 1000;
        renderReplayFrame(idx);
      });
    }

    document.querySelectorAll('.history-speed-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const speed = parseInt(btn.dataset.speed);
        setReplaySpeed(speed);
      });
    });

    // Esc to close (samo kad je history modal otvoren i nije drugi otvoren)
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!isOpen) return;
      // Provjeri jesu li drugi modali otvoreni - ako jesu, ne diraj
      const fb = document.getElementById('folderBrowserModal');
      const ab = document.getElementById('aboutModal');
      const sm = document.getElementById('settingsModal');
      if (fb && !fb.classList.contains('hidden')) return;
      if (ab && !ab.classList.contains('hidden')) return;
      if (sm && !sm.classList.contains('hidden')) return;
      close();
    });
  }

  // Init kad DOM bude spreman
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { open, close };
})();
