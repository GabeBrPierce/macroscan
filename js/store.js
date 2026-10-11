/* MacroScan persistent store — localStorage backed.
   All data lives under one key so it is easy to export/clear.
   Weight is always stored internally in kilograms. */
(function () {
  var KEY = 'macroscan.data';

  var DEFAULTS = {
    settings: {
      calorieLimit: 2000,
      proteinG: 130,
      carbG: 220,
      fatG: 65,
      weightUnit: 'kg',   // 'kg' | 'lb'
      weightGoalKg: null,
      startOnQuickAdd: false, // launch straight into Quick add
      dayStartHour: 8,        // "day progress" clock: waking hour (0-23)
      dayEndHour: 22,         // "day progress" clock: end-of-day hour (1-24)
      seeded: false
    },
    diary: {},        // 'YYYY-MM-DD' -> [entry]
    weights: [],      // [{ id, date, kg, ts }]
    customFoods: [],  // [food]
    recentFoods: []   // [food] most-recent-first, capped
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var data = null;

  function load() {
    if (data) return data;
    try {
      var raw = localStorage.getItem(KEY);
      data = raw ? JSON.parse(raw) : clone(DEFAULTS);
    } catch (e) {
      data = clone(DEFAULTS);
    }
    // backfill any new default keys
    for (var k in DEFAULTS) if (!(k in data)) data[k] = clone(DEFAULTS[k]);
    for (var s in DEFAULTS.settings) if (!(s in data.settings)) data.settings[s] = DEFAULTS.settings[s];
    return data;
  }

  var listeners = [];
  function onChange(cb) { listeners.push(cb); }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(load())); }
    catch (e) { console.error('save failed', e); }
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (e2) {} }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---- date helpers ---- */
  function todayKey(d) {
    d = d || new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  /* ---- macro / calorie math ---- */
  // Compute nutrition for `grams` of a food whose per100 macros are given.
  function scale(per100, grams) {
    var f = grams / 100;
    return {
      kcal: Math.round((per100.kcal || 0) * f),
      protein: round1((per100.protein || 0) * f),
      carb: round1((per100.carb || 0) * f),
      fat: round1((per100.fat || 0) * f)
    };
  }
  function round1(n) { return Math.round(n * 10) / 10; }

  /* ---- settings ---- */
  function settings() { return load().settings; }
  function setSetting(k, v) { load().settings[k] = v; save(); }

  /* ---- diary ---- */
  function getDay(dateKey) {
    var d = load().diary[dateKey];
    return d ? d : [];
  }
  function addEntry(dateKey, entry) {
    var d = load().diary;
    if (!d[dateKey]) d[dateKey] = [];
    entry.id = entry.id || uid();
    entry.ts = entry.ts || Date.now();
    d[dateKey].push(entry);
    save();
    return entry;
  }
  function updateEntry(dateKey, id, patch) {
    var arr = load().diary[dateKey] || [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) { Object.assign(arr[i], patch); save(); return arr[i]; }
    }
    return null;
  }
  function removeEntry(dateKey, id) {
    var d = load().diary;
    if (!d[dateKey]) return;
    d[dateKey] = d[dateKey].filter(function (e) { return e.id !== id; });
    if (!d[dateKey].length) delete d[dateKey];
    save();
  }
  function dayTotals(dateKey) {
    var t = { kcal: 0, protein: 0, carb: 0, fat: 0, count: 0 };
    getDay(dateKey).forEach(function (e) {
      var n = scale(e.per100, e.grams);
      t.kcal += n.kcal; t.protein += n.protein; t.carb += n.carb; t.fat += n.fat; t.count++;
    });
    t.protein = round1(t.protein); t.carb = round1(t.carb); t.fat = round1(t.fat);
    return t;
  }
  function mealTotals(dateKey, meal) {
    var t = { kcal: 0, protein: 0, carb: 0, fat: 0, count: 0 };
    getDay(dateKey).forEach(function (e) {
      if (e.meal !== meal) return;
      var n = scale(e.per100, e.grams);
      t.kcal += n.kcal; t.protein += n.protein; t.carb += n.carb; t.fat += n.fat; t.count++;
    });
    return t;
  }

  /* ---- weights ---- */
  function weights() {
    return load().weights.slice().sort(function (a, b) { return a.ts - b.ts; });
  }
  function addWeight(kg, dateKey) {
    var w = { id: uid(), date: dateKey || todayKey(), kg: kg, ts: Date.now() };
    // one entry per day: replace if same date exists
    var arr = load().weights;
    var existing = arr.filter(function (x) { return x.date === w.date; });
    if (existing.length) { existing[0].kg = kg; existing[0].ts = Date.now(); }
    else arr.push(w);
    save();
    return w;
  }
  function removeWeight(id) {
    var d = load();
    d.weights = d.weights.filter(function (w) { return w.id !== id; });
    save();
  }
  function weightStats() {
    var ws = weights();
    if (!ws.length) return null;
    var kgs = ws.map(function (w) { return w.kg; });
    var latest = ws[ws.length - 1].kg;
    var first = ws[0].kg;
    return {
      latest: latest,
      first: first,
      change: round1(latest - first),
      min: Math.min.apply(null, kgs),
      max: Math.max.apply(null, kgs),
      count: ws.length
    };
  }

  // Least-squares weight trend: slope in kg/day + projection to a goal.
  function weightTrend(goalKg) {
    var ws = weights();
    if (ws.length < 2) return null;
    var t0 = new Date(ws[0].date + 'T00:00:00').getTime();
    var xs = [], ys = [], n = ws.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    ws.forEach(function (w) {
      var x = (new Date(w.date + 'T00:00:00').getTime() - t0) / 86400000;
      xs.push(x); ys.push(w.kg);
      sx += x; sy += w.kg; sxx += x * x; sxy += x * w.kg;
    });
    var denom = (n * sxx - sx * sx);
    var slope = denom ? (n * sxy - sx * sy) / denom : 0; // kg/day
    var intercept = (sy / n) - slope * (sx / n);         // kg at x=0 (first log day)
    var latest = ys[n - 1];
    var out = { slopePerDay: slope, perWeek: round1(slope * 7), latest: latest,
                intercept: intercept, t0: t0 };
    // predicted weight for any date key from the least-squares line
    out.predictAt = function (dateKey) {
      var x = (new Date(dateKey + 'T00:00:00').getTime() - t0) / 86400000;
      return intercept + slope * x;
    };
    if (goalKg != null && slope !== 0) {
      var days = (goalKg - latest) / slope;
      if (isFinite(days) && days > 0.5) {
        out.etaDays = Math.round(days);
        var d = new Date(); d.setDate(d.getDate() + out.etaDays);
        out.targetDate = todayKey(d);
        out.towardGoal = true;
      } else {
        out.towardGoal = false; // at goal, or moving the wrong way
        out.atGoal = Math.abs(goalKg - latest) < 0.1;
      }
    }
    return out;
  }

  // Calorie totals for the N days ending at (and including) anchorKey.
  function lastDaysKcal(anchorKey, n) {
    var out = [];
    var base = new Date(anchorKey + 'T00:00:00');
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(base); d.setDate(d.getDate() - i);
      var key = todayKey(d);
      out.push({ date: key, kcal: dayTotals(key).kcal });
    }
    return out;
  }

  // Per-day tracking stats for the N days ending at anchorKey: whether anything
  // was logged (tracked) and that day's calorie total. Feeds the adherence chart.
  function lastDaysStats(anchorKey, n) {
    var out = [];
    var base = new Date(anchorKey + 'T00:00:00');
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(base); d.setDate(d.getDate() - i);
      var key = todayKey(d);
      out.push({ date: key, kcal: dayTotals(key).kcal, tracked: getDay(key).length > 0 });
    }
    return out;
  }

  /* ---- custom foods ---- */
  function customFoods() { return load().customFoods; }
  function addCustomFood(food) {
    food.id = food.id || ('c_' + uid());
    food.source = 'custom';
    load().customFoods.unshift(food);
    save();
    return food;
  }
  function updateCustomFood(id, patch) {
    var arr = load().customFoods;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) { Object.assign(arr[i], patch); save(); return arr[i]; }
    }
    return null;
  }
  function removeCustomFood(id) {
    var d = load();
    d.customFoods = d.customFoods.filter(function (f) { return f.id !== id; });
    save();
  }
  function getFood(id) {
    var all = load();
    var hit = all.customFoods.filter(function (f) { return f.id === id; })[0];
    if (hit) return hit;
    return all.recentFoods.filter(function (f) { return f.id === id; })[0] || null;
  }

  /* ---- recent foods (quick re-log) ---- */
  function recentFoods() { return load().recentFoods; }
  function pushRecent(food) {
    var d = load();
    d.recentFoods = d.recentFoods.filter(function (f) { return f.id !== food.id; });
    d.recentFoods.unshift(food);
    if (d.recentFoods.length > 40) d.recentFoods.length = 40;
    save();
  }

  function exportData() { return JSON.stringify(load()); }

  // Replace all data from a JSON backup string. Throws on invalid input.
  function importData(jsonString) {
    var obj = JSON.parse(jsonString);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('not a MacroScan backup');
    // require at least one known top-level key so we don't import junk
    if (!('settings' in obj) && !('diary' in obj) && !('weights' in obj) && !('customFoods' in obj)) {
      throw new Error('not a MacroScan backup');
    }
    data = obj;
    for (var k in DEFAULTS) if (!(k in data)) data[k] = clone(DEFAULTS[k]);
    for (var sk in DEFAULTS.settings) if (!(sk in data.settings)) data.settings[sk] = DEFAULTS.settings[sk];
    save();
    return true;
  }

  function clearAll() { data = clone(DEFAULTS); save(); }

  window.MS = window.MS || {};
  MS.store = {
    load: load, save: save, uid: uid,
    todayKey: todayKey, scale: scale, round1: round1,
    settings: settings, setSetting: setSetting,
    getDay: getDay, addEntry: addEntry, updateEntry: updateEntry,
    removeEntry: removeEntry, dayTotals: dayTotals, mealTotals: mealTotals,
    weights: weights, addWeight: addWeight, removeWeight: removeWeight, weightStats: weightStats,
    weightTrend: weightTrend, lastDaysKcal: lastDaysKcal, lastDaysStats: lastDaysStats,
    customFoods: customFoods, addCustomFood: addCustomFood, updateCustomFood: updateCustomFood,
    removeCustomFood: removeCustomFood, getFood: getFood,
    recentFoods: recentFoods, pushRecent: pushRecent,
    exportData: exportData, importData: importData, clearAll: clearAll,
    onChange: onChange
  };
})();
