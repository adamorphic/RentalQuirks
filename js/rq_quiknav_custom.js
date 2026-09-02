// rq_quiknav_custom.js
// Custom QuikNav entries and keyboard shortcuts.
// This file is loaded only by RentalQuirks.local.user.js (not the upstream script).
//
// How QuikNav entries work:
//   The module list is built from window.masterController.navigation on first QuikNav focus.
//   To add a custom entry, inject a .quiknav-list-item div into #rq-quiknav-popup after that.
//   Each item needs dataset properties matching what rq_quiknav.js expects:
//     data-caption  — display name (also used for filtering)
//     data-nav      — hash path, e.g. "module/rentalinventory"
//     data-name     — internal module name (used by RQ.api calls)
//     data-code     — (optional) item code field name, e.g. "ICode"

(function initFeatureFlags(RQ) {
    const defaults = {
        customEntries: true,
        shortcuts: true,
        tabReorder: true,
        tabColors: true,
        tabPresets: true,
        bookmarks: true,
        moduleSearch: true,
        numberShortcuts: true,
        recents: true,
        sessionRestore: true,
    };
    RQ.customFeatures = {
        ...defaults,
        ...(RQ.customFeatures ?? {}),
        ...(window.RQ_CUSTOM_FEATURES ?? {}),
    };
})(window.RentalQuirks ||= {});

// Shared tab-bar watcher. RentalWorks recreates #moduletabs > .tabs on module
// navigation, so multiple features need to (re)bind whenever it reappears.
// Rather than each feature spinning up its own always-on, site-wide
// MutationObserver (subtree:true on #application), they register a callback here
// and a single observer notifies all of them. RQ.onTabBar(cb) calls cb(tabBar)
// once immediately if the tab bar already exists, and again every time a new
// tab bar element replaces the old one.
(function (RQ) {
    'use strict';
    const callbacks = [];
    let lastTabBar = null;
    let started = false;

    function check() {
        const tabBar = document.querySelector('#moduletabs > .tabs');
        if (tabBar && tabBar !== lastTabBar) {
            lastTabBar = tabBar;
            callbacks.forEach(cb => {
                try { cb(tabBar); }
                catch (e) { console.error('[RQ] onTabBar callback failed', e); }
            });
        }
    }

    RQ.onTabBar = function (callback) {
        callbacks.push(callback);
        if (started) {
            // Observer already (or soon to be) running; bind now if present.
            check();
            return;
        }
        started = true;
        RQ.runOnAppLoad ||= [];
        RQ.runOnAppLoad.push(() => {
            new MutationObserver(check)
                .observe(document.querySelector('#application') ?? document.body, { childList: true, subtree: true });
            check(); // in case the tab bar already exists at app load
        });
    };
})(window.RentalQuirks);

(function (RQ) {
    'use strict';

    // -------------------------------------------------------------------------
    // CUSTOM QUIKNAV ENTRIES
    // Managed via the RQ Settings panel (profile menu → RQ Settings…).
    // Stored in localStorage under 'rq-custom-entries'.
    // -------------------------------------------------------------------------
    function loadCustomEntries() {
        try { return JSON.parse(localStorage.getItem('rq-custom-entries') || 'null') ?? []; }
        catch { return []; }
    }

    function addCustomQuikNavEntries() {
        // Remove previously injected custom entries to support refresh after settings save
        document.querySelectorAll('#rq-quiknav-popup .quiknav-list-item[data-rq-custom]').forEach(el => {
            if (RQ.quiknav?.modules) {
                const idx = RQ.quiknav.modules.indexOf(el);
                if (idx !== -1) RQ.quiknav.modules.splice(idx, 1);
            }
            el.remove();
        });

        let entries = loadCustomEntries();
        let popup = document.getElementById("rq-quiknav-popup");
        if (!popup) return;

        let create = document.createElement.bind(document);

        entries.forEach(entry => {
            let row = create('div');
            row.className = "quiknav-list-item";
            row.dataset.rqCustom = '1'; // marker so we can remove on refresh

            let icon = create('i');
            icon.className = "material-icons";
            icon.textContent = entry.icon ?? "arrow_forward";

            let capt = create('span');
            capt.className = "caption";
            capt.textContent = entry.caption;

            row.append(icon, capt);

            if (entry.code) {
                let code = create('span');
                code.className = "item-code";
                code.textContent = '[' + entry.code + ']';
                row.append(code);
            }

            // Dataset mirrors what rq_quiknav.js expects
            Object.assign(row.dataset, {
                caption: entry.caption,
                nav:     entry.nav,
                name:    entry.name ?? entry.caption.replaceAll(' ', ''),
                ...(entry.code ? { code: entry.code } : {}),
            });

            popup.appendChild(row);

            // Keep RQ.quiknav.modules in sync so arrow keys / filtering work
            if (RQ.quiknav?.modules) {
                RQ.quiknav.modules.push(row);
            }
        });
    }

    // Expose so the settings panel can trigger a refresh after saving
    RQ.settings ||= {};
    RQ.settings.refreshCustomEntries = addCustomQuikNavEntries;

    // -------------------------------------------------------------------------
    // CUSTOM KEYBOARD SHORTCUTS
    // Add site-wide keyboard shortcuts here.
    // -------------------------------------------------------------------------
   function initCustomShortcuts() {
    document.addEventListener("keydown", function customShortcuts(e) {
        // * key (outside of text fields) → open QuikNav
        if (e.ctrlKey && e.key === 'ArrowUp' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
            e.preventDefault();
            const searchbox = RQ.quiknav.searchbox;
            searchbox.focus();
            searchbox.setSelectionRange(0, searchbox.value.length);
        }

        // Alt+W → close active tab
if (e.altKey && e.key === 'w') {
    e.preventDefault();
    const activeTab = document.querySelector('#moduletabs > .tabs > .tabcontainer > .tab.active');
    if (activeTab) {
        activeTab.querySelector('.delete')?.click();
    }
}


        // Alt+Right → next tab, Alt+Left → previous tab
if (e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    const tabs = [...document.querySelectorAll('#moduletabs > .tabs > .tabcontainer > .tab')];
    if (tabs.length === 0) return;
    const active = document.querySelector('#moduletabs > .tabs > .tabcontainer > .tab.active');
    const currentIndex = active ? tabs.indexOf(active) : -1;
    let nextIndex;
    if (e.key === 'ArrowLeft') {
        nextIndex = currentIndex <= 0 ? tabs.length - 1 : currentIndex - 1;
    } else {
        nextIndex = currentIndex >= tabs.length - 1 ? 0 : currentIndex + 1;
    }
    tabs[nextIndex].click();
}
    });
}

    // -------------------------------------------------------------------------
    // INIT
    // runOnAppLoad fires once RentalWorks is fully loaded and the user is logged in.
    // -------------------------------------------------------------------------
    RQ.runOnAppLoad ||= [];
    RQ.runOnAppLoad.push(function initQuikNavCustom() {
        // QuikNav modules are built on first focus, so we patch in after that event.
        let searchbox = document.getElementById("rq-quiknav");
        if (!searchbox) return;

        if (RQ.customFeatures.customEntries) {
            searchbox.addEventListener('focus', function onFirstFocusCustom() {
                // Run after the upstream quiknav_first_focus has fired and built the list
                setTimeout(addCustomQuikNavEntries, 0);
                searchbox.removeEventListener('focus', onFirstFocusCustom);
            }, { capture: false });
        }

        if (RQ.customFeatures.shortcuts) {
            initCustomShortcuts();
        }
    });

})(window.RentalQuirks);

