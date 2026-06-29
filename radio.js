/**
 * RAYVER RADIO v3 — Player HTML5 nativo
 * Carga tracks desde /api/public/tracks
 * Usa el campo "streamUrl" para reproducir
 * Si no hay streamUrl, muestra instrucciones para añadirlo desde el admin
 */
(function () {
  'use strict';

  const API = '/api/public';
  let tracks     = [];
  let currentIdx = 0;
  let isPlaying  = false;
  let isShuffle  = false;
  let isMuted    = false;

  // DOM
  const audio      = document.getElementById('radio-audio');
  const cover      = document.getElementById('radio-cover');
  const pulse      = document.getElementById('radio-cover-pulse');
  const titleEl    = document.getElementById('radio-title');
  const artistEl   = document.getElementById('radio-artist');
  const genreEl    = document.getElementById('radio-genre');
  const platTagsEl = document.getElementById('radio-platform-tags');
  const playBtn    = document.getElementById('radio-play');
  const playIcon   = document.getElementById('radio-play-icon');
  const prevBtn    = document.getElementById('radio-prev');
  const nextBtn    = document.getElementById('radio-next');
  const shuffleBtn = document.getElementById('radio-shuffle');
  const muteBtn    = document.getElementById('radio-mute');
  const volIcon    = document.getElementById('radio-vol-icon');
  const volumeEl   = document.getElementById('radio-volume');
  const progressEl = document.getElementById('radio-progress');
  const fillEl     = document.getElementById('radio-progress-fill');
  const curTimeEl  = document.getElementById('radio-current-time');
  const durEl      = document.getElementById('radio-duration');
  const onairDot   = document.getElementById('radio-onair-dot');
  const counterEl  = document.getElementById('radio-counter');
  const tracklistBody = document.getElementById('radio-tracklist-body');

  if (!audio) return;

  // ── UTILIDADES ─────────────────────────────────────────────────
  function fmt(s) {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── PLATAFORMAS ─────────────────────────────────────────────────
  const PLAT_MAP = {
    spotify:    { l: 'Spotify',    cls: 'ptag-spotify',    i: 'fab fa-spotify' },
    apple:      { l: 'Apple',      cls: 'ptag-apple',      i: 'fab fa-apple' },
    youtube:    { l: 'YouTube',    cls: 'ptag-youtube',    i: 'fab fa-youtube' },
    soundcloud: { l: 'SoundCloud', cls: 'ptag-soundcloud', i: 'fab fa-soundcloud' },
    tidal:      { l: 'Tidal',      cls: 'ptag-tidal',      i: 'fas fa-water' },
    amazon:     { l: 'Amazon',     cls: 'ptag-amazon',     i: 'fab fa-amazon' },
    deezer:     { l: 'Deezer',     cls: 'ptag-deezer',     i: 'fas fa-music' },
    distrokid:  { l: 'Link',       cls: 'ptag-lk',         i: 'fas fa-link' }
  };

  function renderPlatformTags(platforms) {
    if (!platTagsEl) return;
    const entries = Object.entries(platforms || {}).filter(([, v]) => v);
    platTagsEl.innerHTML = entries.slice(0, 4).map(([k, v]) => {
      const p = PLAT_MAP[k] || { l: k, cls: 'ptag-lk', i: 'fas fa-link' };
      return `<a href="${esc(v)}" target="_blank" class="radio-ptag ${p.cls}"><i class="${p.i}"></i> ${p.l}</a>`;
    }).join('');
  }

  // ── UPDATE UI ───────────────────────────────────────────────────
  function updateUI(track) {
    if (!track) return;
    titleEl.textContent  = track.title  || 'Sin título';
    artistEl.textContent = 'RAYVER';
    genreEl.textContent  = track.type   || '';
    cover.src = track.cover || 'logo.jpg';
    renderPlatformTags(track.platforms);
    counterEl.textContent = `${currentIdx + 1} / ${tracks.length}`;
    // Tracklist highlight
    document.querySelectorAll('.radio-track-item').forEach((el, i) => {
      el.classList.toggle('active', i === currentIdx);
      if (i === currentIdx) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  function setPlayState(playing) {
    isPlaying = playing;
    playIcon.className = playing ? 'fas fa-pause' : 'fas fa-play';
    onairDot.classList.toggle('pulsing', playing);
    cover.classList.toggle('spinning', playing);
    if (pulse) pulse.classList.toggle('active', playing);
  }

  // ── TRACKLIST ───────────────────────────────────────────────────
  function renderTracklist() {
    if (!tracklistBody) return;
    if (!tracks.length) {
      tracklistBody.innerHTML = `<div class="radio-empty">
        <i class="fas fa-music"></i>
        Sin canciones en la playlist.
        <div class="radio-hint">
          Para añadir canciones a la radio:<br>
          1. Ve a <strong>rayvermusic.com/admin.html</strong><br>
          2. Añade tus canciones con el campo <strong>"Stream URL"</strong><br>
          3. Pega la URL directa del audio o del track en SoundCloud/YouTube
        </div>
      </div>`;
      return;
    }
    tracklistBody.innerHTML = tracks.map((t, i) => `
      <div class="radio-track-item${i === currentIdx ? ' active' : ''}" onclick="radioPlayIdx(${i})">
        <span class="rtitem-num">${i + 1}</span>
        <img class="rtitem-cover" src="${esc(t.cover || 'logo.jpg')}" alt="" loading="lazy">
        <div class="rtitem-info">
          <div class="rtitem-title">${esc(t.title)}</div>
          <div class="rtitem-sub">${esc(t.type || 'Single')}${t.year ? ' · ' + t.year : ''}${t.streamUrl ? '' : ' · <em>Sin URL de audio</em>'}</div>
        </div>
      </div>`).join('');
  }

  // ── PLAY ────────────────────────────────────────────────────────
  function loadTrack(idx, autoplay) {
    if (!tracks.length) return;
    currentIdx = ((idx % tracks.length) + tracks.length) % tracks.length;
    const t = tracks[currentIdx];
    updateUI(t);

    if (t.streamUrl) {
      audio.src = t.streamUrl;
      audio.load();
      if (autoplay) {
        audio.play().catch(e => {
          console.warn('Autoplay bloqueado:', e);
          setPlayState(false);
        });
      }
    } else {
      // Sin URL — mostrar info pero no romper
      audio.src = '';
      setPlayState(false);
      if (autoplay) {
        // Saltar al siguiente con streamUrl automáticamente
        const nextWithUrl = findNextWithUrl(currentIdx);
        if (nextWithUrl !== -1) {
          setTimeout(() => loadTrack(nextWithUrl, true), 1500);
        }
      }
    }
    renderTracklist();
  }

  function findNextWithUrl(from) {
    for (let i = 1; i <= tracks.length; i++) {
      const idx = (from + i) % tracks.length;
      if (tracks[idx].streamUrl) return idx;
    }
    return -1;
  }

  function nextTrack() {
    if (isShuffle) {
      let rand = Math.floor(Math.random() * tracks.length);
      if (tracks.length > 1 && rand === currentIdx) rand = (rand + 1) % tracks.length;
      loadTrack(rand, true);
    } else {
      loadTrack(currentIdx + 1, true);
    }
  }

  function prevTrack() {
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    loadTrack(currentIdx - 1, true);
  }

  // ── CONTROLS ────────────────────────────────────────────────────
  playBtn.addEventListener('click', () => {
    if (!tracks.length) return;
    if (isPlaying) {
      audio.pause();
    } else {
      if (!audio.src || audio.src === window.location.href) {
        loadTrack(currentIdx, true);
      } else {
        audio.play().catch(() => {});
      }
    }
  });

  prevBtn.addEventListener('click', prevTrack);
  nextBtn.addEventListener('click', nextTrack);

  shuffleBtn.addEventListener('click', () => {
    isShuffle = !isShuffle;
    shuffleBtn.classList.toggle('active', isShuffle);
  });

  muteBtn && muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    audio.muted = isMuted;
    if (volIcon) volIcon.className = isMuted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
  });

  volumeEl && volumeEl.addEventListener('input', () => {
    audio.volume = volumeEl.value / 100;
    if (volIcon) {
      volIcon.className = volumeEl.value == 0 ? 'fas fa-volume-mute'
        : volumeEl.value < 50 ? 'fas fa-volume-down'
        : 'fas fa-volume-up';
    }
  });

  // Progress seek
  progressEl && progressEl.addEventListener('click', e => {
    if (!audio.duration) return;
    const rect = progressEl.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
  });

  // Audio events
  audio.addEventListener('play',  () => setPlayState(true));
  audio.addEventListener('pause', () => setPlayState(false));
  audio.addEventListener('ended', nextTrack);

  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    if (fillEl) fillEl.style.width = pct + '%';
    if (curTimeEl) curTimeEl.textContent = fmt(audio.currentTime);
  });

  audio.addEventListener('durationchange', () => {
    if (durEl) durEl.textContent = fmt(audio.duration);
  });

  audio.addEventListener('error', () => {
    setPlayState(false);
    if (titleEl) titleEl.textContent += ' (error al cargar)';
  });

  // Global click desde tracklist
  window.radioPlayIdx = function(idx) {
    loadTrack(idx, true);
  };

  audio.volume = 0.8;

  // ── CARGAR TRACKS DESDE API ─────────────────────────────────────
  async function init() {
    try {
      const r = await fetch(`${API}/tracks`);
      if (r.ok) {
        const data = await r.json();
        if (data && data.length) tracks = data;
      }
    } catch (_) {}

    if (!tracks.length) {
      // Tracks de demo si el backend no responde
      tracks = [
        { title: 'Feel It In The Air', type: 'Álbum', year: '2025', cover: '', streamUrl: '',
          platforms: { spotify: 'https://open.spotify.com/artist/0GmwWh84e70RNGNkYOwE6d' } },
        { title: 'I Am Found', type: 'Álbum', year: '2025', cover: '', streamUrl: '',
          platforms: { spotify: 'https://open.spotify.com/artist/0GmwWh84e70RNGNkYOwE6d' } },
        { title: 'Summum', type: 'Single', year: '2025', cover: '', streamUrl: '',
          platforms: { youtube: 'https://youtu.be/_5ay8vh1SJk' } }
      ];
    }

    loadTrack(0, false);
    renderTracklist();
  }

  init();
})();
