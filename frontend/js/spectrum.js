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

  const darkGrid = 'rgba(148, 163, 184, 0.12)';
  const tickColor = '#94a3b8';

  function init() {
    const ctx = document.getElementById('spectrumChart').getContext('2d');

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
      }
    } else if (rtlMode) {
      // Vrati na audio mod
      rtlMode = false;
      rtlTargetFreqHz = 0;
      rtlCenterFreqHz = 0;
      chart.options.scales.x.min = 100;
      chart.options.scales.x.max = 3500;
      chart.options.scales.x.title.text = HorusI18n.t('spectrum.freq_axis');
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
