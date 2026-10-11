/* MacroScan main app: router + views.
   Views: Today (diary), Add (search/scan), Weight, Foods (custom), More (settings). */
(function () {
  var store = MS.store, net = MS.net, ui = MS.ui;
  var screen = document.getElementById('screen');
  var appSub = document.getElementById('appbar-sub');

  var TABS = ['today', 'add', 'weight', 'foods', 'settings'];
  var state = {
    tab: 'today',
    date: store.todayKey(),
    stack: []
  };

  /* ============================ kaiads initialization ============================ */ 
  

  function displayKaiAd()
  {
    // The KaiAds SDK loads from a remote <script> after this file. If it isn't
    // ready yet (or is blocked/offline), skip and retry — never let a missing ad
    // SDK throw and abort app boot (which blanks the whole screen).
    if (typeof getKaiAd !== 'function') { kaiAdRepeat(5 * 1000); return; }
    try {
      getKaiAd({
        publisher: '0b1f52de-82bb-4c58-b2e4-1b125c046417',
        app: 'Macro Scan',
        slot: 'macro-scan-fullscreen',
        onerror: err => { console.error('Custom catch:', err); kaiAdRepeat(10 * 60 * 1000); },
        onready: ad => {
          // calling 'display' will display the ad
          ad.call('display')

          // user clicked the ad
          ad.on('click', () => console.log('click event') )

          // user closed the ad (currently only with fullscreen)
          ad.on('close', () => kaiAdRepeat(10 * 60 * 1000) )

          // the ad succesfully displayed
          ad.on('display', () => console.log('display event') )
        }
      })
    } catch (e) { /* ad failures must never break the app */ }
  }

  async function kaiAdRepeat(delay) {
    await new Promise(function (resolve) {
      setTimeout(resolve, delay);
    });
    displayKaiAd();
  }

  // Ads only exist on KaiOS; the web/PWA build never loads the SDK.
  if (/KaiOS/i.test(navigator.userAgent)) displayKaiAd();
  
  /* ============================ helpers ============================ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function r0(n) { return Math.round(n || 0); }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : (d || 0); }

  /* weight unit conversion */
  function unit() { return store.settings().weightUnit; }
  function kgToU(kg) { return unit() === 'lb' ? kg * 2.2046226 : kg; }
  function uToKg(v) { return unit() === 'lb' ? v / 2.2046226 : v; }
  function fmtW(kg) { return (Math.round(kgToU(kg) * 10) / 10) + ' ' + unit(); }

  /* date label */
  function dateLabel(key) {
    var t = store.todayKey();
    var d = new Date(key + 'T00:00:00');
    var yest = new Date(); yest.setDate(yest.getDate() - 1);
    if (key === t) return 'Today';
    if (key === store.todayKey(yest)) return 'Yesterday';
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return days[d.getDay()] + ' ' + mon[d.getMonth()] + ' ' + d.getDate();
  }
  function shiftDate(key, delta) {
    var d = new Date(key + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    return store.todayKey(d);
  }
  /* "Day progress": how far the current clock time is between the configured
     day-start and day-end hours (0..1). Only meaningful for the live day. */
  function dayProgress() {
    var s = store.settings();
    var startM = (num(s.dayStartHour, 8)) * 60;
    var endM = (num(s.dayEndHour, 22)) * 60;
    if (endM <= startM) endM = startM + 60;
    var now = new Date();
    var mins = now.getHours() * 60 + now.getMinutes();
    var p = (mins - startM) / (endM - startM);
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function relLabel(key) {
    var t = store.todayKey();
    if (key === t) return 'Today';
    if (key === shiftDate(t, -1)) return 'Yesterday';
    if (key === shiftDate(t, 1)) return 'Tomorrow';
    return DAYS[new Date(key + 'T00:00:00').getDay()];
  }
  function dateFull(key) {
    var d = new Date(key + 'T00:00:00');
    return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  /* ============================ navigation ============================ */
  function renderTop(opts) {
    var fn = state.stack[state.stack.length - 1];
    screen.scrollTop = 0;
    appSub.textContent = '';
    fn();
    if (opts && opts.keepTabFocus) ui.focusTab(TABS.indexOf(state.tab));
    else ui.resetFocus();
  }
  function setTab(name, opts) {
    state.tab = name;
    state.stack = [tabRoot[name]];
    updateTabbar();
    renderTop(opts);
  }
  function go(fn) { state.stack.push(fn); renderTop(); }
  function back() {
    if (state.stack.length > 1) { state.stack.pop(); renderTop(); }
  }
  // Switch tabs by index, keeping focus on the top tab bar (called from ui when
  // the user moves Left/Right while the tab bar is focused).
  function gotoTabIndex(i) {
    if (i < 0) i = TABS.length - 1;
    if (i >= TABS.length) i = 0;
    setTab(TABS[i], { keepTabFocus: true });
  }
  function updateTabbar() {
    Array.prototype.forEach.call(document.querySelectorAll('#tabbar .tab'), function (t) {
      t.classList.toggle('active', t.getAttribute('data-view') === state.tab);
    });
  }

  /* wire every .focusable[data-act] to a handler map; data-id passed along */
  function wire(map) {
    Array.prototype.forEach.call(screen.querySelectorAll('.focusable'), function (el) {
      var act = el.getAttribute('data-act');
      if (act && map[act]) {
        el._onEnter = (function (fn, el) { return function () { fn(el); }; })(map[act], el);
      }
    });
  }

  /* =================================================================
     TODAY (diary)
     ================================================================= */
  function viewToday() {
    var date = state.date;
    var s = store.settings();
    var tot = store.dayTotals(date);
    var limit = s.calorieLimit || 0;
    var remaining = limit - tot.kcal;
    var pct = limit ? Math.min(tot.kcal / limit, 1) : 0;
    var over = limit && tot.kcal > limit;

    var ringColor = over ? 'var(--danger)' : 'var(--accent)';
    var C = 2 * Math.PI * 40;
    var dash = (pct * C).toFixed(1) + ' ' + C.toFixed(1);

    // Day-progress ring (inner arc) — only for the live day, when hours are set.
    var isToday = date === store.todayKey();
    var dayP = isToday ? dayProgress() : null;
    var dayRing = '';
    if (dayP != null) {
      var Cd = 2 * Math.PI * 30;
      var dashD = (dayP * Cd).toFixed(1) + ' ' + Cd.toFixed(1);
      dayRing = '<circle cx="46" cy="46" r="30" fill="none" stroke="var(--bg3)" stroke-width="4"/>' +
        '<circle cx="46" cy="46" r="30" fill="none" stroke="var(--fat)" stroke-width="4" ' +
        'stroke-linecap="round" stroke-dasharray="' + dashD + '"/>';
    }

    var html = '<div class="view">';
    // date navigator with explicit prev/next buttons and a visible date
    html += '<div class="datenav hgroup">' +
      '<div class="navbtn focusable" data-act="prevDay">&#8249;</div>' +
      '<div class="datebox"><div class="date-big">' + esc(relLabel(date)) + '</div>' +
      '<div class="date-small">' + esc(dateFull(date)) + '</div></div>' +
      '<div class="navbtn focusable" data-act="nextDay">&#8250;</div></div>';

    // calorie ring card (outer arc = calories, inner arc = day progress)
    html += '<div class="cal-card">' +
      '<div class="ring"><svg width="92" height="92" viewBox="0 0 92 92">' +
      '<circle cx="46" cy="46" r="40" fill="none" stroke="var(--bg3)" stroke-width="8"/>' +
      '<circle cx="46" cy="46" r="40" fill="none" stroke="' + ringColor + '" stroke-width="8" ' +
      'stroke-linecap="round" stroke-dasharray="' + dash + '"/>' + dayRing + '</svg>' +
      '<div class="ring-center"><div class="ring-num">' + r0(tot.kcal) + '</div>' +
      '<div class="ring-lbl">of ' + r0(limit) + '</div></div></div>' +
      '<div class="cal-meta">' +
      '<div class="line"><span>Eaten</span><span class="v">' + r0(tot.kcal) + '</span></div>' +
      '<div class="line"><span>Limit</span><span class="v">' + r0(limit) + '</span></div>' +
      '<div class="line"><span>' + (over ? 'Over' : 'Left') + '</span><span class="v ' +
      (over ? 'over' : 'right-accent') + '">' + r0(Math.abs(remaining)) + '</span></div>' +
      (dayP != null ? '<div class="line"><span style="color:var(--fat)">Day</span><span class="v">' +
        Math.round(dayP * 100) + '%</span></div>' : '') +
      '</div></div>';

    // pace hint: are calories ahead of / behind the clock?
    if (dayP != null && limit) html += paceHintHTML(pct, dayP, over);

    // macro bars
    html += macroBarsHTML(tot, s);

    // flat food list (no meals)
    html += '<div class="meal-head"><span class="mh-name">Foods</span>' +
      '<span class="mh-cal">' + r0(tot.kcal) + ' kcal</span></div>';
    var entries = store.getDay(date);
    entries.forEach(function (e) {
      var n = store.scale(e.per100, e.grams);
      html += '<div class="row focusable" data-act="editEntry" data-id="' + e.id + '">' +
        '<span class="grow"><span class="title">' + esc(e.name) + '</span>' +
        '<span class="sub">' + r0(e.grams) + ' g' + (e.brand ? ' &middot; ' + esc(e.brand) : '') +
        ' &middot; P' + r0(n.protein) + ' C' + r0(n.carb) + ' F' + r0(n.fat) + '</span></span>' +
        '<span class="right">' + r0(n.kcal) + '<span class="u"> kcal</span></span></div>';
    });
    html += '<div class="row focusable" data-act="addFood"><span class="grow">' +
      '<span class="title" style="color:var(--accent)">&#43; Add food</span>' +
      '<span class="sub">Search, scan a barcode or pick a saved food</span></span></div>';

    // consistency: how well you've tracked & stayed under the limit lately
    html += '<div class="section-title">Consistency &mdash; last 14 days</div>';
    html += consistencyHTML(date, limit);

    // 7-day calorie progress chart
    html += '<div class="section-title">Calories &mdash; last 7 days</div>';
    html += calorieChartHTML(date, limit);

    html += '</div>';
    screen.innerHTML = html;

    wire({
      prevDay: function () { state.date = shiftDate(state.date, -1); viewToday(); ui.resetFocus(); },
      nextDay: function () { state.date = shiftDate(state.date, 1); viewToday(); ui.resetFocus(); },
      addFood: function () { openAdd(); },
      editEntry: function (el) {
        var id = el.getAttribute('data-id');
        var e = store.getDay(state.date).filter(function (x) { return x.id === id; })[0];
        if (e) openLogFood(entryToFood(e), { entryId: id, grams: e.grams });
      }
    });

    refreshTodaySoftkeys();
    hookTodayFocus();
  }

  function refreshTodaySoftkeys() {
    ui.setSoftkeys({
      left: { label: 'Today', action: function () { state.date = store.todayKey(); viewToday(); ui.resetFocus(); } },
      center: { label: 'Add', action: function () { openAdd(); } },
      right: null
    });
  }

  function hookTodayFocus() {
    Array.prototype.forEach.call(screen.querySelectorAll('.focusable'), function (el) {
      var act = el.getAttribute('data-act');
      el._onFocus = function () {
        if (act === 'editEntry') {
          ui.setCenterLabel('Edit');
          ui.setRight({ label: 'Delete', action: function () {
            store.removeEntry(state.date, el.getAttribute('data-id'));
            ui.toast('Deleted'); viewToday(); ui.resetFocus();
          } });
        } else if (act === 'prevDay' || act === 'nextDay') {
          ui.setCenterLabel(act === 'prevDay' ? 'Prev day' : 'Next day'); ui.setRight(null);
        } else {
          ui.setCenterLabel('Add'); ui.setRight(null);
        }
      };
    });
  }

  /* 7-day calorie bar chart (consumed per day vs the limit line) */
  function calorieChartHTML(anchorKey, limit) {
    var days = store.lastDaysKcal(anchorKey, 7);
    var maxV = Math.max(limit || 0, 1);
    days.forEach(function (d) { if (d.kcal > maxV) maxV = d.kcal; });
    var W = 224, H = 78, padB = 14, padT = 6, n = days.length;
    var slot = W / n, bw = slot * 0.6;
    var limY = limit ? padT + (H - padB - padT) * (1 - limit / maxV) : null;
    var bars = '', labels = '', i;
    var wd = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    for (i = 0; i < n; i++) {
      var d = days[i];
      var h = (H - padB - padT) * (d.kcal / maxV);
      var x = i * slot + (slot - bw) / 2;
      var y = H - padB - h;
      var col = (limit && d.kcal > limit) ? 'var(--danger)' : 'var(--accent)';
      bars += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) +
        '" height="' + Math.max(h, 0).toFixed(1) + '" rx="2" fill="' + col + '"/>';
      var dd = new Date(d.date + 'T00:00:00');
      labels += '<text x="' + (i * slot + slot / 2).toFixed(1) + '" y="' + (H - 3) +
        '" text-anchor="middle" font-size="8" fill="var(--muted)">' + wd[dd.getDay()] + '</text>';
    }
    var limLine = limY != null ? '<line x1="0" y1="' + limY.toFixed(1) + '" x2="' + W + '" y2="' +
      limY.toFixed(1) + '" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 3"/>' : '';
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
      bars + limLine + labels + '</svg>';
  }

  /* Pace hint: compares how much of the calorie budget is used vs how far into
     the day it is, so you can tell whether you're spending calories too fast. */
  function paceHintHTML(calPct, dayP, over) {
    var msg, cls;
    if (over) { msg = 'Over your limit for today.'; cls = 'over'; }
    else if (calPct <= dayP + 0.05) { msg = 'On pace — calories are tracking with your day.'; cls = 'right-accent'; }
    else { msg = 'Ahead of pace — you\'re eating faster than the clock.'; cls = ''; }
    return '<div class="pace ' + cls + '">' +
      '<span class="pace-dot" style="background:var(--accent)"></span>' + Math.round(calPct * 100) + '% calories' +
      ' <span class="pace-dot" style="background:var(--fat)"></span>' + Math.round(dayP * 100) + '% day' +
      '<div class="pace-msg">' + msg + '</div></div>';
  }

  /* Consistency strip: one cell per day (green = under limit, red = over,
     hollow = nothing logged) plus tracked/adherence tallies. */
  function consistencyHTML(anchorKey, limit) {
    var days = store.lastDaysStats(anchorKey, 14);
    var tracked = 0, under = 0;
    var cells = days.map(function (d) {
      var cls = 'con-cell';
      if (!d.tracked) cls += ' none';
      else {
        tracked++;
        if (!limit || d.kcal <= limit) { cls += ' good'; under++; }
        else cls += ' over';
      }
      return '<span class="' + cls + '"></span>';
    }).join('');
    var adh = tracked ? Math.round(under / tracked * 100) : 0;
    return '<div class="con">' +
      '<div class="con-cells">' + cells + '</div>' +
      '<div class="con-stats">' +
      '<span><b>' + tracked + '</b>/14 days tracked</span>' +
      '<span><b class="right-accent">' + under + '</b>/' + tracked + ' under limit</span>' +
      '<span><b>' + adh + '%</b> adherence</span>' +
      '</div></div>';
  }

  function macroBarsHTML(tot, s) {
    function bar(cls, label, val, goal, accent) {
      var pct = goal ? Math.min(val / goal * 100, 100) : 0;
      return '<div class="macro ' + cls + '"><div class="mlabel">' + label + '</div>' +
        '<div class="mval">' + r0(val) + 'g</div>' +
        '<div class="mgoal">/ ' + r0(goal) + 'g</div>' +
        '<div class="mbar"><i style="width:' + pct + '%"></i></div></div>';
    }
    return '<div class="macros">' +
      bar('p', 'Protein', tot.protein, s.proteinG) +
      bar('c', 'Carbs', tot.carb, s.carbG) +
      bar('f', 'Fat', tot.fat, s.fatG) + '</div>';
  }

  function entryToFood(e) {
    return { id: e.foodId || 'h_' + e.id, name: e.name, brand: e.brand,
      per100: e.per100, source: e.source || 'custom',
      serving: e.servG ? { label: r0(e.servG) + ' g', grams: e.servG } : null,
      barcode: e.barcode || '' };
  }

  /* =================================================================
     ADD (search + scan + recent)
     ================================================================= */
  function openAdd() { setTab('add'); }
  // Jump straight to Quick add (used by the "open to Quick add" startup option).
  function openQuickAdd() { setTab('add'); go(viewQuickAdd); }
  var lastResults = [];
  var lastQuery = '';

  function viewAdd() {
    var html = '<div class="view">';
    html += '<div class="searchbar">' +
      '<input class="input focusable" id="q" type="text" placeholder="Search foods..." ' +
      'value="' + esc(lastQuery) + '" data-act="search"></div>';
    html += '<div class="row focusable" data-act="scan"><span class="grow">' +
      '<span class="title">&#128247; Scan barcode</span>' +
      '<span class="sub">Look up a packaged food by its barcode</span></span></div>';
    html += '<div class="row focusable" data-act="quick"><span class="grow">' +
      '<span class="title">&#9889; Quick add</span>' +
      '<span class="sub">Log calories (and macros) without a food</span></span></div>';

    html += '<div id="results"></div>';

    if (!lastResults.length) {
      var recent = store.recentFoods();
      var customs = store.customFoods();
      if (recent.length) {
        html += '<div class="section-title">Recent</div>';
        html += recent.slice(0, 12).map(foodRowHTML).join('');
      }
      if (customs.length) {
        html += '<div class="section-title">My foods</div>';
        html += customs.slice(0, 12).map(foodRowHTML).join('');
      }
      if (!recent.length && !customs.length) {
        html += '<div class="empty">Search USDA &amp; Open Food Facts,<br>scan a barcode, or create<br>your own foods in the Foods tab.</div>';
      }
    } else {
      html += '<div class="section-title">Results</div>';
      html += lastResults.map(foodRowHTML).join('');
    }
    html += '</div>';
    screen.innerHTML = html;

    wireFoodRows();
    var q = document.getElementById('q');
    q._onEnter = function () { runSearch(q.value); };
    q._onFocus = function () { ui.setCenterLabel('Search'); ui.setRight(null); };
    document.querySelector('[data-act="scan"]')._onEnter = function () { go(viewScan); };
    document.querySelector('[data-act="quick"]')._onEnter = function () { openQuickAdd(); };

    ui.setSoftkeys({
      left: { label: 'Back', isBack: true, action: function () { setTab('today'); } },
      center: { label: 'Search', action: function () { var el = ui.currentEl(); if (el && el._onEnter) el._onEnter(el); } },
      right: null
    });
    appSub.textContent = '';
  }

  /* =================================================================
     QUICK ADD (log calories/macros directly, no food)
     ================================================================= */
  function viewQuickAdd() {
    var html = '<div class="view">';
    html += '<div class="section-title">Quick add</div>';
    html += inputField('Name (optional)', 'qName', 'text', '', 'e.g. Restaurant meal');
    html += inputField('Calories', 'qKcal', 'number', '', 'kcal');
    html += inputField('Protein (optional)', 'qProt', 'number', '', 'g');
    html += inputField('Carbs (optional)', 'qCarb', 'number', '', 'g');
    html += inputField('Fat (optional)', 'qFat', 'number', '', 'g');
    html += '<div class="hint">Adds straight to ' + esc(relLabel(state.date)).toLowerCase() + '\'s diary.</div>';
    html += '<div class="btnrow"><div class="btn focusable" data-act="qsave">Add to diary</div></div>';
    html += '</div>';
    screen.innerHTML = html;

    wire({ qsave: function () {
      var kcal = num(document.getElementById('qKcal').value, 0);
      var prot = num(document.getElementById('qProt').value, 0);
      var carb = num(document.getElementById('qCarb').value, 0);
      var fat = num(document.getElementById('qFat').value, 0);
      if (kcal <= 0 && prot <= 0 && carb <= 0 && fat <= 0) { ui.toast('Enter calories or macros'); return; }
      if (kcal <= 0) kcal = Math.round(prot * 4 + carb * 4 + fat * 9);
      var name = document.getElementById('qName').value.trim() || 'Quick add';
      // store as per-100g with grams=100 so it integrates with all totals/scaling
      store.addEntry(state.date, {
        name: net.titleCase(name), brand: '',
        per100: { kcal: kcal, protein: prot, carb: carb, fat: fat },
        grams: 100, source: 'quick', servG: 100
      });
      ui.toast('Added ' + r0(kcal) + ' kcal');
      setTab('today');
    } });
    Array.prototype.forEach.call(screen.querySelectorAll('.focusable'), function (el) {
      el._onFocus = function () { ui.setCenterLabel(el.getAttribute('data-act') === 'qsave' ? 'Add' : 'Edit'); };
    });
    ui.setSoftkeys({
      left: { label: 'Back', isBack: true, action: back },
      center: { label: 'Add', action: function () { var el = ui.currentEl(); if (el && el._onEnter) el._onEnter(el); } },
      right: null
    });
  }

  function foodRowHTML(f) {
    var b = f.source === 'usda' ? '<span class="badge usda">USDA</span>' :
            f.source === 'off' ? '<span class="badge off">OFF</span>' :
            f.source === 'custom' ? '<span class="badge custom">Mine</span>' :
            '<span class="badge recent">Food</span>';
    return '<div class="row focusable" data-act="pick" data-fid="' + esc(f.id) + '">' +
      '<span class="grow"><span class="title">' + esc(f.name) + b + '</span>' +
      '<span class="sub">' + (f.brand ? esc(f.brand) + ' &middot; ' : '') +
      r0(f.per100.kcal) + ' kcal/100g &middot; P' + r0(f.per100.protein) +
      ' C' + r0(f.per100.carb) + ' F' + r0(f.per100.fat) + '</span></span></div>';
  }

  var rowFoodIndex = {};
  function wireFoodRows() {
    rowFoodIndex = {};
    store.recentFoods().concat(store.customFoods()).concat(lastResults).forEach(function (f) {
      rowFoodIndex[f.id] = f;
    });
    Array.prototype.forEach.call(screen.querySelectorAll('[data-act="pick"]'), function (el) {
      var f = rowFoodIndex[el.getAttribute('data-fid')];
      el._onEnter = function () { if (f) openLogFood(f, {}); };
      el._onFocus = function () { ui.setCenterLabel('Select'); ui.setRight(null); };
    });
  }

  function runSearch(q) {
    q = (q || '').trim();
    if (!q) { ui.toast('Type something to search'); return; }
    lastQuery = q;
    ui.toast('Searching...');
    appSub.textContent = 'searching';
    net.searchUsda(q).then(function (foods) {
      if (foods.length) return foods;
      return net.searchOff(q); // fallback for coverage
    }).then(function (foods) {
      lastResults = foods || [];
      viewAdd();
      appSub.textContent = lastResults.length + ' results';
      if (!lastResults.length) ui.toast('No foods found');
      else {
        var first = screen.querySelector('[data-act="pick"]');
        if (first) ui.focusEl(first);
      }
    }).catch(function (err) {
      appSub.textContent = '';
      ui.toast('Search failed: ' + err.message);
    });
  }

  /* =================================================================
     LOG FOOD (servings counter -> grams, save entry)
     ================================================================= */
  function openLogFood(food, opts) {
    opts = opts || {};
    go(function () { viewLogFood(food, opts); });
  }

  function viewLogFood(food, opts) {
    var editing = !!opts.entryId;
    // grams in one serving; defaults to 100 g when the food has no serving size
    var servG = (food.serving && food.serving.grams) || 100;
    var grams = opts.grams || servG;
    var servings = grams / servG;

    function fmtServ(v) { return (Math.round(v * 10) / 10).toString(); }

    function render() {
      var n = store.scale(food.per100, grams);
      var html = '<div class="view">';
      html += '<div class="row" style="display:block"><div class="title">' + esc(food.name) + '</div>' +
        '<div class="sub">' + (food.brand ? esc(food.brand) + ' &middot; ' : '') +
        r0(food.per100.kcal) + ' kcal/100g</div></div>';

      // servings counter
      html += '<div class="section-title">Servings</div>';
      html += '<div class="stepper hgroup">' +
        '<div class="navbtn focusable" data-act="minus">&#8722;</div>' +
        '<div class="stepbox"><div class="stepval" id="servVal">' + fmtServ(servings) + '</div>' +
        '<div class="dimtag" id="servNote">' + servNote() + '</div></div>' +
        '<div class="navbtn focusable" data-act="plus">&#43;</div></div>';

      // exact grams (kept in sync)
      html += '<div class="section-title">Or exact grams</div>';
      html += '<div class="field focusable" data-f="grams"><label>Total weight (g)</label>' +
        '<input id="grams" type="tel" inputmode="numeric" value="' + r0(grams) + '"></div>';

      // live nutrition preview
      html += '<div class="section-title">This amount</div>';
      html += '<div class="cal-card"><div class="ring" style="width:64px;height:64px">' +
        '<svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" fill="none" stroke="var(--bg3)" stroke-width="6"/></svg>' +
        '<div class="ring-center"><div class="ring-num" id="pvKcal" style="font-size:16px">' + r0(n.kcal) + '</div><div class="ring-lbl">kcal</div></div></div>' +
        '<div class="cal-meta">' +
        '<div class="line"><span style="color:var(--protein)">Protein</span><span class="v" id="pvP">' + n.protein + ' g</span></div>' +
        '<div class="line"><span style="color:var(--carb)">Carbs</span><span class="v" id="pvC">' + n.carb + ' g</span></div>' +
        '<div class="line"><span style="color:var(--fat)">Fat</span><span class="v" id="pvF">' + n.fat + ' g</span></div>' +
        '</div></div>';

      html += '<div class="btnrow"><div class="btn focusable" data-act="save">' +
        (editing ? 'Update entry' : 'Add to today') + '</div></div>';
      html += '</div>';
      screen.innerHTML = html;

      var gi = document.getElementById('grams');
      gi.addEventListener('input', function () {
        grams = num(gi.value, 0);
        servings = grams / servG;
        document.getElementById('servVal').textContent = fmtServ(servings);
        document.getElementById('servNote').textContent = servNote();
        recalc();
      });
      screen.querySelector('[data-f="grams"]')._onEnter = function () {};

      wire({
        minus: function () { setServings(servings - 0.5); },
        plus: function () { setServings(servings + 0.5); },
        save: doSave
      });

      Array.prototype.forEach.call(screen.querySelectorAll('.focusable'), function (el) {
        var act = el.getAttribute('data-act');
        el._onFocus = function () {
          ui.setCenterLabel(act === 'save' ? (editing ? 'Update' : 'Save') :
            act === 'minus' ? '− 0.5' : act === 'plus' ? '+ 0.5' : 'Edit');
        };
      });

      ui.setSoftkeys({
        left: { label: 'Back', isBack: true, action: back },
        center: { label: 'Save', action: function () { var el = ui.currentEl(); if (el && el._onEnter) el._onEnter(el); } },
        right: editing ? { label: 'Delete', action: function () {
          store.removeEntry(state.date, opts.entryId); ui.toast('Deleted'); setTab('today');
        } } : null
      });
    }

    function servNote() {
      var note = '1 serving = ' + r0(servG) + ' g';
      if (food.serving && food.serving.label && !/^\d+\s*g$/.test(food.serving.label)) {
        note += ' (' + esc(food.serving.label) + ')';
      }
      return note + ' · total ' + r0(grams) + ' g';
    }

    function setServings(v) {
      servings = Math.max(0.5, Math.round(v * 2) / 2);
      grams = servings * servG;
      document.getElementById('servVal').textContent = fmtServ(servings);
      document.getElementById('servNote').textContent = servNote();
      document.getElementById('grams').value = r0(grams);
      recalc();
    }

    function recalc() {
      var n = store.scale(food.per100, grams);
      document.getElementById('pvKcal').textContent = r0(n.kcal);
      document.getElementById('pvP').textContent = n.protein + ' g';
      document.getElementById('pvC').textContent = n.carb + ' g';
      document.getElementById('pvF').textContent = n.fat + ' g';
    }

    function doSave() {
      var g = num(document.getElementById('grams').value, 0);
      if (g <= 0) { ui.toast('Enter an amount'); return; }
      if (editing) {
        store.updateEntry(state.date, opts.entryId, { grams: g });
        ui.toast('Updated');
      } else {
        store.addEntry(state.date, {
          name: food.name, brand: food.brand || '', per100: food.per100, grams: g,
          source: food.source || 'custom', foodId: food.id, barcode: food.barcode || '',
          servG: servG
        });
        store.pushRecent(food);
        ui.toast('Added ' + store.scale(food.per100, g).kcal + ' kcal');
      }
      setTab('today');
    }

    render();
  }

  /* =================================================================
     SCAN (barcode) — dedicated full-screen camera view
     The camera feed fills the whole window (above the softkey bar) so the
     barcode is big and easy to aim; the decoder already reads the full video
     frame, not the little preview box it used before.
     ================================================================= */
  var scanLooking = false;

  // Shared barcode lookup used by both the camera and the manual-entry screen.
  function lookupBarcodeCode(code, opts) {
    opts = opts || {};
    code = String(code).replace(/\D/g, '');
    if (code.length < 6) { ui.toast('Enter a valid barcode'); if (opts.onEmpty) opts.onEmpty(); return; }
    if (scanLooking) return;
    scanLooking = true;
    if (opts.onStatus) opts.onStatus('Looking up ' + code + '…');
    net.lookupBarcode(code).then(function (food) {
      scanLooking = false;
      if (!food) {
        ui.toast('Not found — keep scanning or create it');
        if (opts.onStatus) opts.onStatus('No product for ' + code + '. Try again.');
        if (opts.onEmpty) opts.onEmpty();
        return;
      }
      if (opts.onFound) opts.onFound();
      openLogFood(food, {});
    }).catch(function () {
      scanLooking = false;
      ui.toast('Lookup failed');
      if (opts.onStatus) opts.onStatus('Lookup failed. Try again.');
      if (opts.onEmpty) opts.onEmpty();
    });
  }

  function viewScan() {
    // A near-empty placeholder keeps the nav stack honest; the live camera is a
    // full-screen overlay appended to <body> so it can sit above the app chrome.
    screen.innerHTML = '<div class="view"></div>';

    var overlay = document.createElement('div');
    overlay.id = 'scanScreen';
    overlay.innerHTML =
      '<div id="scanVideoWrap"></div>' +
      '<div class="scan-flash" id="scanFlash">&#128161; Flash: Off</div>' +
      '<div class="scan-reticle"><span class="scan-laser"></span></div>' +
      '<div class="scan-top" id="scanStatus">Starting camera…</div>' +
      '<div class="scan-bottom">Fill the box with the barcode &middot; press <b>*</b> for flash</div>';
    document.body.appendChild(overlay);
    ui.setModal(true);

    var statusEl = overlay.querySelector('#scanStatus');
    var flashEl = overlay.querySelector('#scanFlash');
    var wrap = overlay.querySelector('#scanVideoWrap');
    var scanner = MS.scanner ? MS.scanner.create(wrap, statusEl, onCode) : null;
    if (scanner) scanner.start();
    else statusEl.textContent = 'Camera not available — press Type to enter the number.';

    // The camera backend resolves asynchronously; once it's up, reflect whether
    // this device actually has a controllable torch (only the KaiOS Camera API
    // backend does — a desktop browser / simulator won't).
    function reflectFlashCapability() {
      if (closed) return;
      var bottom = overlay.querySelector('.scan-bottom');
      if (scanner && scanner.torchSupported()) {
        flashEl.classList.remove('off');
      } else {
        flashEl.classList.add('off');
        flashEl.innerHTML = '&#128161; No flash';
        if (bottom) bottom.textContent = 'Fill the box with the barcode';
      }
    }
    setTimeout(reflectFlashCapability, 1400);
    setTimeout(reflectFlashCapability, 3000);

    function toggleFlash() {
      if (!scanner) { ui.toast('Camera not available'); return; }
      var state = scanner.toggleTorch();
      if (state === null) { ui.toast('No flashlight on this camera'); flashEl.classList.add('off'); flashEl.innerHTML = '&#128161; No flash'; return; }
      flashEl.innerHTML = '&#128161; Flash: ' + (state ? 'On' : 'Off');
      flashEl.classList.toggle('on', state);
    }
    // The star key toggles the torch (there's no spare softkey slot on the scanner).
    function onStar(e) { if (e.key === '*') { e.preventDefault(); e.stopPropagation(); toggleFlash(); } }
    document.addEventListener('keydown', onStar, true);

    var closed = false;
    function cleanup() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onStar, true);
      ui.setModal(false);
      if (scanner) scanner.stop();
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    function onCode(code) {
      lookupBarcodeCode(code, {
        onStatus: function (t) { statusEl.textContent = t; },
        onEmpty: function () { if (scanner) scanner.resume(); },
        onFound: cleanup
      });
    }

    ui.setSoftkeys({
      left: { label: 'Back', isBack: true, action: function () { cleanup(); back(); } },
      center: { label: 'Scan', action: function () {
        if (scanner) { statusEl.textContent = 'Scanning…'; scanner.scanOnce(); }
        else ui.toast('Camera not available — press Type');
      } },
      right: { label: 'Type', action: function () { cleanup(); go(viewBarcodeEntry); } }
    });
  }

  /* Manual barcode entry — its own clean form so OK/Enter looks up the number
     you typed (the old mixed camera+field screen triggered a camera scan on OK). */
  function viewBarcodeEntry() {
    var html = '<div class="view">';
    html += '<div class="section-title">Enter barcode</div>';
    html += '<div class="field focusable" data-fid="code"><label>Barcode digits</label>' +
      '<input id="code" type="tel" inputmode="numeric" placeholder="e.g. 049000028911"></div>';
    html += '<div class="hint" id="bcHint">Type the number under the barcode, then press Look up.</div>';
    html += '<div class="btnrow"><div class="btn focusable" data-act="lookup">Look up</div></div>';
    html += '</div>';
    screen.innerHTML = html;

    function submit() {
      lookupBarcodeCode(document.getElementById('code').value, {
        onStatus: function (t) { var h = document.getElementById('bcHint'); if (h) h.textContent = t; }
      });
    }
    // OK on the field OR the button both look up — the old bug was OK doing nothing.
    document.querySelector('[data-fid="code"]')._onEnter = submit;
    wire({ lookup: submit });

    Array.prototype.forEach.call(screen.querySelectorAll('.focusable'), function (el) {
      el._onFocus = function () { ui.setCenterLabel('Look up'); };
    });
    ui.setSoftkeys({
      left: { label: 'Back', isBack: true, action: back },
      center: { label: 'Look up', action: submit },
      right: null
    });
  }

  /* =================================================================
     WEIGHT
     ================================================================= */
  function viewWeight() {
    var s = store.settings();
    var st = store.weightStats();
    var ws = store.weights().slice().reverse(); // newest first for list
    var html = '<div class="view">';

    if (st) {
      var change = Math.round((kgToU(st.latest) - kgToU(st.first)) * 10) / 10;
      html += '<div class="stat-row">' +
        '<div class="stat"><div class="sval">' + (Math.round(kgToU(st.latest) * 10) / 10) + '</div><div class="slbl">' + unit() + ' now</div></div>' +
        '<div class="stat"><div class="sval" style="color:' + (change <= 0 ? 'var(--accent)' : 'var(--protein)') + '">' +
        (change > 0 ? '+' : '') + change + '</div><div class="slbl">change</div></div>' +
        '<div class="stat"><div class="sval">' + (s.weightGoalKg ? (Math.round(kgToU(s.weightGoalKg) * 10) / 10) : '--') + '</div><div class="slbl">goal</div></div>' +
        '</div>';
      html += weightChartHTML(store.weights(), s.weightGoalKg, store.weightTrend(s.weightGoalKg));
      html += '<div class="hint" style="text-align:center;margin-top:-2px">' +
        '<span style="color:var(--accent)">&#9679; actual</span> &nbsp; ' +
        '<span style="color:var(--fat)">- - projected</span>' +
        (s.weightGoalKg ? ' &nbsp; <span style="color:var(--carb)">- - goal</span>' : '') + '</div>';
      html += etaHTML(s.weightGoalKg);
    } else {
      html += '<div class="empty">No weight logged yet.<br>Add your first entry below.</div>';
    }

    html += '<div class="row focusable" data-act="addw"><span class="grow">' +
      '<span class="title">&#43; Log weight</span><span class="sub">Record today\'s weight</span></span></div>';

    if (ws.length) {
      html += '<div class="section-title">History</div>';
      ws.forEach(function (w) {
        html += '<div class="row focusable" data-act="delw" data-id="' + w.id + '">' +
          '<span class="grow"><span class="title">' + fmtW(w.kg) + '</span>' +
          '<span class="sub">' + esc(dateLabel(w.date)) + '</span></span></div>';
      });
    }
    html += '</div>';
    screen.innerHTML = html;

    wire({
      addw: function () { go(viewWeightForm); },
      delw: function (el) {
        store.removeWeight(el.getAttribute('data-id'));
        ui.toast('Removed'); viewWeight(); ui.resetFocus();
      }
    });
    Array.prototype.forEach.call(screen.querySelectorAll('.focusable'), function (el) {
      el._onFocus = function () {
        if (el.getAttribute('data-act') === 'delw') { ui.setCenterLabel('Delete'); }
        else { ui.setCenterLabel('Open'); }
      };
    });

    ui.setSoftkeys({
      left: { label: 'Back', isBack: true, action: function () { setTab('today'); } },
      center: { label: 'Open', action: function () { var el = ui.currentEl(); if (el && el._onEnter) el._onEnter(el); } },
      right: null
    });
  }

  // Weight line chart: actual points (solid) plus a dashed projection of the
  // least-squares trend into the future so you can compare where you're headed
  // against where you are now. Optional goal line.
  function weightChartHTML(ws, goalKg, trend) {
    if (ws.length < 2) {
      return '<div class="hint" style="text-align:center;padding:10px 0">Log on another day to see your progress graph.</div>';
    }
    var DAY = 86400000;
    var t0 = new Date(ws[0].date + 'T00:00:00').getTime();
    var tLast = new Date(ws[ws.length - 1].date + 'T00:00:00').getTime();

    // Project the trend forward — to the goal date if we're heading there,
    // otherwise a fixed 21-day horizon. Cap it so the past isn't squashed.
    var tEnd = tLast, predEndU = null;
    if (trend) {
      var horizon = tLast + 21 * DAY;
      if (trend.towardGoal && trend.targetDate) {
        var tg = new Date(trend.targetDate + 'T00:00:00').getTime();
        if (tg > tLast) horizon = Math.min(tg, tLast + 120 * DAY);
      }
      tEnd = horizon;
      predEndU = kgToU(trend.intercept + trend.slopePerDay * ((tEnd - t0) / DAY));
    }

    var vals = ws.map(function (w) { return kgToU(w.kg); });
    var goalU = goalKg != null ? kgToU(goalKg) : null;
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (goalU != null) { lo = Math.min(lo, goalU); hi = Math.max(hi, goalU); }
    if (predEndU != null) { lo = Math.min(lo, predEndU); hi = Math.max(hi, predEndU); }
    var pad = (hi - lo) * 0.12 || 1; lo -= pad; hi += pad;
    var range = (hi - lo) || 1;
    var W = 224, H = 96, L = 26, B = 14, T = 6;
    var span = (tEnd - t0) || 1;
    function Xt(ms) { return L + (W - L - 4) * ((ms - t0) / span); }
    function X(i) { return Xt(new Date(ws[i].date + 'T00:00:00').getTime()); }
    function Y(v) { return T + (H - T - B) * (1 - (v - lo) / range); }

    var line = vals.map(function (v, i) { return X(i).toFixed(1) + ',' + Y(v).toFixed(1); }).join(' ');
    var area = 'M' + X(0).toFixed(1) + ',' + (H - B) + ' L' +
      vals.map(function (v, i) { return X(i).toFixed(1) + ',' + Y(v).toFixed(1); }).join(' L') +
      ' L' + X(vals.length - 1).toFixed(1) + ',' + (H - B) + ' Z';
    var dots = vals.map(function (v, i) { return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="1.8" fill="var(--accent)"/>'; }).join('');

    // dashed projection from the latest actual point to the horizon
    var proj = '';
    if (predEndU != null && tEnd > tLast) {
      proj = '<line x1="' + X(vals.length - 1).toFixed(1) + '" y1="' + Y(vals[vals.length - 1]).toFixed(1) +
        '" x2="' + Xt(tEnd).toFixed(1) + '" y2="' + Y(predEndU).toFixed(1) +
        '" stroke="var(--fat)" stroke-width="1.5" stroke-dasharray="3 3"/>' +
        '<circle cx="' + Xt(tEnd).toFixed(1) + '" cy="' + Y(predEndU).toFixed(1) + '" r="1.8" fill="var(--fat)"/>';
      // Only label the projected value when there's no goal line to collide with.
      if (goalU == null) {
        proj += '<text x="' + Xt(tEnd).toFixed(1) + '" y="' + (Y(predEndU) - 3).toFixed(1) +
          '" text-anchor="end" font-size="7" fill="var(--fat)">' + (Math.round(predEndU * 10) / 10) + '</text>';
      }
    }

    var goalLine = '';
    if (goalU != null) {
      var gy = Y(goalU).toFixed(1);
      goalLine = '<line x1="' + L + '" y1="' + gy + '" x2="' + W + '" y2="' + gy +
        '" stroke="var(--carb)" stroke-width="1" stroke-dasharray="3 3"/>' +
        '<text x="' + W + '" y="' + (gy - 2) + '" text-anchor="end" font-size="7" fill="var(--carb)">goal</text>';
    }
    var yTop = '<text x="2" y="' + (T + 6) + '" font-size="7" fill="var(--muted)">' + (Math.round(hi * 10) / 10) + '</text>';
    var yBot = '<text x="2" y="' + (H - B) + '" font-size="7" fill="var(--muted)">' + (Math.round(lo * 10) / 10) + '</text>';
    var xFirst = '<text x="' + L + '" y="' + (H - 3) + '" font-size="7" fill="var(--muted)">' + shortDate(ws[0].date) + '</text>';
    var xLast = '<text x="' + W + '" y="' + (H - 3) + '" text-anchor="end" font-size="7" fill="var(--muted)">' +
      shortDate(store.todayKey(new Date(tEnd))) + '</text>';
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<path d="' + area + '" fill="var(--accent)" opacity="0.12"/>' +
      goalLine + proj +
      '<polyline fill="none" stroke="var(--accent)" stroke-width="2" points="' + line + '"/>' +
      dots + yTop + yBot + xFirst + xLast + '</svg>';
  }
  function shortDate(key) { var d = new Date(key + 'T00:00:00'); return MON[d.getMonth()] + ' ' + d.getDate(); }

  // Estimated days-to-goal panel from the weight trend.
  function etaHTML(goalKg) {
    var tr = store.weightTrend(goalKg);
    if (!tr) return '';
    var rate = Math.abs(Math.round(kgToU(Math.abs(tr.slopePerDay) * 7) * 10) / 10);
    var rateTxt = rate ? (rate + ' ' + unit() + '/wk ' + (tr.slopePerDay < 0 ? 'down' : 'up')) : 'holding steady';
    var body;
    if (goalKg == null) {
      body = '<span class="sub">Set a weight goal in More to see your estimate.</span>';
    } else if (tr.atGoal) {
      body = '<span class="title right-accent">You\'re at your goal! &#127881;</span>';
    } else if (tr.towardGoal) {
      body = '<span class="title right-accent">~' + tr.etaDays + ' days to goal</span>' +
        '<span class="sub">on track for ' + dateFull(tr.targetDate) + '</span>';
    } else {
      body = '<span class="title">Trend isn\'t toward your goal yet</span>' +
        '<span class="sub">adjust intake to change direction</span>';
    }
    return '<div class="row" style="display:block"><div class="grow">' + body +
      '<div class="sub" style="margin-top:2px">Trend: ' + rateTxt + '</div></div></div>';
  }

  function viewWeightForm() {
    var s = store.settings();
    var cur = store.weightStats();
    var defVal = cur ? Math.round(kgToU(cur.latest) * 10) / 10 : '';
    var html = '<div class="view">';
    html += '<div class="section-title">Log weight (' + unit() + ')</div>';
    html += '<div class="field focusable" data-f="w"><label>Weight in ' + unit() + '</label>' +
      '<input id="wval" type="tel" inputmode="decimal" value="' + defVal + '" placeholder="0.0"></div>';
    html += '<div class="hint">Saved against today. One entry per day; logging again replaces it.</div>';
    html += '<div class="btnrow"><div class="btn focusable" data-act="savew">Save</div></div>';
    html += '</div>';
    screen.innerHTML = html;

    wire({ savew: function () {
      var v = num(document.getElementById('wval').value, 0);
      if (v <= 0) { ui.toast('Enter a weight'); return; }
      store.addWeight(uToKg(v));
      ui.toast('Weight saved');
      back();
    } });
    ui.setSoftkeys({
      left: { label: 'Back', isBack: true, action: back },
      center: { label: 'Save', action: function () { var el = ui.currentEl(); if (el && el._onEnter) el._onEnter(el); } },
      right: null
    });
  }

  /* =================================================================
     FOODS (custom foods)
     ================================================================= */
  function viewFoods() {
    var customs = store.customFoods();
    var html = '<div class="view">';
    html += '<div class="row focusable" data-act="new"><span class="grow">' +
      '<span class="title">&#43; Create new food</span>' +
      '<span class="sub">Enter calories &amp; macros per serving</span></span></div>';
    if (customs.length) {
      html += '<div class="section-title">My foods</div>';
      customs.forEach(function (f) {
        html += '<div class="row focusable" data-act="logc" data-fid="' + esc(f.id) + '">' +
          '<span class="grow"><span class="title">' + esc(f.name) + '</span>' +
          '<span class="sub">' + (f.brand ? esc(f.brand) + ' &middot; ' : '') +
          r0(f.per100.kcal) + ' kcal &middot; P' + r0(f.per100.protein) + ' C' + r0(f.per100.carb) +
          ' F' + r0(f.per100.fat) + ' /100g</span></span></div>';
      });
    } else {
      html += '<div class="empty">No custom foods yet.<br>Create one to log meals you<br>eat often or that aren\'t online.</div>';
    }
    html += '</div>';
    screen.innerHTML = html;

    var idx = {}; customs.forEach(function (f) { idx[f.id] = f; });
    wire({
      new: function () { go(function () { viewFoodForm(null); }); },
      logc: function (el) { var f = idx[el.getAttribute('data-fid')]; if (f) openLogFood(f, {}); }
    });
    Array.prototype.forEach.call(screen.querySelectorAll('[data-act="logc"]'), function (el) {
      var f = idx[el.getAttribute('data-fid')];
      el._onFocus = function () {
        ui.setCenterLabel('Log');
        ui.setRight({ label: 'Edit', action: function () { go(function () { viewFoodForm(f); }); } });
      };
    });
    var newRow = screen.querySelector('[data-act="new"]');
    newRow._onFocus = function () { ui.setCenterLabel('Create'); ui.setRight(null); };

    ui.setSoftkeys({
      left: { label: 'Back', isBack: true, action: function () { setTab('today'); } },
      center: { label: 'Create', action: function () { var el = ui.currentEl(); if (el && el._onEnter) el._onEnter(el); } },
      right: null
    });
  }

  var OZ_G = 28.349523;
  function viewFoodForm(food) {
    var editing = !!food;
    // Serving state: how many <servUnit> make one serving, and per-serving macros.
    var servUnit = 'g';
    var servAmount = 100;
    var per = { kcal: '', protein: '', carb: '', fat: '' };
    if (editing) {
      var g = (food.serving && food.serving.grams) || 100;
      servAmount = Math.round(g * 100) / 100;
      var f = g / 100;
      per = {
        kcal: r0(food.per100.kcal * f),
        protein: store.round1(food.per100.protein * f),
        carb: store.round1(food.per100.carb * f),
        fat: store.round1(food.per100.fat * f)
      };
    } else {
      food = { name: '', brand: '' };
    }

    var html = '<div class="view">';
    html += '<div class="section-title">' + (editing ? 'Edit food' : 'New food') + '</div>';
    html += inputField('Name', 'fName', 'text', food.name, 'e.g. Homemade granola');
    html += inputField('Brand (optional)', 'fBrand', 'text', food.brand, '');

    html += '<div class="section-title">Serving size</div>';
    html += '<div class="seg hgroup">' +
      '<div class="segbtn focusable' + (servUnit === 'g' ? ' active' : '') + '" data-act="unitG">Grams</div>' +
      '<div class="segbtn focusable' + (servUnit === 'oz' ? ' active' : '') + '" data-act="unitOz">Ounces</div></div>';
    html += '<div class="field focusable" data-fid="fServ"><label><span id="servUnitLbl">' +
      (servUnit === 'oz' ? 'Ounces' : 'Grams') + '</span> in one serving</label>' +
      '<input id="fServ" type="tel" inputmode="decimal" value="' + esc(servAmount) + '"></div>';

    html += '<div class="section-title">Per serving</div>';
    html += inputField('Calories /serving', 'fKcal', 'number', per.kcal, 'kcal');
    html += inputField('Protein /serving', 'fProt', 'number', per.protein, 'g');
    html += inputField('Carbs /serving', 'fCarb', 'number', per.carb, 'g');
    html += inputField('Fat /serving', 'fFat', 'number', per.fat, 'g');
    html += '<div class="hint" id="perHint">Stored as per-100g automatically. Leave calories blank to calc from macros (4/4/9).</div>';
    html += '<div class="btnrow"><div class="btn focusable" data-act="savef">' +
      (editing ? 'Save changes' : 'Create food') + '</div></div>';
    html += '</div>';
    screen.innerHTML = html;

    function setUnit(u) {
      servUnit = u;
      screen.querySelector('[data-act="unitG"]').classList.toggle('active', u === 'g');
      screen.querySelector('[data-act="unitOz"]').classList.toggle('active', u === 'oz');
      document.getElementById('servUnitLbl').textContent = u === 'oz' ? 'Ounces' : 'Grams';
      updateHint();
    }
    function gramsPerServing() {
      var a = num(document.getElementById('fServ').value, 0);
      return servUnit === 'oz' ? a * OZ_G : a;
    }
    function updateHint() {
      var gps = gramsPerServing();
      document.getElementById('perHint').textContent = gps > 0
        ? ('1 serving = ' + r0(gps) + ' g — stored as per-100g automatically.')
        : 'Stored as per-100g automatically.';
    }
    document.getElementById('fServ').addEventListener('input', updateHint);
    updateHint();

    wire({ unitG: function () { setUnit('g'); }, unitOz: function () { setUnit('oz'); }, savef: saveFood });
    Array.prototype.forEach.call(screen.querySelectorAll('.focusable'), function (el) {
      el._onFocus = function () {
        var act = el.getAttribute('data-act');
        ui.setCenterLabel(act === 'savef' ? 'Save' : act === 'unitG' || act === 'unitOz' ? 'Pick' : 'Edit');
      };
    });

    ui.setSoftkeys({
      left: { label: 'Back', isBack: true, action: back },
      center: { label: 'Save', action: function () { var el = ui.currentEl(); if (el && el._onEnter) el._onEnter(el); } },
      right: editing ? { label: 'Delete', action: function () {
        store.removeCustomFood(food.id); ui.toast('Deleted'); back();
      } } : null
    });

    function saveFood() {
      var name = document.getElementById('fName').value.trim();
      if (!name) { ui.toast('Name is required'); return; }
      var gps = gramsPerServing();
      if (gps <= 0) { ui.toast('Enter a serving size'); return; }
      var prot = num(document.getElementById('fProt').value, 0);
      var carb = num(document.getElementById('fCarb').value, 0);
      var fat = num(document.getElementById('fFat').value, 0);
      var kcalRaw = document.getElementById('fKcal').value.trim();
      var kcal = kcalRaw === '' ? (prot * 4 + carb * 4 + fat * 9) : num(kcalRaw, 0);
      if (kcal <= 0 && prot <= 0 && carb <= 0 && fat <= 0) { ui.toast('Enter calories or macros'); return; }
      // convert per-serving -> per-100g for storage
      var k = 100 / gps;
      var amt = num(document.getElementById('fServ').value, 0);
      var data = {
        name: net.titleCase(name),
        brand: document.getElementById('fBrand').value.trim(),
        per100: { kcal: r0(kcal * k), protein: store.round1(prot * k), carb: store.round1(carb * k), fat: store.round1(fat * k) },
        serving: { label: amt + (servUnit === 'oz' ? ' oz' : ' g'), grams: gps }
      };
      if (editing) { store.updateCustomFood(food.id, data); ui.toast('Saved'); }
      else { store.addCustomFood(data); ui.toast('Food created'); }
      back();
    }
  }

  function inputField(label, id, type, val, ph) {
    // numeric fields use type=tel: shows the numeric keypad on device AND keeps a
    // plain string value so we can edit it manually under synthetic key events.
    var t = type === 'number' ? 'tel' : type;
    var im = type === 'number' ? ' inputmode="decimal"' : '';
    return '<div class="field focusable" data-fid="' + id + '"><label>' + label + '</label>' +
      '<input id="' + id + '" type="' + t + '"' + im +
      ' value="' + esc(val) + '" placeholder="' + esc(ph || '') + '"></div>';
  }

  /* =================================================================
     SETTINGS (More)
     ================================================================= */
  function viewSettings() {
    var s = store.settings();
    var html = '<div class="view">';
    html += '<div class="section-title">Daily goals</div>';
    html += inputField('Calorie limit (kcal)', 'sCal', 'number', s.calorieLimit, '2000');
    html += inputField('Protein target (g)', 'sProt', 'number', s.proteinG, '');
    html += inputField('Carbs target (g)', 'sCarb', 'number', s.carbG, '');
    html += inputField('Fat target (g)', 'sFat', 'number', s.fatG, '');
    html += '<div class="hint">Tip: a quick macro split for your calories is ~30% protein, 40% carbs, 30% fat.</div>';

    html += '<div class="section-title">Weight</div>';
    html += '<div class="row focusable" data-f="unit"><span class="grow"><span class="title">Units</span></span>' +
      '<span class="right" id="unitVal">' + (s.weightUnit === 'lb' ? 'Pounds (lb)' : 'Kilograms (kg)') + '</span></div>';
    html += '<div class="field focusable" data-fid="sGoal"><label>Weight goal (<span id="goalUnit">' +
      s.weightUnit + '</span>)</label><input id="sGoal" type="tel" inputmode="decimal" value="' +
      (s.weightGoalKg ? Math.round(kgToU(s.weightGoalKg) * 10) / 10 : '') + '" placeholder="optional"></div>';

    html += '<div class="section-title">Startup</div>';
    html += '<div class="row focusable" data-act="togglestart"><span class="grow"><span class="title">Open to Quick add</span>' +
      '<span class="sub">Launch straight into the Quick add screen</span></span>' +
      '<span class="right" id="startVal">' + (s.startOnQuickAdd ? 'On' : 'Off') + '</span></div>';

    html += '<div class="section-title">Day progress</div>';
    html += inputField('Day starts (hour 0–23)', 'sDayStart', 'number', s.dayStartHour, '8');
    html += inputField('Day ends (hour 1–24)', 'sDayEnd', 'number', s.dayEndHour, '22');
    html += '<div class="hint">The Today ring compares how far into your day it is with how much of your calorie budget you\'ve used.</div>';

    html += '<div class="section-title">Data</div>';
    html += '<div class="row focusable" data-act="autogoal"><span class="grow"><span class="title">Auto macro split</span>' +
      '<span class="sub">Set P/C/F from calorie limit (30/40/30)</span></span></div>';
    html += '<div class="row focusable" data-act="export"><span class="grow"><span class="title">Export / backup</span>' +
      '<span class="sub">' + (MS.backup.deviceAvailable() ? 'Save a backup to the sdcard' : 'Download a backup file') + '</span></span></div>';
    html += '<div class="row focusable" data-act="import"><span class="grow"><span class="title">Import / restore</span>' +
      '<span class="sub">' + (MS.backup.deviceAvailable() ? 'Restore from the sdcard backup' : 'Restore from a backup file') + '</span></span></div>';
    html += '<div class="row focusable" data-act="clear"><span class="grow"><span class="title" style="color:var(--danger)">Clear all data</span>' +
      '<span class="sub">Delete diary, weights &amp; foods</span></span></div>';

    html += '<div class="btnrow"><div class="btn focusable" data-act="save">Save settings</div></div>';
    html += '<div class="hint" style="text-align:center;margin-top:10px">MacroScan v' + MS.VERSION +
      ' &middot; Data: USDA FoodData Central &amp; Open Food Facts</div>';
    html += '</div>';
    screen.innerHTML = html;

    var unitEl = screen.querySelector('[data-f="unit"]');
    var pendingUnit = s.weightUnit;
    unitEl._onEnter = function () {
      var newU = pendingUnit === 'kg' ? 'lb' : 'kg';
      // convert the displayed goal value to the new unit so it stays equivalent
      var gEl = document.getElementById('sGoal');
      if (gEl.value.trim() !== '') {
        var v = num(gEl.value, 0);
        var kg = pendingUnit === 'lb' ? v / 2.2046226 : v;
        gEl.value = Math.round((newU === 'lb' ? kg * 2.2046226 : kg) * 10) / 10;
      }
      pendingUnit = newU;
      document.getElementById('unitVal').textContent = pendingUnit === 'lb' ? 'Pounds (lb)' : 'Kilograms (kg)';
      document.getElementById('goalUnit').textContent = pendingUnit;
    };

    var pendingStart = !!s.startOnQuickAdd;
    screen.querySelector('[data-act="togglestart"]')._onEnter = function () {
      pendingStart = !pendingStart;
      document.getElementById('startVal').textContent = pendingStart ? 'On' : 'Off';
    };

    wire({
      autogoal: function () {
        var cal = num(document.getElementById('sCal').value, s.calorieLimit);
        document.getElementById('sProt').value = Math.round(cal * 0.30 / 4);
        document.getElementById('sCarb').value = Math.round(cal * 0.40 / 4);
        document.getElementById('sFat').value = Math.round(cal * 0.30 / 9);
        ui.toast('Macro split set');
      },
      'export': function () {
        MS.backup.exportNow(store.exportData()).then(function () {
          ui.toast(MS.backup.deviceAvailable() ? 'Backed up to sdcard' : 'Backup downloaded');
        }).catch(function () { ui.toast('Export failed'); });
      },
      'import': function () {
        MS.backup.importNow().then(function (txt) {
          try { store.importData(txt); ui.toast('Data imported'); setTab('today'); }
          catch (e) { ui.toast('Invalid backup file'); }
        }).catch(function (e) { ui.toast(e.message || 'Import cancelled'); });
      },
      clear: function () {
        go(function () { confirmClear(); });
      },
      save: function () {
        store.setSetting('calorieLimit', num(document.getElementById('sCal').value, 2000));
        store.setSetting('proteinG', num(document.getElementById('sProt').value, 0));
        store.setSetting('carbG', num(document.getElementById('sCarb').value, 0));
        store.setSetting('fatG', num(document.getElementById('sFat').value, 0));
        store.setSetting('startOnQuickAdd', pendingStart);
        // clamp day-progress hours to a sane 0–24 window (start before end)
        var ds = Math.max(0, Math.min(23, Math.round(num(document.getElementById('sDayStart').value, 8))));
        var de = Math.max(1, Math.min(24, Math.round(num(document.getElementById('sDayEnd').value, 22))));
        if (de <= ds) de = Math.min(24, ds + 1);
        store.setSetting('dayStartHour', ds);
        store.setSetting('dayEndHour', de);
        // the goal field is displayed in pendingUnit (kept in sync on toggle)
        var goalRaw = document.getElementById('sGoal').value.trim();
        store.setSetting('weightUnit', pendingUnit);
        if (goalRaw === '') store.setSetting('weightGoalKg', null);
        else {
          var v = num(goalRaw, 0);
          var kg = (pendingUnit === 'lb') ? v / 2.2046226 : v;
          store.setSetting('weightGoalKg', kg);
        }
        ui.toast('Settings saved');
        setTab('today');
      }
    });
    Array.prototype.forEach.call(screen.querySelectorAll('.focusable'), function (el) {
      el._onFocus = function () {
        var act = el.getAttribute('data-act');
        ui.setCenterLabel(act === 'save' ? 'Save' : act === 'clear' ? 'Clear' :
          act === 'autogoal' ? 'Apply' : act === 'export' ? 'Export' : act === 'import' ? 'Import' :
          act === 'togglestart' || el.getAttribute('data-f') === 'unit' ? 'Toggle' : 'OK');
      };
    });

    ui.setSoftkeys({
      left: { label: 'Back', isBack: true, action: function () { setTab('today'); } },
      center: { label: 'Save', action: function () { var el = ui.currentEl(); if (el && el._onEnter) el._onEnter(el); } },
      right: null
    });
  }

  function confirmClear() {
    screen.innerHTML = '<div class="view"><div class="section-title">Clear all data?</div>' +
      '<div class="hint">This permanently deletes your diary, weight history, custom foods and settings. This cannot be undone.</div>' +
      '<div class="btnrow hgroup"><div class="btn focusable" data-act="cancel">Cancel</div>' +
      '<div class="btn danger focusable" data-act="confirm">Delete all</div></div></div>';
    wire({
      cancel: back,
      confirm: function () { store.clearAll(); ui.toast('All data cleared'); setTab('today'); }
    });
    Array.prototype.forEach.call(screen.querySelectorAll('.focusable'), function (el) {
      el._onFocus = function () { ui.setCenterLabel(el.getAttribute('data-act') === 'confirm' ? 'Delete' : 'Cancel'); };
    });
    ui.setSoftkeys({
      left: { label: 'Back', isBack: true, action: back },
      center: { label: 'Select', action: function () { var el = ui.currentEl(); if (el && el._onEnter) el._onEnter(el); } },
      right: null
    });
  }

  /* ============================ boot ============================ */
  var tabRoot = {
    today: viewToday, add: viewAdd, weight: viewWeight, foods: viewFoods, settings: viewSettings
  };

  MS.app = { gotoTabIndex: gotoTabIndex, back: back, setTab: setTab };

  // Was this a fresh install (no local data yet)? Capture before anything saves.
  var wasFresh = false;
  try { wasFresh = (localStorage.getItem('macroscan.data') == null); } catch (e) {}

  // tab bar clicks (also work with system cursor if enabled)
  Array.prototype.forEach.call(document.querySelectorAll('#tabbar .tab'), function (t) {
    t.addEventListener('click', function () { setTab(t.getAttribute('data-view')); });
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  // Auto-backup to the sdcard (debounced) on every change so data survives
  // app reinstalls. No-op in a plain browser (no DeviceStorage).
  var backupTimer = null;
  store.onChange(function () {
    if (!MS.backup.deviceAvailable()) return;
    clearTimeout(backupTimer);
    backupTimer = setTimeout(function () {
      MS.backup.writeDevice(store.exportData()).catch(function () {});
    }, 1500);
  });

  // Land on Quick add when the user opted to "open to Quick add" (fast logging);
  // otherwise the normal Today dashboard.
  if (store.settings().startOnQuickAdd) openQuickAdd();
  else setTab('today');

  // On a fresh install, restore the sdcard backup automatically if present.
  if (wasFresh && MS.backup.deviceAvailable()) {
    MS.backup.readDevice().then(function (txt) {
      if (!txt) return;
      try { store.importData(txt); setTab('today'); ui.toast('Restored your data'); } catch (e) {}
    });
  }
})();