// Reorderable module tabs via mouse drag
(function(RQ) {
  const dragState = {
    dragging: null,
    placeholder: null,
    startX: 0,
    startY: 0,
    pendingTab: null,
  };
  const DRAG_THRESHOLD = 5;
  let reorderListenersBound = false;

  function bindReorderListeners() {
    if (reorderListenersBound) return;
    reorderListenersBound = true;

    document.addEventListener('mousemove', (e) => {
      if (!dragState.pendingTab && !dragState.dragging) return;

      if (dragState.pendingTab && !dragState.dragging) {
        const dx = Math.abs(e.clientX - dragState.startX);
        const dy = Math.abs(e.clientY - dragState.startY);
        if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;

        dragState.dragging = dragState.pendingTab;
        dragState.pendingTab = null;

        dragState.placeholder = document.createElement('div');
        dragState.placeholder.style.cssText = `
          display: inline-block;
          width: ${dragState.dragging.offsetWidth}px;
          height: ${dragState.dragging.offsetHeight}px;
          background: rgba(255,255,255,0.1);
          border: 2px dashed #888;
          vertical-align: top;
          box-sizing: border-box;
          flex-shrink: 0;
        `;
        dragState.dragging.parentNode.insertBefore(dragState.placeholder, dragState.dragging);
        dragState.dragging.style.cssText += `
          position: fixed;
          z-index: 9999;
          opacity: 0.8;
          pointer-events: none;
          width: ${dragState.dragging.offsetWidth}px;
        `;
      }

      if (dragState.dragging) {
        dragState.dragging.style.left = e.clientX - dragState.dragging.offsetWidth / 2 + 'px';
        dragState.dragging.style.top = e.clientY - dragState.dragging.offsetHeight / 2 + 'px';

        dragState.dragging.style.display = 'none';
        const hoveredElem = document.elementFromPoint(e.clientX, e.clientY);
        dragState.dragging.style.display = '';

        const hoveredTab = hoveredElem?.closest('.tab');
        if (hoveredTab && hoveredTab !== dragState.dragging) {
          const rect = hoveredTab.getBoundingClientRect();
          if (e.clientX < rect.left + rect.width / 2) {
            hoveredTab.parentNode.insertBefore(dragState.placeholder, hoveredTab);
          } else {
            hoveredTab.parentNode.insertBefore(dragState.placeholder, hoveredTab.nextSibling);
          }
        }
      }
    });

    document.addEventListener('mouseup', () => {
      dragState.pendingTab = null;
      if (!dragState.dragging) return;

      dragState.dragging.style.cssText = '';
      dragState.placeholder.parentNode.insertBefore(dragState.dragging, dragState.placeholder);
      dragState.placeholder.remove();
      dragState.dragging = null;
      dragState.placeholder = null;
    });
  }

  function attachTabReorder(tabContainer) {
    if (tabContainer.dataset.rqTabReorderBound === '1') return;
    tabContainer.dataset.rqTabReorderBound = '1';

    bindReorderListeners();

    // Listen on the tab strip, but keep drag movement on document so the drag
    // continues smoothly even if the cursor leaves the tab bar.
    tabContainer.addEventListener('mousedown', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      dragState.pendingTab = tab;
      dragState.startX = e.clientX;
      dragState.startY = e.clientY;
    });

    console.log('[RQ] Reorderable tabs initialized');
  }

  if (RQ.customFeatures.tabReorder) {
    RQ.onTabBar(attachTabReorder);
  }
})(window.RentalQuirks);



// Tab color coding via right-click menu
(function(RQ) {
  const COLORS = [
    '#e53935', '#d81b60', '#8e24aa', '#3949ab',
    '#1e88e5', '#00897b', '#43a047', '#f4511e',
    '#fb8c00', '#fdd835', '#ffffff', 'transparent'
  ];

  const STORAGE_KEY = 'rq-tab-colors';

  function loadTabColors() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
  }

  function saveTabColor(tabCaption, color) {
    const colors = loadTabColors();
    if (color === 'transparent') delete colors[tabCaption];
    else colors[tabCaption] = color;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
  }

  function setTabColor(tab, color) {
    tab.querySelector('.rq-tab-colorbar')?.remove();
    if (!color) return;
    const bar = document.createElement('div');
    bar.className = 'rq-tab-colorbar';
    bar.style.cssText = `
      position: absolute; bottom: 0; left: 0; right: 0;
      height: 3px; background: ${color};
      pointer-events: none; z-index: 999;
    `;
    tab.style.position = 'relative';
    tab.appendChild(bar);
  }

  function applyTabColors(tabContainer) {
    const colors = loadTabColors();
    tabContainer.querySelectorAll('.tab').forEach(tab => {
      const caption = tab.querySelector('.caption')?.textContent?.trim();
      if (caption && colors[caption]) setTabColor(tab, colors[caption]);
    });
  }

  function createColorMenu(tab) {
    document.getElementById('rq-color-menu')?.remove();
    const caption = tab.querySelector('.caption')?.textContent?.trim();
    const menu = document.createElement('div');
    menu.id = 'rq-color-menu';
    menu.style.cssText = `
      position: fixed; z-index: 99999; background: #2e2e2e;
      border: 1px solid #555; border-radius: 6px; padding: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      display: flex; flex-wrap: wrap; gap: 6px; width: 160px;
    `;

    COLORS.forEach(color => {
      const swatch = document.createElement('div');
      swatch.style.cssText = `
        width: 24px; height: 24px; border-radius: 50%;
        background: ${color}; border: 2px solid #888;
        cursor: pointer; box-sizing: border-box;
        ${color === 'transparent' ? 'background: repeating-conic-gradient(#aaa 0% 25%, #fff 0% 50%) 0 0 / 8px 8px;' : ''}
      `;
      swatch.title = color === 'transparent' ? 'Clear color' : color;
      swatch.addEventListener('click', () => {
        setTabColor(tab, color === 'transparent' ? null : color);
        saveTabColor(caption, color);
        menu.remove();
      });
      menu.appendChild(swatch);
    });

    return menu;
  }

  function attachColorMenu(tabContainer) {
    tabContainer.addEventListener('contextmenu', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      e.preventDefault();
      e.stopPropagation();
      const menu = createColorMenu(tab);
      document.body.appendChild(menu);
      const x = Math.min(e.clientX, window.innerWidth - 180);
      const y = Math.min(e.clientY, window.innerHeight - 120);
      menu.style.left = x + 'px';
      menu.style.top = y + 'px';
      setTimeout(() => {
        document.addEventListener('mousedown', function close(e2) {
          if (!menu.contains(e2.target)) { menu.remove(); document.removeEventListener('mousedown', close); }
        });
      }, 0);
    });

    new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          const tab = node.classList?.contains('tab') ? node : node.querySelector?.('.tab');
          if (!tab) return;
          const caption = tab.querySelector('.caption')?.textContent?.trim();
          const colors = loadTabColors();
          if (caption && colors[caption]) setTabColor(tab, colors[caption]);
        });
      });
    }).observe(tabContainer, { childList: true, subtree: true });

    applyTabColors(tabContainer);
    console.log('[RQ] Tab color coding initialized');
  }

  if (RQ.customFeatures.tabColors) {
    RQ.onTabBar(attachColorMenu);
  }
})(window.RentalQuirks);





