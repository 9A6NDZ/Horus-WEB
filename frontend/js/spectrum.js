// ----------------------------------------------------------------------------
// spectrum.js  -  Audio spektar s peak hold linijom i detekcijom tonova
// ----------------------------------------------------------------------------

const HorusSpectrum = (() => {
  let chart;
  let lastUpdate = 0;
  const MIN_INTERVAL_MS = 80;

  // RTL mod state — kad je aktivan, X-os prikazuje RF MHz
  let rtlMode = false;
  let rtlTargetFreqHz = 0;
  let rtlCenterFreqHz = 0;

  // ---- Waterfall state ----
  let wfCanvas = null;
  let wfCtx = null;
  let wfContainer = null;
  let wfTargetMarker = null;
  // Off-screen buffer u kojem držimo cijelu "povijest" — prilikom novog reda
  // pomaknemo sadržaj prema dolje i nacrtamo novi red gore.
  let wfBuffer = null;     // OffscreenCanvas / HTMLCanvasElement
  let wfBufferCtx = null;
  let wfWidth = 0;
  let wfHeight = 0;
  // Raspon za mapiranje dB → boja. Auto se prilagođava iz noise_floor-a.
  let wfDbMin = -110;
  let wfDbMax = -30;
  // X-os bounds u RTL modu (Hz) — koriste se za pozicioniranje target markera
  let wfFreqMin = 0;
  let wfFreqMax = 0;

  const darkGrid = 'rgba(148, 163, 184, 0.12)';
  const tickColor = '#94a3b8';

  function init() {
    const ctx = document.getElementById('spectrumChart').getContext('2d');

    initWaterfall();

    chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: HorusI18n.t('spectrum.dataset_spectrum'),
            data: [],
            borderColor: '#60a5fa',
            backgroundColor: 'rgba(96, 165, 250, 0.2)',
            borderWidth: 1,
            pointRadius: 0,
            fill: true,
            tension: 0,
            order: 2,
          },
          {
            label: 'Peak hold',
            data: [],
            borderColor: '#f59e0b',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
            tension: 0,
            order: 1,
          },
          {
            label: HorusI18n.t('spectrum.dataset_tones'),
            data: [],
            borderColor: '#ef4444',
            backgroundColor: '#ef4444',
            borderWidth: 0,
            pointRadius: 6,
            pointHoverRadius: 8,
            pointStyle: 'triangle',
            showLine: false,
            order: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
              color: tickColor,
              font: { size: 11 },
              boxWidth: 20,
              padding: 10,
              filter: (legendItem) => legendItem.datasetIndex !== 2,
            },
          },
          tooltip: {
            enabled: true,
            mode: 'nearest',
            intersect: false,
            backgroundColor: '#1e293b',
            borderColor: '#334155',
            borderWidth: 1,
            callbacks: {
              title: (items) => {
                if (!items.length) return '';
                const freq = items[0].parsed.x;
                if (rtlMode) return (freq / 1e6).toFixed(4) + ' MHz';
                return `${freq.toFixed(0)} Hz`;
              },
              label: (ctx) => {
                if (ctx.datasetIndex === 2) return HorusI18n.t('spectrum.tone_tooltip', ctx.parsed.y.toFixed(1));
                return `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} dB`;
              },
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            min: 100,
            max: 3500,
            title: { display: true, text: HorusI18n.t('spectrum.freq_axis'), color: tickColor, font: { size: 11 } },
            ticks: {
              color: tickColor,
              maxTicksLimit: 10,
              font: { size: 10 },
              callback: function(v) {
                if (rtlMode && rtlTargetFreqHz > 0) {
                  // Prikaži MHz s 3 decimale
                  return (v / 1e6).toFixed(3);
                }
                return v + ' Hz';
              },
            },
            grid: { color: darkGrid },
          },
          y: {
            min: -120,
            max: -20,
            title: { display: true, text: HorusI18n.t('spectrum.mag_axis'), color: tickColor, font: { size: 11 } },
            ticks: { color: tickColor, stepSize: 20, font: { size: 10 } },
            grid: { color: darkGrid },
          },
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  //  WATERFALL — pomoćne funkcije
  // ---------------------------------------------------------------------------

  function initWaterfall() {
    wfContainer = document.getElementById('waterfallContainer');
    wfCanvas = document.getElementById('waterfallCanvas');
    wfTargetMarker = document.getElementById('waterfallTargetMarker');
    if (!wfCanvas) return;
    wfCtx = wfCanvas.getContext('2d');

    // Postavi internu rezoluciju kanvasa prema CSS veličini. Visina je fiksna
    // (definirana u CSS-u kao 160px), širina prati container.
    resizeWaterfall();

    // Off-screen buffer iste veličine koji čuva povijest između okvira.
    wfBuffer = document.createElement('canvas');
    wfBuffer.width = wfWidth;
    wfBuffer.height = wfHeight;
    wfBufferCtx = wfBuffer.getContext('2d');
    wfBufferCtx.fillStyle = '#000';
    wfBufferCtx.fillRect(0, 0, wfWidth, wfHeight);

    // Pri resize prozora — preskaliraj canvas, ali zadrži stari sadržaj
    // tako da ga prekopiramo iz buffera nakon resizinga.
    window.addEventListener('resize', () => {
      if (!wfContainer || wfContainer.classList.contains('hidden')) return;
      const oldBuffer = wfBuffer;
      const oldW = wfWidth;
      const oldH = wfHeight;
      resizeWaterfall();
      // Novi buffer
      wfBuffer = document.createElement('canvas');
      wfBuffer.width = wfWidth;
      wfBuffer.height = wfHeight;
      wfBufferCtx = wfBuffer.getContext('2d');
      wfBufferCtx.fillStyle = '#000';
      wfBufferCtx.fillRect(0, 0, wfWidth, wfHeight);
      // Prebaci stari sadržaj rastegnut na nove dimenzije
      try {
        wfBufferCtx.drawImage(oldBuffer, 0, 0, oldW, oldH, 0, 0, wfWidth, wfHeight);
        wfCtx.drawImage(wfBuffer, 0, 0);
      } catch (e) { /* ignore */ }
      updateTargetMarker();
    });
  }

  function resizeWaterfall() {
    if (!wfCanvas) return;
    // Internu razlučivost stavi jednaku CSS pikselima (uz device pixel ratio
    // za oštrinu na high-DPI ekranima).
    const dpr = window.devicePixelRatio || 1;
    const rect = wfCanvas.getBoundingClientRect();
    // Ako container još nije vidljiv, rect.width može biti 0 — koristi parent
    let cssW = rect.width;
    if (!cssW && wfCanvas.parentElement) {
      cssW = wfCanvas.parentElement.getBoundingClientRect().width;
    }
    if (!cssW) cssW = 600; // fallback
    const cssH = 160;
    wfCanvas.width = Math.max(1, Math.floor(cssW * dpr));
    wfCanvas.height = Math.max(1, Math.floor(cssH * dpr));
    wfWidth = wfCanvas.width;
    wfHeight = wfCanvas.height;
    // Ne skaliramo transformaciju — radimo u pikselima buffera direktno
  }

  // Mapiranje normalizirane vrijednosti [0..1] u "jet"-like paletu RGB.
  function dbToColor(db) {
    let t = (db - wfDbMin) / (wfDbMax - wfDbMin);
    if (t < 0) t = 0;
    else if (t > 1) t = 1;

    // 7-stop paleta: crna → tamno plava → plava → cyan → zelena → žuta → narančasta → crvena
    const stops = [
      [0,    0,   0,   20 ],
      [0.15, 0,   30,  120],
      [0.30, 0,   90,  220],
      [0.45, 0,   220, 220],
      [0.60, 0,   220, 0  ],
      [0.75, 255, 230, 0  ],
      [0.88, 255, 130, 0  ],
      [1.0,  255, 0,   0  ],
    ];
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const a = stops[i - 1], b = stops[i];
        const u = (t - a[0]) / (b[0] - a[0]);
        const r = a[1] + (b[1] - a[1]) * u;
        const g = a[2] + (b[2] - a[2]) * u;
        const bl = a[3] + (b[3] - a[3]) * u;
        return [r | 0, g | 0, bl | 0];
      }
    }
    return [255, 0, 0];
  }

  // Dodaj jedan novi red waterfalla na vrh. freqs/spectrum su iz backend FFT-a,
  // i mapiraju se na X-piksele buffera linearnom interpolacijom.
  function drawWaterfallRow(freqs, spectrum) {
    if (!wfBufferCtx || !freqs || !spectrum || freqs.length === 0) return;
    if (wfWidth <= 0 || wfHeight <= 0) return;

    // 1) Skrolaj postojeći sadržaj prema dolje za 1 px
    //    drawImage iz iste površine sa offsetom = scroll
    wfBufferCtx.drawImage(wfBuffer, 0, 0, wfWidth, wfHeight - 1, 0, 1, wfWidth, wfHeight - 1);

    // 2) Nacrtaj novi red na y = 0
    const row = wfBufferCtx.createImageData(wfWidth, 1);
    const data = row.data;
    const fMin = freqs[0];
    const fMax = freqs[freqs.length - 1];
    const fRange = fMax - fMin;
    if (fRange <= 0) return;

    for (let x = 0; x < wfWidth; x++) {
      // Mapiraj piksel x na frekvenciju → indeks u spectrum nizu
      const f = fMin + (x / (wfWidth - 1)) * fRange;
      // Binary search bi bio brži, ali freqs je uglavnom uniformno raspodijeljen
      // pa je dovoljna linearna procjena s clamp-om.
      let idx = ((f - fMin) / fRange) * (freqs.length - 1);
      idx = Math.max(0, Math.min(freqs.length - 1, Math.round(idx)));
      const db = spectrum[idx];

      const [r, g, b] = dbToColor(db);
      const off = x * 4;
      data[off]     = r;
      data[off + 1] = g;
      data[off + 2] = b;
      data[off + 3] = 255;
    }
    wfBufferCtx.putImageData(row, 0, 0);

    // 3) Prebaci buffer u vidljivi canvas
    wfCtx.drawImage(wfBuffer, 0, 0);
  }

  function showWaterfall() {
    if (!wfContainer) return;
    if (wfContainer.classList.contains('hidden')) {
      wfContainer.classList.remove('hidden');
      // Container je tek sada vidljiv — re-mjeri da dobijemo stvarnu širinu
      setTimeout(() => {
        resizeWaterfall();
        if (wfBuffer) {
          wfBuffer.width = wfWidth;
          wfBuffer.height = wfHeight;
          wfBufferCtx = wfBuffer.getContext('2d');
          wfBufferCtx.fillStyle = '#000';
          wfBufferCtx.fillRect(0, 0, wfWidth, wfHeight);
          wfCtx.drawImage(wfBuffer, 0, 0);
        }
        updateTargetMarker();
      }, 0);
    }
  }

  function hideWaterfall() {
    if (!wfContainer) return;
    wfContainer.classList.add('hidden');
    if (wfTargetMarker) wfTargetMarker.classList.add('hidden');
  }

  function clearWaterfall() {
    if (!wfBufferCtx || !wfCtx) return;
    wfBufferCtx.fillStyle = '#000';
    wfBufferCtx.fillRect(0, 0, wfWidth, wfHeight);
    wfCtx.drawImage(wfBuffer, 0, 0);
  }

  // Pozicioniraj vertikalnu crvenu liniju target frekvencije.
  function updateTargetMarker() {
    if (!wfTargetMarker || !wfCanvas) return;
    if (!rtlMode || wfFreqMax <= wfFreqMin || rtlTargetFreqHz <= 0) {
      wfTargetMarker.classList.add('hidden');
      return;
    }
    if (rtlTargetFreqHz < wfFreqMin || rtlTargetFreqHz > wfFreqMax) {
      wfTargetMarker.classList.add('hidden');
      return;
    }
    const pct = ((rtlTargetFreqHz - wfFreqMin) / (wfFreqMax - wfFreqMin)) * 100;
    wfTargetMarker.style.left = pct.toFixed(3) + '%';
    wfTargetMarker.classList.remove('hidden');
  }

  function update(fftData) {
    const now = performance.now();
    if (now - lastUpdate < MIN_INTERVAL_MS) return;
    lastUpdate = now;

    if (!chart) return;

    const { freqs, spectrum, peak_hold, dbfs, peak_freq, peaks, noise_floor } = fftData;
    if (!freqs || !spectrum || freqs.length === 0) return;

    // Provjeri je li RTL mod aktivan (backend šalje rtl_mode flag)
    if (fftData.rtl_mode) {
      if (!rtlMode || rtlTargetFreqHz !== fftData.target_freq_hz) {
        rtlMode = true;
        rtlTargetFreqHz = fftData.target_freq_hz || 0;
        rtlCenterFreqHz = fftData.center_freq_hz || 0;

        // Postavi X-os range na podatke iz backenda
        chart.options.scales.x.min = freqs[0];
        chart.options.scales.x.max = freqs[freqs.length - 1];
        chart.options.scales.x.title.text = 'MHz';

        // Pripremi waterfall: zapamti raspon i očisti povijest (drugi target = drugi prikaz)
        wfFreqMin = freqs[0];
        wfFreqMax = freqs[freqs.length - 1];
        showWaterfall();
        clearWaterfall();
        updateTargetMarker();
      }
    } else if (rtlMode) {
      // Vrati na audio mod
      rtlMode = false;
      rtlTargetFreqHz = 0;
      rtlCenterFreqHz = 0;
      chart.options.scales.x.min = 100;
      chart.options.scales.x.max = 3500;
      chart.options.scales.x.title.text = HorusI18n.t('spectrum.freq_axis');
      hideWaterfall();
    }

    const mainPoints = freqs.map((f, i) => ({ x: f, y: spectrum[i] }));
    chart.data.datasets[0].data = mainPoints;

    if (peak_hold && peak_hold.length === freqs.length) {
      const peakPoints = freqs.map((f, i) => ({ x: f, y: peak_hold[i] }));
      chart.data.datasets[1].data = peakPoints;
    }

    if (peaks && peaks.length > 0) {
      chart.data.datasets[2].data = peaks.map(p => ({ x: p.freq, y: p.db }));
    } else {
      chart.data.datasets[2].data = [];
    }

    if (noise_floor !== undefined) {
      const yMin = Math.min(noise_floor - 10, -100);
      chart.options.scales.y.min = Math.max(-120, Math.round(yMin / 10) * 10);

      // Auto-skaliranje waterfall dB raspona: noise floor ± okolina
      // Min ~ noise_floor - 5 dB (sve ispod = crno), Max ~ noise_floor + 50 dB (jak signal = crveno)
      if (rtlMode) {
        wfDbMin = noise_floor - 5;
        wfDbMax = noise_floor + 50;
      }
    }

    // Iscrtaj novi red waterfalla samo u RTL modu
    if (rtlMode) {
      drawWaterfallRow(freqs, spectrum);
    }

    chart.update('none');

    updateDbfsIndicators(dbfs);

    const peakEl = document.getElementById('peakFreqValue');
    const peakUnitEl = document.getElementById('peakFreqUnit');
    if (peakEl && peak_freq !== undefined) {
      if (rtlMode) {
        peakEl.textContent = (peak_freq / 1e6).toFixed(4);
        if (peakUnitEl) peakUnitEl.textContent = 'MHz';
      } else {
        peakEl.textContent = peak_freq.toFixed(0);
        if (peakUnitEl) peakUnitEl.textContent = 'Hz';
      }
    }

    const toneInfoEl = document.getElementById('toneInfoValue');
    if (toneInfoEl) {
      if (peaks && peaks.length > 0) {
        let freqList;
        if (rtlMode) {
          freqList = peaks.map(p => (p.freq / 1e6).toFixed(4)).join(', ');
          toneInfoEl.textContent = `${peaks.length} (${freqList} MHz)`;
        } else {
          freqList = peaks.map(p => p.freq.toFixed(0)).join(', ');
          toneInfoEl.textContent = `${peaks.length} (${freqList} Hz)`;
        }
      } else {
        toneInfoEl.textContent = '---';
      }
    }

    // Prikaži centralnu frekvenciju u RTL modu
    const cfEl = document.getElementById('centerFreqValue');
    if (cfEl) {
      if (rtlMode && fftData.target_freq_mhz) {
        cfEl.textContent = fftData.target_freq_mhz.toFixed(3) + ' MHz';
        cfEl.closest('.stat-item')?.classList.remove('hidden');
      } else {
        cfEl.closest('.stat-item')?.classList.add('hidden');
      }
    }
  }

  function updateDbfsIndicators(dbfs) {
    const dbfsEl = document.getElementById('dbfsValue');
    if (dbfsEl) {
      dbfsEl.textContent = dbfs.toFixed(1);
      if (dbfs > -6)       dbfsEl.className = 'font-mono font-semibold ml-1 text-red-400';
      else if (dbfs > -20) dbfsEl.className = 'font-mono font-semibold ml-1 text-yellow-400';
      else if (dbfs > -60) dbfsEl.className = 'font-mono font-semibold ml-1 text-emerald-400';
      else                 dbfsEl.className = 'font-mono font-semibold ml-1 text-slate-400';
    }

    const bar = document.getElementById('dbfsBar');
    if (bar) {
      const pct = Math.max(0, Math.min(100, (dbfs + 100)));
      bar.style.width = pct + '%';
    }

    const ind = document.getElementById('audioIndicator');
    if (ind) {
      if (dbfs > -6) {
        ind.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-500"></span><span class="text-red-400">${HorusI18n.t('spectrum.clipping')}</span>`;
      } else if (dbfs > -40) {
        ind.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 pulse-green"></span><span class="text-emerald-400">${HorusI18n.t('spectrum.signal_ok')}</span>`;
      } else if (dbfs > -70) {
        ind.innerHTML = `<span class="w-2 h-2 rounded-full bg-yellow-500"></span><span class="text-yellow-400">${HorusI18n.t('spectrum.signal_weak')}</span>`;
      } else {
        ind.innerHTML = `<span class="w-2 h-2 rounded-full bg-slate-600"></span><span class="text-slate-500">${HorusI18n.t('spectrum.signal_none')}</span>`;
      }
    }
  }

  function reset() {
    if (!chart) return;
    chart.data.datasets.forEach(ds => ds.data = []);
    // Reset na audio mod
    rtlMode = false;
    rtlTargetFreqHz = 0;
    rtlCenterFreqHz = 0;
    chart.options.scales.x.min = 100;
    chart.options.scales.x.max = 3500;
    chart.options.scales.x.title.text = HorusI18n.t('spectrum.freq_axis');
    chart.update();
    hideWaterfall();
    clearWaterfall();
    document.getElementById('dbfsValue').textContent = '---';
    document.getElementById('peakFreqValue').textContent = '---';
    const toneInfo = document.getElementById('toneInfoValue');
    if (toneInfo) toneInfo.textContent = '---';
    document.getElementById('dbfsBar').style.width = '0%';
    const cfEl = document.getElementById('centerFreqValue');
    if (cfEl) cfEl.closest('.stat-item')?.classList.add('hidden');
  }

  return { init, update, reset };
})();
