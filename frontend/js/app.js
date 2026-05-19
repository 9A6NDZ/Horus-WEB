// ----------------------------------------------------------------------------
// app.js  -  Glavna aplikacija
// ----------------------------------------------------------------------------

const App = (() => {
  let ws = null;
  let wsReconnectTimer = null;
  let lastPacket = null;
  let allFlightsData = { flights: {}, callsigns: [] };
  let selectedCallsign = null;
  let knownCallsigns = new Set();

  let savedDecoderConfig = null;

  async function init() {
    HorusI18n.init();
    initTheme();
    HorusMap.init();
    HorusCharts.init();
    HorusSpectrum.init();
    HorusAnalytics.startAgeUpdater(() => lastPacket?._rx_time);

    // Inicijaliziraj collapse/expand sustav za sve panele
    HorusCharts.initCollapseHandlers();

    bindEvents();

    await loadDecoderConfig();
    await loadAudioDevices();
    await loadOutputDevices();
    await loadModems();
    applyDecoderConfigToUI();

    await loadStation();
    await loadWeatherConfig();
    await loadLogFiles();
    await syncDecoderStatus();
    connectWebSocket();
  }

  async function loadDecoderConfig() {
    try {
      const r = await fetch('/api/decoder/config');
      if (!r.ok) return;
      savedDecoderConfig = await r.json();
    } catch (e) {
      log('ERROR', `Load decoder config: ${e.message}`);
    }
  }

  function applyDecoderConfigToUI() {
    if (!savedDecoderConfig || Object.keys(savedDecoderConfig).length === 0) return;
    const cfg = savedDecoderConfig;

    const audioSel = document.getElementById('audioDevice');
    const hint = document.getElementById('audioDeviceHint');
    let matched = false;

    if (audioSel && cfg.audio_device_name) {
      for (const opt of audioSel.options) {
        if (opt.textContent === cfg.audio_device_name) {
          opt.selected = true;
          matched = true;
          break;
        }
      }

      if (!matched && cfg.audio_device_index !== null && cfg.audio_device_index !== undefined) {
        for (const opt of audioSel.options) {
          if (parseInt(opt.value, 10) === cfg.audio_device_index) {
            if (cfg.use_udp && opt.dataset.udp !== '1') continue;
            if (!cfg.use_udp && opt.dataset.udp === '1') continue;
            opt.selected = true;
            matched = true;
            break;
          }
        }
      }

      if (hint) {
        if (matched) {
          hint.textContent = `✓ ${HorusI18n.t('app.last_device_used')} ${cfg.audio_device_name}`;
          hint.className = 'text-xs text-emerald-400 mt-1';
          hint.classList.remove('hidden');
        } else if (cfg.audio_device_name) {
          hint.textContent = `⚠ ${HorusI18n.t('app.last_device_missing')} "${cfg.audio_device_name}"`;
          hint.className = 'text-xs text-amber-400 mt-1';
          hint.classList.remove('hidden');
        }
      }
    }

    if (cfg.sample_rate) {
      const srSel = document.getElementById('sampleRate');
      if (srSel) {
        for (const opt of srSel.options) {
          if (parseInt(opt.value, 10) === cfg.sample_rate) { opt.selected = true; break; }
        }
      }
    }

    if (cfg.modem) {
      const modSel = document.getElementById('modemSelect');
      if (modSel) {
        for (const opt of modSel.options) {
          if (opt.value === cfg.modem) { opt.selected = true; onModemChange(); break; }
        }
      }
    }

    if (cfg.baud_rate) {
      const baudSel = document.getElementById('baudRate');
      if (baudSel) {
        for (const opt of baudSel.options) {
          if (parseInt(opt.value, 10) === cfg.baud_rate) { opt.selected = true; break; }
        }
      }
    }

    // Audio Monitor — restauriraj odabrani output uređaj i stanje
    applyMonitorConfigToUI(cfg);
  }

  function applyMonitorConfigToUI(cfg) {
    if (!cfg) return;

    const cb = document.getElementById('audioMonitorEnabled');
    const fields = document.getElementById('audioMonitorFields');
    const sel = document.getElementById('audioOutputDevice');
    const hint = document.getElementById('audioMonitorHint');

    if (!cb || !sel) return;

    // Odaberi zapamćeni output uređaj (po imenu, pa fallback na index)
    let matched = false;
    if (cfg.monitor_device_name) {
      for (const opt of sel.options) {
        if (opt.textContent === cfg.monitor_device_name) {
          opt.selected = true;
          matched = true;
          break;
        }
      }
    }
    if (!matched && cfg.monitor_device_index !== null && cfg.monitor_device_index !== undefined) {
      for (const opt of sel.options) {
        if (parseInt(opt.value, 10) === cfg.monitor_device_index) {
          opt.selected = true;
          matched = true;
          break;
        }
      }
    }

    // Ako je monitor bio upaljen, pokaži polja (ali ne pokreći automatski —
    // korisnik mora kliknuti toggle jer audio output zahtijeva interakciju)
    if (cfg.monitor_enabled && matched) {
      if (fields) fields.classList.remove('hidden');
      if (sel) sel.disabled = false;
      if (hint) {
        hint.textContent = `✓ ${HorusI18n.t('app.last_device_used')} ${cfg.monitor_device_name || ''}`;
        hint.className = 'text-xs text-slate-400 mt-1';
        hint.classList.remove('hidden');
      }
    } else if (matched && cfg.monitor_device_name) {
      // Uređaj zapamćen ali monitor nije bio aktivan — samo pokaži hint
      if (hint) {
        hint.textContent = `✓ ${HorusI18n.t('app.last_device_used')} ${cfg.monitor_device_name}`;
        hint.className = 'text-xs text-slate-500 mt-1';
        hint.classList.remove('hidden');
      }
    }
  }

  async function loadStation() {
    try {
      const r = await fetch('/api/station');
      if (!r.ok) return;
      const s = await r.json();
      if (!s || Object.keys(s).length === 0) return;
      document.getElementById('stationCallsign').value = s.callsign || '';
      document.getElementById('stationLat').value = s.latitude || '';
      document.getElementById('stationLon').value = s.longitude || '';
      const altEl = document.getElementById('stationAltitude');
      if (altEl && s.altitude) altEl.value = s.altitude;
      const radioEl = document.getElementById('stationRadio');
      if (radioEl) radioEl.value = s.radio || '';
      const antennaEl = document.getElementById('stationAntenna');
      if (antennaEl) antennaEl.value = s.antenna || '';
      const dialEl = document.getElementById('stationDialFreq');
      if (dialEl && s.dial_freq_mhz) dialEl.value = s.dial_freq_mhz;
      const shubEl = document.getElementById('sondehubEnabled');
      if (shubEl) shubEl.checked = !!s.sondehub_enabled;

      const blocklistEl = document.getElementById('sondehubBlocklist');
      if (blocklistEl && Array.isArray(s.sondehub_blocklist)) {
        blocklistEl.value = s.sondehub_blocklist.join(', ');
        updateBlocklistStatus(s.sondehub_blocklist);
      }

      // Private server config
      const pvtEnabled = document.getElementById('privateServerEnabled');
      if (pvtEnabled) pvtEnabled.checked = !!s.private_server_enabled;
      const pvtHost = document.getElementById('privateServerHost');
      if (pvtHost) pvtHost.value = s.private_server_host || '';
      const pvtPort = document.getElementById('privateServerPort');
      if (pvtPort && s.private_server_port) pvtPort.value = s.private_server_port;
      const pvtProto = document.getElementById('privateServerProtocol');
      if (pvtProto && s.private_server_protocol) pvtProto.value = s.private_server_protocol;
      const pvtFmt = document.getElementById('privateServerFormat');
      if (pvtFmt && s.private_server_format) pvtFmt.value = s.private_server_format;
      // Show/hide fields
      const pvtFields = document.getElementById('privateServerFields');
      if (pvtFields) pvtFields.classList.toggle('hidden', !s.private_server_enabled);

      if (s.latitude && s.longitude) {
        HorusMap.updateStation({
          callsign: s.callsign,
          latitude: s.latitude,
          longitude: s.longitude,
          altitude: s.altitude || 0,
        });
      }
    } catch (e) {
      log('ERROR', `Load station failed: ${e.message}`);
    }
  }

  async function syncDecoderStatus() {
    try {
      const r = await fetch('/api/status');
      if (!r.ok) return;
      const s = await r.json();
      if (s.running) {
        setRunning(true);
        log('INFO', HorusI18n.t('app.decoder_running'));
      }
    } catch (e) {
      log('ERROR', `Status sync failed: ${e.message}`);
    }
  }

  // ====================================================================
  // THEME SWITCHER (dark / light)
  // ====================================================================
  function initTheme() {
    const saved = localStorage.getItem('horus-theme') || 'dark';
    applyTheme(saved);
  }

  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('horus-theme', theme);

    const iconLight = document.querySelector('.theme-icon-light');
    const iconDark  = document.querySelector('.theme-icon-dark');
    if (iconLight && iconDark) {
      if (theme === 'light') {
        iconLight.classList.remove('hidden');
        iconDark.classList.add('hidden');
      } else {
        iconLight.classList.add('hidden');
        iconDark.classList.remove('hidden');
      }
    }

    // Ažuriraj Chart.js boje ako postoje grafovi
    if (typeof HorusCharts !== 'undefined' && HorusCharts.updateTheme) {
      HorusCharts.updateTheme(theme);
    }
  }

  function toggleTheme() {
    const current = document.body.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  function bindEvents() {
    // Theme toggle
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

    document.getElementById('startStopBtn').addEventListener('click', toggleDecoder);
    document.getElementById('saveStationBtn').addEventListener('click', saveStation);
    document.getElementById('uploadStationBtn').addEventListener('click', uploadStation);
    document.getElementById('downloadCsvBtn').addEventListener('click', downloadCSV);
    document.getElementById('refreshLogsBtn').addEventListener('click', loadLogFiles);
    document.getElementById('loadLogBtn').addEventListener('click', loadLogFile);
    document.getElementById('resetFlightBtn').addEventListener('click', resetFlight);
    document.getElementById('clearConsoleBtn').addEventListener('click', () => {
      document.getElementById('console').innerHTML = '';
    });
    document.getElementById('modemSelect').addEventListener('change', onModemChange);

    // Audio Monitor toggle
    const monitorCb = document.getElementById('audioMonitorEnabled');
    if (monitorCb) {
      monitorCb.addEventListener('change', toggleAudioMonitor);
    }

    const csSelect = document.getElementById('callsignSelect');
    if (csSelect) csSelect.addEventListener('change', onCallsignSelectChange);

    const timeRangeSel = document.getElementById('chartTimeRange');
    if (timeRangeSel) {
      timeRangeSel.addEventListener('change', () => {
        const val = timeRangeSel.value;
        const sec = val === 'all' ? 'all' : parseInt(val, 10);
        HorusCharts.setTimeRange(sec);
        log('INFO', HorusI18n.t('app.chart_time_range', timeRangeSel.options[timeRangeSel.selectedIndex].text));
      });
      HorusCharts.setTimeRange(parseInt(timeRangeSel.value, 10));
    }

    // Weather
    const saveWeatherBtn = document.getElementById('saveWeatherBtn');
    if (saveWeatherBtn) saveWeatherBtn.addEventListener('click', saveWeatherConfig);

    const deleteWeatherKeyBtn = document.getElementById('deleteWeatherKeyBtn');
    if (deleteWeatherKeyBtn) deleteWeatherKeyBtn.addEventListener('click', deleteWeatherKey);

    const weatherSelect = document.getElementById('weatherLayerSelect');
    if (weatherSelect) weatherSelect.addEventListener('change', onWeatherLayerChange);

    const opacitySlider = document.getElementById('weatherOpacitySlider');
    if (opacitySlider) opacitySlider.addEventListener('input', onOpacityChange);

    const horizonCb = document.getElementById('showHorizonRings');
    if (horizonCb) horizonCb.addEventListener('change', onHorizonRingsToggle);

    const metarCb = document.getElementById('showMetarStations');
    if (metarCb) metarCb.addEventListener('change', onMetarToggle);

    // ABOUT MODAL
    const aboutBtn = document.getElementById('aboutBtn');
    if (aboutBtn) aboutBtn.addEventListener('click', openAboutModal);

    const closeAboutBtn = document.getElementById('closeAboutBtn');
    if (closeAboutBtn) closeAboutBtn.addEventListener('click', closeAboutModal);

    const closeAboutFooterBtn = document.getElementById('closeAboutFooterBtn');
    if (closeAboutFooterBtn) closeAboutFooterBtn.addEventListener('click', closeAboutModal);

    const aboutModal = document.getElementById('aboutModal');
    if (aboutModal) {
      aboutModal.addEventListener('click', (e) => {
        if (e.target === aboutModal) closeAboutModal();
      });
    }

    // SETTINGS MODAL
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) settingsBtn.addEventListener('click', openSettingsModal);

    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettingsModal);

    const closeSettingsFooterBtn = document.getElementById('closeSettingsFooterBtn');
    if (closeSettingsFooterBtn) closeSettingsFooterBtn.addEventListener('click', closeSettingsModal);

    // LANGUAGE SELECTOR
    const langSelect = document.getElementById('settingsLanguageSelect');
    if (langSelect) {
      langSelect.value = HorusI18n.getLang();
      langSelect.addEventListener('change', () => {
        HorusI18n.setLanguage(langSelect.value);
        lucide.createIcons();
      });
    }

    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) {
      settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) closeSettingsModal();
      });
    }

    const saveServerConfigBtn = document.getElementById('saveServerConfigBtn');
    if (saveServerConfigBtn) saveServerConfigBtn.addEventListener('click', saveServerConfig);

    // Private server checkbox toggle - show/hide fields
    const pvtServerCb = document.getElementById('privateServerEnabled');
    if (pvtServerCb) {
      pvtServerCb.addEventListener('change', () => {
        const fields = document.getElementById('privateServerFields');
        if (fields) fields.classList.toggle('hidden', !pvtServerCb.checked);
      });
    }

    const saveLoggingConfigBtn = document.getElementById('saveLoggingConfigBtn');
    if (saveLoggingConfigBtn) saveLoggingConfigBtn.addEventListener('click', saveLoggingConfig);

    const browseLogDirBtn = document.getElementById('browseLogDirBtn');
    if (browseLogDirBtn) browseLogDirBtn.addEventListener('click', openFolderBrowser);

    const saveAlertConfigBtn = document.getElementById('saveAlertConfigBtn');
    if (saveAlertConfigBtn) saveAlertConfigBtn.addEventListener('click', saveAlertConfig);

    const saveEmailConfigBtn = document.getElementById('saveEmailConfigBtn');
    if (saveEmailConfigBtn) saveEmailConfigBtn.addEventListener('click', saveEmailConfig);

    const testEmailBtn = document.getElementById('testEmailBtn');
    if (testEmailBtn) testEmailBtn.addEventListener('click', testEmail);

    const saveStartupProgramsBtn = document.getElementById('saveStartupProgramsBtn');
    if (saveStartupProgramsBtn) saveStartupProgramsBtn.addEventListener('click', saveStartupProgramsConfig);

    const addStartupProgramBtn = document.getElementById('addStartupProgramBtn');
    if (addStartupProgramBtn) addStartupProgramBtn.addEventListener('click', addStartupProgramRow);

    const detectStartupProgramsBtn = document.getElementById('detectStartupProgramsBtn');
    if (detectStartupProgramsBtn) detectStartupProgramsBtn.addEventListener('click', detectStartupPrograms);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const fb = document.getElementById('folderBrowserModal');
        const ab = document.getElementById('aboutModal');
        if (fb && !fb.classList.contains('hidden')) {
          closeFolderBrowser();
        } else if (ab && !ab.classList.contains('hidden')) {
          closeAboutModal();
        } else {
          closeSettingsModal();
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // SETTINGS MODAL
  // --------------------------------------------------------------------------
  async function openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    await loadServerConfigToModal();
    await loadLoggingConfigToModal();
    await loadWeatherConfigToModal();
    await loadAlertConfigToModal();
    await loadEmailConfigToModal();
    await loadStartupProgramsToModal();
    lucide.createIcons();
  }

  function closeSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.classList.add('hidden');
  }

  // --------------------------------------------------------------------------
  // ABOUT MODAL
  // --------------------------------------------------------------------------
  function openAboutModal() {
    const modal = document.getElementById('aboutModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    lucide.createIcons();
  }

  function closeAboutModal() {
    const modal = document.getElementById('aboutModal');
    if (modal) modal.classList.add('hidden');
  }

  async function loadServerConfigToModal() {
    try {
      const r = await fetch('/api/server/config');
      if (!r.ok) return;
      const cfg = await r.json();
      const portInput = document.getElementById('settingsServerPort');
      const currentEl = document.getElementById('settingsCurrentPort');
      if (portInput) portInput.value = cfg.port || 8000;
      if (currentEl) {
        const livePort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
        currentEl.textContent = livePort;
      }
    } catch (e) {
      log('ERROR', `Server config load: ${e.message}`);
    }
  }

  // --------------------------------------------------------------------------
  // LOGGING CONFIG (u modalu)
  // --------------------------------------------------------------------------
  async function loadLoggingConfigToModal() {
    try {
      const r = await fetch('/api/logging/config');
      if (!r.ok) return;
      const cfg = await r.json();

      const enabledEl = document.getElementById('settingsLoggingEnabled');
      if (enabledEl) enabledEl.checked = !!cfg.enabled;

      const dirEl = document.getElementById('settingsLogDirectory');
      if (dirEl) dirEl.value = cfg.log_directory || '';

      const currentEl = document.getElementById('settingsCurrentLogDir');
      if (currentEl) currentEl.textContent = cfg.log_directory || '(default)';

      const formatEl = document.getElementById('settingsLogFormat');
      if (formatEl) formatEl.value = (cfg.log_format || 'CSV').toUpperCase();

      // Dohvati broj datoteka u trenutnom direktoriju
      try {
        const fr = await fetch('/api/logging/files');
        if (fr.ok) {
          const files = await fr.json();
          const infoEl = document.getElementById('settingsLogFilesInfo');
          const textEl = document.getElementById('settingsLogFilesText');
          if (infoEl && textEl) {
            if (files.length > 0) {
              const totalKB = files.reduce((sum, f) => sum + (f.size || 0), 0) / 1024;
              textEl.textContent = HorusI18n.t('app.dir_files', files.length, totalKB.toFixed(1));
              infoEl.classList.remove('hidden');
            } else {
              textEl.textContent = HorusI18n.t('app.dir_empty');
              infoEl.classList.remove('hidden');
            }
          }
        }
      } catch (_) {
        // ignore - nije kritično
      }
    } catch (e) {
      log('ERROR', `Logging config load: ${e.message}`);
    }
  }

  async function saveLoggingConfig() {
    const enabledEl = document.getElementById('settingsLoggingEnabled');
    const dirEl = document.getElementById('settingsLogDirectory');
    const formatEl = document.getElementById('settingsLogFormat');

    const payload = {
      enabled: enabledEl?.checked || false,
      log_directory: (dirEl?.value || '').trim(),
      log_format: formatEl?.value || 'CSV',
    };

    try {
      const r = await fetch('/api/logging/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(await r.text());
      const result = await r.json();

      const status = payload.enabled ? HorusI18n.t('app.logging_active') : HorusI18n.t('app.logging_disabled');
      log('INFO', HorusI18n.t('app.logging_status', status, payload.log_format, result.log_directory));

      HorusAnalytics.showAlert({
        level: 'info',
        title: HorusI18n.t('app.save_success_title'),
        message: HorusI18n.t('app.logging_saved_message'),
        icon: 'check-circle',
      });

      // Ažuriraj UI
      await loadLoggingConfigToModal();

      // Ažuriraj i popis logova u sidebaru
      await loadLogFiles();
    } catch (e) {
      log('ERROR', `Logging save: ${e.message}`);
      alert(HorusI18n.t('app.save_logging_error') + '\n' + e.message);
    }
  }

  // --------------------------------------------------------------------------
  // FOLDER BROWSER
  // --------------------------------------------------------------------------
  let _folderBrowserCurrentPath = '';

  async function openFolderBrowser() {
    const modal = document.getElementById('folderBrowserModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    // Inicijaliziraj gumbe (samo jednom)
    if (!modal._fbInitialized) {
      modal._fbInitialized = true;
      document.getElementById('closeFolderBrowserBtn')?.addEventListener('click', closeFolderBrowser);
      document.getElementById('folderBrowserCancelBtn')?.addEventListener('click', closeFolderBrowser);
      document.getElementById('folderBrowserUpBtn')?.addEventListener('click', folderBrowserGoUp);
      document.getElementById('folderBrowserSelectBtn')?.addEventListener('click', folderBrowserSelect);
      modal.addEventListener('click', (e) => { if (e.target === modal) closeFolderBrowser(); });
    }

    // Pokreni od trenutno upisane putanje ili prazno (root)
    const dirEl = document.getElementById('settingsLogDirectory');
    const startPath = (dirEl?.value || '').trim();
    await folderBrowserNavigate(startPath);
    lucide.createIcons();
  }

  function closeFolderBrowser() {
    const modal = document.getElementById('folderBrowserModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }

  async function folderBrowserNavigate(path) {
    const listEl = document.getElementById('folderBrowserList');
    const pathEl = document.getElementById('folderBrowserPath');
    const selEl = document.getElementById('folderBrowserSelected');
    if (!listEl) return;

    listEl.innerHTML = `<div class="text-center text-slate-500 text-sm py-8">${HorusI18n.t('folder.loading')}</div>`;

    try {
      const r = await fetch('/api/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path || '' }),
      });
      if (!r.ok) {
        const errText = await r.text();
        listEl.innerHTML = `<div class="text-center text-red-400 text-sm py-8">${errText}</div>`;
        return;
      }
      const data = await r.json();
      _folderBrowserCurrentPath = data.current || '';

      if (pathEl) pathEl.textContent = _folderBrowserCurrentPath || HorusI18n.t('folder.root');
      if (selEl) selEl.textContent = _folderBrowserCurrentPath ? `${HorusI18n.t('folder.selected')} ${_folderBrowserCurrentPath}` : HorusI18n.t('folder.not_selected');

      listEl.innerHTML = '';

      if (data.dirs.length === 0) {
        listEl.innerHTML = `<div class="text-center text-slate-500 text-sm py-8">${HorusI18n.t('folder.no_subdirs')}</div>`;
        return;
      }

      data.dirs.forEach(dir => {
        const row = document.createElement('button');
        row.className = 'w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800 transition flex items-center gap-2 text-sm group';
        if (dir.locked) row.classList.add('opacity-50');
        row.innerHTML = `
          <i data-lucide="${dir.is_drive ? 'hard-drive' : 'folder'}" class="w-4 h-4 text-brand-500 flex-shrink-0"></i>
          <span class="truncate">${dir.name}</span>
          <i data-lucide="chevron-right" class="w-3 h-3 text-slate-600 ml-auto flex-shrink-0 group-hover:text-slate-400"></i>
        `;
        if (!dir.locked) {
          row.addEventListener('click', () => folderBrowserNavigate(dir.path));
        }
        listEl.appendChild(row);
      });

      lucide.createIcons();
    } catch (e) {
      listEl.innerHTML = `<div class="text-center text-red-400 text-sm py-8">${HorusI18n.t('app.error')} ${e.message}</div>`;
    }
  }

  async function folderBrowserGoUp() {
    // Dohvati parent od servera
    try {
      const r = await fetch('/api/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: _folderBrowserCurrentPath || '' }),
      });
      if (!r.ok) return;
      const data = await r.json();
      if (data.parent !== undefined) {
        await folderBrowserNavigate(data.parent);
      }
    } catch (_) {}
  }

  function folderBrowserSelect() {
    if (!_folderBrowserCurrentPath) return;
    const dirEl = document.getElementById('settingsLogDirectory');
    if (dirEl) dirEl.value = _folderBrowserCurrentPath;
    closeFolderBrowser();
  }

  async function loadWeatherConfigToModal() {
    try {
      const r = await fetch('/api/weather/config');
      if (!r.ok) return;
      const cfg = await r.json();
      const keyInput = document.getElementById('settingsWeatherApiKey');
      const statusEl = document.getElementById('settingsWeatherKeyStatus');
      if (keyInput) {
        keyInput.value = '';
        keyInput.placeholder = cfg.api_key_set ? HorusI18n.t('app.keep_existing_key') : HorusI18n.t('app.enter_api_key');
      }
      if (statusEl) {
        if (cfg.api_key_set) {
          statusEl.classList.remove('hidden');
          statusEl.textContent = `${HorusI18n.t('app.key_set')} (${cfg.api_key_preview})`;
        } else {
          statusEl.classList.add('hidden');
        }
      }
    } catch (e) {
      log('ERROR', `Weather config load: ${e.message}`);
    }
  }

  // --------------------------------------------------------------------------
  // ALERT CONFIG (u modalu)
  // --------------------------------------------------------------------------
  async function loadAlertConfigToModal() {
    try {
      const r = await fetch('/api/alerts/config');
      if (!r.ok) return;
      const cfg = await r.json();

      const el = (id) => document.getElementById(id);
      if (el('alertEnabled')) el('alertEnabled').checked = cfg.enabled !== false;
      if (el('alertBatteryV')) el('alertBatteryV').value = cfg.battery_low_v ?? 0.91;
      if (el('alertTempC')) el('alertTempC').value = cfg.temperature_low_c ?? -50;
      if (el('alertSnrDb')) el('alertSnrDb').value = cfg.snr_low_db ?? -5;
      if (el('alertTimeoutS')) el('alertTimeoutS').value = cfg.packet_timeout_s ?? 300;
    } catch (e) {
      log('ERROR', `Alert config load: ${e.message}`);
    }
  }

  async function saveAlertConfig() {
    const el = (id) => document.getElementById(id);
    const payload = {
      enabled: el('alertEnabled')?.checked ?? true,
      battery_low_v: parseFloat(el('alertBatteryV')?.value) || 0.91,
      temperature_low_c: parseFloat(el('alertTempC')?.value) || -50,
      snr_low_db: parseFloat(el('alertSnrDb')?.value) || -5,
      packet_timeout_s: parseInt(el('alertTimeoutS')?.value) || 300,
    };

    try {
      const r = await fetch('/api/alerts/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(await r.text());
      log('INFO', HorusI18n.t('app.alerts_status', payload.enabled ? HorusI18n.t('app.alerts_activated') : HorusI18n.t('app.alerts_deactivated'), payload.battery_low_v, payload.temperature_low_c, payload.snr_low_db, payload.packet_timeout_s));

      HorusAnalytics.showAlert({
        level: 'info',
        title: HorusI18n.t('app.save_success_title'),
        message: HorusI18n.t('app.alerts_saved_message'),
        icon: 'check-circle',
      });
    } catch (e) {
      log('ERROR', `Alert config save: ${e.message}`);
      alert(HorusI18n.t('app.error') + ' ' + e.message);
    }
  }

  // --------------------------------------------------------------------------
  // EMAIL NOTIFIKACIJE (u modalu)
  // --------------------------------------------------------------------------
  async function loadEmailConfigToModal() {
    try {
      const r = await fetch('/api/email/config');
      if (!r.ok) return;
      const cfg = await r.json();

      const el = (id) => document.getElementById(id);
      if (el('emailEnabled')) el('emailEnabled').checked = cfg.enabled === true;
      if (el('emailSmtpServer')) el('emailSmtpServer').value = cfg.smtp_server || 'smtp.gmail.com';
      if (el('emailSmtpPort')) el('emailSmtpPort').value = cfg.smtp_port || 587;
      if (el('emailSmtpUser')) el('emailSmtpUser').value = cfg.smtp_user || '';
      if (el('emailFromEmail')) el('emailFromEmail').value = cfg.from_email || '';
      if (el('emailToEmail')) el('emailToEmail').value = cfg.to_email || '';
      if (el('emailCooldownHours')) el('emailCooldownHours').value = cfg.cooldown_hours ?? 6;

      // Password status
      const pwdStatus = el('emailPasswordStatus');
      if (pwdStatus) {
        if (cfg.smtp_password_set) {
          pwdStatus.classList.remove('hidden');
        } else {
          pwdStatus.classList.add('hidden');
        }
      }
      // Ostavi password polje prazno (placeholder)
      if (el('emailSmtpPassword')) el('emailSmtpPassword').value = '';
      if (el('emailSmtpPassword')) {
        el('emailSmtpPassword').placeholder = cfg.smtp_password_set
          ? HorusI18n.t('app.keep_existing_password')
          : HorusI18n.t('settings.smtp_password_placeholder');
      }
    } catch (e) {
      log('ERROR', `Email config load: ${e.message}`);
    }
  }

  async function saveEmailConfig() {
    const el = (id) => document.getElementById(id);
    const payload = {
      enabled: el('emailEnabled')?.checked ?? false,
      smtp_server: (el('emailSmtpServer')?.value || '').trim() || 'smtp.gmail.com',
      smtp_port: parseInt(el('emailSmtpPort')?.value) || 587,
      smtp_user: (el('emailSmtpUser')?.value || '').trim(),
      smtp_password: (el('emailSmtpPassword')?.value || '').trim(),
      from_email: (el('emailFromEmail')?.value || '').trim(),
      to_email: (el('emailToEmail')?.value || '').trim(),
      cooldown_hours: parseFloat(el('emailCooldownHours')?.value) || 6,
    };

    try {
      const r = await fetch('/api/email/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(await r.text());
      log('INFO', HorusI18n.t('app.email_log', payload.enabled ? HorusI18n.t('app.email_activated') : HorusI18n.t('app.email_deactivated'), payload.to_email || HorusI18n.t('app.not_set'), payload.cooldown_hours));

      HorusAnalytics.showAlert({
        level: 'info',
        title: HorusI18n.t('app.save_success_title'),
        message: HorusI18n.t('app.email_saved_message'),
        icon: 'check-circle',
      });

      await loadEmailConfigToModal(); // Refresh za password status
    } catch (e) {
      log('ERROR', `Email config save: ${e.message}`);
      alert(HorusI18n.t('app.error') + ' ' + e.message);
    }
  }

  async function testEmail() {
    const resultEl = document.getElementById('emailTestResult');
    const btn = document.getElementById('testEmailBtn');
    if (resultEl) {
      resultEl.textContent = HorusI18n.t('app.sending_test');
      resultEl.className = 'text-xs mt-1 text-slate-400';
      resultEl.classList.remove('hidden');
    }
    if (btn) btn.disabled = true;

    try {
      // Spremi config prvo (da test koristi ažurne podatke)
      await saveEmailConfig();

      const r = await fetch('/api/email/test', { method: 'POST' });
      const data = await r.json();
      if (r.ok) {
        if (resultEl) {
          resultEl.textContent = '✅ ' + (data.message || HorusI18n.t('app.test_sent'));
          resultEl.className = 'text-xs mt-1 text-emerald-400';
        }
        log('INFO', HorusI18n.t('app.test_email_sent_log'));
      } else {
        const err = data.detail || data.error || HorusI18n.t('app.unknown_error');
        if (resultEl) {
          resultEl.textContent = '❌ ' + err;
          resultEl.className = 'text-xs mt-1 text-red-400';
        }
        log('ERROR', HorusI18n.t('app.test_email_failed', err));
      }
    } catch (e) {
      if (resultEl) {
        resultEl.textContent = '❌ ' + e.message;
        resultEl.className = 'text-xs mt-1 text-red-400';
      }
      log('ERROR', HorusI18n.t('app.test_email_error', e.message));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function saveServerConfig() {
    const portInput = document.getElementById('settingsServerPort');
    const port = parseInt(portInput?.value, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      alert(HorusI18n.t('app.port_invalid'));
      return;
    }
    try {
      const r = await fetch('/api/server/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      log('INFO', HorusI18n.t('app.port_saved', data.port));

      HorusAnalytics.showAlert({
        level: 'info',
        title: HorusI18n.t('app.save_success_title'),
        message: HorusI18n.t('app.server_saved_message'),
        icon: 'check-circle',
      });

      const livePort = parseInt(window.location.port || '80', 10);
      if (port !== livePort) {
        alert(HorusI18n.t('app.port_restart_steps', port));
      }
    } catch (e) {
      log('ERROR', `Server config save: ${e.message}`);
      alert(HorusI18n.t('app.error') + ' ' + e.message);
    }
  }

  // --------------------------------------------------------------------------
  // CALLSIGN SELECTOR
  // --------------------------------------------------------------------------
  function onCallsignSelectChange() {
    const sel = document.getElementById('callsignSelect');
    selectedCallsign = sel.value || null;
    refreshChartsForSelected();

    if (selectedCallsign) {
      // Pojedinačna sonda — centriraj, zumiraj i prati u letu
      HorusMap.followBalloon(selectedCallsign);
    } else {
      // "Svi" — prestani pratiti, pokaži sve putanje na karti
      HorusMap.unfollowBalloon();
      HorusMap.fitPath();
    }
  }

  function updateCallsignSelector() {
    const sel = document.getElementById('callsignSelect');
    if (!sel) return;

    const currentVal = sel.value;
    const callsigns = Array.from(knownCallsigns).sort();

    const existingOpts = Array.from(sel.options).map(o => o.value).join(',');
    const newOpts = ['', ...callsigns].join(',');
    if (existingOpts === newOpts) return;

    sel.innerHTML = '';
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = callsigns.length > 1 ? `${HorusI18n.t('charts.all_balloons')} (${callsigns.length})` : HorusI18n.t('charts.all');
    sel.appendChild(allOpt);

    callsigns.forEach(cs => {
      const opt = document.createElement('option');
      opt.value = cs;
      opt.textContent = cs;
      sel.appendChild(opt);
    });

    if (currentVal && callsigns.includes(currentVal)) sel.value = currentVal;

    const container = document.getElementById('callsignSelectContainer');
    if (container) {
      if (callsigns.length > 1) {
        container.classList.remove('hidden');
        container.classList.add('flex');
      } else {
        container.classList.add('hidden');
        container.classList.remove('flex');
        sel.value = '';
        selectedCallsign = null;
        HorusMap.unfollowBalloon();
      }
    }
  }

  function refreshChartsForSelected() {
    if (!allFlightsData || !allFlightsData.flights) return;

    let packets = [];

    if (selectedCallsign && allFlightsData.flights[selectedCallsign]) {
      packets = allFlightsData.flights[selectedCallsign].packets || [];
    } else {
      Object.values(allFlightsData.flights).forEach(f => {
        if (f.packets) packets = packets.concat(f.packets);
      });
      packets.sort((a, b) => (a._rx_time || 0) - (b._rx_time || 0));
    }

    HorusCharts.update(packets);

    if (selectedCallsign && allFlightsData.flights[selectedCallsign]) {
      const f = allFlightsData.flights[selectedCallsign];
      HorusAnalytics.updateKPI({
        packets: f.packets || [],
        max_altitude: f.max_altitude || 0,
        phase: f.phase,
        stats: allFlightsData.stats || {},
        last_nogps_packet: f.last_nogps_packet || null,
      });
    } else if (packets.length > 0) {
      const last = packets[packets.length - 1];
      const cs = last.callsign;
      const f = allFlightsData.flights[cs];
      HorusAnalytics.updateKPI({
        packets: f ? f.packets : packets,
        max_altitude: f ? f.max_altitude : 0,
        phase: f ? f.phase : 'pre_launch',
        stats: allFlightsData.stats || {},
        last_nogps_packet: f ? (f.last_nogps_packet || null) : null,
      });
    } else {
      // Nema validnih GPS paketa — ali možda postoji no-GPS paket negdje
      // Pronađi prvi flight koji ima last_nogps_packet
      const flightWithNogps = Object.values(allFlightsData.flights).find(f => f.last_nogps_packet);
      if (flightWithNogps) {
        HorusAnalytics.updateKPI({
          packets: [],
          max_altitude: flightWithNogps.max_altitude || 0,
          phase: flightWithNogps.phase || 'pre_launch',
          stats: allFlightsData.stats || {},
          last_nogps_packet: flightWithNogps.last_nogps_packet,
        });
      }
    }
  }

  async function loadAudioDevices() {
    try {
      const r = await fetch('/api/audio-devices');
      const devices = await r.json();
      const sel = document.getElementById('audioDevice');
      sel.innerHTML = '';
      devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.index;
        opt.textContent = d.name;
        opt.dataset.udp = d.udp ? '1' : '0';
        sel.appendChild(opt);
      });
      log('INFO', HorusI18n.t('app.audio_devices', devices.length));
    } catch (e) {
      log('ERROR', HorusI18n.t('app.audio_devices_error', e.message));
    }
  }

  async function loadOutputDevices() {
    try {
      const r = await fetch('/api/audio-output-devices');
      const devices = await r.json();
      const sel = document.getElementById('audioOutputDevice');
      if (!sel) return;
      sel.innerHTML = '';
      if (devices.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = HorusI18n.t('sidebar.no_output_devices');
        sel.appendChild(opt);
        return;
      }
      devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.index;
        opt.textContent = d.name;
        sel.appendChild(opt);
      });
      // Provjeri da li je monitor već aktivan (npr. nakon refresha stranice)
      await syncMonitorStatus();
    } catch (e) {
      log('ERROR', `Output devices: ${e.message}`);
    }
  }

  async function syncMonitorStatus() {
    try {
      const r = await fetch('/api/monitor/status');
      if (!r.ok) return;
      const status = await r.json();
      const cb = document.getElementById('audioMonitorEnabled');
      const fields = document.getElementById('audioMonitorFields');
      const sel = document.getElementById('audioOutputDevice');
      if (cb) cb.checked = status.enabled;
      if (fields) {
        fields.classList.toggle('hidden', !status.enabled);
      }
      if (sel) {
        sel.disabled = !status.enabled;
        if (status.enabled && status.device_index !== null) {
          sel.value = status.device_index;
        }
      }
    } catch (e) {
      // Nije kritično
    }
  }

  async function toggleAudioMonitor() {
    const cb = document.getElementById('audioMonitorEnabled');
    const fields = document.getElementById('audioMonitorFields');
    const sel = document.getElementById('audioOutputDevice');
    const hint = document.getElementById('audioMonitorHint');

    if (cb.checked) {
      // Uključi — pokaži dropdown
      if (fields) fields.classList.remove('hidden');
      if (sel) sel.disabled = false;

      // Ako nema odabranog uređaja, čekaj da korisnik odabere
      if (!sel || !sel.value) {
        if (hint) {
          hint.textContent = HorusI18n.t('sidebar.select_output_first');
          hint.className = 'text-xs text-amber-400 mt-1';
          hint.classList.remove('hidden');
        }
        // Dodaj listener za promjenu uređaja
        sel.addEventListener('change', startMonitorWithSelected, { once: true });
        return;
      }

      await startMonitorWithSelected();
    } else {
      // Isključi monitor
      try {
        await fetch('/api/monitor/stop', { method: 'POST' });
        if (fields) fields.classList.add('hidden');
        if (sel) sel.disabled = true;
        if (hint) hint.classList.add('hidden');
        log('INFO', HorusI18n.t('app.monitor_stopped'));
      } catch (e) {
        log('ERROR', `Monitor stop: ${e.message}`);
      }
    }
  }

  async function startMonitorWithSelected() {
    const sel = document.getElementById('audioOutputDevice');
    const hint = document.getElementById('audioMonitorHint');
    const sampleRate = parseInt(document.getElementById('sampleRate').value, 10) || 48000;

    if (!sel || !sel.value) return;

    try {
      const r = await fetch('/api/monitor/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_index: parseInt(sel.value, 10),
          sample_rate: sampleRate,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      if (hint) {
        hint.textContent = `🔊 ${HorusI18n.t('app.monitor_active')}`;
        hint.className = 'text-xs text-emerald-400 mt-1';
        hint.classList.remove('hidden');
      }
      log('INFO', `${HorusI18n.t('app.monitor_started')} (${sel.options[sel.selectedIndex]?.textContent || '?'})`);
    } catch (e) {
      const cb = document.getElementById('audioMonitorEnabled');
      if (cb) cb.checked = false;
      if (hint) {
        hint.textContent = `⚠ ${e.message}`;
        hint.className = 'text-xs text-red-400 mt-1';
        hint.classList.remove('hidden');
      }
      log('ERROR', `Monitor start: ${e.message}`);
    }
  }

  async function loadModems() {
    try {
      const r = await fetch('/api/modems');
      const modems = await r.json();
      const sel = document.getElementById('modemSelect');
      sel.innerHTML = '';
      modems.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.textContent = m.name;
        opt.dataset.config = JSON.stringify(m);
        sel.appendChild(opt);
      });
      onModemChange();
    } catch (e) {
      log('ERROR', HorusI18n.t('app.modems_error', e.message));
    }
  }

  function onModemChange() {
    const sel = document.getElementById('modemSelect');
    const opt = sel.options[sel.selectedIndex];
    if (!opt) return;
    const cfg = JSON.parse(opt.dataset.config);
    const bauds = cfg.baud_rates || [100];

    const baudSel = document.getElementById('baudRate');
    baudSel.innerHTML = '';
    bauds.forEach(b => {
      const o = document.createElement('option');
      o.value = b;
      o.textContent = b;
      if (b === cfg.default_baud_rate) o.selected = true;
      baudSel.appendChild(o);
    });
  }

  async function toggleDecoder() {
    const btn = document.getElementById('startStopBtn');
    const isRunning = btn.dataset.running === 'true';

    if (!isRunning) {
      const audioSel = document.getElementById('audioDevice');
      const opt = audioSel.options[audioSel.selectedIndex];
      const isUdp = opt?.dataset.udp === '1';

      const payload = {
        audio_device: isUdp ? null : parseInt(audioSel.value, 10),
        sample_rate: parseInt(document.getElementById('sampleRate').value, 10),
        modem: document.getElementById('modemSelect').value,
        baud_rate: parseInt(document.getElementById('baudRate').value, 10),
        use_udp: isUdp,
        udp_port: 7355,
      };

      try {
        const r = await fetch('/api/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error(await r.text());
        setRunning(true);
        log('INFO', `${HorusI18n.t('app.decoder_started')} (${opt?.textContent || HorusI18n.t('app.unknown_device')})`);
      } catch (e) {
        log('ERROR', HorusI18n.t('app.start_failed', e.message));
      }
    } else {
      try {
        await fetch('/api/stop', { method: 'POST' });
        setRunning(false);
        log('INFO', HorusI18n.t('app.decoder_stopped'));
      } catch (e) {
        log('ERROR', e.message);
      }
    }
  }

  function setRunning(running) {
    const btn = document.getElementById('startStopBtn');
    btn.dataset.running = running ? 'true' : 'false';
    btn.innerHTML = running
      ? `<i data-lucide="square" class="w-5 h-5"></i><span>${HorusI18n.t('sidebar.stop')}</span>`
      : `<i data-lucide="play" class="w-5 h-5"></i><span>${HorusI18n.t('sidebar.start')}</span>`;
    btn.className = running
      ? 'w-full py-3 rounded-lg bg-red-600 hover:bg-red-700 transition font-semibold flex items-center justify-center gap-2'
      : 'w-full py-3 rounded-lg bg-brand-600 hover:bg-brand-700 transition font-semibold flex items-center justify-center gap-2';
    document.getElementById('decoderStatus').textContent = running ? HorusI18n.t('sidebar.decoding') : HorusI18n.t('sidebar.stopped');
    lucide.createIcons();
  }

  async function saveStation() {
    const altitude = parseFloat(document.getElementById('stationAltitude')?.value) || 0;
    const blocklistRaw = document.getElementById('sondehubBlocklist')?.value || '';
    const blocklist = blocklistRaw.split(/[,\n]/).map(s => s.trim().toUpperCase()).filter(s => s.length > 0);

    const payload = {
      callsign: document.getElementById('stationCallsign').value || 'N0CALL',
      latitude: parseFloat(document.getElementById('stationLat').value) || 0,
      longitude: parseFloat(document.getElementById('stationLon').value) || 0,
      altitude: altitude,
      radio: document.getElementById('stationRadio')?.value || '',
      antenna: document.getElementById('stationAntenna')?.value || '',
      sondehub_enabled: document.getElementById('sondehubEnabled')?.checked || false,
      dial_freq_mhz: parseFloat(document.getElementById('stationDialFreq')?.value) || 0,
      sondehub_blocklist: blocklist,
      private_server_enabled: document.getElementById('privateServerEnabled')?.checked || false,
      private_server_host: document.getElementById('privateServerHost')?.value || '',
      private_server_port: parseInt(document.getElementById('privateServerPort')?.value, 10) || 0,
      private_server_protocol: document.getElementById('privateServerProtocol')?.value || 'udp',
      private_server_format: document.getElementById('privateServerFormat')?.value || 'json',
    };

    try {
      await fetch('/api/station', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const details = [];
      if (payload.sondehub_enabled) details.push(HorusI18n.t('app.sondehub_active'));
      if (payload.dial_freq_mhz > 0) details.push(`${payload.dial_freq_mhz.toFixed(3)} MHz`);
      if (altitude > 0) details.push(HorusI18n.t('app.antenna_height', altitude));
      if (blocklist.length > 0) details.push(HorusI18n.t('app.blocklist_short', blocklist.length));
      if (payload.private_server_enabled && payload.private_server_host) {
        details.push(HorusI18n.t('app.private_server_active', payload.private_server_host, payload.private_server_port));
      }
      const suffix = details.length ? ` (${details.join(', ')})` : '';
      log('INFO', HorusI18n.t('app.station_saved', payload.callsign, suffix));

      HorusAnalytics.showAlert({
        level: 'info',
        title: HorusI18n.t('app.save_success_title'),
        message: HorusI18n.t('app.station_saved_message'),
        icon: 'check-circle',
      });

      HorusMap.updateStation(payload);
      updateBlocklistStatus(blocklist);

      const horizonCb = document.getElementById('showHorizonRings');
      if (horizonCb?.checked) HorusMap.setHorizonRings(true, altitude);
    } catch (e) {
      log('ERROR', e.message);
    }
  }

  async function uploadStation() {
    try {
      const r = await fetch('/api/station/upload', { method: 'POST' });
      const data = await r.json();
      if (r.ok && data.ok) {
        log('INFO', HorusI18n.t('app.station_uploaded'));
        HorusAnalytics.showAlert({
          level: 'info',
          title: HorusI18n.t('app.station_uploaded_title'),
          message: HorusI18n.t('app.station_uploaded'),
          icon: 'upload-cloud',
        });
      } else {
        const errMsg = data.detail || data.error || 'Upload nije uspio';
        log('ERROR', HorusI18n.t('app.station_upload_failed', errMsg));
        HorusAnalytics.showAlert({
          level: 'warn',
          title: HorusI18n.t('app.station_upload_failed_title'),
          message: errMsg,
          icon: 'alert-triangle',
        });
      }
    } catch (e) {
      log('ERROR', HorusI18n.t('app.station_upload_failed', e.message));
    }
  }

  function updateBlocklistStatus(blocklist) {
    const statusEl = document.getElementById('blocklistStatus');
    if (!statusEl) return;
    if (blocklist && blocklist.length > 0) {
      statusEl.textContent = HorusI18n.t('app.blocklist_status', blocklist.length, blocklist.join(', '));
      statusEl.classList.remove('hidden');
    } else {
      statusEl.classList.add('hidden');
    }
  }

  async function loadWeatherConfig() {
    try {
      const r = await fetch('/api/weather/config');
      if (!r.ok) return;
      const cfg = await r.json();
      updateWeatherControlsVisibility(cfg.api_key_set);
    } catch (e) {
      log('ERROR', `Weather: ${e.message}`);
    }
  }

  async function saveWeatherConfig() {
    const keyInput = document.getElementById('settingsWeatherApiKey');
    const newKey = (keyInput?.value || '').trim();

    try {
      const r = await fetch('/api/weather/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: newKey }),
      });
      if (!r.ok) throw new Error(await r.text());
      const result = await r.json();
      log('INFO', HorusI18n.t('app.weather_key_saved'));

      HorusAnalytics.showAlert({
        level: 'info',
        title: HorusI18n.t('app.save_success_title'),
        message: HorusI18n.t('app.weather_saved_message'),
        icon: 'check-circle',
      });

      if (keyInput) keyInput.value = '';
      await loadWeatherConfigToModal();
      updateWeatherControlsVisibility(!!result.api_key_set);
    } catch (e) {
      log('ERROR', `Weather save: ${e.message}`);
      alert(HorusI18n.t('app.error') + ' ' + e.message);
    }
  }

  async function deleteWeatherKey() {
    if (!confirm(HorusI18n.t('app.confirm_delete_weather'))) return;
    try {
      const r = await fetch('/api/weather/config', { method: 'DELETE' });
      if (!r.ok) throw new Error(await r.text());
      log('WARN', HorusI18n.t('app.weather_key_deleted'));
      await loadWeatherConfigToModal();
      updateWeatherControlsVisibility(false);
      HorusMap.clearWeatherLayer();
      const select = document.getElementById('weatherLayerSelect');
      if (select) select.value = '';
      const opacityCtrl = document.getElementById('weatherOpacityControl');
      if (opacityCtrl) {
        opacityCtrl.classList.add('hidden');
        opacityCtrl.classList.remove('flex');
      }
    } catch (e) {
      log('ERROR', `Weather delete: ${e.message}`);
    }
  }

  // --------------------------------------------------------------------------
  // STARTUP PROGRAMS CONFIG (u modalu)
  // --------------------------------------------------------------------------
  let startupProgramsData = [];

  async function loadStartupProgramsToModal() {
    try {
      const r = await fetch('/api/startup-programs/config');
      if (!r.ok) return;
      const cfg = await r.json();

      const enabledEl = document.getElementById('startupProgramsEnabled');
      if (enabledEl) enabledEl.checked = cfg.enabled === true;

      startupProgramsData = cfg.programs || [];
      renderStartupProgramsList();
    } catch (e) {
      log('ERROR', `Startup programs config load: ${e.message}`);
    }
  }

  function renderStartupProgramsList() {
    const container = document.getElementById('startupProgramsList');
    if (!container) return;
    container.innerHTML = '';

    if (startupProgramsData.length === 0) {
      container.innerHTML = `
        <div class="text-xs text-slate-500 text-center py-3 border border-dashed border-slate-700 rounded-lg">
          ${HorusI18n.t('settings.no_programs')}
        </div>`;
      return;
    }

    startupProgramsData.forEach((prog, idx) => {
      const row = document.createElement('div');
      row.className = 'bg-slate-800/60 border border-slate-700 rounded-lg p-3 space-y-2';
      row.innerHTML = `
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 flex-1 min-w-0">
            <label class="flex items-center gap-2 cursor-pointer flex-shrink-0">
              <input type="checkbox" class="accent-brand-500 w-4 h-4 startup-prog-enabled" data-idx="${idx}"
                     ${prog.enabled !== false ? 'checked' : ''} />
            </label>
            <input type="text" class="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm startup-prog-name" data-idx="${idx}"
                   value="${(prog.name || '').replace(/"/g, '&quot;')}" placeholder="${HorusI18n.t('app.startup_name_placeholder')}" />
          </div>
          <button class="p-1 rounded hover:bg-red-600/30 text-red-400 hover:text-red-300 transition startup-prog-remove flex-shrink-0" data-idx="${idx}" title="${HorusI18n.t('app.startup_remove')}">
            <i data-lucide="trash-2" class="w-4 h-4 pointer-events-none"></i>
          </button>
        </div>
        <div>
          <label class="text-xs text-slate-500">${HorusI18n.t('settings.exe_path')}</label>
          <div class="flex gap-1 mt-0.5">
            <input type="text" class="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs font-mono startup-prog-path" data-idx="${idx}"
                   value="${(prog.path || '').replace(/"/g, '&quot;')}" placeholder="${HorusI18n.t('app.startup_path_placeholder')}" />
            <button class="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs startup-prog-browse flex-shrink-0" data-idx="${idx}" title="${HorusI18n.t('app.startup_browse_file')}">
              <i data-lucide="file-search" class="w-3.5 h-3.5 pointer-events-none"></i>
            </button>
          </div>
        </div>
        <div>
          <label class="text-xs text-slate-500">${HorusI18n.t('app.startup_args_label')}</label>
          <input type="text" class="w-full mt-0.5 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs font-mono startup-prog-args" data-idx="${idx}"
                 value="${(prog.args || '').replace(/"/g, '&quot;')}" placeholder="${HorusI18n.t('app.startup_args_placeholder')}" />
        </div>
      `;
      container.appendChild(row);
    });

    // Bind remove buttons
    container.querySelectorAll('.startup-prog-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        startupProgramsData.splice(idx, 1);
        renderStartupProgramsList();
        lucide.createIcons();
      });
    });

    // Bind input changes
    container.querySelectorAll('.startup-prog-name').forEach(el => {
      el.addEventListener('input', () => {
        startupProgramsData[parseInt(el.dataset.idx, 10)].name = el.value;
      });
    });
    container.querySelectorAll('.startup-prog-path').forEach(el => {
      el.addEventListener('input', () => {
        startupProgramsData[parseInt(el.dataset.idx, 10)].path = el.value;
      });
    });
    container.querySelectorAll('.startup-prog-args').forEach(el => {
      el.addEventListener('input', () => {
        startupProgramsData[parseInt(el.dataset.idx, 10)].args = el.value;
      });
    });
    container.querySelectorAll('.startup-prog-enabled').forEach(el => {
      el.addEventListener('change', () => {
        startupProgramsData[parseInt(el.dataset.idx, 10)].enabled = el.checked;
      });
    });

    lucide.createIcons();
  }

  function addStartupProgramRow() {
    startupProgramsData.push({ name: '', path: '', args: '', enabled: true });
    renderStartupProgramsList();
    lucide.createIcons();
    // Fokusiraj zadnji name input
    const nameInputs = document.querySelectorAll('.startup-prog-name');
    if (nameInputs.length > 0) nameInputs[nameInputs.length - 1].focus();
  }

  async function detectStartupPrograms() {
    try {
      const r = await fetch('/api/startup-programs/browse', { method: 'POST' });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      const found = data.programs || [];

      if (found.length === 0) {
        log('INFO', HorusI18n.t('app.detect_none_log'));
        alert(HorusI18n.t('app.detect_no_programs'));
        return;
      }

      // Dodaj samo programe koji već nisu na listi
      let added = 0;
      for (const prog of found) {
        const alreadyExists = startupProgramsData.some(
          p => p.path.toLowerCase() === prog.path.toLowerCase()
        );
        if (!alreadyExists) {
          startupProgramsData.push({ name: prog.name, path: prog.path, args: '', enabled: true });
          added++;
        }
      }

      renderStartupProgramsList();
      lucide.createIcons();

      if (added > 0) {
        log('INFO', HorusI18n.t('app.detect_found', added) + ' ' + found.map(p => p.name).join(', '));
      } else {
        log('INFO', HorusI18n.t('app.all_detected_added'));
        alert(HorusI18n.t('app.detect_already_added'));
      }
    } catch (e) {
      log('ERROR', `Detect startup programs: ${e.message}`);
      alert(HorusI18n.t('app.detect_error') + ' ' + e.message);
    }
  }

  async function saveStartupProgramsConfig() {
    const enabledEl = document.getElementById('startupProgramsEnabled');
    const enabled = enabledEl ? enabledEl.checked : false;

    // Sync from UI before saving
    document.querySelectorAll('.startup-prog-name').forEach(el => {
      startupProgramsData[parseInt(el.dataset.idx, 10)].name = el.value;
    });
    document.querySelectorAll('.startup-prog-path').forEach(el => {
      startupProgramsData[parseInt(el.dataset.idx, 10)].path = el.value;
    });
    document.querySelectorAll('.startup-prog-args').forEach(el => {
      startupProgramsData[parseInt(el.dataset.idx, 10)].args = el.value;
    });
    document.querySelectorAll('.startup-prog-enabled').forEach(el => {
      startupProgramsData[parseInt(el.dataset.idx, 10)].enabled = el.checked;
    });

    // Filtriraj prazne
    const programs = startupProgramsData.filter(p => p.path.trim() !== '');

    try {
      const r = await fetch('/api/startup-programs/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, programs }),
      });
      if (!r.ok) throw new Error(await r.text());
      log('INFO', HorusI18n.t('app.startup_saved', enabled ? HorusI18n.t('app.logging_active') : HorusI18n.t('app.logging_disabled'), programs.length));

      HorusAnalytics.showAlert({
        level: 'info',
        title: HorusI18n.t('app.save_success_title'),
        message: HorusI18n.t('app.startup_saved_message'),
        icon: 'check-circle',
      });

      startupProgramsData = programs;
      renderStartupProgramsList();
      lucide.createIcons();
    } catch (e) {
      log('ERROR', `Startup programs save: ${e.message}`);
      alert(HorusI18n.t('app.error') + ' ' + e.message);
    }
  }

  function updateWeatherControlsVisibility(enabled) {
    const controls = document.getElementById('weatherLayerControls');
    if (!controls) return;
    if (enabled) {
      controls.classList.remove('hidden');
      controls.classList.add('flex');
    } else {
      controls.classList.add('hidden');
      controls.classList.remove('flex');
      HorusMap.clearWeatherLayer();
    }
  }

  async function onWeatherLayerChange() {
    const select = document.getElementById('weatherLayerSelect');
    const layer = select.value;
    const opacityCtrl = document.getElementById('weatherOpacityControl');
    try {
      await HorusMap.setWeatherLayer(layer);
      if (opacityCtrl) {
        if (layer) { opacityCtrl.classList.remove('hidden'); opacityCtrl.classList.add('flex'); }
        else { opacityCtrl.classList.add('hidden'); opacityCtrl.classList.remove('flex'); }
      }
      if (layer) log('INFO', HorusI18n.t('app.weather_layer', select.options[select.selectedIndex].text));
    } catch (e) {
      log('ERROR', `Weather layer: ${e.message}`);
      select.value = '';
    }
  }

  function onOpacityChange(e) {
    const val = parseInt(e.target.value, 10);
    const valueEl = document.getElementById('weatherOpacityValue');
    if (valueEl) valueEl.textContent = `${val}%`;
    HorusMap.setWeatherOpacity(val / 100);
  }

  function onHorizonRingsToggle(e) {
    const enabled = e.target.checked;
    const altEl = document.getElementById('stationAltitude');
    const antHeight = parseFloat(altEl?.value) || 0;
    HorusMap.setHorizonRings(enabled, antHeight);
    if (enabled) {
      log('INFO', HorusI18n.t('app.horizon_activated', antHeight));
      fetchAllFlightsAndRefresh();
    }
  }

  async function onMetarToggle(e) {
    const enabled = e.target.checked;
    // Koristi poziciju stanice koju je korisnik unio, ili centar karte
    let lat, lon;
    const latEl = document.getElementById('stationLat');
    const lonEl = document.getElementById('stationLon');
    if (latEl && lonEl && latEl.value && lonEl.value) {
      lat = parseFloat(latEl.value);
      lon = parseFloat(lonEl.value);
    } else if (allFlightsData?.station?.latitude && allFlightsData?.station?.longitude) {
      lat = allFlightsData.station.latitude;
      lon = allFlightsData.station.longitude;
    } else {
      // Nema korisničkih koordinata — upozori i odustani
      log('WARN', HorusI18n.t('app.metar_no_station_coords'));
      e.target.checked = false;
      return;
    }

    if (enabled) {
      log('INFO', HorusI18n.t('app.metar_loading', lat.toFixed(2), lon.toFixed(2)));
      const result = await HorusMap.setMetarEnabled(true, lat, lon);
      if (result.ok) {
        log('INFO', HorusI18n.t('app.metar_stations_count', result.count, result.cached ? HorusI18n.t('app.metar_cached') : ''));
        if (result.count === 0) {
          log('WARN', HorusI18n.t('app.metar_no_airports'));
        }
      } else {
        log('ERROR', HorusI18n.t('app.metar_error') + ' ' + result.error);
        e.target.checked = false;
      }
    } else {
      HorusMap.setMetarEnabled(false, lat, lon);
      log('INFO', HorusI18n.t('app.metar_deactivated'));
    }
  }

  async function resetFlight() {
    if (!confirm(HorusI18n.t('app.confirm_reset_flight'))) return;
    try {
      await fetch('/api/flight/reset', { method: 'POST' });
      allFlightsData = { flights: {}, callsigns: [] };
      knownCallsigns.clear();
      selectedCallsign = null;
      HorusMap.reset();
      HorusCharts.reset();
      HorusSpectrum.reset();
      updateCallsignSelector();
      log('WARN', HorusI18n.t('app.flight_reset'));
    } catch (e) {
      log('ERROR', e.message);
    }
  }

  async function loadLogFiles() {
    try {
      const r = await fetch('/api/logging/files');
      const files = await r.json();
      const sel = document.getElementById('csvLogSelect');
      sel.innerHTML = '';

      // Dohvati i ažuriraj hint s direktorijem
      try {
        const cr = await fetch('/api/logging/config');
        if (cr.ok) {
          const cfg = await cr.json();
          const hintEl = document.getElementById('logsDirHint');
          if (hintEl) {
            const dir = cfg.log_directory || '(default)';
            hintEl.textContent = `📁 ${dir}`;
            hintEl.title = dir;
          }
        }
      } catch (_) {}

      if (files.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = HorusI18n.t('app.no_log_files');
        sel.appendChild(opt);
        return;
      }

      files.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.name;
        const sizeKB = (f.size / 1024).toFixed(1);
        opt.textContent = `${f.name} (${sizeKB} KB)`;
        sel.appendChild(opt);
      });

      log('INFO', HorusI18n.t('app.log_files_found', files.length));
    } catch (e) {
      log('ERROR', `Log files: ${e.message}`);
    }
  }

  async function downloadCSV() {
    const sel = document.getElementById('csvLogSelect');
    const filename = sel.value;
    if (!filename) {
      log('WARN', HorusI18n.t('app.select_log_download'));
      return;
    }
    try {
      const r = await fetch(`/api/logging/download/${encodeURIComponent(filename)}`);
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(txt || HorusI18n.t('app.generic_error'));
      }
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      log('INFO', HorusI18n.t('app.downloaded', filename));
    } catch (e) {
      log('ERROR', `Download: ${e.message}`);
    }
  }

  async function loadLogFile() {
    const sel = document.getElementById('csvLogSelect');
    const filename = sel.value;
    if (!filename) {
      log('WARN', HorusI18n.t('app.select_log_to_load'));
      return;
    }
    if (!confirm(HorusI18n.t('app.confirm_load_log', filename))) return;

    const btn = document.getElementById('loadLogBtn');
    const origText = btn.querySelector('span').textContent;
    btn.disabled = true;
    btn.querySelector('span').textContent = HorusI18n.t('sidebar.loading');

    try {
      const r = await fetch(`/api/logging/load/${encodeURIComponent(filename)}`, {
        method: 'POST',
      });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(txt || HorusI18n.t('app.generic_error'));
      }
      const data = await r.json();
      const total = data.total_packets || 0;
      const callsigns = data.callsigns || [];

      log('INFO', HorusI18n.t('app.log_loaded_success', filename, total, callsigns.join(', ')));

      // Prebaci vremenski raspon na "Sve" da se vide svi učitani podaci
      const timeRangeSel = document.getElementById('chartTimeRange');
      if (timeRangeSel) {
        timeRangeSel.value = 'all';
        HorusCharts.setTimeRange('all');
      }

      // Dodaj učitane callsignove i odaberi prvi ako ništa nije odabrano
      callsigns.forEach(cs => knownCallsigns.add(cs));
      updateCallsignSelector();
      if (!selectedCallsign && callsigns.length > 0) {
        selectedCallsign = callsigns[0];
        const csSelect = document.getElementById('callsignSelect');
        if (csSelect) csSelect.value = selectedCallsign;
      }

      // Osvježi sve podatke s backend-a
      await fetchAllFlightsAndRefresh();
    } catch (e) {
      log('ERROR', `${HorusI18n.t('app.log_load_error')}: ${e.message}`);
    } finally {
      btn.disabled = false;
      btn.querySelector('span').textContent = origText;
    }
  }

  function connectWebSocket() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${window.location.host}/ws`);

    ws.addEventListener('open', () => {
      setConnectionStatus(true);
      log('INFO', HorusI18n.t('app.ws_connected'));
    });

    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        handleMessage(msg);
      } catch (e) {
        console.error('WS parse error', e);
      }
    });

    ws.addEventListener('close', () => {
      setConnectionStatus(false);
      log('WARN', HorusI18n.t('app.ws_disconnected'));
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = setTimeout(connectWebSocket, 3000);
    });

    ws.addEventListener('error', () => log('ERROR', HorusI18n.t('app.ws_error')));
  }

  function setConnectionStatus(connected) {
    const el = document.getElementById('connStatus');
    el.innerHTML = connected
      ? `<span class="w-2 h-2 rounded-full bg-emerald-500 pulse-green"></span><span class="text-emerald-400">${HorusI18n.t('header.connected')}</span>`
      : `<span class="w-2 h-2 rounded-full bg-red-500"></span><span class="text-slate-400">${HorusI18n.t('header.disconnected')}</span>`;
  }

  function handleMessage(msg) {
    if (msg.type === 'snapshot') {
      fetchAllFlightsAndRefresh();
    } else if (msg.type === 'packet') {
      const p = msg.data;
      lastPacket = p;
      if (p.callsign) {
        knownCallsigns.add(p.callsign);
        updateCallsignSelector();
      }
      if (p.no_gps_fix) {
        log('WARN', `📦 ${p.callsign} ⚠ ${HorusI18n.t('app.no_gps')} • SNR: ${p.snr != null ? p.snr.toFixed(1) + ' dB' : '—'} • ${p.phase}`);
      } else {
        log('INFO', `📦 ${p.callsign} @ ${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)} • ${p.altitude.toFixed(0)}m • ${p.phase}`);
      }
      fetchAllFlightsAndRefresh();
    } else if (msg.type === 'alert') {
      const a = msg.data;
      log('WARN', `🚨 [${a.type}] ${a.message}`);
      HorusAnalytics.showAlert(a);
    } else if (msg.type === 'status') {
      if (msg.data?.type === 'fft') HorusSpectrum.update(msg.data);
      // CRC fail se NE logira - normalno je kad nema signala
    } else if (msg.type === 'log_loaded') {
      const d = msg.data;
      log('INFO', HorusI18n.t('app.log_loaded_ws', d.filename, d.total_packets, (d.callsigns || []).join(', ')));
      fetchAllFlightsAndRefresh();
    }
  }

  async function fetchAllFlightsAndRefresh() {
    try {
      const r = await fetch('/api/flights');
      const data = await r.json();
      if (data && data.flights) {
        allFlightsData = data;
        (data.callsigns || []).forEach(cs => knownCallsigns.add(cs));
        updateCallsignSelector();
        refreshAll();
      }
    } catch (e) {
      console.error(e);
    }
  }

  function refreshAll() {
    if (!allFlightsData || !allFlightsData.flights) return;
    HorusMap.updateAllFlights(allFlightsData);
    if (allFlightsData.station) HorusMap.updateStation(allFlightsData.station);
    refreshChartsForSelected();
  }

  function log(level, msg) {
    const c = document.getElementById('console');
    const time = new Date().toLocaleTimeString(HorusI18n.getLocale());
    const line = document.createElement('div');
    line.className = `log-${level}`;
    line.textContent = `${time} [${level}] ${msg}`;
    c.appendChild(line);
    c.scrollTop = c.scrollHeight;
    while (c.children.length > 500) c.removeChild(c.firstChild);
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
