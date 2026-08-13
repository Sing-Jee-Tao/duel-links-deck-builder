/* Deck Ledger — demo interaction only. No application logic.
   Everything here exists to show a state, not to implement a feature. */
(function () {
  "use strict";

  /* 1. Owned quantity: click the count to cycle 0 → 1 → 2 → 3 → 0.
        Keyboard: 0–3 sets directly while the control is focused. */
  var PIPS = ["○○○", "●○○", "●●○", "●●●"];
  function setQty(btn, n) {
    btn.setAttribute("data-quantity", String(n));
    var value = btn.querySelector('[data-role="quantity-value"]');
    var track = btn.querySelector('[data-role="quantity-track"]');
    if (value) { value.textContent = String(n); }
    if (track) { track.textContent = PIPS[n]; }
  }
  document.querySelectorAll('[data-role="owned-quantity"]').forEach(function (btn) {
    btn.addEventListener("click", function () {
      setQty(btn, (parseInt(btn.getAttribute("data-quantity"), 10) + 1) % 4);
    });
    btn.addEventListener("keydown", function (e) {
      if (/^[0-3]$/.test(e.key)) { e.preventDefault(); setQty(btn, parseInt(e.key, 10)); }
    });
  });

  /* 2. Extra Deck cap, 5–9. */
  var cap = document.querySelector('[data-role="extra-cap-value"]');
  function step(delta) {
    if (!cap) { return; }
    cap.textContent = String(Math.min(9, Math.max(5, parseInt(cap.textContent, 10) + delta)));
  }
  var inc = document.querySelector('[data-role="extra-cap-increase"]');
  var dec = document.querySelector('[data-role="extra-cap-decrease"]');
  if (inc) { inc.addEventListener("click", function () { step(1); }); }
  if (dec) { dec.addEventListener("click", function () { step(-1); }); }

  /* 3. Candidate deck tabs (upgrade screen). Panels are pre-rendered;
        the real implementation would fetch each candidate's diff. */
  var tabs = document.querySelectorAll('[data-role="candidate-tab"]');
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var id = tab.getAttribute("data-candidate");
      tabs.forEach(function (t) { t.setAttribute("aria-selected", String(t === tab)); });
      document.querySelectorAll('[data-role="candidate-panel"]').forEach(function (p) {
        p.hidden = p.getAttribute("data-candidate") !== id;
      });
    });
  });

  /* 3b. Auth mode switch (account screen): create ↔ sign in. */
  function setAuthMode(mode) {
    document.querySelectorAll('[data-role="auth-tab"]').forEach(function (t) {
      t.setAttribute("aria-selected", String(t.getAttribute("data-mode") === mode));
    });
    document.querySelectorAll('[data-role="auth-panel"]').forEach(function (p) {
      p.hidden = p.getAttribute("data-mode") !== mode;
    });
  }
  document.querySelectorAll('[data-role="auth-tab"], [data-role="auth-alt-button"]').forEach(function (b) {
    b.addEventListener("click", function () { setAuthMode(b.getAttribute("data-mode")); });
  });

  /* 4. Ruling modal (strategy screen). */
  var modal = document.querySelector('[data-role="ruling-modal"]');
  var lastFocus = null;
  function openModal() {
    if (!modal) { return; }
    lastFocus = document.activeElement;
    modal.hidden = false;
    var close = modal.querySelector('[data-role="modal-close"]');
    if (close) { close.focus(); }
  }
  function closeModal() {
    if (!modal || modal.hidden) { return; }
    modal.hidden = true;
    if (lastFocus) { lastFocus.focus(); }
  }
  document.querySelectorAll('[data-role="ruling-button"]').forEach(function (b) {
    b.addEventListener("click", openModal);
  });
  if (modal) {
    modal.addEventListener("click", function (e) {
      if (e.target === modal || e.target.closest('[data-role="modal-close"]')) { closeModal(); }
    });
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeModal(); } });
}());
