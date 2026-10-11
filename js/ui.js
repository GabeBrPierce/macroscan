/* MacroScan UI primitives: softkeys, 2D D-pad navigation, toast.

   Navigation model (feature-phone standard):
   - Row 0 is the top TAB BAR. Left/Right there switches app tabs.
   - Each content row is one or more ".focusable" cells. Cells that share a
     ".hgroup" ancestor form a single horizontal row (Left/Right moves between
     them — e.g. the prev/next day buttons, the servings -/+ stepper).
   - Up/Down moves between rows; Left/Right moves within a row.
   - A focused ".field" focuses its inner <input> so the keypad types into it. */
(function () {
  var screen = document.getElementById('screen');
  var elL = document.getElementById('softkey-left');
  var elC = document.getElementById('softkey-center');
  var elR = document.getElementById('softkey-right');
  var toastEl = document.getElementById('toast');

  var keys = { left: null, center: null, right: null };
  var rows = [];
  var pos = { r: 0, c: 0 };
  var savedCol = 0;
  var toastTimer = null;
  // Modal mode: a full-screen overlay (e.g. the barcode scanner) owns the screen.
  // Softkeys / Enter / Back still fire, but D-pad row navigation is frozen so the
  // hidden tab bar underneath can't be moved.
  var modal = false;
  function setModal(v) { modal = !!v; }

  /* ---------- softkeys ---------- */
  function setSoftkeys(cfg) {
    cfg = cfg || {};
    keys.left = cfg.left || null;
    keys.center = cfg.center || null;
    keys.right = cfg.right || null;
    elL.textContent = cfg.left ? cfg.left.label : '';
    elC.textContent = cfg.center ? cfg.center.label : '';
    elR.textContent = cfg.right ? cfg.right.label : '';
  }
  function setCenterLabel(label) { elC.textContent = label || ''; }
  function setRight(right) { keys.right = right || null; elR.textContent = right ? right.label : ''; }

  /* ---------- row model ---------- */
  function tabCells() { return Array.prototype.slice.call(document.querySelectorAll('#tabbar .tab')); }

  function hgroupOf(el) {
    var n = el.parentNode;
    while (n && n !== screen) {
      if (n.classList && n.classList.contains('hgroup')) return n;
      n = n.parentNode;
    }
    return null;
  }

  function buildRows() {
    rows = [tabCells()];
    var foc = Array.prototype.slice.call(screen.querySelectorAll('.focusable'));
    var i = 0;
    while (i < foc.length) {
      var hg = hgroupOf(foc[i]);
      if (hg) {
        var group = [];
        while (i < foc.length && hgroupOf(foc[i]) === hg) { group.push(foc[i]); i++; }
        rows.push(group);
      } else {
        rows.push([foc[i]]); i++;
      }
    }
  }

  function clampPos() {
    if (pos.r < 0) pos.r = 0;
    if (pos.r >= rows.length) pos.r = rows.length - 1;
    var row = rows[pos.r] || [];
    if (pos.c < 0) pos.c = 0;
    if (pos.c >= row.length) pos.c = row.length - 1;
  }

  function applyFocus() {
    tabCells().forEach(function (t) { t.classList.remove('focused'); });
    Array.prototype.forEach.call(screen.querySelectorAll('.focusable.focused'),
      function (e) { e.classList.remove('focused'); });
    if (!rows.length) return;
    clampPos();
    var row = rows[pos.r]; if (!row || !row.length) return;
    var el = row[pos.c]; if (!el) return;
    el.classList.add('focused');

    var input = (el.matches && el.matches('input,select,textarea')) ? el :
      (el.querySelector ? el.querySelector('input,select,textarea') : null);
    if (input) {
      try { input.focus({ preventScroll: true }); } catch (e) { try { input.focus(); } catch (e2) {} }
      // Select existing content so the first keystroke REPLACES a pre-filled
      // value (native handles this for real keystrokes; _fresh does it for
      // synthetic ones). Avoids "100" + typed "40" => "10040".
      try { input.select(); } catch (e3) {}
      input._fresh = true;
    } else if (document.activeElement && document.activeElement.blur) {
      try { document.activeElement.blur(); } catch (e3) {}
    }
    scrollToEl(el);
    if (el._onFocus) el._onFocus(el);
    else if (pos.r === 0) setCenterLabel('Open');
  }

  // Scroll only the #screen container — never the document (avoids the fixed
  // header/footer pushing the page to the bottom).
  function scrollToEl(el) {
    if (!screen.contains(el)) return;
    var er = el.getBoundingClientRect(), sr = screen.getBoundingClientRect();
    if (er.top < sr.top + 2) screen.scrollTop -= (sr.top - er.top) + 8;
    else if (er.bottom > sr.bottom - 2) screen.scrollTop += (er.bottom - sr.bottom) + 8;
  }

  function vert(dr) {
    if (!rows.length) return;
    pos.r += dr; clampPos();
    pos.c = Math.min(savedCol, (rows[pos.r] || []).length - 1);
    applyFocus();
  }

  function horiz(dc) {
    if (!rows.length) return;
    if (pos.r === 0) {
      // tab bar: Left/Right switches app tabs (wraps)
      var ni = pos.c + dc, len = rows[0].length;
      if (ni < 0) ni = len - 1; if (ni >= len) ni = 0;
      savedCol = ni;
      if (MS.app && MS.app.gotoTabIndex) MS.app.gotoTabIndex(ni);
      return;
    }
    var row = rows[pos.r];
    if (row.length > 1) {
      // horizontal group (date prev/next, servings -/+): move within, clamp at edges
      var nc = pos.c + dc;
      if (nc >= 0 && nc < row.length) { pos.c = nc; savedCol = nc; applyFocus(); }
      return;
    }
    // single-cell row (incl. text fields): step to the adjacent content row so the
    // D-pad never gets trapped in an input. Tab bar stays reachable only via Up.
    var nr = pos.r + dc;
    if (nr < 1) nr = 1;
    if (nr >= rows.length) nr = rows.length - 1;
    if (nr !== pos.r) { pos.r = nr; pos.c = 0; savedCol = 0; applyFocus(); }
  }

  /* ---------- public focus helpers ---------- */
  function focusContentTop() {
    if (modal) return; // a full-screen overlay owns the screen; don't touch focus/labels
    buildRows();
    pos.r = rows.length > 1 ? 1 : 0; pos.c = 0; savedCol = 0;
    screen.scrollTop = 0;
    applyFocus();
  }
  function focusTab(i) {
    buildRows();
    pos.r = 0; pos.c = i; savedCol = i;
    applyFocus();
  }
  function focusEl(target) {
    buildRows();
    for (var r = 0; r < rows.length; r++) {
      for (var c = 0; c < rows[r].length; c++) {
        if (rows[r][c] === target) { pos.r = r; pos.c = c; savedCol = c; applyFocus(); return true; }
      }
    }
    return false;
  }
  function currentEl() {
    var row = rows[pos.r];
    return row ? row[pos.c] : null;
  }

  /* ---------- toast ---------- */
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.add('hidden'); }, ms || 1800);
  }

  MS.ui = {
    setSoftkeys: setSoftkeys,
    setCenterLabel: setCenterLabel,
    setRight: setRight,
    setModal: setModal,
    resetFocus: focusContentTop,
    focusContentTop: focusContentTop,
    focusTab: focusTab,
    focusEl: focusEl,
    currentEl: currentEl,
    toast: toast
  };

  /* ---------- key handler ---------- */
  function inEditable() {
    var a = document.activeElement;
    return a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== 'button';
  }
  function isNumericField(a) {
    var im = a.getAttribute && a.getAttribute('inputmode');
    return a.type === 'tel' || a.type === 'number' || im === 'numeric' || im === 'decimal';
  }
  // Manually insert a typed char into a focused field. Used only for untrusted
  // (synthetic) key events — the device simulator and headless tests dispatch
  // synthetic KeyboardEvents, which the browser does NOT apply to inputs.
  function insertChar(a, ch) {
    if (a._fresh) { a.value = ''; a._fresh = false; }
    if (isNumericField(a)) {
      var allowDot = a.getAttribute && a.getAttribute('inputmode') === 'decimal';
      if (/[0-9]/.test(ch)) a.value = a.value + ch;
      else if (ch === '.' && allowDot && a.value.indexOf('.') === -1) a.value = (a.value === '' ? '0.' : a.value + '.');
      else return false;
    } else {
      a.value = a.value + ch;
    }
    a.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function onKey(e) {
    // Printable character into a focused field — only for synthetic events
    // (real hardware keystrokes are trusted and the browser inserts them itself).
    if (!e.isTrusted && e.key && e.key.length === 1 && inEditable()) {
      if (insertChar(document.activeElement, e.key)) { e.preventDefault(); e.stopPropagation(); }
      return;
    }
    switch (e.key) {
      case 'SoftLeft':
        if (keys.left) { e.preventDefault(); keys.left.action(); }
        break;
      case 'SoftRight':
        if (keys.right) { e.preventDefault(); keys.right.action(); }
        break;
      case 'Enter': {
        e.preventDefault();
        if (modal) { if (keys.center) keys.center.action(); break; }
        if (pos.r === 0) { focusContentTop(); break; } // enter content from tab bar
        var el = currentEl();
        if (el && el._onEnter) el._onEnter(el);
        else if (keys.center) keys.center.action();
        break;
      }
      // Up/Down always navigates between rows (even out of a text field).
      case 'ArrowUp':    e.preventDefault(); e.stopPropagation(); if (!modal) vert(-1); break;
      case 'ArrowDown':  e.preventDefault(); e.stopPropagation(); if (!modal) vert(1); break;
      // Left/Right move the CARET inside a focused text field; elsewhere they
      // drive horizontal navigation (groups, tab bar, single-cell fallthrough).
      case 'ArrowLeft':  if (inEditable()) return; e.preventDefault(); e.stopPropagation(); if (!modal) horiz(-1); break;
      case 'ArrowRight': if (inEditable()) return; e.preventDefault(); e.stopPropagation(); if (!modal) horiz(1); break;
      case 'Backspace': {
        // KaiOS sends 'Backspace' for the hardware Back key. We must ALWAYS
        // preventDefault (otherwise the system also navigates back / closes the
        // app). When a text field has content we delete a char ourselves and
        // fire 'input' so live previews update; otherwise we go Back.
        e.preventDefault(); e.stopPropagation();
        var a = document.activeElement;
        if (inEditable() && a.value) {
          // a "fresh" (just-focused, all-selected) field clears on first Backspace
          if (a._fresh) { a.value = ''; a._fresh = false; }
          else a.value = a.value.slice(0, -1);
          a.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (keys.left && keys.left.isBack) {
          keys.left.action();
        } else if (MS.app && MS.app.back) {
          MS.app.back();
        }
        break;
      }
    }
  }
  // Capture phase: intercept the D-pad BEFORE a focused <input> consumes
  // Left/Right for caret movement (KaiOS eats arrows inside text fields).
  document.addEventListener('keydown', onKey, true);
})();
