// ==UserScript==
// @name         RentalQuirks for Outlook
// @namespace    RentalQuirks
// @version      1.1
// @description  Link Outlook emails to RentalWorks records in the RentalQuirks dashboard
// @author       RentalQuirks
// @match        https://outlook.office.com/*
// @match        https://outlook.live.com/*
// @match        https://outlook.cloud.microsoft/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const MODULES = ['Order', 'Quote', 'PurchaseOrder', 'Contract', 'Customer', 'Deal', 'Invoice'];

  let panel = null;
  let panelVisible = false;

  // ── Styles ──────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #rq-ol-btn {
      position: fixed !important;
      bottom: 24px !important;
      right: 24px !important;
      z-index: 999998 !important;
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      padding: 8px 14px !important;
      background: #1a2a1a !important;
      border: 1px solid #3a7a3a !important;
      border-radius: 20px !important;
      color: #8aca8a !important;
      font-size: 13px !important;
      font-family: 'Segoe UI', sans-serif !important;
      cursor: pointer !important;
      box-shadow: 0 2px 12px rgba(0,0,0,0.5) !important;
      white-space: nowrap !important;
      user-select: none !important;
    }
    #rq-ol-btn:hover {
      background: #213021 !important;
      border-color: #4a9a4a !important;
    }
    #rq-ol-panel {
      position: fixed !important;
      bottom: 70px !important;
      right: 24px !important;
      z-index: 999999 !important;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 14px 16px;
      min-width: 260px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.6);
      font-family: 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #ccc;
    }
    #rq-ol-panel .rq-panel-label {
      display: block;
      font-size: 10px;
      color: #555;
      margin: 10px 0 3px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    #rq-ol-panel select, #rq-ol-panel input[type=text] {
      width: 100%;
      box-sizing: border-box;
      background: #111;
      color: #ccc;
      border: 1px solid #333;
      border-radius: 3px;
      padding: 5px 8px;
      font-size: 12px;
      font-family: inherit;
      outline: none;
    }
    #rq-ol-panel .rq-btn {
      display: block;
      width: 100%;
      margin-top: 10px;
      padding: 7px;
      background: #1a3a1a;
      border: 1px solid #2a5a2a;
      border-radius: 4px;
      color: #8aca8a;
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
      text-align: center;
    }
    #rq-ol-panel .rq-btn:hover { background: #213021; }
    #rq-ol-panel .rq-btn-secondary {
      background: #1a1a1a;
      border-color: #2a2a2a;
      color: #555;
    }
    #rq-ol-panel .rq-btn-secondary:hover { background: #222; }
    #rq-ol-toast {
      position: fixed !important;
      bottom: 80px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      background: #1a2a1a;
      border: 1px solid #2a5a2a;
      border-radius: 6px;
      padding: 9px 16px;
      color: #8aca8a;
      font-size: 13px;
      font-family: 'Segoe UI', sans-serif;
      z-index: 9999999 !important;
      pointer-events: none;
      white-space: nowrap;
    }
  `;
  document.head.appendChild(style);

  // ── Toast ────────────────────────────────────────────────────────────────────
  function showToast(msg) {
    document.getElementById('rq-ol-toast')?.remove();
    const t = document.createElement('div');
    t.id = 'rq-ol-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  // ── Panel ────────────────────────────────────────────────────────────────────
  function buildPanel() {
    document.getElementById('rq-ol-panel')?.remove();
    panel = document.createElement('div');
    panel.id = 'rq-ol-panel';

    const title = document.createElement('div');
    title.style.cssText = 'font-weight:600;color:#8aca8a;margin-bottom:4px;font-size:14px;';
    title.textContent = '📌 RentalWorks';
    panel.appendChild(title);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:11px;color:#555;padding-bottom:10px;border-bottom:1px solid #222;margin-bottom:4px;';
    hint.textContent = 'Copy this email\'s URL to paste into the RentalWorks dashboard.';
    panel.appendChild(hint);

    // Copy link button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'rq-btn';
    copyBtn.style.marginTop = '6px';
    copyBtn.textContent = '✉ Copy email link to clipboard';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(window.location.href).then(() => {
        showToast('Email link copied — paste into RentalWorks dashboard');
        hidePanel();
      }).catch(() => {
        // Fallback: put URL in a temp input and execCommand
        const tmp = document.createElement('input');
        tmp.value = window.location.href;
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand('copy');
        tmp.remove();
        showToast('Email link copied — paste into RentalWorks dashboard');
        hidePanel();
      });
    });
    panel.appendChild(copyBtn);

    // Divider
    const div = document.createElement('div');
    div.style.cssText = 'border-top:1px solid #222;margin:12px 0 4px;';
    panel.appendChild(div);

    const openLabel = document.createElement('div');
    openLabel.style.cssText = 'font-size:11px;color:#555;margin-bottom:6px;';
    openLabel.textContent = 'Open a RentalWorks record:';
    panel.appendChild(openLabel);

    const modLabel = document.createElement('span');
    modLabel.className = 'rq-panel-label';
    modLabel.textContent = 'Module';
    panel.appendChild(modLabel);

    const modSelect = document.createElement('select');
    MODULES.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m === 'PurchaseOrder' ? 'Purchase Order' : m;
      modSelect.appendChild(opt);
    });
    panel.appendChild(modSelect);

    const numLabel = document.createElement('span');
    numLabel.className = 'rq-panel-label';
    numLabel.textContent = 'Record number';
    panel.appendChild(numLabel);

    const numInput = document.createElement('input');
    numInput.type = 'text';
    numInput.placeholder = 'e.g. ORD-00123';
    numInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') openBtn.click(); });
    panel.appendChild(numInput);

    const openBtn = document.createElement('button');
    openBtn.className = 'rq-btn';
    openBtn.textContent = 'Open in RentalWorks';
    openBtn.addEventListener('click', () => {
      const rn = numInput.value.trim();
      if (!rn) { numInput.style.borderColor = '#a44'; setTimeout(() => { numInput.style.borderColor = '#333'; }, 1500); return; }
      window.open('https://rentalworks.cloud/', '_blank');
      showToast(`Open RentalWorks and search for ${rn}`);
      hidePanel();
    });
    panel.appendChild(openBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'rq-btn rq-btn-secondary';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', hidePanel);
    panel.appendChild(closeBtn);

    document.body.appendChild(panel);
  }

  function showPanel() { buildPanel(); panelVisible = true; }
  function hidePanel() { document.getElementById('rq-ol-panel')?.remove(); panel = null; panelVisible = false; }

  // ── Floating button (fixed position — not injected into toolbar) ─────────────
  function ensureButton() {
    if (document.getElementById('rq-ol-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'rq-ol-btn';
    btn.title = 'RentalQuirks — link this email to a dashboard record';
    btn.textContent = '📌 RW';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (panelVisible) hidePanel(); else showPanel();
    });
    document.body.appendChild(btn);
  }

  // Close panel on outside click
  document.addEventListener('click', (e) => {
    const btn = document.getElementById('rq-ol-btn');
    if (panelVisible && panel && !panel.contains(e.target) && e.target !== btn) hidePanel();
  }, true);

  // Show button whenever a reading pane is open
  const observer = new MutationObserver(() => {
    const readingPaneOpen = document.querySelector('[aria-label="Move & delete"], .th6py, [aria-label="Quick actions"]');
    if (readingPaneOpen) ensureButton();
    else document.getElementById('rq-ol-btn')?.remove();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Also try immediately
  ensureButton();
})();
