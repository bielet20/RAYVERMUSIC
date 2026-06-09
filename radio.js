/**
 * RAYVER RADIO — SoundCloud Widget API controller
 * Loads tracks from /api/tracks, builds playlist, controls SoundCloud widget
 */
(function () {
  'use strict';

  const API = window.RAYVER_API || '/api';
  let tracks = [];
  let currentIdx = 0;
  let isPlaying = false;
  let isShuffle = false;
  let widget = null;
  let widgetReady = false;

  // ── DOM refs ────────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const radioSection  = $('radio');
  const coverEl       = $('radio-cover');
  const titleEl       = $('radio-title');
  const artistEl      = $('radio-artist');
  const genreEl       = $('radio-genre');
  const playBtn       = $('radio-play');
  const prevBtn       = $('radio-prev');
  const nextBtn       = $('radio-next');
  const shuffleBtn    = $('radio-shuffle');
  const progressEl    = $('radio-progress');
  const progressFill  = $('radio-progress-fill');
  const currentTimeEl = $('radio-current-time');
  const durationEl    = $('radio-duration');
  const volumeEl      = $('radio-volume');
  const tracklistEl   = $('radio-tracklist');
  const onairDot      = $('radio-onair-dot');

  // ── Utilities ───────────────────────────────────────────────────────────────
  function fmt(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function updateTrackUI(track) {
    if (!track) return;
    titleEl.textContent  = track.title;
    artistEl.textContent = track.artist;
    genreEl.textContent  = track.genre || '';
    if (track.coverUrl) {
      coverEl.src = track.coverUrl;
      coverEl.style.display = 'block';
    } else {
      coverEl.src = 'logo.jpg';
    }
    // Highlight active track in tracklist
    document.querySelectorAll('.radio-track-item').forEach((el, i) => {
      el.classList.toggle('active', i === currentIdx);
    });
  }

  function setPlayingState(playing) {
    isPlaying = playing;
    playBtn.innerHTML = playing
      ? '<i class="fas fa-pause"></i>'
      : '<i class="fas fa-play"></i>';
    onairDot?.classList.toggle('pulsing', playing);
  }

  // ── SoundCloud Widget ────────────────────────────────────────────────────────
  function initWidget(url) {
    const iframe = $('sc-widget');
    if (!iframe) return;
    iframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&visual=false&color=%233b82f6`;

    if (window.SC && widgetReady === false) {
      widget = window.SC.Widget(iframe);

      widget.bind(SC.Widget.Events.READY, () => {
        widgetReady = true;
        widget.bind(SC.Widget.Events.FINISH, () => nextTrack());
        widget.bind(SC.Widget.Events.PLAY, () => setPlayingState(true));
        widget.bind(SC.Widget.Events.PAUSE, () => setPlayingState(false));
        widget.bind(SC.Widget.Events.PLAY_PROGRESS, (data) => {
          const pct = data.relativePosition * 100;
          if (progressFill) progressFill.style.width = pct + '%';
          if (currentTimeEl) currentTimeEl.textContent = fmt(data.currentPosition / 1000);
          widget.getDuration(d => { if (durationEl) durationEl.textContent = fmt(d / 1000); });
        });
      });
    }
  }

  function loadTrack(idx) {
    currentIdx = ((idx % tracks.length) + tracks.length) % tracks.length;
    const track = tracks[currentIdx];
    if (!track) return;
    updateTrackUI(track);
    if (widget && widgetReady && track.soundcloudUrl) {
      widget.load(track.soundcloudUrl, { auto_play: isPlaying });
    } else if (track.soundcloudUrl) {
      initWidget(track.soundcloudUrl);
    }
  }

  function nextTrack() {
    const next = isShuffle
      ? Math.floor(Math.random() * tracks.length)
      : currentIdx + 1;
    loadTrack(next);
    if (isPlaying && widget && widgetReady) widget.play();
  }

  function prevTrack() {
    loadTrack(currentIdx - 1);
    if (isPlaying && widget && widgetReady) widget.play();
  }

  // ── Controls ─────────────────────────────────────────────────────────────────
  playBtn?.addEventListener('click', () => {
    if (!tracks.length) return;
    if (!widgetReady) {
      loadTrack(currentIdx);
      return;
    }
    if (isPlaying) widget.pause();
    else widget.play();
  });

  nextBtn?.addEventListener('click', nextTrack);
  prevBtn?.addEventListener('click', prevTrack);

  shuffleBtn?.addEventListener('click', () => {
    isShuffle = !isShuffle;
    shuffleBtn.classList.toggle('active', isShuffle);
  });

  progressEl?.addEventListener('click', (e) => {
    if (!widgetReady) return;
    const rect = progressEl.getBoundingClientRect();
    const pct  = (e.clientX - rect.left) / rect.width;
    widget.getDuration(d => widget.seekTo(d * pct));
  });

  volumeEl?.addEventListener('input', () => {
    if (widget && widgetReady) widget.setVolume(volumeEl.value);
  });

  // ── Tracklist render ─────────────────────────────────────────────────────────
  function buildTracklist() {
    if (!tracklistEl) return;
    tracklistEl.innerHTML = tracks.map((t, i) => `
      <div class="radio-track-item ${i === currentIdx ? 'active' : ''}" data-idx="${i}">
        <span class="radio-track-num">${String(i + 1).padStart(2, '0')}</span>
        <div class="radio-track-info">
          <span class="radio-track-title">${t.title}</span>
          <span class="radio-track-genre">${t.genre || ''}</span>
        </div>
        <button class="radio-track-play" aria-label="Reproducir ${t.title}">
          <i class="fas fa-play"></i>
        </button>
      </div>
    `).join('');

    tracklistEl.querySelectorAll('.radio-track-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx, 10);
        loadTrack(idx);
        if (widget && widgetReady) widget.play();
        else { setTimeout(() => widget?.play(), 800); }
      });
    });
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  async function init() {
    try {
      const res = await fetch(`${API}/tracks`);
      tracks = await res.json();
    } catch {
      console.warn('[Radio] Could not load tracks from API — using empty playlist');
      tracks = [];
    }

    if (!tracks.length) {
      if (radioSection) radioSection.style.display = 'none';
      return;
    }

    buildTracklist();
    updateTrackUI(tracks[0]);
    // Load widget lazily — only when user first clicks play
    playBtn?.addEventListener('click', function firstPlay() {
      initWidget(tracks[currentIdx].soundcloudUrl);
      playBtn.removeEventListener('click', firstPlay);
    }, { once: true });
  }

  // Wait for SC Widget API script
  function waitForSC(cb) {
    if (window.SC) return cb();
    const s = document.createElement('script');
    s.src = 'https://w.soundcloud.com/player/api.js';
    s.onload = cb;
    document.head.appendChild(s);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => waitForSC(init));
  } else {
    waitForSC(init);
  }
})();
