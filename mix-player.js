// MixPlayer — Web Audio API player para suscriptores Mix+
// Permite crossfade real simultáneo + EQ automático entre tracks propios
// Solo se activa cuando el track tiene audioFile en el backend

window.MixPlayer = (function () {

  let _ctx = null;
  let _masterGain = null;

  // Track activo (A) y precargado (B)
  let _nodeA = null;   // GainNode de salida del track A
  let _srcA  = null;   // AudioBufferSourceNode del track A
  let _bufA  = null;   // AudioBuffer del track A
  let _startedAt = 0;  // ctx.currentTime cuando arrancó el track A
  let _pausedAt  = 0;  // segundos de offset si estaba en pausa

  let _nodeB = null;
  let _bufB  = null;

  let _fadeCurveRef = () => 1; // referencia a _applyFadeCurve del radio.js principal

  // Callbacks que el radio.js principal puede registrar
  let _onProgress = null; // (posMs, durMs) => void
  let _onFinish   = null; // () => void
  let _progressTimer = null;

  function _getCtx() {
    if (!_ctx) {
      _ctx = new (window.AudioContext || window.webkitAudioContext)();
      _masterGain = _ctx.createGain();
      _masterGain.connect(_ctx.destination);
    }
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
  }

  async function _fetchBuffer(url) {
    const token = window.getToken?.();
    const r = await fetch(url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const ab = await r.arrayBuffer();
    return _getCtx().decodeAudioData(ab);
  }

  function _startProgress(durSec) {
    if (_progressTimer) clearInterval(_progressTimer);
    _progressTimer = setInterval(() => {
      if (!_ctx || !_srcA) return;
      const pos = (_ctx.currentTime - _startedAt) * 1000;
      const dur = durSec * 1000;
      if (_onProgress) _onProgress(Math.min(pos, dur), dur);
      if (pos >= dur - 50) {
        clearInterval(_progressTimer);
        _progressTimer = null;
        if (_onFinish) _onFinish();
      }
    }, 250);
  }

  function _stopProgress() {
    if (_progressTimer) { clearInterval(_progressTimer); _progressTimer = null; }
  }

  // Carga y reproduce un track. Devuelve Promise<durationMs>
  async function play(streamUrl, startOffsetMs) {
    const ctx = _getCtx();
    _stopProgress();

    const buf = await _fetchBuffer(streamUrl);
    _bufA = buf;

    const gainA = ctx.createGain();
    gainA.gain.value = 1;
    gainA.connect(_masterGain);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gainA);

    const offsetSec = (startOffsetMs || 0) / 1000;
    src.start(0, offsetSec);
    _startedAt = ctx.currentTime - offsetSec;
    _nodeA = gainA;
    _srcA  = src;
    _pausedAt = 0;

    _startProgress(buf.duration);
    return buf.duration * 1000;
  }

  function pause() {
    if (!_ctx || !_srcA) return;
    _pausedAt = _ctx.currentTime - _startedAt;
    _stopProgress();
    try { _srcA.stop(); } catch(_) {}
    _srcA = null;
  }

  function resume(streamUrl) {
    return play(streamUrl, _pausedAt * 1000);
  }

  function stop() {
    _stopProgress();
    if (_srcA) { try { _srcA.stop(); } catch(_) {} _srcA = null; }
    if (_nodeA) { _nodeA.disconnect(); _nodeA = null; }
    _bufA = null; _bufB = null;
    _nodeB = null;
    _pausedAt = 0;
  }

  function setVolume(v01) { // 0..1
    if (_masterGain) _masterGain.gain.value = v01;
  }

  function getCurrentTime() { // ms
    if (!_ctx || !_startedAt) return 0;
    return (_ctx.currentTime - _startedAt) * 1000;
  }

  function getDuration() { // ms
    return _bufA ? _bufA.duration * 1000 : 0;
  }

  // Precarga el siguiente track en _bufB (silencioso, solo descarga y decodifica)
  async function preload(streamUrl) {
    try { _bufB = await _fetchBuffer(streamUrl); } catch(_) { _bufB = null; }
  }

  // Crossfade real hacia el siguiente track.
  // Si preload() ya llamado, usa _bufB directamente (sin red). Si no, lo descarga.
  // fadeCurveFn: función (p: 0..1) => curva — viene de radio.js
  // eqEnabled: corta graves del track entrante los primeros 4s (estándar DJ)
  async function crossfadeTo(streamUrl, durationMs, fadeCurveFn, eqEnabled, onProgressB, onFinishB) {
    const ctx = _getCtx();
    const durSec = durationMs / 1000;
    const curve = fadeCurveFn || (p => p);

    let bufB = _bufB;
    if (!bufB) bufB = await _fetchBuffer(streamUrl);
    _bufB = null; // consumido

    // ── Track entrante (B) ─────────────────────────────────────────
    const gainB = ctx.createGain();
    gainB.gain.value = 0;

    let dest = _masterGain;

    if (eqEnabled) {
      // Corte de graves: lowshelf a -12dB que sube a 0 durante los primeros 4s
      const eq = ctx.createBiquadFilter();
      eq.type = 'lowshelf';
      eq.frequency.value = 200;
      eq.gain.setValueAtTime(-12, ctx.currentTime);
      eq.gain.linearRampToValueAtTime(0, ctx.currentTime + Math.min(durSec * 0.6, 4));
      gainB.connect(eq);
      eq.connect(_masterGain);
    } else {
      gainB.connect(_masterGain);
    }

    const srcB = ctx.createBufferSource();
    srcB.buffer = bufB;
    srcB.connect(gainB);
    srcB.start();
    const startedAtB = ctx.currentTime;

    // ── Automatización de ganancia ─────────────────────────────────
    // En lugar de linearRamp usamos setValueCurveAtTime para aplicar la curva personalizada
    const steps = 60;
    const interval = durSec / steps;
    const curveA = new Float32Array(steps + 1);
    const curveB = new Float32Array(steps + 1);
    for (let i = 0; i <= steps; i++) {
      const p = curve(i / steps);
      curveA[i] = Math.max(0, 1 - p);
      curveB[i] = Math.min(1, p);
    }

    const startNow = ctx.currentTime;
    _nodeA?.gain.setValueCurveAtTime(curveA, startNow, durSec);
    gainB.gain.setValueCurveAtTime(curveB, startNow, durSec);

    // ── Progreso del track B ───────────────────────────────────────
    const progressB = setInterval(() => {
      const pos = (ctx.currentTime - startedAtB) * 1000;
      if (onProgressB) onProgressB(Math.min(pos, bufB.duration * 1000), bufB.duration * 1000);
      if (pos >= bufB.duration * 1000 - 50) {
        clearInterval(progressB);
        if (onFinishB) onFinishB();
      }
    }, 250);

    // ── Tras el crossfade: limpiar track A, promover B a A ─────────
    setTimeout(() => {
      _stopProgress();
      if (_srcA) { try { _srcA.stop(); } catch(_) {} }
      if (_nodeA) _nodeA.disconnect();

      _bufA      = bufB;
      _nodeA     = gainB;
      _srcA      = srcB;
      _startedAt = startedAtB;

      // El progreso de B pasa a ser el progreso principal
      clearInterval(progressB);
      _onProgress = onProgressB || _onProgress;
      _onFinish   = onFinishB   || _onFinish;
      _startProgress(bufB.duration);
    }, durationMs);

    return bufB.duration * 1000;
  }

  function seekTo(ms) {
    // Reinicia el track A desde la posición indicada
    if (!_bufA) return;
    // No podemos hacer seek nativo en AudioBufferSourceNode — hay que parar y crear uno nuevo
    _pausedAt = ms / 1000;
    if (_srcA) { try { _srcA.stop(); } catch(_) {} _srcA = null; }

    const ctx = _getCtx();
    const src = ctx.createBufferSource();
    src.buffer = _bufA;
    if (_nodeA) src.connect(_nodeA);
    src.start(0, _pausedAt);
    _startedAt = ctx.currentTime - _pausedAt;
    _srcA = src;
    _pausedAt = 0;
  }

  function onProgress(fn) { _onProgress = fn; }
  function onFinish(fn)   { _onFinish   = fn; }

  function isActive() { return !!_srcA; }

  return { play, pause, resume, stop, setVolume, getCurrentTime, getDuration, preload, crossfadeTo, seekTo, onProgress, onFinish, isActive };
})();
