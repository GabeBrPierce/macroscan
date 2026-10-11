/* MacroScan networking — USDA FoodData Central + Open Food Facts.
   Uses a mozSystem XHR on device (bypasses CORS for privileged apps);
   falls back to a normal XHR in the browser/simulator. */
(function () {
  var cfg = MS.config;

  function xhrJSON(url, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var x;
      try { x = new XMLHttpRequest({ mozSystem: true }); }
      catch (e) { x = new XMLHttpRequest(); }
      try { x.open(opts.method || 'GET', url, true); } catch (e2) { return reject(e2); }
      x.timeout = opts.timeout || 15000;
      x.responseType = 'json';
      try { x.setRequestHeader('Accept', 'application/json'); } catch (e3) {}
      if (opts.body) { try { x.setRequestHeader('Content-Type', 'application/json'); } catch (e3b) {} }
      x.onload = function () {
        if (x.status >= 200 && x.status < 300) {
          var r = x.response;
          if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e4) {} }
          resolve(r);
        } else {
          reject(new Error('HTTP ' + x.status));
        }
      };
      x.onerror = function () { reject(new Error('network')); };
      x.ontimeout = function () { reject(new Error('timeout')); };
      x.send(opts.body || null);
    });
  }

  /* ---- nutrient extraction ---- */
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function usdaNutrients(foodNutrients) {
    // search results: array of { nutrientNumber|number, value }
    var out = { kcal: 0, protein: 0, carb: 0, fat: 0 };
    (foodNutrients || []).forEach(function (n) {
      var code = String(n.nutrientNumber || n.number || (n.nutrient && n.nutrient.number) || '');
      var val = num(n.value != null ? n.value : n.amount);
      if (code === '208') out.kcal = val;
      else if (code === '203') out.protein = val;
      else if (code === '205') out.carb = val;
      else if (code === '204') out.fat = val;
    });
    // derive kcal if missing
    if (!out.kcal) {
      out.kcal = Math.round(out.protein * 4 + out.carb * 4 + out.fat * 9);
    }
    return out;
  }

  function normUsda(food) {
    var per100 = usdaNutrients(food.foodNutrients);
    var serving = null;
    if (food.servingSize && food.servingSizeUnit &&
        /^(g|gram|grams)$/i.test(food.servingSizeUnit)) {
      serving = { label: food.householdServingFullText || (food.servingSize + ' g'),
                  grams: num(food.servingSize) };
    }
    return {
      id: 'u_' + food.fdcId,
      name: titleCase(food.description || 'Food'),
      brand: food.brandName || food.brandOwner || '',
      per100: per100,
      source: 'usda',
      serving: serving,
      barcode: food.gtinUpc || ''
    };
  }

  function normOff(p, barcode) {
    var n = p.nutriments || {};
    var per100 = {
      kcal: num(n['energy-kcal_100g'] || (n['energy_100g'] ? n['energy_100g'] / 4.184 : 0)),
      protein: num(n['proteins_100g']),
      carb: num(n['carbohydrates_100g']),
      fat: num(n['fat_100g'])
    };
    if (!per100.kcal) per100.kcal = Math.round(per100.protein * 4 + per100.carb * 4 + per100.fat * 9);
    var serving = null;
    var sg = num(n['serving_quantity'] || parseFloat(p.serving_size));
    if (sg) serving = { label: p.serving_size || (sg + ' g'), grams: sg };
    return {
      id: 'o_' + (barcode || p.code || MS.store.uid()),
      name: titleCase(p.product_name || p.generic_name || 'Food'),
      brand: (p.brands || '').split(',')[0] || '',
      per100: per100,
      source: 'off',
      serving: serving,
      barcode: barcode || p.code || ''
    };
  }

  function titleCase(s) {
    s = String(s || '').trim();
    if (s === s.toUpperCase() && s.length > 3) {
      s = s.toLowerCase().replace(/(^|\s)\S/g, function (m) { return m.toUpperCase(); });
    }
    return s;
  }

  /* ---- public API ---- */
  // POST (JSON body) instead of GET: USDA's nginx intermittently 400s on the long
  // url-encoded dataType query string. POST is reliable and CORS-allowed.
  function searchUsda(query, page) {
    var url = cfg.USDA_BASE + '/foods/search?api_key=' + encodeURIComponent(cfg.USDA_KEY);
    var body = JSON.stringify({
      query: query,
      pageSize: 25,
      pageNumber: page || 1,
      dataType: ['Branded', 'Foundation', 'SR Legacy', 'Survey (FNDDS)']
    });
    return xhrJSON(url, { method: 'POST', body: body }).then(function (r) {
      return (r && r.foods ? r.foods : []).map(normUsda).filter(function (f) {
        return f.per100.kcal > 0 || f.per100.protein > 0;
      });
    });
  }

  // Open Food Facts text search (fallback / extra coverage)
  function searchOff(query, page) {
    var url = 'https://world.openfoodfacts.org/cgi/search.pl?search_terms=' +
      encodeURIComponent(query) + '&search_simple=1&action=process&json=1&page_size=20&page=' +
      (page || 1) + '&fields=code,product_name,generic_name,brands,nutriments,serving_size';
    return xhrJSON(url).then(function (r) {
      return (r && r.products ? r.products : []).map(function (p) { return normOff(p, p.code); })
        .filter(function (f) { return f.name && f.name !== 'Food' && f.per100.kcal > 0; });
    });
  }

  // Barcode: Open Food Facts first (best coverage), USDA gtin search fallback.
  function lookupBarcode(code) {
    code = String(code).replace(/\D/g, '');
    var offUrl = cfg.OFF_BASE + '/product/' + code +
      '.json?fields=code,product_name,generic_name,brands,nutriments,serving_size';
    return xhrJSON(offUrl).then(function (r) {
      if (r && r.status === 1 && r.product && r.product.product_name) {
        return normOff(r.product, code);
      }
      return usdaByBarcode(code);
    }).catch(function () { return usdaByBarcode(code); });
  }

  function usdaByBarcode(code) {
    var url = cfg.USDA_BASE + '/foods/search?api_key=' + encodeURIComponent(cfg.USDA_KEY) +
      '&query=' + encodeURIComponent(code) + '&dataType=Branded&pageSize=5';
    return xhrJSON(url).then(function (r) {
      var foods = (r && r.foods) ? r.foods : [];
      var match = foods.filter(function (f) { return String(f.gtinUpc || '').replace(/^0+/, '') === code.replace(/^0+/, ''); })[0] || foods[0];
      return match ? normUsda(match) : null;
    }).catch(function () { return null; });
  }

  window.MS = window.MS || {};
  MS.net = {
    searchUsda: searchUsda,
    searchOff: searchOff,
    lookupBarcode: lookupBarcode,
    titleCase: titleCase
  };
})();
