/**
 * RAYVER RADIO v7
 * Tracklist sincronizada con el widget de SoundCloud real.
 * El widget carga la playlist de SC y al cambiar de track
 * el evento PLAY_PROGRESS/PLAY nos da el índice real via
 * widget.getCurrentSoundIndex() — así tracklist y player siempre coinciden.
 */
(function () {
  'use strict';

  const SC_PLAYLIST = 'https://soundcloud.com/biel-rivero-sampol/sets/marzo-best-ranking';

  let widgetReady   = false;
  let widget        = null;
  let scTracks      = [];   // tracks reales del widget SC
  let currentIdx    = 0;
  let isPlaying     = false;
  let isShuffle     = false;
  let isMuted       = false;

  // ── DOM ────────────────────────────────────────────────────────
  const titleEl      = document.getElementById('radio-title');
  const artistEl     = document.getElementById('radio-artist');
  const genreEl      = document.getElementById('radio-genre');
  const platTagsEl   = document.getElementById('radio-platform-tags');
  const playBtn      = document.getElementById('radio-play');
  const playIcon     = document.getElementById('radio-play-icon');
  const prevBtn      = document.getElementById('radio-prev');
  const nextBtn      = document.getElementById('radio-next');
  const shuffleBtn   = document.getElementById('radio-shuffle');
  const muteBtn      = document.getElementById('radio-mute');
  const volIcon      = document.getElementById('radio-vol-icon');
  const volumeEl     = document.getElementById('radio-volume');
  const fillEl       = document.getElementById('radio-progress-fill');
  const curTimeEl    = document.getElementById('radio-current-time');
  const durEl        = document.getElementById('radio-duration');
  const onairDot     = document.getElementById('radio-onair-dot');
  const counterEl    = document.getElementById('radio-counter');
  const coverEl      = document.getElementById('radio-cover');
  const coverPulse   = document.getElementById('radio-cover-pulse');
  const tracklistBody= document.getElementById('radio-tracklist-body');
  const audioEl      = document.getElementById('radio-audio');
  const progEl       = document.getElementById('radio-progress');
  const progWrap     = document.getElementById('radio-progress-wrap');

  if (audioEl) { audioEl.style.display = 'none'; audioEl.src = ''; }

  // ── UTILS ──────────────────────────────────────────────────────
  function fmt(ms) {
    if (!ms || isNaN(ms)) return '0:00';
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  }
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── CREAR IFRAME WIDGET ─────────────────────────────────────────
  function createWidget() {
    let iframe = document.getElementById('sc-widget');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id     = 'sc-widget';
      iframe.allow  = 'autoplay';
      iframe.src    = `https://w.soundcloud.com/player/?url=${encodeURIComponent(SC_PLAYLIST)}`
        + `&color=%23a855f7&auto_play=false&hide_related=true&show_comments=false`
        + `&show_user=true&show_reposts=false&show_teaser=false&continuous_play=true`;
      iframe.style.cssText = 'width:100%;height:0;border:none;display:block;overflow:hidden;border-radius:10px;margin-top:12px;transition:height 0.3s';
      const playerDiv = document.querySelector('.radio-player');
      if (playerDiv) playerDiv.appendChild(iframe);
    }
    return iframe;
  }

  // ── BIND WIDGET ─────────────────────────────────────────────────
  function bindWidget(iframe) {
    widget = window.SC.Widget(iframe);

    widget.bind(SC.Widget.Events.READY, () => {
      widgetReady = true;

      // Obtener todos los sonidos reales de la playlist
      widget.getSounds(sounds => {
        if (!sounds || !sounds.length) return;
        scTracks = sounds.map(s => ({
          id:        s.id,
          title:     s.title,
          artist:    s.user?.username || 'RAYVER',
          cover:     s.artwork_url
                       ? s.artwork_url.replace('large', 't300x300')
                       : (s.user?.avatar_url || 'logo.jpg'),
          permalink: s.permalink_url,
          duration:  s.duration
        }));

        // Mostrar primer track en UI
        updateUIFromTrack(scTracks[0], 0);
        renderTracklist();
        if (counterEl) counterEl.textContent = `1 / ${scTracks.length}`;
      });
    });

    // Al cambiar de track el widget dispara PLAY con el índice real
    widget.bind(SC.Widget.Events.PLAY, () => {
      setPlayState(true);
      // Obtener índice real del widget
      widget.getCurrentSoundIndex(idx => {
        currentIdx = idx || 0;
        if (scTracks[currentIdx]) {
          updateUIFromTrack(scTracks[currentIdx], currentIdx);
        } else {
          // Fallback: obtener sonido actual
          widget.getCurrentSound(s => {
            if (s) updateUIFromSound(s);
          });
        }
      });
    });

    widget.bind(SC.Widget.Events.PAUSE,  () => setPlayState(false));
    widget.bind(SC.Widget.Events.FINISH, () => { if (!isShuffle) widget.next(); else shufflePlay(); });

    widget.bind(SC.Widget.Events.PLAY_PROGRESS, data => {
      if (!data) return;
      const pos = data.currentPosition || 0;
      const dur = data.duration || 1;
      if (fillEl)    fillEl.style.width = Math.min((pos / dur) * 100, 100) + '%';
      if (curTimeEl) curTimeEl.textContent = fmt(pos);
      if (durEl)     durEl.textContent     = fmt(dur);
      if (progWrap)  progWrap.style.display = '';
    });

    widget.bind(SC.Widget.Events.ERROR, () => {
      console.warn('[radio] SC error, saltando...');
      setTimeout(() => widget.next(), 1000);
    });
  }

  // ── UPDATE UI ───────────────────────────────────────────────────
  function updateUIFromTrack(track, idx) {
    if (!track) return;
    currentIdx = idx;
    if (titleEl)   titleEl.textContent  = track.title  || 'RAYVER Radio';
    if (artistEl)  artistEl.textContent = track.artist || 'RAYVER';
    if (genreEl)   genreEl.textContent  = '';
    if (coverEl)   coverEl.src = track.cover || 'logo.jpg';
    if (counterEl) counterEl.textContent = `${idx + 1} / ${scTracks.length}`;
    if (platTagsEl && track.permalink) {
      platTagsEl.innerHTML = `<a href="${esc(track.permalink)}" target="_blank" class="radio-ptag ptag-soundcloud"><i class="fab fa-soundcloud"></i> SoundCloud</a>`;
    }
    highlightTracklist(idx);
  }

  function updateUIFromSound(sound) {
    const track = {
      title:     sound.title,
      artist:    sound.user?.username || 'RAYVER',
      cover:     sound.artwork_url?.replace('large','t300x300') || 'logo.jpg',
      permalink: sound.permalink_url
    };
    const idx = scTracks.findIndex(t => t.title === sound.title);
    updateUIFromTrack(track, idx >= 0 ? idx : currentIdx);
  }

  // ── PLAY STATE ──────────────────────────────────────────────────
  function setPlayState(playing) {
    isPlaying = playing;
    if (playIcon)   playIcon.className = playing ? 'fas fa-pause' : 'fas fa-play';
    if (onairDot)   onairDot.classList.toggle('pulsing', playing);
    if (coverEl)    coverEl.classList.toggle('spinning', playing);
    if (coverPulse) coverPulse.classList.toggle('active', playing);
    // Mostrar/ocultar el widget iframe
    const iframe = document.getElementById('sc-widget');
    if (iframe) iframe.style.height = playing ? '116px' : '0px';
  }

  // ── TRACKLIST ───────────────────────────────────────────────────
  function renderTracklist() {
    if (!tracklistBody) return;
    if (!scTracks.length) {
      tracklistBody.innerHTML = `<div class="radio-empty">
        <i class="fas fa-circle-notch fa-spin"></i>
        <p>Cargando playlist…</p>
      </div>`;
      return;
    }
    tracklistBody.innerHTML = scTracks.map((t, i) => `
      <div class="radio-track-item${i === currentIdx ? ' active' : ''}" onclick="radioPlayIdx(${i})">
        <span class="rtitem-num">${i + 1}</span>
        <img class="rtitem-cover"
          src="${esc(t.cover || 'logo.jpg')}"
          alt="${esc(t.title)}"
          loading="lazy"
          onerror="this.src='logo.jpg'">
        <div class="rtitem-info">
          <div class="rtitem-title">${esc(t.title)}</div>
          <div class="rtitem-sub">${esc(t.artist || 'RAYVER')}${t.duration ? ' · ' + fmt(t.duration) : ''}</div>
        </div>
      </div>`).join('');
  }

  function highlightTracklist(idx) {
    document.querySelectorAll('.radio-track-item').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
      if (i === idx) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  // ── CONTROLES ───────────────────────────────────────────────────
  function ensureWidget() {
    if (!widgetReady) {
      const iframe = createWidget();
      loadSCScript(() => bindWidget(iframe));
    }
  }

  playBtn && playBtn.addEventListener('click', () => {
    ensureWidget();
    if (!widgetReady) return;
    if (isPlaying) widget.pause();
    else widget.play();
  });

  prevBtn && prevBtn.addEventListener('click', () => {
    ensureWidget();
    if (widgetReady) widget.prev();
  });

  nextBtn && nextBtn.addEventListener('click', () => {
    ensureWidget();
    if (widgetReady) widget.next();
  });

  shuffleBtn && shuffleBtn.addEventListener('click', () => {
    isShuffle = !isShuffle;
    shuffleBtn.classList.toggle('active', isShuffle);
  });

  function shufflePlay() {
    if (!scTracks.length) return;
    let r = Math.floor(Math.random() * scTracks.length);
    if (r === currentIdx) r = (r + 1) % scTracks.length;
    if (widget && widgetReady) widget.skip(r);
  }

  muteBtn && muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    if (widget && widgetReady) widget.setVolume(isMuted ? 0 : (volumeEl?.value || 80));
    if (volIcon) volIcon.className = isMuted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
  });

  volumeEl && volumeEl.addEventListener('input', () => {
    if (widget && widgetReady) widget.setVolume(volumeEl.value);
    if (volIcon) {
      const v = parseInt(volumeEl.value);
      volIcon.className = v === 0 ? 'fas fa-volume-mute' : v < 50 ? 'fas fa-volume-down' : 'fas fa-volume-up';
    }
  });

  progEl && progEl.addEventListener('click', e => {
    if (!widget || !widgetReady) return;
    const rect = progEl.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    widget.getDuration(dur => widget.seekTo(pct * dur));
  });

  // Click en tracklist → saltar al track real en el widget
  window.radioPlayIdx = function(idx) {
    ensureWidget();
    if (!widgetReady) {
      // Esperar y reintentar
      setTimeout(() => { if (widgetReady) { widget.skip(idx); widget.play(); } }, 1500);
      return;
    }
    widget.skip(idx);
    widget.play();
    currentIdx = idx;
    highlightTracklist(idx);
  };

  // ── SC API LOADER ───────────────────────────────────────────────
  function loadSCScript(cb) {
    if (window.SC) { cb(); return; }
    const s = document.createElement('script');
    s.src   = 'https://w.soundcloud.com/player/api.js';
    s.onload = cb;
    document.head.appendChild(s);
  }

  // ── INIT ────────────────────────────────────────────────────────
  // ── CARGAR TRACKLIST DESDE BACKEND ──────────────────────────────
  async function loadTracklistFromAPI() {
    try {
      const r = await fetch('/api/public/sc-playlist');
      if (!r.ok) return null;
      const data = await r.json();
      return data.tracks || null;
    } catch { return null; }
  }

  async function init() {
    // Mostrar spinner inicial
    if (tracklistBody) {
      tracklistBody.innerHTML = `<div class="radio-empty">
        <i class="fas fa-circle-notch fa-spin"></i>
        <p>Cargando playlist…</p>
      </div>`;
    }
    if (titleEl)   titleEl.textContent  = 'RAYVER Radio';
    if (artistEl)  artistEl.textContent = 'Pulsa ▶ para escuchar';
    if (counterEl) counterEl.textContent = '— / —';

    // 1. Intentar cargar tracklist desde la API del backend (más rápido)
    const apiTracks = await loadTracklistFromAPI();
    if (apiTracks && apiTracks.length) {
      scTracks = apiTracks;
      renderTracklist();
      if (counterEl) counterEl.textContent = `1 / ${scTracks.length}`;
      if (titleEl) titleEl.textContent = scTracks[0]?.title || 'RAYVER Radio';
    }

    // 2. Crear el widget SC (se sincronizará cuando cargue)
    const iframe = createWidget();
    loadSCScript(() => bindWidget(iframe));
  }

  init();
})();