// Tab presets
(function(RQ) {
  const STORAGE_KEY = 'rq-tab-presets';

  function loadPresets() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
  }

  function savePresets(presets) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  }

  function getCurrentTabs() {
    return [...document.querySelectorAll('#moduletabs > .tabs > .tabcontainer > .tab')]
      .map(tab => {
        const tabpageid = tab.dataset.tabpageid;
        const tabtype = tab.dataset.tabtype;
        const caption = tab.dataset.caption;
        if (tabtype === 'FORM') {
          const tabpage = document.getElementById(tabpageid);
          const form = tabpage?.querySelector('[data-controller]');
          if (!form) return null;
          const controller = form.dataset.controller;
          const module = controller.replace('Controller', '')
          const numberField = tabpage.querySelector(`[data-datafield="${controller.replace('Controller', '')}Number"] input`);
          const recordNumber = numberField?.value;
          if (!recordNumber) return null;
          return { tabtype: 'FORM', module, recordNumber, caption };
        }
        return { tabtype: 'BROWSE', caption };
      })
      .filter(Boolean);
  }

  function getNavFromCaption(caption) {
    let nav = null;
    window.masterController?.navigation?.forEach(root => {
      if (root.navigation && root.caption === caption) nav = root.navigation;
      else if (root.children) {
        root.children.forEach(child => {
          if (child.caption === caption) nav = child.nav;
        });
      }
    });
    return nav;
  }

  function closeAllTabs() {
    [...document.querySelectorAll('#moduletabs > .tabs > .tabcontainer > .tab .delete')]
      .forEach(btn => btn.click());
  }

  function loadPreset(tabs, closeFirst) {
    if (closeFirst) closeAllTabs();
    setTimeout(() => {
      const alreadyOpen = new Set(
        [...document.querySelectorAll('#moduletabs > .tabs > .tabcontainer > .tab')]
          .map(t => t.dataset.caption)
      );
      const browseTabs = tabs.filter(t => t.tabtype === 'BROWSE' && !alreadyOpen.has(t.caption));
      const formTabs = tabs.filter(t => t.tabtype === 'FORM');
      browseTabs.forEach(tab => {
        const nav = getNavFromCaption(tab.caption);
        if (nav) RQ.load_module_as_tab(nav);
      });
      setTimeout(() => {
        formTabs.forEach(tab => {
          RQ.api.open_record_by_number(tab.module, tab.recordNumber);
        });
      }, 1000);
    }, closeFirst ? 500 : 0);
  }

  function removeMenu() {
    document.getElementById('rq-preset-menu')?.remove();
  }

  function showPresetMenu(x, y) {
    removeMenu();
    const presets = loadPresets();
    const menu = document.createElement('div');
    menu.id = 'rq-preset-menu';
    menu.style.cssText = `
      position: fixed; z-index: 99999; background: #2e2e2e;
      border: 1px solid #555; border-radius: 6px; padding: 6px 0;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      min-width: 180px; font-size: 13px; color: #e0e0e0;
    `;

    const menuItem = (label, onClick) => {
      const item = document.createElement('div');
      item.textContent = label;
      item.style.cssText = 'padding: 7px 14px; cursor: pointer;';
      item.addEventListener('mouseenter', () => item.style.background = '#444');
      item.addEventListener('mouseleave', () => item.style.background = '');
      item.addEventListener('click', () => { removeMenu(); onClick(); });
      return item;
    };

    const divider = () => {
      const d = document.createElement('div');
      d.style.cssText = 'border-top: 1px solid #444; margin: 4px 0;';
      return d;
    };

    menu.appendChild(menuItem('💾  Save as preset...', () => {
      const name = prompt('Preset name:');
      if (!name?.trim()) return;
      const p = loadPresets();
      p[name.trim()] = getCurrentTabs();
      savePresets(p);
    }));

    const presetNames = Object.keys(presets);
    if (presetNames.length > 0) {
      menu.appendChild(divider());
      presetNames.forEach(name => {
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; align-items: center; padding: 0 6px;';
        const load = document.createElement('div');
        load.textContent = '📂  ' + name;
        load.style.cssText = 'flex: 1; padding: 7px 8px; cursor: pointer;';
        load.addEventListener('mouseenter', () => row.style.background = '#444');
        load.addEventListener('mouseleave', () => row.style.background = '');
        load.addEventListener('click', (e) => {
  e.stopPropagation();
  // Remove any existing submenu
  document.getElementById('rq-preset-submenu')?.remove();

  const sub = document.createElement('div');
  sub.id = 'rq-preset-submenu';
  sub.style.cssText = `
    position: fixed; z-index: 999999; background: #2e2e2e;
    border: 1px solid #555; border-radius: 6px; padding: 6px 0;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    min-width: 180px; font-size: 13px; color: #e0e0e0;
  `;

  const subItem = (label, onClick) => {
    const item = document.createElement('div');
    item.textContent = label;
    item.style.cssText = 'padding: 7px 14px; cursor: pointer;';
    item.addEventListener('mouseenter', () => item.style.background = '#444');
    item.addEventListener('mouseleave', () => item.style.background = '');
    item.addEventListener('click', () => {
      sub.remove();
      removeMenu();
      onClick();
    });
    return item;
  };

  sub.appendChild(subItem('Replace current tabs', () => loadPreset(presets[name], true)));
  sub.appendChild(subItem('Add alongside current tabs', () => loadPreset(presets[name], false)));

  document.body.appendChild(sub);
  sub.style.left = Math.min(e.clientX + 10, window.innerWidth - 200) + 'px';
  sub.style.top = Math.min(e.clientY, window.innerHeight - 100) + 'px';

  setTimeout(() => {
    document.addEventListener('mousedown', function closeSub(e2) {
      if (!sub.contains(e2.target)) {
        sub.remove();
        document.removeEventListener('mousedown', closeSub);
      }
    });
  }, 0);
});
        const del = document.createElement('div');
        del.textContent = '✕';
        del.title = 'Delete preset';
        del.style.cssText = 'padding: 7px 8px; cursor: pointer; color: #f88; font-size: 11px;';
        del.addEventListener('mouseenter', () => { del.style.color = '#ff4444'; del.style.background = 'rgba(255,68,68,0.1)'; del.style.borderRadius = '3px'; });
        del.addEventListener('mouseleave', () => { del.style.color = '#f88'; del.style.background = ''; });
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          removeMenu();
          if (confirm(`Delete preset "${name}"?`)) { const p = loadPresets(); delete p[name]; savePresets(p); }
        });
        row.append(load, del);
        menu.appendChild(row);
      });
    }

    if (window.RQ_bookmarks?.buildBookmarkRows) {
      window.RQ_bookmarks.buildBookmarkRows(menu, divider, removeMenu);
    }

    document.body.appendChild(menu);
    menu.style.left = Math.min(x, window.innerWidth - 200) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - menu.offsetHeight - 10) + 'px';

    setTimeout(() => {
      document.addEventListener('mousedown', function close(e) {
        if (!menu.contains(e.target)) { removeMenu(); document.removeEventListener('mousedown', close); }
      });
    }, 0);
  }

  function attachPresets(tabBar) {
    tabBar.addEventListener('contextmenu', (e) => {
      const tab = e.target.closest('.tab');
      if (tab) return;
      e.preventDefault();
      showPresetMenu(e.clientX, e.clientY);
    });
    console.log('[RQ] Tab presets initialized');
  }

  if (RQ.customFeatures.tabPresets) {
    RQ.onTabBar(attachPresets);
  }
})(window.RentalQuirks);






