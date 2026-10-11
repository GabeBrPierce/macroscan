/* MacroScan backup/restore.
   On a real KaiOS device, reads/writes a JSON file on the sdcard via the
   DeviceStorage API (survives app reinstalls). In a plain browser (the
   simulator) it falls back to a file download / file picker so export &
   import are still usable and testable. */
(function () {
  var FILE = 'macroscan-backup.json';

  function getStorage() {
    try {
      if (navigator.b2g && navigator.b2g.getDeviceStorage) return navigator.b2g.getDeviceStorage('sdcard');
      if (navigator.getDeviceStorage) return navigator.getDeviceStorage('sdcard');
    } catch (e) {}
    return null;
  }
  function deviceAvailable() { return !!getStorage(); }

  function writeDevice(json) {
    return new Promise(function (resolve, reject) {
      var storage = getStorage();
      if (!storage) { reject(new Error('no device storage')); return; }
      var blob = new Blob([json], { type: 'application/json' });
      var del = storage.delete(FILE);
      del.onsuccess = del.onerror = function () {
        var req = storage.addNamed(blob, FILE);
        req.onsuccess = function () { resolve(req.result || FILE); };
        req.onerror = function () { reject((req.error) || new Error('write failed')); };
      };
    });
  }

  function readDevice() {
    return new Promise(function (resolve) {
      var storage = getStorage();
      if (!storage) { resolve(null); return; }
      var req = storage.get(FILE);
      req.onsuccess = function () {
        var file = req.result, reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { resolve(null); };
        reader.readAsText(file);
      };
      req.onerror = function () { resolve(null); };
    });
  }

  /* ---- browser fallbacks ---- */
  function download(json) {
    try {
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = FILE;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
      return true;
    } catch (e) { return false; }
  }
  function pickFile(cb) {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.style.display = 'none'; document.body.appendChild(inp);
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      if (!f) { cb(null); inp.remove(); return; }
      var reader = new FileReader();
      reader.onload = function () { cb(reader.result); inp.remove(); };
      reader.onerror = function () { cb(null); inp.remove(); };
      reader.readAsText(f);
    });
    inp.click();
  }

  /* ---- public: device-first with browser fallback ---- */
  function exportNow(json) {
    if (deviceAvailable()) return writeDevice(json);
    return new Promise(function (resolve, reject) {
      if (download(json)) resolve('download'); else reject(new Error('export failed'));
    });
  }
  function importNow() {
    return new Promise(function (resolve, reject) {
      if (deviceAvailable()) {
        readDevice().then(function (txt) { if (txt) resolve(txt); else reject(new Error('no backup found on sdcard')); });
      } else {
        pickFile(function (txt) { if (txt) resolve(txt); else reject(new Error('no file chosen')); });
      }
    });
  }

  window.MS = window.MS || {};
  MS.backup = {
    deviceAvailable: deviceAvailable,
    writeDevice: writeDevice,
    readDevice: readDevice,
    exportNow: exportNow,
    importNow: importNow
  };
})();
