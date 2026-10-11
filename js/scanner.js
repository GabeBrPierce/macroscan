/* MacroScan barcode scanner.
   Two camera backends behind one interface:
     1. KaiOS Camera API (navigator.b2g.cameras) — the ONLY backend that can drive
        the LED torch on a KaiOS device (cameraControl.flashMode = 'torch'). Gecko
        does NOT implement the Chrome-style getUserMedia torch constraint, so the
        old getUserMedia-only scanner could never turn the flashlight on.
     2. getUserMedia — used in a desktop browser / simulator, or if the Camera API
        is missing or fails. Previews and decodes fine, but has no torch.
   Both feed the same decode loop (BarcodeDetector when present, else Quagga) and
   expose the same methods. Reliability rules kept from earlier testing:
     - Auto mode needs the SAME code twice in a row before accepting (avoids the
       single-frame misread "wrong number" bug).
     - After a lookup miss the view calls resume() so scanning keeps going.
   Always degrades to manual numeric entry. */
(function () {
  function create(wrap, statusEl, onCode) {
    var video = document.createElement('video');
    video.setAttribute('playsinline', 'true');
    video.muted = true; video.autoplay = true;
    wrap.insertBefore(video, wrap.firstChild);

    var backend = null;          // 'b2g' | 'gum'
    var cameraControl = null;    // KaiOS CameraControl
    var stream = null;           // getUserMedia MediaStream
    var flashModes = null;       // CameraControl.capabilities.flashModes
    var torchOn = false;
    var loopTimer = null, running = false, busy = false, dead = false;
    var lastCode = null, lastCount = 0;

    var detector = null;
    if (typeof window.BarcodeDetector !== 'undefined') {
      try { detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] }); }
      catch (e) { detector = null; }
    }
    var hasQuagga = typeof window.Quagga !== 'undefined';

    function setStatus(t) { if (statusEl) statusEl.textContent = t; }
    function live() { setStatus('Aim at a barcode — hold steady.'); running = true; scheduleLoop(); }

    /* ---- start: prefer the KaiOS Camera API (torch-capable) ---- */
    function start() {
      var cams = null;
      try { cams = navigator.b2g && navigator.b2g.cameras; } catch (e) { cams = null; }
      if (cams && cams.getCamera) startB2G(cams);
      else startGUM();
    }

    function pickBackCamera(ids) {
      if (!ids || !ids.length) return 0;
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i]).toLowerCase().indexOf('back') > -1) return ids[i];
      }
      return ids[0];
    }

    function startB2G(cams) {
      var ids;
      try { ids = cams.getListOfCameras() || []; } catch (e) { startGUM(); return; }
      var id = pickBackCamera(ids);
      var opts = { mode: 'picture', recorderProfile: 'jpg', previewSize: { width: 320, height: 240 } };
      var pr;
      try { pr = cams.getCamera(id, opts); } catch (e) { startGUM(); return; }
      if (!pr || !pr.then) { startGUM(); return; }
      pr.then(function (obj) {
        var cc = obj && obj.camera;
        if (dead) { releaseCamera(cc); return; }
        if (!cc) { startGUM(); return; }
        cameraControl = cc; backend = 'b2g';
        try { flashModes = (cc.capabilities && cc.capabilities.flashModes) || null; } catch (e) { flashModes = null; }
        // attach the viewfinder to the <video> element
        try { video.mozSrcObject = cc; } catch (e) { try { video.srcObject = cc; } catch (e2) {} }
        try { var pl = video.play(); if (pl && pl.catch) pl.catch(function () {}); } catch (e3) {}
        live();
      }, function () { startGUM(); });
    }

    function startGUM() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus('Camera not available — press Type to enter the number.');
        return;
      }
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false
      }).then(function (s) {
        if (dead) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
        stream = s; backend = 'gum'; video.srcObject = s;
        live();
      }).catch(function () {
        setStatus('Camera blocked — press Type to enter the number.');
      });
    }

    /* ---- decode loop ---- */
    function scheduleLoop() {
      if (loopTimer) clearTimeout(loopTimer);
      loopTimer = setTimeout(function () { if (running && !busy) decode(false); }, 550);
    }

    function frame() {
      var w = video.videoWidth || 320, h = video.videoHeight || 240;
      if (!w || !h) return null;
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      try { c.getContext('2d').drawImage(video, 0, 0, w, h); } catch (e) { return null; }
      return c;
    }

    function decode(manual) {
      if (dead) return;
      // On a real KaiOS camera, nudge autofocus before a manual read — helps a
      // soft/low-res sensor lock onto the bars.
      if (manual && backend === 'b2g' && cameraControl && cameraControl.autoFocus) {
        try {
          var af = cameraControl.autoFocus();
          if (af && af.then) { af.then(runDecode, runDecode); return; }
        } catch (e) {}
      }
      runDecode();

      function runDecode() {
        var canvas = frame();
        if (!canvas) { if (manual) setStatus('Camera still warming up...'); if (running) scheduleLoop(); return; }
        busy = true;
        function done(code) {
          busy = false;
          if (code) { handle(code, manual); return; }
          if (manual) setStatus('No barcode detected — try again.');
          if (running) scheduleLoop();
        }
        if (detector) {
          detector.detect(canvas).then(function (codes) {
            done(codes && codes.length ? codes[0].rawValue : null);
          }).catch(function () { quagga(canvas, done); });
        } else {
          quagga(canvas, done);
        }
      }
    }

    function quagga(canvas, done) {
      if (!hasQuagga) { done(null); return; }
      try {
        window.Quagga.decodeSingle({
          src: canvas.toDataURL('image/png'),
          numOfWorkers: 0, locate: true, inputStream: { size: 800 },
          decoder: { readers: ['ean_reader', 'ean_8_reader', 'upc_reader', 'upc_e_reader'] }
        }, function (result) {
          done(result && result.codeResult && result.codeResult.code ? result.codeResult.code : null);
        });
      } catch (e) { done(null); }
    }

    function handle(code, manual) {
      code = String(code).replace(/\D/g, '');
      if (code.length < 6) { if (running) scheduleLoop(); return; }
      if (manual) { accept(code); return; }
      if (code === lastCode) lastCount++; else { lastCode = code; lastCount = 1; }
      if (lastCount >= 2) { accept(code); }
      else { setStatus('Reading ' + code + ' — hold steady'); if (running) scheduleLoop(); }
    }

    function accept(code) {
      running = false; lastCode = null; lastCount = 0;
      setStatus('Found ' + code);
      onCode(code);
    }

    function resume() {
      if (dead || (!stream && !cameraControl)) return;
      lastCode = null; lastCount = 0; running = true;
      setStatus('Aim at a barcode — hold steady.');
      scheduleLoop();
    }

    function releaseCamera(cc) {
      if (!cc) return;
      try { cc.flashMode = 'off'; } catch (e) {}
      try { if (cc.release) cc.release(); } catch (e2) {}
    }

    function stop() {
      dead = true; running = false; torchOn = false;
      if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
      releaseCamera(cameraControl); cameraControl = null;
      if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
      try { video.mozSrcObject = null; } catch (e) {}
      try { video.srcObject = null; } catch (e2) {}
    }

    /* ---- flashlight / torch (KaiOS Camera API only) ---- */
    function torchSupported() {
      return !!(backend === 'b2g' && cameraControl && flashModes &&
                flashModes.indexOf && flashModes.indexOf('torch') > -1);
    }
    // Returns the new torch state, or null when this backend/camera has no torch.
    function toggleTorch() {
      if (!torchSupported()) return null;
      var next = !torchOn;
      try { cameraControl.flashMode = next ? 'torch' : 'off'; }
      catch (e) { return null; }
      torchOn = next;
      return torchOn;
    }

    return {
      start: start,
      scanOnce: function () { if (!dead) decode(true); },
      resume: resume,
      stop: stop,
      isLive: function () { return !!(stream || cameraControl); },
      torchSupported: torchSupported,
      toggleTorch: toggleTorch,
      isTorchOn: function () { return torchOn; }
    };
  }

  window.MS = window.MS || {};
  MS.scanner = { create: create };
})();