// Record bookmarks
(function(RQ) {
  const STORAGE_KEY = 'rq-bookmarks';

  const COLOR_TAGS = [
    { label: 'Red',    value: '#e53935' },
    { label: 'Orange', value: '#fb8c00' },
    { label: 'Yellow', value: '#fdd835' },
    { label: 'Green',  value: '#43a047' },
    { label: 'Blue',   value: '#1e88e5' },
    { label: 'Purple', value: '#8e24aa' },
    { label: 'None',   value: null      },
  ];

  function loadBookmarks() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  }

  function saveBookmarks(bookmarks) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
  }

  function getRecordInfo(form) {
    const controller = form.dataset.controller;
    if (!controller || !controller.endsWith('Controller')) return null;
    const module = controller.replace('Controller', '');
    const numberField = form.querySelector(`[data-datafield="${module}Number"] input`);
    const descField = form.querySelector(`[data-datafield="Description"] input, [data-datafield="ICode"] input`);
    const recordNumber = numberField?.value;
    const description = descField?.value;
    if (!recordNumber) return null;
    return { module, moduleLower: module.toLowerCase(), recordNumber, description, caption: `${recordNumber}${description ? ' — ' + description : ''}`, tags: [], colorTag: null };
  }

  function isBookmarked(module, recordNumber) {
    return loadBookmarks().some(b => b.module === module && b.recordNumber === recordNumber);
  }

  function toggleBookmark(info) {
    const bookmarks = loadBookmarks();
    const idx = bookmarks.findIndex(b => b.module === info.module && b.recordNumber === info.recordNumber);
    if (idx >= 0) bookmarks.splice(idx, 1);
    else bookmarks.unshift({ ...info, tags: [], colorTag: null });
    saveBookmarks(bookmarks);
    return idx < 0;
  }

  function createStarButton(form) {
    const info = getRecordInfo(form);
    if (!info || form.querySelector('.rq-bookmark-btn')) return;
    const btn = document.createElement('div');
    btn.className = 'rq-bookmark-btn';
    const starred = isBookmarked(info.module, info.recordNumber);
    btn.textContent = starred ? '★' : '☆';
    btn.title = starred ? 'Remove bookmark' : 'Bookmark this record';
    btn.style.cssText = `
      position: absolute; top: 12px; right: 48px;
      font-size: 22px; cursor: pointer; z-index: 100;
      color: ${starred ? '#fdd835' : '#888'};
      transition: color 0.2s, transform 0.1s;
      user-select: none; line-height: 1;
    `;
    btn.addEventListener('mouseenter', () => btn.style.transform = 'scale(1.2)');
    btn.addEventListener('mouseleave', () => btn.style.transform = 'scale(1)');
    btn.addEventListener('click', () => {
      const info = getRecordInfo(form);
      if (!info) return;
      const added = toggleBookmark(info);
      btn.textContent = added ? '★' : '☆';
      btn.style.color = added ? '#fdd835' : '#888';
      btn.title = added ? 'Remove bookmark' : 'Bookmark this record';
    });
    form.style.position = 'relative';
    form.appendChild(btn);
  }

  function showEditBookmarkMenu(bookmark, x, y, onSave) {
    document.getElementById('rq-bookmark-edit')?.remove();
    const menu = document.createElement('div');
    menu.id = 'rq-bookmark-edit';
    menu.style.cssText = `
      position: fixed; z-index: 999999;
      background: #2e2e2e; border: 1px solid #555;
      border-radius: 8px; padding: 12px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      min-width: 220px; color: #e0e0e0; font-size: 13px;
    `;

    // Tags input
    const tagsLabel = document.createElement('div');
    tagsLabel.textContent = 'Tags (comma separated)';
    tagsLabel.style.cssText = 'font-size: 10px; color: #888; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.1em;';
    const tagsInput = document.createElement('input');
    tagsInput.type = 'text';
    tagsInput.value = (bookmark.tags || []).join(', ');
    tagsInput.placeholder = 'e.g. priority, follow-up';
    tagsInput.style.cssText = `
      width: 100%; box-sizing: border-box;
      background: #1e1e1e; border: 1px solid #555;
      border-radius: 4px; color: #e0e0e0;
      padding: 5px 8px; font-size: 12px; margin-bottom: 10px;
    `;

    // Color tag
    const colorLabel = document.createElement('div');
    colorLabel.textContent = 'Color Tag';
    colorLabel.style.cssText = 'font-size: 10px; color: #888; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.1em;';
    const colorRow = document.createElement('div');
    colorRow.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px;';

    let selectedColor = bookmark.colorTag ?? null;
    const swatches = COLOR_TAGS.map(ct => {
      const swatch = document.createElement('div');
      swatch.style.cssText = `
        width: 20px; height: 20px; border-radius: 50%;
        background: ${ct.value ?? 'transparent'}; cursor: pointer;
        border: 2px solid ${selectedColor === ct.value ? '#fff' : '#555'};
        box-sizing: border-box;
        ${ct.value === null ? 'background: repeating-conic-gradient(#aaa 0% 25%, #555 0% 50%) 0 0 / 8px 8px;' : ''}
      `;
      swatch.title = ct.label;
      swatch.addEventListener('click', () => {
        selectedColor = ct.value;
        swatches.forEach((s, i) => {
          s.style.border = `2px solid ${COLOR_TAGS[i].value === selectedColor ? '#fff' : '#555'}`;
        });
      });
      colorRow.appendChild(swatch);
      return swatch;
    });

    // Save button
    const saveBtn = document.createElement('div');
    saveBtn.textContent = 'Save';
    saveBtn.style.cssText = `
      background: #1e88e5; color: #fff; border-radius: 4px;
      padding: 5px 12px; cursor: pointer; text-align: center;
      font-size: 12px; font-weight: bold;
    `;
    saveBtn.addEventListener('click', () => {
      const tags = tagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
      onSave({ tags, colorTag: selectedColor });
      menu.remove();
    });

    menu.append(tagsLabel, tagsInput, colorLabel, colorRow, saveBtn);
    document.body.appendChild(menu);
    menu.style.left = Math.min(x, window.innerWidth - 240) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 200) + 'px';

    setTimeout(() => {
      document.addEventListener('mousedown', function close(e) {
        if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close); }
      });
    }, 0);
  }

  // Build bookmark rows
  function buildBookmarkRows(menu, divider, removeMenu) {
    const bookmarks = loadBookmarks();
    if (bookmarks.length === 0) return;

    menu.appendChild(divider());
    const header = document.createElement('div');
    header.textContent = 'BOOKMARKS';
    header.style.cssText = 'padding: 4px 14px; font-size: 10px; color: #888; letter-spacing: 0.1em;';
    menu.appendChild(header);


    bookmarks.forEach((bookmark, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; align-items: center; padding: 0 6px; cursor: pointer;';
    

      // Color indicator
      const dot = document.createElement('div');
      dot.style.cssText = `
        width: 8px; height: 8px; border-radius: 50%;
        background: ${bookmark.colorTag ?? 'transparent'};
        border: 1px solid ${bookmark.colorTag ? bookmark.colorTag : '#555'};
        margin-right: 6px; flex-shrink: 0;
      `;

      // Label
      const load = document.createElement('div');
      const tagStr = bookmark.tags?.length ? ` [${bookmark.tags.join(', ')}]` : '';
      load.textContent = '★  ' + bookmark.caption + tagStr;
      load.style.cssText = 'flex: 1; padding: 6px 4px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
      load.addEventListener('mouseenter', () => row.style.background = '#444');
      load.addEventListener('mouseleave', () => row.style.background = '');
      load.addEventListener('click', () => { removeMenu(); window._rqOpenRecord(bookmark); });

      // Edit button
      const edit = document.createElement('div');
      edit.textContent = '✎';
      edit.title = 'Edit tags & color';
      edit.style.cssText = 'padding: 6px 5px; cursor: pointer; color: #aaa; font-size: 12px;';
      edit.addEventListener('click', (e) => {
        e.stopPropagation();
        showEditBookmarkMenu(bookmark, e.clientX, e.clientY, ({ tags, colorTag }) => {
          const all = loadBookmarks();
          const idx = all.findIndex(b => b.module === bookmark.module && b.recordNumber === bookmark.recordNumber);
          if (idx >= 0) { all[idx].tags = tags; all[idx].colorTag = colorTag; saveBookmarks(all); }
        });
      });

      // Delete button
      const del = document.createElement('div');
      del.addEventListener('mouseenter', () => { del.style.color = '#ff4444'; del.style.background = 'rgba(255,68,68,0.1)'; del.style.borderRadius = '3px'; });
del.addEventListener('mouseleave', () => { del.style.color = '#f88'; del.style.background = ''; });
      del.textContent = '✕';
      del.title = 'Remove bookmark';
      del.style.cssText = 'padding: 6px 5px; cursor: pointer; color: #f88; font-size: 11px;';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        removeMenu();
        const all = loadBookmarks();
        saveBookmarks(all.filter(b => !(b.module === bookmark.module && b.recordNumber === bookmark.recordNumber)));
        document.querySelectorAll('.rq-bookmark-btn').forEach(btn => {
          const form = btn.closest('[data-controller]');
          if (!form) return;
          const controller = form.dataset.controller;
          if (!controller?.endsWith('Controller')) return;
          const formModule = controller.replace('Controller', '');
          if (formModule !== bookmark.module) return;
          const info = form.querySelector(`[data-datafield] input[value="${bookmark.recordNumber}"]`);
          if (info) { btn.textContent = '☆'; btn.style.color = '#888'; }
        });
      });

    

      row.append(dot, load, edit, del);
      menu.appendChild(row);
    });
  }

  window.RQ_bookmarks = { loadBookmarks, buildBookmarkRows };
  window._rqOpenRecord = function(bookmark) {
    RQ.api.open_record_by_number(bookmark.module, bookmark.recordNumber);
  };

  function initBookmarks() {
    // RW adds the form node first, then adds form_load_complete as a class once loaded —
    // so watching for class addition is more reliable than watching for node insertion.
    on_class_added('form_load_complete', document.body, (form) => {
      if (!form.matches('.fwform[data-controller]')) return;
      if (form.dataset.rqSeen) return;
      form.dataset.rqSeen = '1';
      createStarButton(form);
    });
    // Also catch any forms already loaded on init
    document.querySelectorAll('.fwform.form_load_complete[data-controller]').forEach(form => {
      form.dataset.rqSeen = '1'; createStarButton(form);
    });
    console.log('[RQ] Record bookmarks initialized');
  }

  RQ.runOnAppLoad ||= [];
  if (RQ.customFeatures.bookmarks) {
    RQ.runOnAppLoad.push(initBookmarks);
  }
})(window.RentalQuirks);









