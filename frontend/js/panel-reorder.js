// ----------------------------------------------------------------------------
// panel-reorder.js  -  Drag & drop preuređivanje desnih panela (HR/EN/PL)
// ----------------------------------------------------------------------------
// - Posebna "drag" ručka (ikona) u svakom headeru
// - Desktop (miš, HTML5 DnD) + mobitel (touch)
// - Redoslijed se sprema u localStorage (po pregledniku)
// - Ne dira collapse/expand logiku (charts.js); ručka ima vlastiti stopPropagation
// ----------------------------------------------------------------------------

const HorusPanelReorder = (() => {
  'use strict';

  const STORAGE_KEY = 'horus_panel_order';
  // Kontejner s desnim panelima
  const CONTAINER_SELECTOR = 'section.lg\\:col-span-9';
  // Paneli koji se smiju premještati (svi direktni .collapsible-panel s data-panel-id)
  const PANEL_SELECTOR = ':scope > .collapsible-panel[data-panel-id]';

  let container = null;
  let draggingEl = null;

  // ---- localStorage ----------------------------------------------------------
  function _loadOrder() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function _saveOrder(ids) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)); } catch {}
  }

  function _currentIds() {
    return Array.from(container.querySelectorAll(PANEL_SELECTOR))
      .map(p => p.dataset.panelId);
  }

  // ---- Primjena spremljenog redoslijeda --------------------------------------
  function _applyStoredOrder() {
    const saved = _loadOrder();
    if (!saved || !saved.length) return;

    const panels = Array.from(container.querySelectorAll(PANEL_SELECTOR));
    const byId = {};
    panels.forEach(p => { byId[p.dataset.panelId] = p; });

    // Prvo poznati redoslijed iz localStorage, pa svi novi (nepoznati) paneli na kraj
    saved.forEach(id => {
      if (byId[id]) {
        container.appendChild(byId[id]);
        delete byId[id];
      }
    });
    // Preostali (npr. novi panel u budućoj verziji) ostaju na kraju u zatečenom redu
    Object.values(byId).forEach(p => container.appendChild(p));
  }

  // ---- Ručka -----------------------------------------------------------------
  function _t(key, fallback) {
    try {
      if (typeof HorusI18n !== 'undefined' && HorusI18n.t) {
        const v = HorusI18n.t(key);
        if (v && v !== key) return v;
      }
    } catch {}
    return fallback;
  }

  function _makeHandle() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'panel-drag-handle p-1 rounded text-slate-500 hover:text-brand-400 ' +
      'hover:bg-slate-700 transition cursor-grab active:cursor-grabbing touch-none select-none';
    btn.setAttribute('draggable', 'true');
    btn.title = _t('reorder.drag_hint', 'Povuci za promjenu redoslijeda');
    btn.setAttribute('aria-label', btn.title);
    btn.innerHTML = '<i data-lucide="grip-vertical" class="w-4 h-4 pointer-events-none"></i>';
    return btn;
  }

  function _injectHandles() {
    const panels = container.querySelectorAll(PANEL_SELECTOR);
    panels.forEach(panel => {
      const header = panel.querySelector(':scope > .collapsible-panel-header');
      if (!header || header.querySelector('.panel-drag-handle')) return;

      const handle = _makeHandle();

      // Ručka NE smije pokretati collapse: zaustavi klik prema headeru
      handle.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); });

      _bindMouseDnD(handle, panel);
      _bindTouchDnD(handle, panel);

      // Ubaci ručku UNUTAR naslova (h2) kao prvi element — tako dijeli isti
      // razmak (gap) s ikonom naslova i ime panela stoji odmah uz ručku,
      // jednako na svim panelima (bez obzira ima li header gap ili justify-between).
      const titleEl = header.querySelector(':scope > h2');
      if (titleEl) {
        titleEl.insertBefore(handle, titleEl.firstChild);
      } else {
        header.insertBefore(handle, header.firstChild);
      }
    });
  }

  // ---- Desktop: HTML5 Drag & Drop -------------------------------------------
  function _bindMouseDnD(handle, panel) {
    handle.addEventListener('dragstart', e => {
      draggingEl = panel;
      panel.classList.add('panel-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', panel.dataset.panelId); } catch {}
      // Drag slika = cijeli panel, ne sama ikona
      try { e.dataTransfer.setDragImage(panel, 20, 20); } catch {}
    });

    handle.addEventListener('dragend', () => {
      if (draggingEl) draggingEl.classList.remove('panel-dragging');
      draggingEl = null;
      container.querySelectorAll('.panel-drop-target')
        .forEach(el => el.classList.remove('panel-drop-target'));
      _saveOrder(_currentIds());
    });
  }

  function _bindContainerDnD() {
    container.addEventListener('dragover', e => {
      if (!draggingEl) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const after = _getDragAfterElement(e.clientY);
      if (after == null) {
        if (container.lastElementChild !== draggingEl) container.appendChild(draggingEl);
      } else if (after !== draggingEl) {
        container.insertBefore(draggingEl, after);
      }
    });

    container.addEventListener('drop', e => {
      if (draggingEl) e.preventDefault();
    });
  }

  function _getDragAfterElement(y) {
    const els = Array.from(container.querySelectorAll(PANEL_SELECTOR))
      .filter(el => el !== draggingEl);

    let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
    for (const el of els) {
      const box = el.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        closest = { offset, element: el };
      }
    }
    return closest.element;
  }

  // ---- Mobitel: Touch --------------------------------------------------------
  function _bindTouchDnD(handle, panel) {
    let active = false;

    handle.addEventListener('touchstart', e => {
      active = true;
      draggingEl = panel;
      panel.classList.add('panel-dragging');
      e.stopPropagation();
    }, { passive: true });

    handle.addEventListener('touchmove', e => {
      if (!active || !draggingEl) return;
      e.preventDefault(); // spriječi scroll dok premještamo
      const t = e.touches[0];
      const after = _getDragAfterElement(t.clientY);
      if (after == null) {
        if (container.lastElementChild !== draggingEl) container.appendChild(draggingEl);
      } else if (after !== draggingEl) {
        container.insertBefore(draggingEl, after);
      }
    }, { passive: false });

    const end = () => {
      if (!active) return;
      active = false;
      if (draggingEl) draggingEl.classList.remove('panel-dragging');
      draggingEl = null;
      _saveOrder(_currentIds());
    };
    handle.addEventListener('touchend', end);
    handle.addEventListener('touchcancel', end);
  }

  // ---- Reset -----------------------------------------------------------------
  function reset() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    // Najjednostavnije i najpouzdanije: reload vraća izvorni HTML redoslijed
    location.reload();
  }

  // ---- Init ------------------------------------------------------------------
  function init() {
    container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) {
      console.warn('[PanelReorder] kontejner nije pronađen:', CONTAINER_SELECTOR);
      return;
    }
    _applyStoredOrder();
    _injectHandles();
    _bindContainerDnD();

    // Osvježi lucide ikone (grip-vertical) ako je dostupno
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
      try { lucide.createIcons(); } catch {}
    }
  }

  return { init, reset };
})();
