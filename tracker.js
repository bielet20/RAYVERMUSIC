// ════════════════════════════════════════════════════════════════
// RAYVER Analytics Tracker  — privado, sin cookies de terceros
// ════════════════════════════════════════════════════════════════
(function (win, doc) {
  'use strict';

  const EP = '/api/analytics/batch';

  // ── Sesión ───────────────────────────────────────────────────
  let sid = sessionStorage.getItem('_rv_sid');
  if (!sid) {
    sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    sessionStorage.setItem('_rv_sid', sid);
  }

  // ── Dispositivo ──────────────────────────────────────────────
  const ua     = navigator.userAgent;
  const device = /Mobi|Android|iPhone|iPod/.test(ua) ? 'mobile'
               : /iPad|Tablet/.test(ua)              ? 'tablet'
               : 'desktop';

  // ── Fuente de tráfico ────────────────────────────────────────
  function getSource() {
    const p  = new URLSearchParams(win.location.search);
    const ut = p.get('utm_source') || p.get('utm_medium');
    if (ut) return ut;
    const ref = doc.referrer;
    if (!ref) return 'direct';
    try {
      const h = new URL(ref).hostname.replace('www.', '');
      if (h.includes('google'))    return 'google';
      if (h.includes('instagram')) return 'instagram';
      if (h.includes('facebook'))  return 'facebook';
      if (h.includes('twitter') || h.includes('x.com')) return 'twitter/x';
      if (h.includes('soundcloud')) return 'soundcloud';
      if (h.includes('spotify'))   return 'spotify';
      if (h.includes('youtube'))   return 'youtube';
      return h;
    } catch { return 'unknown'; }
  }

  // ── Cola de eventos ──────────────────────────────────────────
  let queue = [];
  let _sessionStart = Date.now();
  let _lastSection  = null;

  function _getTrackerUserId() {
    try { return JSON.parse(localStorage.getItem('rv_user') || '{}').id || null; } catch { return null; }
  }

  function track(type, data) {
    const entry = { type, sessionId: sid, data: data || {}, device, ts: new Date().toISOString() };
    const uid = _getTrackerUserId();
    if (uid) entry.userId = uid;
    queue.push(entry);
  }

  function flush(beacon) {
    if (!queue.length) return;
    const payload = JSON.stringify({ events: queue.splice(0) });
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon(EP, new Blob([payload], { type: 'application/json' }));
    } else {
      fetch(EP, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true })
        .catch(() => {});
    }
  }

  setInterval(flush, 8000);

  // ── Sección activa (IntersectionObserver) ────────────────────
  const sectionMap = {
    radio:   'Radio',
    music:   'Música',
    youtube: 'Videos',
    ambient: 'Ambiente',
    beats:   'Beats',
    about:   'Sobre mí',
    contact: 'Contacto',
  };
  const sectionEnterTime = {};

  function sectionIn(id) {
    sectionEnterTime[id] = Date.now();
    _lastSection = id;
    track('section_view', { section: id, label: sectionMap[id] || id });
  }

  function sectionOut(id) {
    const entered = sectionEnterTime[id];
    if (!entered) return;
    const secs = Math.round((Date.now() - entered) / 1000);
    delete sectionEnterTime[id];
    if (secs >= 2) track('section_time', { section: id, secs });
  }

  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) sectionIn(e.target.id);
      else sectionOut(e.target.id);
    });
  }, { threshold: 0.25 });

  doc.addEventListener('DOMContentLoaded', () => {
    Object.keys(sectionMap).forEach(id => {
      const el = doc.getElementById(id);
      if (el) io.observe(el);
    });
  });

  // ── Clics en links externos ──────────────────────────────────
  const PLATFORM_RE = /(spotify|soundcloud|youtube|youtu\.be|bandcamp|instagram|facebook|twitter|tiktok)/i;

  doc.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.href || '';
    if (!href.startsWith('http')) return;

    let platform = null;
    const pm = href.match(PLATFORM_RE);
    if (pm) platform = pm[1].replace('youtu.be', 'youtube');

    if (platform) {
      track('link_click', { platform, href: href.slice(0, 120), label: (a.textContent || '').trim().slice(0, 60) });
    } else {
      // link externo genérico
      try {
        const host = new URL(href).hostname;
        if (host !== win.location.hostname) {
          track('external_click', { host, href: href.slice(0, 120) });
        }
      } catch (_) {}
    }
  }, true);

  // ── Button-level: beats, ambient, auth ──────────────────────
  doc.addEventListener('click', e => {
    // Beat card
    const beatCard = e.target.closest('.beat-card');
    if (beatCard) {
      const title = beatCard.querySelector('.beat-title')?.textContent?.trim();
      const isBuy = !!e.target.closest('[href*="airbit"],[href*="beatstars"],[class*="buy"]');
      track(isBuy ? 'beat_buy_intent' : 'beat_card_click', { title });
      return;
    }
    // Track card (music section)
    const trackCard = e.target.closest('.track-card');
    if (trackCard) {
      const title = trackCard.querySelector('.track-title')?.textContent?.trim();
      track('track_card_click', { title });
    }
  });

  // ── Fin de sesión ────────────────────────────────────────────
  function trackSessionEnd() {
    const duration = Math.round((Date.now() - _sessionStart) / 1000);
    track('session_end', { duration, lastSection: _lastSection });
    flush(true);
  }

  doc.addEventListener('visibilitychange', () => {
    if (doc.hidden) {
      // Tiempo en sección activa
      Object.keys(sectionEnterTime).forEach(id => sectionOut(id));
      flush(true);
    } else {
      // Volvió a la pestaña — reanudar conteo
      Object.keys(sectionEnterTime).forEach(id => { sectionEnterTime[id] = Date.now(); });
    }
  });

  win.addEventListener('beforeunload', trackSessionEnd);
  win.addEventListener('pagehide',     trackSessionEnd);

  // ── Inicio de sesión ─────────────────────────────────────────
  doc.addEventListener('DOMContentLoaded', () => {
    track('session_start', {
      source:    getSource(),
      ref:       doc.referrer ? (new URL(doc.referrer).hostname || '') : '',
      path:      win.location.pathname,
      utm_source: new URLSearchParams(win.location.search).get('utm_source') || '',
      utm_medium: new URLSearchParams(win.location.search).get('utm_medium') || '',
      utm_campaign: new URLSearchParams(win.location.search).get('utm_campaign') || '',
    });
  });

  // ── API pública: window.TRACKER ──────────────────────────────
  win.TRACKER = {
    track,
    // Hooks para el reproductor de radio
    onTrackPlay  (title, source, genre) { track('track_play',   { title, source, genre: genre || '' }); },
    onTrackPause (title, pct)    { track('track_pause',  { title, pct: pct | 0 }); },
    onTrackFinish(title)         { track('track_finish', { title }); },
    onVideoPlay  (title, vidId)  { track('video_play',   { title, vidId }); },
    onAmbientPlay(title, packId) { track('ambient_play', { title, packId }); },
    onLogin  (method)            { track('auth_login',    { method: method || 'email' }); },
    onRegister(method)           { track('auth_register', { method: method || 'email' }); },
    flush,
  };

})(window, document);