// QuikNav → open module with filter pre-applied
(function(RQ) {

  // ── Module config ─────────────────────────────────────────────────
  // Managed via the RQ Settings panel (profile menu → RQ Settings…).
  // Stored in localStorage under 'rq-module-search-shortcuts'.
  const DEFAULT_SEARCH_SHORTCUTS = [
    { prefix: 'ri', nav: 'module/rentalinventory', filterField: 'Description' },
    { prefix: 'si', nav: 'module/salesinventory',  filterField: 'Description' },
    { prefix: 'o',  nav: 'module/order',           filterField: 'Description' },
    { prefix: 'q',  nav: 'module/quote',           filterField: 'Description' },
    { prefix: 'd',  nav: 'module/deal',            filterField: 'DealName'    },
    { prefix: 'c',  nav: 'module/customer',        filterField: 'CustomerName'},
    { prefix: 'a',  nav: 'module/asset',           filterField: 'BarCode'     },
    { prefix: 'co', nav: 'module/contract',        filterField: 'Description' },
  ];

  function getSearchConfig() {
    let shortcuts;
    try { shortcuts = JSON.parse(localStorage.getItem('rq-module-search-shortcuts') || 'null') ?? DEFAULT_SEARCH_SHORTCUTS; }
    catch { shortcuts = DEFAULT_SEARCH_SHORTCUTS; }
    const config = {};
    shortcuts.forEach(s => { config[s.prefix.toLowerCase()] = { nav: s.nav, filterField: s.filterField }; });
    return config;
  }

  function getCaptionFromNav(nav) {
    let caption = null;
    window.masterController?.navigation?.forEach(root => {
      if (root.navigation === nav) caption = root.caption;
      else if (root.children) {
        root.children.forEach(child => {
          if (child.nav === nav) caption = child.caption;
        });
      }
    });
    return caption;
  }

  function getActiveBrowseTabPage(expectedCaption = null) {
    const browseTab = document.querySelector('#moduletabs .tabpage.active[data-tabtype="BROWSE"]');
    if (!browseTab) return null;
    if (!expectedCaption) return browseTab;

    const activeTab = document.querySelector('#moduletabs > .tabs > .tabcontainer > .tab.active');
    const activeCaption = activeTab?.dataset.caption ?? activeTab?.querySelector('.caption')?.textContent?.trim();
    return activeCaption === expectedCaption ? browseTab : null;
  }

  function applyBrowseFilter(filterField, keywords, expectedCaption = null) {
    // Try to find the filter input in the intended active browse tab
    const browseTab = getActiveBrowseTabPage(expectedCaption);
    if (!browseTab) return false;

    const input = browseTab.querySelector(`.field[data-browsedatafield="${filterField}"] input`);
    if (!input) return false;

    // Join keywords with space — RentalWorks "contains" filter handles it
    const filterValue = keywords.join(',');
    input.value = filterValue;

    // Trigger RentalWorks' own filter logic
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));

    console.log(`[RQ] Applied filter "${filterValue}" to ${filterField}`);
    return true;
  }

  function waitForBrowseAndFilter(nav, filterField, keywords, attempts = 0) {
    if (attempts > 30) {
      console.warn('[RQ] Timed out waiting for browse tab');
      return;
    }

    // Check if the intended browse tab is active and has filter inputs loaded
    const expectedCaption = getCaptionFromNav(nav);
    const browseTab = getActiveBrowseTabPage(expectedCaption);
    const input = browseTab?.querySelector(`.field[data-browsedatafield="${filterField}"] input`);

    if (input) {
      // Small extra delay to let RentalWorks finish rendering
      setTimeout(() => applyBrowseFilter(filterField, keywords, expectedCaption), 150);
    } else {
      setTimeout(() => waitForBrowseAndFilter(nav, filterField, keywords, attempts + 1), 200);
    }
  }

  function handleModuleSearch(prefix, keywords) {
    const config = getSearchConfig()[prefix.toLowerCase()];
    if (!config) return false;

    // Open or switch to the module browse tab
    RQ.load_module_as_tab(config.nav);

    // Wait for it to be ready, then apply filter
    waitForBrowseAndFilter(config.nav, config.filterField, keywords);
    return true;
  }

  function initModuleSearch() {
    const searchbox = document.getElementById('rq-quiknav');
    if (!searchbox) return;

    // input listener — registered once
    searchbox.addEventListener('input', (e) => {
  const val = e.target.value;
  const hasComma = val.includes(',');

  if (!hasComma) {
    document.querySelectorAll('#rq-quiknav-popup .rq-hidden-for-search').forEach(el => {
      el.classList.remove('rq-hidden-for-search', 'hidden');
      el.style.display = ''; // clear any lingering inline style
    });
    return;
  }

  document.querySelectorAll('#rq-quiknav-popup .quiknav-list-item:not(.rq-recent-item)').forEach(el => {
    el.classList.add('rq-hidden-for-search', 'hidden');
    el.classList.remove('selected');
    el.style.display = '';
  });
});

    // blur listener — registered once
    searchbox.addEventListener('blur', () => {
      setTimeout(() => {
        document.querySelectorAll('#rq-quiknav-popup .quiknav-list-item.rq-hidden-for-search').forEach(el => {
          el.classList.remove('rq-hidden-for-search');
          el.style.display = '';
        });
      }, 200);
    });

    // keydown listener — registered once
    searchbox.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const val = searchbox.value.trim();
      if (!val.includes(',')) return;
      const match = /^([a-z]+)\s+(.+)$/i.exec(val);
      if (!match) return;
      const prefix = match[1].toLowerCase();
      const rest = match[2];
      const keywords = rest.split(',').map(k => k.trim()).filter(k => k.length > 0);
      if (keywords.length === 0) return;
      if (!getSearchConfig()[prefix]) return;
      e.preventDefault();
      searchbox.value = '';
      searchbox.blur();
      handleModuleSearch(prefix, keywords);
    });

    console.log('[RQ] Module search initialized');
  }

  RQ.runOnAppLoad ||= [];
  if (RQ.customFeatures.moduleSearch) {
    RQ.runOnAppLoad.push(initModuleSearch);
  }
})(window.RentalQuirks);


