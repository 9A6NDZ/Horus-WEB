// ----------------------------------------------------------------------------
// charts.js  -  Chart.js grafovi s time-range filterom i dinamičkim custom poljima
// ----------------------------------------------------------------------------

const HorusCharts = (() => {
  let altitudeChart, snrChart, batteryChart, temperatureChart, satellitesChart, climbRateChart;
  // Statički paneli za česta custom polja (uvijek vidljivi)
  let speedChart, ascentRateChart, extHumidityChart, extPressureChart, crcPassChart, horizSpeedChart;

  // Polja koja imaju statičke panele — ne stvaraju se dinamički
  const STATIC_CUSTOM_KEYS = new Set(['speed', 'ascent_rate', 'ext_humidity', 'ext_pressure', 'crc_pass']);

  // Dinamički custom field grafovi (za sve OSTALO što nije u STATIC_CUSTOM_KEYS)
  const customCharts = {};  // key -> Chart instanca
  let customChartContainer = null;

  // Trenutni raspon prikazanog vremena (sekunde). Default: 5 minuta.
  let timeRangeSeconds = 5 * 60;
  // 'all' = prikaži sve podatke (bez filtra)
  let showAll = false;
  // Svi zadnje primljeni paketi (pamtimo za prefilter pri promjeni range-a)
  let allPackets = [];

  const darkGridColor = 'rgba(148, 163, 184, 0.15)';
  const tickColor = '#94a3b8';

  // Boje za custom field grafove (rotirajuće)
  const CUSTOM_COLORS = [
    '#06b6d4', '#ec4899', '#14b8a6', '#f97316',
    '#a855f7', '#84cc16', '#e11d48', '#0ea5e9',
  ];
  let colorIdx = 0;

  function makeLineChart(canvasId, color, label, yCallback) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    const rgba = (c, a) => {
      const hex = c.replace('#', '');
      const r = parseInt(hex.substr(0, 2), 16);
      const g = parseInt(hex.substr(2, 2), 16);
      const b = parseInt(hex.substr(4, 2), 16);
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    };

    return new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [{
          label: label,
          data: [],
          borderColor: color,
          backgroundColor: rgba(color, 0.15),
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
          tension: 0.3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1e293b',
            borderColor: '#334155',
            borderWidth: 1,
          },
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: 'minute', displayFormats: { minute: 'HH:mm' } },
            grid: { color: darkGridColor },
            ticks: { color: tickColor, maxTicksLimit: 6 },
          },
          y: {
            grid: { color: darkGridColor },
            ticks: {
              color: tickColor,
              callback: yCallback || ((v) => v),
            },
          },
        },
      },
    });
  }

  function init() {
    Chart.defaults.color = tickColor;
    Chart.defaults.borderColor = darkGridColor;

    altitudeChart = makeLineChart('altitudeChart', '#3b82f6', HorusI18n.t('charts.altitude_label'),
      (v) => (v >= 1000 ? (v / 1000).toFixed(1) + ' km' : v + ' m'));
    snrChart = makeLineChart('snrChart', '#10b981', HorusI18n.t('charts.snr_label'),
      (v) => v + ' dB');
    batteryChart = makeLineChart('batteryChart', '#eab308', HorusI18n.t('charts.battery_label'),
      (v) => v.toFixed(2) + ' V');
    temperatureChart = makeLineChart('temperatureChart', '#ef4444', HorusI18n.t('charts.temperature_label'),
      (v) => v + '°');
    satellitesChart = makeLineChart('satellitesChart', '#8b5cf6', HorusI18n.t('charts.satellites_label'),
      (v) => v);
    climbRateChart = makeLineChart('climbRateChart', '#f97316', HorusI18n.t('charts.climb_label'),
      (v) => v.toFixed(1) + ' m/s');

    // Statički paneli za česta polja (uvijek vidljivi, bez oznake "custom")
    speedChart = makeLineChart('speedChart', '#06b6d4', HorusI18n.t('charts.speed'),
      (v) => typeof v === 'number' ? v.toFixed(1) + ' km/h' : v);
    ascentRateChart = makeLineChart('ascentRateChart', '#ec4899', HorusI18n.t('charts.ascent_rate_chart'),
      (v) => typeof v === 'number' ? v.toFixed(1) + ' m/s' : v);
    extHumidityChart = makeLineChart('extHumidityChart', '#14b8a6', HorusI18n.t('charts.ext_humidity'),
      (v) => typeof v === 'number' ? v.toFixed(1) + ' %' : v);
    extPressureChart = makeLineChart('extPressureChart', '#a855f7', HorusI18n.t('charts.ext_pressure'),
      (v) => typeof v === 'number' ? v.toFixed(1) + ' hPa' : v);
    crcPassChart = makeLineChart('crcPassChart', '#84cc16', 'CRC Pass',
      (v) => v);
    horizSpeedChart = makeLineChart('horizSpeedChart', '#0ea5e9', HorusI18n.t('charts.horiz_speed'),
      (v) => typeof v === 'number' ? v.toFixed(1) + ' km/h' : v);

    customChartContainer = document.getElementById('customChartsContainer');
  }

  /** Prikazi samo pakete unutar odabranog vremenskog raspona (relativnog na NOW). */
  function filterByRange(packets) {
    if (showAll || !packets || packets.length === 0) return packets || [];
    const nowSec = Date.now() / 1000;
    const cutoff = nowSec - timeRangeSeconds;
    return packets.filter(p => (p._rx_time || 0) >= cutoff);
  }

  /** Postavi vremenski raspon u sekundama, ili 'all'. */
  function setTimeRange(seconds) {
    if (seconds === 'all' || seconds === -1) {
      showAll = true;
      timeRangeSeconds = 0;
    } else {
      showAll = false;
      timeRangeSeconds = Math.max(10, Number(seconds) || 300);
    }
    // Re-apply na zadnje pakete
    if (allPackets.length > 0) {
      update(allPackets);
    }
  }

  function getTimeRangeLabel() {
    if (showAll) return HorusI18n.t('charts.time_range_all');
    const s = timeRangeSeconds;
    if (s < 3600) return `${Math.round(s / 60)} min`;
    if (s < 86400) return `${Math.round(s / 3600)} h`;
    return `${Math.round(s / 86400)} d`;
  }

  /** Detektiraj sva custom polja iz paketa i stvori grafove za njih. */
  function ensureCustomCharts(packets) {
    if (!customChartContainer) return;

    // Skupi sva custom polja iz svih paketa
    const allCustomKeys = new Set();
    packets.forEach(p => {
      if (p.custom_fields) {
        Object.keys(p.custom_fields).forEach(k => {
          // Samo numerička polja mogu biti grafirana
          if (typeof p.custom_fields[k] === 'number') allCustomKeys.add(k);
        });
      }
    });

    // Stvori grafove za nova polja
    allCustomKeys.forEach(key => {
      if (customCharts[key]) return; // već postoji
      if (STATIC_CUSTOM_KEYS.has(key)) return; // ima statički panel

      const color = CUSTOM_COLORS[colorIdx % CUSTOM_COLORS.length];
      colorIdx++;

      const label = (typeof HorusAnalytics !== 'undefined' && HorusAnalytics.formatCustomFieldName)
        ? HorusAnalytics.formatCustomFieldName(key)
        : key;

      // Stvori wrapper div
      const wrapper = document.createElement('div');
      wrapper.className = 'bg-slate-900 rounded-xl border border-slate-800 p-4 chart-panel';
      wrapper.id = `customChart_wrapper_${key}`;
      wrapper.dataset.chartId = `custom_${key}`;
      wrapper.innerHTML = `
        <h2 class="font-semibold mb-3 flex items-center gap-2 cursor-pointer chart-panel-header" data-chart-id="custom_${key}">
          <i data-lucide="bar-chart-3" class="w-5 h-5" style="color: ${color}"></i>
          ${label}
          <span class="text-xs font-normal text-cyan-400/50 ml-1">custom</span>
          <button class="ml-auto p-1 rounded hover:bg-slate-700 transition text-slate-400 hover:text-slate-200 chart-toggle-btn" data-chart-id="custom_${key}" title="Minimiziraj/proširi">
            <i data-lucide="chevron-up" class="w-4 h-4 chart-toggle-icon"></i>
          </button>
        </h2>
        <div class="chart-panel-body" data-chart-id="custom_${key}">
          <div class="h-48"><canvas id="customChart_${key}"></canvas></div>
        </div>
      `;
      customChartContainer.appendChild(wrapper);

      // Renderiraj Lucide ikonu
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [wrapper] });

      // Inicijaliziraj Chart
      customCharts[key] = makeLineChart(`customChart_${key}`, color, label,
        (v) => typeof v === 'number' ? (Number.isInteger(v) ? v.toString() : v.toFixed(2)) : v);

      // Restore collapsed stanja ako postoji
      const state = _loadCollapsedState();
      if (state[`custom_${key}`]) _setCollapsed(`custom_${key}`, true);
    });
  }

  function update(packets) {
    // Pamti zadnji set paketa za promjenu range-a
    allPackets = packets || [];
    if (!packets || packets.length === 0) {
      reset();
      return;
    }

    const filtered = filterByRange(packets);

    altitudeChart.data.datasets[0].data = filtered.map(p => ({
      x: p._rx_time * 1000, y: p.altitude,
    }));
    altitudeChart.update('none');

    snrChart.data.datasets[0].data = filtered
      .filter(p => p.snr !== null && p.snr !== undefined)
      .map(p => ({ x: p._rx_time * 1000, y: p.snr }));
    snrChart.update('none');

    batteryChart.data.datasets[0].data = filtered
      .filter(p => p.battery_voltage !== null && p.battery_voltage !== undefined)
      .map(p => ({ x: p._rx_time * 1000, y: p.battery_voltage }));
    batteryChart.update('none');

    temperatureChart.data.datasets[0].data = filtered
      .filter(p => p.temperature !== null && p.temperature !== undefined)
      .map(p => ({ x: p._rx_time * 1000, y: p.temperature }));
    temperatureChart.update('none');

    satellitesChart.data.datasets[0].data = filtered
      .filter(p => p.satellites !== null && p.satellites !== undefined)
      .map(p => ({ x: p._rx_time * 1000, y: p.satellites }));
    satellitesChart.update('none');

    climbRateChart.data.datasets[0].data = filtered
      .filter(p => p.climb_rate !== null && p.climb_rate !== undefined)
      .map(p => ({ x: p._rx_time * 1000, y: p.climb_rate }));
    climbRateChart.update('none');

    // Statički paneli za custom polja
    speedChart.data.datasets[0].data = filtered
      .filter(p => p.custom_fields && p.custom_fields.speed !== undefined && p.custom_fields.speed !== null)
      .map(p => ({ x: p._rx_time * 1000, y: p.custom_fields.speed }));
    speedChart.update('none');

    ascentRateChart.data.datasets[0].data = filtered
      .filter(p => p.custom_fields && p.custom_fields.ascent_rate !== undefined && p.custom_fields.ascent_rate !== null)
      .map(p => ({ x: p._rx_time * 1000, y: p.custom_fields.ascent_rate }));
    ascentRateChart.update('none');

    extHumidityChart.data.datasets[0].data = filtered
      .filter(p => p.custom_fields && p.custom_fields.ext_humidity !== undefined && p.custom_fields.ext_humidity !== null)
      .map(p => ({ x: p._rx_time * 1000, y: p.custom_fields.ext_humidity }));
    extHumidityChart.update('none');

    extPressureChart.data.datasets[0].data = filtered
      .filter(p => p.custom_fields && p.custom_fields.ext_pressure !== undefined && p.custom_fields.ext_pressure !== null)
      .map(p => ({ x: p._rx_time * 1000, y: p.custom_fields.ext_pressure }));
    extPressureChart.update('none');

    crcPassChart.data.datasets[0].data = filtered
      .filter(p => p.custom_fields && p.custom_fields.crc_pass !== undefined && p.custom_fields.crc_pass !== null)
      .map(p => ({ x: p._rx_time * 1000, y: p.custom_fields.crc_pass }));
    crcPassChart.update('none');

    horizSpeedChart.data.datasets[0].data = filtered
      .filter(p => p.horizontal_speed !== null && p.horizontal_speed !== undefined)
      .map(p => ({ x: p._rx_time * 1000, y: p.horizontal_speed }));
    horizSpeedChart.update('none');

    // Dinamički custom field grafovi
    ensureCustomCharts(filtered);
    Object.entries(customCharts).forEach(([key, chart]) => {
      chart.data.datasets[0].data = filtered
        .filter(p => p.custom_fields && p.custom_fields[key] !== undefined && p.custom_fields[key] !== null)
        .map(p => ({ x: p._rx_time * 1000, y: p.custom_fields[key] }));
      chart.update('none');
    });

    // Ažuriraj badge s brojem paketa u trenutnom range-u
    const countEl = document.getElementById('chartRangePacketCount');
    if (countEl) {
      countEl.textContent = HorusI18n.t('charts.packet_count', filtered.length, packets.length);
    }
  }

  // -----------------------------------------------------------------------
  // Panel collapse/expand sustav
  // -----------------------------------------------------------------------
  const COLLAPSE_STORAGE_KEY = 'horus_chart_collapsed';
  const PANEL_COLLAPSE_STORAGE_KEY = 'horus_panel_collapsed';

  function _loadCollapsedState() {
    try {
      const stored = localStorage.getItem(COLLAPSE_STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  }

  function _saveCollapsedState(state) {
    try { localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(state)); } catch {}
  }

  function _loadPanelCollapsedState() {
    try {
      const stored = localStorage.getItem(PANEL_COLLAPSE_STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  }

  function _savePanelCollapsedState(state) {
    try { localStorage.setItem(PANEL_COLLAPSE_STORAGE_KEY, JSON.stringify(state)); } catch {}
  }

  function _setCollapsed(chartId, collapsed) {
    const panel = document.querySelector(`.chart-panel[data-chart-id="${chartId}"]`);
    const body = document.querySelector(`.chart-panel-body[data-chart-id="${chartId}"]`);
    if (!panel || !body) return;

    if (collapsed) {
      panel.classList.add('collapsed');
      body.classList.add('collapsed');
    } else {
      panel.classList.remove('collapsed');
      body.classList.remove('collapsed');
      // Resize Chart.js kad se panel otvori
      setTimeout(() => {
        const canvas = body.querySelector('canvas');
        if (canvas) {
          const chartInstance = Chart.getChart(canvas);
          if (chartInstance) chartInstance.resize();
        }
      }, 350);
    }
  }

  function _setPanelCollapsed(panelId, collapsed) {
    const panel = document.querySelector(`.collapsible-panel[data-panel-id="${panelId}"]`);
    const body = document.querySelector(`.collapsible-panel-body[data-panel-id="${panelId}"]`);
    if (!panel || !body) return;

    if (collapsed) {
      panel.classList.add('collapsed');
      body.classList.add('collapsed');
    } else {
      panel.classList.remove('collapsed');
      body.classList.remove('collapsed');
      // Invalidate Leaflet map size kad se karta otvori
      if (panelId === 'map') {
        setTimeout(() => {
          if (typeof HorusMap !== 'undefined' && HorusMap.invalidateSize) {
            HorusMap.invalidateSize();
          } else {
            // Fallback: potraži Leaflet map instancu
            const mapEl = document.getElementById('map');
            if (mapEl && mapEl._leaflet_id) {
              try { mapEl._leafletMap?.invalidateSize(); } catch {}
            }
          }
        }, 350);
      }
      // Resize spectrum chart
      if (panelId === 'spectrum') {
        setTimeout(() => {
          const canvas = body.querySelector('canvas');
          if (canvas) {
            const chartInstance = Chart.getChart(canvas);
            if (chartInstance) chartInstance.resize();
          }
        }, 350);
      }
      // Resize all flight analysis charts
      if (panelId === 'flight-analysis') {
        setTimeout(() => {
          body.querySelectorAll('canvas').forEach(canvas => {
            const chartInstance = Chart.getChart(canvas);
            if (chartInstance) chartInstance.resize();
          });
        }, 350);
      }
    }
  }

  function togglePanel(chartId) {
    const state = _loadCollapsedState();
    const isNowCollapsed = !state[chartId];
    state[chartId] = isNowCollapsed;
    _saveCollapsedState(state);
    _setCollapsed(chartId, isNowCollapsed);
  }

  function toggleCollapsiblePanel(panelId) {
    const state = _loadPanelCollapsedState();
    const isNowCollapsed = !state[panelId];
    state[panelId] = isNowCollapsed;
    _savePanelCollapsedState(state);
    _setPanelCollapsed(panelId, isNowCollapsed);
  }

  function collapseAll() {
    const chartState = _loadCollapsedState();
    document.querySelectorAll('.chart-panel[data-chart-id]').forEach(panel => {
      const id = panel.dataset.chartId;
      chartState[id] = true;
      _setCollapsed(id, true);
    });
    _saveCollapsedState(chartState);
  }

  function expandAll() {
    const chartState = _loadCollapsedState();
    document.querySelectorAll('.chart-panel[data-chart-id]').forEach(panel => {
      const id = panel.dataset.chartId;
      chartState[id] = false;
      _setCollapsed(id, false);
    });
    _saveCollapsedState(chartState);
  }

  function _restoreCollapsedState() {
    const chartState = _loadCollapsedState();
    Object.entries(chartState).forEach(([id, collapsed]) => {
      if (collapsed) _setCollapsed(id, true);
    });

    const panelState = _loadPanelCollapsedState();
    Object.entries(panelState).forEach(([id, collapsed]) => {
      if (collapsed) _setPanelCollapsed(id, true);
    });
  }

  let _collapseHandlersInitialized = false;

  function _initCollapseHandlers() {
    if (_collapseHandlersInitialized) return;
    _collapseHandlersInitialized = true;

    // Klik na chart panel header ili toggle gumb
    document.addEventListener('click', (e) => {
      // Chart paneli (grafovi)
      const chartBtn = e.target.closest('.chart-toggle-btn');
      const chartHeader = e.target.closest('.chart-panel-header');
      if (chartBtn) {
        e.stopPropagation();
        togglePanel(chartBtn.dataset.chartId);
        return;
      }
      if (chartHeader && !e.target.closest('button') && !e.target.closest('select') && !e.target.closest('input') && !e.target.closest('label')) {
        togglePanel(chartHeader.dataset.chartId);
        return;
      }

      // Collapsible paneli (karta, spektar, konzola, telemetrija, KPI)
      const panelBtn = e.target.closest('.collapsible-toggle-btn');
      const panelHeader = e.target.closest('.collapsible-panel-header');
      if (panelBtn) {
        e.stopPropagation();
        toggleCollapsiblePanel(panelBtn.dataset.panelId);
        return;
      }
      if (panelHeader && !e.target.closest('button') && !e.target.closest('select') && !e.target.closest('input') && !e.target.closest('label')) {
        toggleCollapsiblePanel(panelHeader.dataset.panelId);
        return;
      }
    });

    // Restore stanja iz localStorage
    _restoreCollapsedState();
  }

  function reset() {
    allPackets = [];
    [altitudeChart, snrChart, batteryChart, temperatureChart, satellitesChart, climbRateChart,
     speedChart, ascentRateChart, extHumidityChart, extPressureChart, crcPassChart, horizSpeedChart]
      .forEach(c => {
        if (c) {
          c.data.datasets[0].data = [];
          c.update();
        }
      });

    // Uništi custom grafove
    Object.values(customCharts).forEach(c => c.destroy());
    Object.keys(customCharts).forEach(k => delete customCharts[k]);
    if (customChartContainer) customChartContainer.innerHTML = '';
    colorIdx = 0;

    const countEl = document.getElementById('chartRangePacketCount');
    if (countEl) countEl.textContent = HorusI18n.t('charts.no_packets');
  }

  function updateTheme(theme) {
    const isLight = theme === 'light';
    const newGridColor = isLight ? 'rgba(100, 116, 139, 0.2)' : 'rgba(148, 163, 184, 0.15)';
    const newTickColor = isLight ? '#475569' : '#94a3b8';
    const tooltipBg    = isLight ? '#ffffff' : '#1e293b';
    const tooltipBorder = isLight ? '#cbd5e1' : '#334155';

    Chart.defaults.color = newTickColor;
    Chart.defaults.borderColor = newGridColor;

    const allCharts = [altitudeChart, snrChart, batteryChart, temperatureChart, satellitesChart, climbRateChart,
      speedChart, ascentRateChart, extHumidityChart, extPressureChart, crcPassChart, horizSpeedChart,
      ...Object.values(customCharts)];
    for (const chart of allCharts) {
      if (!chart) continue;
      chart.options.scales.x.grid.color = newGridColor;
      chart.options.scales.x.ticks.color = newTickColor;
      chart.options.scales.y.grid.color = newGridColor;
      chart.options.scales.y.ticks.color = newTickColor;
      chart.options.plugins.tooltip.backgroundColor = tooltipBg;
      chart.options.plugins.tooltip.borderColor = tooltipBorder;
      chart.update('none');
    }
  }

  return { init, update, reset, setTimeRange, getTimeRangeLabel, initCollapseHandlers: _initCollapseHandlers, togglePanel, collapseAll, expandAll, updateTheme };
})();
