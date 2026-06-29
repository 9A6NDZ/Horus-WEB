// ----------------------------------------------------------------------------
// analytics.js  -  Formatiranje i UI ažuriranje KPI kartica/telemetrije
// ----------------------------------------------------------------------------

const HorusAnalytics = (() => {

  // Phase labels are fetched dynamically via i18n
  function getPhaseLabel(phase) {
    const key = {
      pre_launch: 'analytics.pre_launch',
      ascent: 'analytics.ascent',
      burst: 'analytics.burst',
      descent: 'analytics.descent',
      landed: 'analytics.landed',
    }[phase];
    return key ? HorusI18n.t(key) : (phase || '—');
  }

  // Ljepša imena za poznate custom fieldove - dynamic
  function getCustomFieldLabel(field) {
    const map = {
      'ext_temperature': () => HorusI18n.t('analytics.ext_temp'),
      'ext_humidity': () => HorusI18n.t('analytics.ext_humidity'),
      'ext_pressure': () => HorusI18n.t('analytics.ext_pressure'),
      'int_temperature': () => HorusI18n.t('analytics.int_temp'),
      'analog1': 'Analog 1',
      'analog2': 'Analog 2',
      'analog3': 'Analog 3',
      'analog4': 'Analog 4',
      'modulation': () => HorusI18n.t('analytics.modulation'),
      'modulation_detail': () => HorusI18n.t('analytics.modulation'),
      'speed': () => HorusI18n.t('analytics.speed'),
      'ascent_rate': () => HorusI18n.t('analytics.ascent_rate'),
      'climb_rate': () => HorusI18n.t('analytics.climb_rate'),
      'raw': 'Raw',
      'raw_hex': 'Raw',
      'crc_pass': 'CRC Pass',
    };
    const v = map[field];
    if (typeof v === 'function') return v();
    return v || field;
  }

  // Keep CUSTOM_FIELD_LABELS for backward compat references — now dynamic via getter
  const CUSTOM_FIELD_LABELS = {
    get 'ext_temperature'() { return HorusI18n.t('analytics.ext_temp'); },
    get 'ext_humidity'() { return HorusI18n.t('analytics.ext_humidity'); },
    get 'ext_pressure'() { return HorusI18n.t('analytics.ext_pressure'); },
    get 'int_temperature'() { return HorusI18n.t('analytics.int_temp'); },
    'analog1': 'Analog 1',
    'analog2': 'Analog 2',
    'analog3': 'Analog 3',
    'analog4': 'Analog 4',
    get 'modulation'() { return HorusI18n.t('analytics.modulation'); },
    get 'modulation_detail'() { return HorusI18n.t('analytics.modulation'); },
    get 'speed'() { return HorusI18n.t('analytics.speed'); },
    get 'ascent_rate'() { return HorusI18n.t('analytics.ascent_rate'); },
    get 'climb_rate'() { return HorusI18n.t('analytics.climb_rate'); },
    'raw': 'Raw',
    'raw_hex': 'Raw',
    'crc_pass': 'CRC Pass',
  };

  // Polja koja se prikazuju preko cijelog reda (npr. dugački hex stringovi)
  const FULL_WIDTH_FIELDS = new Set(['raw', 'raw_hex', 'raw_sentence']);

  const CUSTOM_FIELD_UNITS = {
    'ext_temperature': '°C',
    'int_temperature': '°C',
    'ext_humidity': '%',
    'ext_pressure': 'hPa',
  };

  function formatCustomFieldName(key) {
    if (getCustomFieldLabel(key) !== key) return getCustomFieldLabel(key);
    // Pretvori snake_case u Human Readable
    return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function formatCustomFieldValue(key, val) {
    if (val === null || val === undefined) return '—';
    const unit = CUSTOM_FIELD_UNITS[key] || '';
    if (typeof val === 'number') {
      return Number.isInteger(val) ? `${val}${unit ? ' ' + unit : ''}` : `${val.toFixed(2)}${unit ? ' ' + unit : ''}`;
    }
    if (typeof val === 'object') {
      // Horus v3 extra_sensors i sl.: prazni objekt/array → prazno, inače serijaliziraj
      if (Array.isArray(val)) {
        return val.length === 0 ? '—' : val.join(', ');
      }
      const entries = Object.entries(val).filter(([, v]) => v !== null && v !== undefined);
      if (entries.length === 0) return '—';
      return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
    }
    return `${val}${unit ? ' ' + unit : ''}`;
  }

  function updateKPI(flight) {
    const packets = flight.packets || [];
    const nogps = flight.last_nogps_packet || null;

    // Ako nema niti validnih paketa niti no-GPS paketa, nema što prikazati
    if (packets.length === 0 && !nogps) return;

    // "last" je zadnji paket čije podatke prikazujemo u telemetry gridu.
    // Ako postoji aktivan no-GPS paket (sonda živa ali nema fix), koristimo
    // njegove non-GPS podatke (SNR, batt, temp, time) ali lat/lon/alt
    // prikazujemo sa zadnjeg validnog paketa (ako postoji).
    let last;
    if (nogps) {
      last = Object.assign({}, nogps);
      // Zamijeni lat/lon/alt sa zadnjom poznatom pozicijom
      if (nogps._last_known_lat !== undefined) {
        last.latitude = nogps._last_known_lat;
        last.longitude = nogps._last_known_lon;
        last.altitude = nogps._last_known_alt;
        last._position_stale = true;  // frontend zna da je pozicija stara
      } else if (packets.length > 0) {
        const lastValid = packets[packets.length - 1];
        last.latitude = lastValid.latitude;
        last.longitude = lastValid.longitude;
        last.altitude = lastValid.altitude;
        last._position_stale = true;
      }
    } else {
      last = packets[packets.length - 1];
    }

    // Visina
    const alt = last.altitude ?? 0;
    document.getElementById('kpiAltitude').textContent = `${alt.toFixed(0)} m`;
    document.getElementById('kpiMaxAltitude').textContent = HorusI18n.t('analytics.max_alt', (flight.max_altitude || 0).toFixed(0));

    // Climb rate
    const climb = last.climb_rate;
    const climbEl = document.getElementById('kpiClimb');
    if (climb !== null && climb !== undefined) {
      climbEl.textContent = `${climb > 0 ? '+' : ''}${climb.toFixed(1)}`;
      climbEl.className = climb > 0
        ? 'text-2xl font-bold text-emerald-400'
        : climb < -2
          ? 'text-2xl font-bold text-amber-400'
          : 'text-2xl font-bold';
    } else {
      climbEl.textContent = '---';
    }

    // Range
    if (last.from_station) {
      document.getElementById('kpiRange').textContent = `${last.from_station.range_km.toFixed(1)} km`;
      document.getElementById('kpiBearing').textContent = HorusI18n.t('analytics.bearing_elev', last.from_station.bearing.toFixed(0), last.from_station.elevation.toFixed(1));
    } else {
      document.getElementById('kpiRange').textContent = '---';
      document.getElementById('kpiBearing').textContent = HorusI18n.t('analytics.set_station');
    }

    // SNR — koristi stats ako postoji, inače iz zadnjeg paketa (uključujući no-GPS)
    const stats = flight.stats || {};
    const snrDisplay = stats.snr_current !== null && stats.snr_current !== undefined
      ? stats.snr_current
      : (last.snr !== undefined && last.snr !== null ? last.snr : null);
    document.getElementById('kpiSnr').textContent = snrDisplay !== null ? `${snrDisplay.toFixed(1)} dB` : '---';
    document.getElementById('kpiSnrAvg').textContent = stats.snr_avg !== null && stats.snr_avg !== undefined ? `avg ${stats.snr_avg.toFixed(1)} dB` : '---';

    // Faza
    const phaseEl = document.getElementById('flightPhase');
    const phase = flight.phase || last.phase || 'pre_launch';
    phaseEl.textContent = getPhaseLabel(phase);
    phaseEl.className = `px-3 py-1 rounded-full text-sm font-semibold phase-${phase}`;

    // Stats
    document.getElementById('packetCount').textContent = packets.length;
    document.getElementById('successRate').textContent =
      stats.success_rate !== null && stats.success_rate !== undefined ? stats.success_rate.toFixed(1) : '---';

    // Last packet age
    updatePacketAge(last._rx_time);

    // Telemetrija grid
    updateTelemetryGrid(last);
  }

  function updatePacketAge(rxTime) {
    if (!rxTime) return;
    const ageSec = (Date.now() / 1000) - rxTime;
    const el = document.getElementById('lastPacketAge');
    if (ageSec < 5)       el.textContent = HorusI18n.t('analytics.just_now');
    else if (ageSec < 60) el.textContent = HorusI18n.t('analytics.seconds_ago', ageSec.toFixed(0));
    else                  el.textContent = HorusI18n.t('analytics.minutes_ago', (ageSec / 60).toFixed(1));

    // Upozorenje ako je paket stariji od 60s
    el.className = ageSec > 60 ? 'text-amber-400' : 'text-slate-500';
  }

  function updateTelemetryGrid(p) {
    const set = (id, val) => document.getElementById(id).textContent = val ?? '—';

    set('tCallsign', p.callsign);
    set('tTime', p.time);

    // Lat/lon: ako je no_gps_fix, prikaži zadnju poznatu poziciju s oznakom
    if (p.no_gps_fix) {
      if (p._position_stale) {
        set('tLat', `${p.latitude?.toFixed(5)} ⚠`);
        set('tLon', `${p.longitude?.toFixed(5)} ⚠`);
      } else {
        set('tLat', HorusI18n.t('analytics.no_gps_fix'));
        set('tLon', HorusI18n.t('analytics.no_gps_fix'));
      }
    } else {
      set('tLat', p.latitude?.toFixed(5));
      set('tLon', p.longitude?.toFixed(5));
    }

    set('tSats', p.satellites);
    set('tBatt', p.battery_voltage !== undefined ? `${p.battery_voltage.toFixed(2)} V` : '—');
    set('tTemp', p.temperature !== undefined ? `${p.temperature.toFixed(1)} °C` : '—');
    set('tBearing', p.from_station ? `${p.from_station.bearing.toFixed(1)}°` : '—');
    set('tElev', p.from_station ? `${p.from_station.elevation.toFixed(1)}°` : '—');
    set('tSpeed', p.horizontal_speed !== null && p.horizontal_speed !== undefined ? `${p.horizontal_speed.toFixed(1)} m/s` : '—');
    set('tCourse', p.course !== null && p.course !== undefined ? `${p.course.toFixed(0)}°` : '—');
    set('tSnr', p.snr !== undefined ? `${p.snr.toFixed(1)} dB` : '—');

    // Header badge i vrijeme
    const badge = document.getElementById('tCallsignBadge');
    if (badge) badge.textContent = p.callsign || '—';
    const timeHeader = document.getElementById('tTimeHeader');
    if (timeHeader) timeHeader.textContent = p.time || '—';

    // SondeHub Amateur direktan link na ovu sondu
    const shLink = document.getElementById('tSondehubLink');
    if (shLink) {
      if (p.callsign) {
        const cs = encodeURIComponent(p.callsign);
        shLink.href = `https://amateur.sondehub.org/${cs}`;
        shLink.classList.remove('hidden');
      } else {
        shLink.classList.add('hidden');
      }
    }

    // Dinamički custom fields
    updateCustomFieldsGrid(p.custom_fields || {});
  }

  function updateCustomFieldsGrid(customFields) {
    const container = document.getElementById('customFieldsGrid');
    if (!container) return;

    // Izbaci prazna polja (npr. Horus v3 extra_sensors = {} kad nema senzora)
    const isEmptyValue = (v) =>
      v === null || v === undefined ||
      (Array.isArray(v) && v.length === 0) ||
      (typeof v === 'object' && !Array.isArray(v) &&
        Object.values(v).every(x => x === null || x === undefined));

    const filtered = {};
    Object.keys(customFields).forEach(k => {
      if (!isEmptyValue(customFields[k])) filtered[k] = customFields[k];
    });
    customFields = filtered;

    const keys = Object.keys(customFields);
    if (keys.length === 0) {
      container.innerHTML = '';
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');

    // Regeneriraj samo ako se polja promijenila
    const existingKeys = Array.from(container.querySelectorAll('[data-cf-key]')).map(el => el.dataset.cfKey);
    const needsRebuild = keys.length !== existingKeys.length || keys.some(k => !existingKeys.includes(k));

    if (needsRebuild) {
      // Sortiraj: full-width polja (raw) prvo, ostala iza
      const sortedKeys = [...keys].sort((a, b) => {
        const aFull = FULL_WIDTH_FIELDS.has(a) ? 0 : 1;
        const bFull = FULL_WIDTH_FIELDS.has(b) ? 0 : 1;
        return aFull - bFull;
      });
      container.innerHTML = sortedKeys.map(key => {
        if (FULL_WIDTH_FIELDS.has(key)) {
          return `
            <div data-cf-key="${key}" class="col-span-full">
              <div class="text-xs text-cyan-400/70">${formatCustomFieldName(key)}</div>
              <div class="font-mono font-semibold text-xs break-all select-all leading-relaxed" id="cf_${key}">—</div>
            </div>`;
        }
        return `
          <div data-cf-key="${key}">
            <div class="text-xs text-cyan-400/70">${formatCustomFieldName(key)}</div>
            <div class="font-mono font-semibold" id="cf_${key}">—</div>
          </div>`;
      }).join('');
    }

    // Ažuriraj vrijednosti
    keys.forEach(key => {
      const el = document.getElementById(`cf_${key}`);
      if (el) el.textContent = formatCustomFieldValue(key, customFields[key]);
    });
  }

  // -----------------------------------------------------------------------
  // Alert toast sustav
  // -----------------------------------------------------------------------
  let alertContainer = null;
  let alertSoundEnabled = true;
  let alertAudioCtx = null;

  function initAlerts() {
    // Toast container — scrollable da se notifikacije ne pregaze ekran
    if (!alertContainer) {
      alertContainer = document.createElement('div');
      alertContainer.id = 'alertToastContainer';
      alertContainer.className = 'fixed top-16 right-4 z-[10100] space-y-2 max-w-sm max-h-[calc(100vh-5rem)] overflow-y-auto scrollbar-thin';
      document.body.appendChild(alertContainer);
    }
  }

  function showAlert(alert) {
    initAlerts();

    // Resolve i18n keys from backend (title_key/message_key) or use direct title/message
    const title = alert.title_key
      ? HorusI18n.t(alert.title_key, ...(alert.message_args || []))
      : (alert.title || '');
    const message = alert.message_key
      ? HorusI18n.t(alert.message_key, ...(alert.message_args || []))
      : (alert.message || '');

    const colors = {
      critical: 'bg-red-900/95 border-red-500 text-red-100',
      warning: 'bg-amber-900/95 border-amber-500 text-amber-100',
      info: 'bg-blue-900/95 border-blue-500 text-blue-100',
    };
    const colorCls = colors[alert.level] || colors.warning;

    // Vrijeme alerte
    const now = new Date();
    const timeStr = now.toLocaleTimeString(HorusI18n.getLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const toast = document.createElement('div');
    toast.className = `${colorCls} border rounded-xl p-4 shadow-2xl backdrop-blur-sm animate-slide-in flex items-start gap-3 transition-opacity`;
    toast.innerHTML = `
      <div class="flex-shrink-0 mt-0.5">
        <i data-lucide="${alert.icon || 'alert-triangle'}" class="w-5 h-5"></i>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between gap-2">
          <div class="font-bold text-sm">${title}</div>
          <div class="text-[10px] opacity-60 font-mono whitespace-nowrap">${timeStr}</div>
        </div>
        <div class="text-xs opacity-80 mt-0.5">${message}</div>
      </div>
      <button class="flex-shrink-0 ml-1 mt-0.5 opacity-60 hover:opacity-100 transition-opacity" title="${HorusI18n.t('analytics.close_alert')}">
        <i data-lucide="x" class="w-4 h-4"></i>
      </button>
    `;

    // X button za dismiss
    const closeBtn = toast.querySelector('button');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toast.style.opacity = '0';
      setTimeout(() => {
        toast.remove();
        _updateClearAllButton();
      }, 300);
    });

    // Dodaj na vrh (najnovija notifikacija uvijek prva)
    const clearAllBtn = alertContainer.querySelector('#alertClearAllBtn');
    if (clearAllBtn) {
      clearAllBtn.insertAdjacentElement('afterend', toast);
    } else {
      alertContainer.prepend(toast);
    }

    // Pokaži/ažuriraj "Clear all" gumb ako ima 2+ notifikacije
    _updateClearAllButton();

    // Renderiraj Lucide ikone unutar toast elementa
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [toast] });

    // NEMA auto-remove — notifikacija ostaje dok korisnik ne klikne X

    // Zvučni signal
    playAlertSound(alert.level);
  }

  function _updateClearAllButton() {
    if (!alertContainer) return;
    const existing = alertContainer.querySelector('#alertClearAllBtn');
    // Broji samo toast elemente (ne "Clear all" gumb)
    const toastCount = alertContainer.querySelectorAll(':scope > div:not(#alertClearAllBtn)').length;

    if (toastCount >= 2 && !existing) {
      const btn = document.createElement('div');
      btn.id = 'alertClearAllBtn';
      btn.className = 'flex justify-end';
      btn.innerHTML = `
        <button class="bg-slate-800/90 border border-slate-600 text-slate-300 hover:text-white hover:border-slate-400 rounded-lg px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-all shadow-lg backdrop-blur-sm">
          <i data-lucide="x-circle" class="w-3.5 h-3.5"></i>
          ${HorusI18n.t('analytics.clear_all_alerts')}
        </button>
      `;
      btn.querySelector('button').addEventListener('click', clearAllAlerts);
      alertContainer.prepend(btn);
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
    } else if (toastCount < 2 && existing) {
      existing.remove();
    }
  }

  function clearAllAlerts() {
    if (!alertContainer) return;
    const toasts = alertContainer.querySelectorAll(':scope > div:not(#alertClearAllBtn)');
    toasts.forEach(t => {
      t.style.opacity = '0';
    });
    setTimeout(() => {
      toasts.forEach(t => t.remove());
      const clearBtn = alertContainer.querySelector('#alertClearAllBtn');
      if (clearBtn) clearBtn.remove();
    }, 300);
  }

  function playAlertSound(level) {
    if (!alertSoundEnabled) return;
    try {
      if (!alertAudioCtx) alertAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = alertAudioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.value = 0.15;

      if (level === 'critical') {
        osc.frequency.value = 880;
        osc.type = 'square';
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      } else {
        osc.frequency.value = 660;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      }
    } catch (e) {
      // Audio neuspješan - tihi fail
    }
  }

  function setAlertSoundEnabled(enabled) {
    alertSoundEnabled = enabled;
  }

  // Interval za ažuriranje "last packet age"
  function startAgeUpdater(getLastRxTime) {
    setInterval(() => {
      const t = getLastRxTime();
      if (t) updatePacketAge(t);
    }, 1000);
  }

  return {
    updateKPI,
    updateTelemetryGrid,
    startAgeUpdater,
    showAlert,
    clearAllAlerts,
    setAlertSoundEnabled,
    formatCustomFieldName,
  };
})();