// Number shortcuts — bare-number lookup with configurable prefix
// e.g., type "51540" → tries Order LA51540, then Quote LA51540, etc.
(function(RQ) {
  const STORAGE_KEY = 'rq-number-shortcuts';
  const DEFAULT_NUMBER_SHORTCUTS = [
    { pattern: '^\\d{3,7}$', module: 'Order', prefix: 'LA' },
    { pattern: '^\\d{3,7}$', module: 'Quote', prefix: 'LA' }
  ];

  function getNumberShortcutConfig() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') ?? DEFAULT_NUMBER_SHORTCUTS; }
    catch { return DEFAULT_NUMBER_SHORTCUTS; }
  }

  async function tryNumberShortcuts(val) {
    const config = getNumberShortcutConfig();
    const candidates = config.filter(s => new RegExp(s.pattern, 'i').test(val));
    if (candidates.length === 0) return null;

    // Try each matching shortcut in order until one succeeds
    for (const shortcut of candidates) {
      const fullCode = shortcut.prefix + val;
      try {
        const id = await RQ.api.get_id_from_code(shortcut.module, fullCode);
        if (id) return { module: shortcut.module, id };
      } catch (err) {
        // Continue to next candidate
      }
    }
    return null; // No match found in any candidate
  }

  function initNumberShortcuts() {
    const searchbox = document.getElementById('rq-quiknav');
    if (!searchbox) return;

    // Register with capture: true to fire BEFORE quiknav_keydown (bubble phase)
    // This way we can intercept number-only inputs and handle them specially
    searchbox.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.repeat) return;
      const val = searchbox.value.trim();
      if (!val) return;

      // Check if any pattern matches BEFORE awaiting async lookups
      const config = getNumberShortcutConfig();
      const candidates = config.filter(s => new RegExp(s.pattern, 'i').test(val));
      if (candidates.length === 0) return; // No match — fall through to normal quiknav_keydown handling

      // Potential match found — prevent normal handler NOW (before async ops)
      e.preventDefault();
      e.stopImmediatePropagation();

      // Now try to find a record asynchronously
      tryNumberShortcuts(val).then(result => {
        if (result) {
          RQ.api.open_form_tab(result.module, result.id);
        } else {
          console.warn(`[RQ] Number shortcut: no record found for ${val}`);
        }
        searchbox.value = '';
        searchbox.blur();
      });
    }, { capture: true });

    console.log('[RQ] Number shortcuts initialized');
  }

  RQ.runOnAppLoad ||= [];
  if (RQ.customFeatures.numberShortcuts) {
    RQ.runOnAppLoad.push(initNumberShortcuts);
  }
})(window.RentalQuirks);









// Recent records in QuikNav
(function(RQ) {
  const STORAGE_KEY = 'rq-recent-records';
  const MAX_RECENTS = 10;

  function loadRecents() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  }

  function saveRecents(recents) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recents));
  }

  function trackRecord(form) {
    const controller = form.dataset.controller;
    if (!controller?.endsWith('Controller')) return;
    const module = controller.replace('Controller', '');
    const numberField = form.querySelector(`[data-datafield="${module}Number"] input`);
    const descField = form.querySelector(`[data-datafield="Description"] input, [data-datafield="ICode"] input`);
    const recordNumber = numberField?.value;
    const description = descField?.value;
    if (!recordNumber) return;
    const entry = {
      module, recordNumber,
      caption: `${recordNumber}${description ? ' — ' + description : ''}`,
      icon: getModuleIcon(module),
      time: Date.now()
    };
    const recents = loadRecents().filter(r => !(r.module === module && r.recordNumber === recordNumber));
    recents.unshift(entry);
    saveRecents(recents.slice(0, MAX_RECENTS));
  }

  function getModuleIcon(module) {
    const icons = {
      Order: 'assignment', Quote: 'request_quote', Deal: 'handshake',
      Customer: 'person', RentalInventory: 'videocam', SalesInventory: 'sell',
      Asset: 'qr_code', Contract: 'description', Invoice: 'receipt',
    };
    return icons[module] ?? 'open_in_new';
  }

  // Rebuild recent rows on each focus. Rows persist in DOM between focuses so that
  // the upstream arrow-key and Enter handlers (rq_quiknav.js) can reach them via
  // querySelector without any special coordination.
  function refreshRecents(popup) {
    // Remove previous recent rows and chrome
    popup.querySelectorAll('.rq-recents-header, .rq-recents-divider, .rq-recent-item')
      .forEach(el => el.remove());

    const recents = loadRecents();
    if (recents.length === 0) return;

    const header = document.createElement('div');
    header.className = 'rq-recents-header';
    header.style.cssText = 'padding: 4px 14px 2px; font-size: 10px; color: #888; letter-spacing: 0.1em; font-weight: bold;';
    header.textContent = 'RECENT';

    const divider = document.createElement('div');
    divider.className = 'rq-recents-divider';
    divider.style.cssText = 'border-top: 1px solid #444; margin: 4px 0;';

    const rows = recents.map(entry => {
      const row = document.createElement('div');
      row.className = 'quiknav-list-item rq-recent-item';
      // Store identity in dataset so the upstream Enter handler can open the record
      // without needing a separate event listener per row.
      row.dataset.module = entry.module;
      row.dataset.recordNumber = entry.recordNumber;

      const icon = document.createElement('i');
      icon.className = 'material-icons';
      icon.textContent = entry.icon;
      icon.style.cssText = 'color: #888; font-size: 1em; line-height: .8em; vertical-align: middle;';

      const text = document.createElement('span');
      text.style.marginLeft = '.4em';
      text.textContent = entry.caption;

      row.append(icon, text);

      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        RQ.api.open_record_by_number(entry.module, entry.recordNumber);
        document.getElementById('rq-quiknav')?.blur();
      });

      return row;
    });

    const firstItem = popup.querySelector('.quiknav-list-item');
    // Insert in visual order: header, divider, then rows newest-first
    popup.insertBefore(header, firstItem);
    popup.insertBefore(divider, firstItem);
    // Insert oldest-first so the most recent ends up at the bottom, right above modules
    [...rows].reverse().forEach(row => popup.insertBefore(row, firstItem));

    // Leave selection on modules[0] (set by quiknav_focus).
    // Recents are reachable by pressing ArrowUp from the first module.
  }

  function initRecents() {
    const popup = document.getElementById('rq-quiknav-popup');
    const searchbox = document.getElementById('rq-quiknav');
    if (!searchbox || !popup) return;

    // Track records when form_load_complete class is added to a form element.
    // RW adds the form node first, then adds form_load_complete as a class once loaded —
    // so watching for class addition is more reliable than watching for node insertion.
    on_class_added('form_load_complete', document.body, (form) => {
      if (!form.matches('.fwform[data-controller]')) return;
      if (form.dataset.rqRecentSeen) return;
      form.dataset.rqRecentSeen = '1';
      trackRecord(form);
    });

    // Refresh recents each time the popup opens (registered once)
    searchbox.addEventListener('focus', () => refreshRecents(popup));

    // Hide/show recents while typing using .hidden class (consistent with core QuikNav)
    searchbox.addEventListener('input', (e) => {
      const hasInput = e.target.value.trim().length > 0;
      popup.querySelectorAll('.rq-recents-header, .rq-recents-divider, .rq-recent-item')
        .forEach(el => el.classList.toggle('hidden', hasInput));
    });

    console.log('[RQ] Recent records initialized');
  }

  RQ.runOnAppLoad ||= [];
  if (RQ.customFeatures.recents) {
    RQ.runOnAppLoad.push(initRecents);
  }
})(window.RentalQuirks);









// Session restore — reopen tabs on refresh like Chrome
(function(RQ) {
  const STORAGE_KEY = 'rq-session-tabs';
  let isRestoring = false;
  let saveDebounceTimer = null;

  function getNavFromCaption(caption) {
    let nav = null;
    window.masterController?.navigation?.forEach(root => {
      if (root.navigation && root.caption === caption) nav = root.navigation;
      // Note: not else-if — a root can have both .navigation and .children
      if (root.children) root.children.forEach(child => {
        if (child.caption === caption) nav = child.nav;
      });
    });
    return nav;
  }

  function saveTabs() {
    // Don't save a partial snapshot while restore is still opening tabs
    if (isRestoring) return;

    const tabs = [...document.querySelectorAll('#moduletabs > .tabs > .tabcontainer > .tab')]
      .map(tab => {
        const tabtype = tab.dataset.tabtype;
        const caption = tab.dataset.caption;

        if (tabtype === 'FORM') {
          const tabpage = document.getElementById(tab.dataset.tabpageid);
          const form = tabpage?.querySelector('[data-controller]');
          if (!form) return null;
          const controller = form.dataset.controller;
          const module = controller.replace('Controller', '');
          // Use known field names when available; fall back to the ${module}X convention
          const fieldNames = RQ.api.module_identifier_names?.(module);
          const idField   = fieldNames?.id   ?? `${module}Id`;
          const codeField = fieldNames?.code ?? `${module}Number`;
          const recordId     = tabpage.querySelector(`[data-datafield="${idField}"] input`)?.value || null;
          const recordNumber = tabpage.querySelector(`[data-datafield="${codeField}"] input`)?.value || null;
          if (!recordId && !recordNumber) return null;
          return { tabtype: 'FORM', module, recordId, recordNumber };
        }

        if (tabtype === 'BROWSE' && caption) {
          return { tabtype: 'BROWSE', caption };
        }

        return null;
      })
      .filter(Boolean);

    // Don't save if any forms are still loading
    const anyLoading = [...document.querySelectorAll('#moduletabs .tabpage[data-tabtype="FORM"]')]
      .some(tp => !tp.querySelector('.form_load_complete'));
    if (anyLoading) return;

    if (tabs.length > 0) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }

  async function restoreTabs() {
    isRestoring = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
      if (saved.length === 0) return;

      const savedCaptions = new Set(saved.map(t => t.caption).filter(Boolean));

      // Close any tabs RentalWorks auto-opened that weren't in our saved session
      [...document.querySelectorAll('#moduletabs > .tabs > .tabcontainer > .tab')]
        .forEach(tab => {
          if (tab.dataset.tabtype === 'BROWSE' && !savedCaptions.has(tab.dataset.caption))
            tab.querySelector('.delete')?.click();
        });

      const alreadyOpen = new Set(
        [...document.querySelectorAll('#moduletabs > .tabs > .tabcontainer > .tab')]
          .map(t => t.dataset.caption)
      );

      // Pre-resolve all FORM tab IDs in parallel.
      // Use the saved recordId directly when available; only hit the API when we only have a recordNumber.
      const resolvedIds = new Map();
      await Promise.allSettled(
        saved.map(async (t, i) => {
          if (t.tabtype !== 'FORM') return;
          const id = t.recordId
            ?? (t.recordNumber ? await RQ.api.get_id_from_code(t.module, t.recordNumber).catch(() => null) : null);
          if (id) resolvedIds.set(i, id);
        })
      );

      // Open all tabs in saved order — preserves original left-to-right layout
      for (const [i, tab] of saved.entries()) {
        if (tab.tabtype === 'BROWSE' && !alreadyOpen.has(tab.caption)) {
          const nav = getNavFromCaption(tab.caption);
          if (nav) RQ.load_module_as_tab(nav);
        } else if (tab.tabtype === 'FORM') {
          const id = resolvedIds.get(i);
          if (!id) continue;
          if (RQ.api.module_identifier_names?.(tab.module)) {
            // Known module — open_form_tab handles dedup and uses the right ID field
            RQ.api.open_form_tab(tab.module, id);
          } else {
            // Unknown module — open_form_tab would throw; call the RW controller directly
            const ctrl = window[`${tab.module}Controller`];
            if (!ctrl?.loadForm) continue;
            const newForm = ctrl.loadForm({ [`${tab.module}Id`]: id });
            if (newForm) FwModule.openModuleTab(newForm, (newForm.attr?.('data-caption') ?? tab.module) + ' (loading)', true, 'FORM', true);
          }
        }
      }

      console.log(`[RQ] Session restored ${saved.length} tab(s)`);
    } catch(e) {
      console.warn('[RQ] Session restore failed:', e);
    } finally {
      isRestoring = false;
      // Write the actual restored state (no-ops if forms are still loading;
      // beforeunload / visibilitychange will catch it once they finish)
      saveTabs();
    }
  }


  function initSessionRestore() {
    window.addEventListener('beforeunload', saveTabs);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveTabs();
    });

    elementReady('#moduletabs > .tabs').then(tabContainer => {
      // Debounced save: cancel any pending save before scheduling a new one so
      // multiple rapid tab mutations don't stack up independent saveTabs calls
      new MutationObserver(() => {
        clearTimeout(saveDebounceTimer);
        saveDebounceTimer = setTimeout(saveTabs, 200);
      }).observe(tabContainer, { childList: true });
      setTimeout(restoreTabs, 50);
    });

    console.log('[RQ] Session restore initialized');
  }

  RQ.runOnAppLoad ||= [];
  if (RQ.customFeatures.sessionRestore) {
    RQ.runOnAppLoad.push(initSessionRestore);
  }
})(window.RentalQuirks);
