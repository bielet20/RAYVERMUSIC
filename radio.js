/**
 * RAYVER RADIO v4
 * Estrategia de reproducción por prioridad:
 * 1. streamUrl directo (MP3/WAV propio)
 * 2. SoundCloud embed widget (si tiene URL de SC)
 * 3. YouTube embed iframe (si tiene URL de YT)
 * 4. Spotify preview 30s (si tiene URL de Spotify)
 * 5. Mostrar links de plataformas para escuchar externamente
 */
(function () {
  'use strict';

  const API = '/api/public';
  let tracks     = [];
  let currentIdx = 0;
  let isPlaying  = false;
  let isShuffle  = false;
  let isMuted    = false;
  let currentMode = null; // 'audio' | 'soundcloud' | 'youtube' | 'external'
  let scWidget   = null;
  let scReady    = false;

  // ── DOM ────────────────────────────────────────────────────────
  const audio       = document.getElementById('radio-audio');
  const cover       = document.getElementById('radio-cover');
  const pulse       = document.getElementById('radio-cover-pulse');
  const titleEl     = document.getElementById('radio-title');
  const artistEl    = document.getElementById('radio-artist');
  const genreEl     = document.getElementById('radio-genre');
  const platTagsEl  = document.getElementById('radio-platform-tags');
  const playBtn     = document.getElementById('radio-play');
  const playIcon    = document.getElementById('radio-play-icon');
  const prevBtn     = document.getElementById('radio-prev');
  const nextBtn     = document.getElementById('radio-next');
  const shuffleBtn  = document.getElementById('radio-shuffle');
  const muteBtn     = document.getElementById('radio-mute');
  const volIcon     = document.getElementById('radio-vol-icon');
  const volumeEl    = document.getElementById('radio-volume');
  const progressEl  = document.getElementById('radio-progress');
  const fillEl      = document.getElementById('radio-progress-fill');
  const curTimeEl   = document.getElementById('radio-current-time');
  const durEl       = document.getElementById('radio-duration');
  const onairDot    = document.getElementById('radio-onair-dot');
  const counterEl   = document.getElementById('radio-counter');
  const tracklistBody = document.getElementById('radio-tracklist-body');

  if (!audio) return;

  // ── UTILS ──────────────────────────────────────────────────────
  function fmt(s) {
    if (!s || isNaN(s)) return '0:00';
    return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function extractSCUrl(url) {
    if (!url) return null;
    if (url.includes('soundcloud.com') || url.includes('on.soundcloud.com')) return url;
    return null;
  }

  function extractYTId(url) {
    if (!url) return null;
    const m = url.match(/(?:youtu\.be\/|v=|embed\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  function extractSpotifyPreview(track) {
    return track.previewUrl || track.preview_url || null;
  }

  function getBestSource(track) {
    if (track.streamUrl && !track.streamUrl.includes('soundcloud') && !track.streamUrl.includes('youtube') && !track.streamUrl.includes('spotify'))
      return { type: 'audio', url: track.streamUrl };
    const scUrl = extractSCUrl(track.streamUrl) || extractSCUrl(track.platforms?.soundcloud);
    if (scUrl) return { type: 'soundcloud', url: scUrl };
    const ytId = extractYTId(track.streamUrl) || extractYTId(track.platforms?.youtube);
    if (ytId) return { type: 'youtube', id: ytId };
    const preview = extractSpotifyPreview(track);
    if (preview) return { type: 'audio', url: preview };
    return { type: 'external', platforms: track.platforms || {} };
  }

  // ── PLATAFORMAS ────────────────────────────────────────────────
  const PLAT_MAP = {
    spotify:    { l:'Spotify',    cls:'ptag-spotify',    i:'fab fa-spotify', color:'#1DB954' },
    apple:      { l:'Apple',      cls:'ptag-apple',      i:'fab fa-apple',   color:'#FC3C44' },
    youtube:    { l:'YouTube',    cls:'ptag-youtube',    i:'fab fa-youtube', color:'#ff4444' },
    soundcloud: { l:'SoundCloud', cls:'ptag-soundcloud', i:'fab fa-soundcloud', color:'#ff5500' },
    tidal:      { l:'Tidal',      cls:'ptag-tidal',      i:'fas fa-water',   color:'#00cccc' },
    amazon:     { l:'Amazon',     cls:'ptag-amazon',     i:'fab fa-amazon',  color:'#ff9900' },
    deezer:     { l:'Deezer',     cls:'ptag-deezer',     i:'fas fa-music',   color:'#ef5466' }
  };

  function renderPlatformTags(track) {
    if (!platTagsEl) return;
    const entries = Object.entries(track.platforms||{}).filter(([,v])=>v);
    platTagsEl.innerHTML = entries.slice(0,4).map(([k,v]) => {
      const p = PLAT_MAP[k]||{l:k,cls:'ptag-lk',i:'fas fa-link'};
      return `<a href="${esc(v)}" target="_blank" class="radio-ptag ${p.cls}" title="Escuchar en ${p.l}">
        <i class="${p.i}"></i> ${p.l}
      </a>`;
    }).join('');
  }

  // ── SOUNDCLOUD WIDGET ──────────────────────────────────────────
  function initSCWidget(url, autoplay) {
    // Limpiar widget anterior
    const existing = document.getElementById('sc-widget');
    if (existing) existing.remove();

    const iframe = document.createElement('iframe');
    iframe.id = 'sc-widget';
    iframe.style.cssText = 'width:100%;height:0;display:none;position:absolute';
    iframe.allow = 'autoplay';
    iframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=${autoplay}&hide_related=true&show_comments=false&show_user=false&show_reposts=false&visual=false&color=%23a855f7`;
    document.body.appendChild(iframe);

    scReady = false;
    scWidget = null;

    if (window.SC) {
      scWidget = window.SC.Widget(iframe);
      scWidget.bind(window.SC.Widget.Events.READY, () => {
        scReady = true;
        if (autoplay) scWidget.play();
        scWidget.bind(window.SC.Widget.Events.PLAY,  () => setPlayState(true));
        scWidget.bind(window.SC.Widget.Events.PAUSE, () => setPlayState(false));
        scWidget.bind(window.SC.Widget.Events.FINISH, () => nextTrack());
        scWidget.bind(window.SC.Widget.Events.PLAY_PROGRESS, data => {
          if (!data.loadedProgress) return;
          const pct = (data.currentPosition / (data.loadedProgress * data.duration / data.loadedProgress)) * 100;
          if (fillEl) fillEl.style.width = Math.min(pct,100) + '%';
          if (curTimeEl) curTimeEl.textContent = fmt(data.currentPosition / 1000);
          if (durEl && data.duration) durEl.textContent = fmt(data.duration / 1000);
        });
      });
    }
  }

  function loadSCScript(cb) {
    if (window.SC) { cb(); return; }
    const s = document.createElement('script');
    s.src = 'https://w.soundcloud.com/player/api.js';
    s.onload = cb;
    document.head.appendChild(s);
  }

  // ── YOUTUBE EMBED ──────────────────────────────────────────────
  function initYTEmbed(videoId) {
    // Crear mini player YT dentro de la radio (oculto, solo audio)
    const existing = document.getElementById('yt-radio-wrap');
    if (existing) existing.remove();

    const wrap = document.createElement('div');
    wrap.id = 'yt-radio-wrap';
    wrap.style.cssText = 'width:1px;height:1px;overflow:hidden;position:absolute;opacity:0;pointer-events:none';
    wrap.innerHTML = `<iframe id="yt-radio-iframe" width="1" height="1"
      src="https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&enablejsapi=1"
      frameborder="0" allow="autoplay; encrypted-media"></iframe>`;
    document.body.appendChild(wrap);

    // YT no tiene API simple de progreso sin YT Player API — usar timer aproximado
    setPlayState(true);
    let elapsed = 0;
    if (window._ytTimer) clearInterval(window._ytTimer);
    window._ytTimer = setInterval(() => {
      elapsed++;
      if (fillEl) fillEl.style.width = Math.min((elapsed / 240) * 100, 99) + '%';
      if (curTimeEl) curTimeEl.textContent = fmt(elapsed);
    }, 1000);
  }

  function stopYT() {
    const wrap = document.getElementById('yt-radio-wrap');
    if (wrap) wrap.remove();
    if (window._ytTimer) { clearInterval(window._ytTimer); window._ytTimer = null; }
  }

  // ── PLAY STATE ─────────────────────────────────────────────────
  function setPlayState(playing) {
    isPlaying = playing;
    if (playIcon) playIcon.className = playing ? 'fas fa-pause' : 'fas fa-play';
    if (onairDot) onairDot.classList.toggle('pulsing', playing);
    if (cover)    cover.classList.toggle('spinning', playing);
    if (pulse)    pulse.classList.toggle('active', playing);
  }

  // ── UI UPDATE ──────────────────────────────────────────────────
  function updateUI(track) {
    if (!track) return;
    if (titleEl)  titleEl.textContent  = track.title || 'Sin título';
    if (artistEl) artistEl.textContent = 'RAYVER';
    if (genreEl)  genreEl.textContent  = track.type  || '';
    if (cover)    cover.src = track.cover || 'logo.jpg';
    if (counterEl) counterEl.textContent = `${currentIdx+1} / ${tracks.length}`;
    renderPlatformTags(track);
    // Reset progress
    if (fillEl)    fillEl.style.width = '0%';
    if (curTimeEl) curTimeEl.textContent = '0:00';
    if (durEl)     durEl.textContent = '0:00';
    // Tracklist highlight
    document.querySelectorAll('.radio-track-item').forEach((el,i) => {
      el.classList.toggle('active', i === currentIdx);
      if (i === currentIdx) el.scrollIntoView({ behavior:'smooth', block:'nearest' });
    });
  }

  // ── LOAD TRACK ─────────────────────────────────────────────────
  function loadTrack(idx, autoplay) {
    if (!tracks.length) return;
    currentIdx = ((idx % tracks.length) + tracks.length) % tracks.length;
    const track = tracks[currentIdx];
    updateUI(track);

    // Parar todo lo anterior
    audio.pause();
    audio.src = '';
    stopYT();
    if (scWidget && scReady) { try { scWidget.pause(); } catch(_){} }

    setPlayState(false);

    const source = getBestSource(track);
    currentMode = source.type;

    if (source.type === 'audio') {
      audio.src = source.url;
      audio.load();
      if (autoplay) audio.play().catch(() => setPlayState(false));

    } else if (source.type === 'soundcloud') {
      loadSCScript(() => initSCWidget(source.url, autoplay));

    } else if (source.type === 'youtube') {
      if (autoplay) initYTEmbed(source.id);
      else {
        // Guardar para cuando pulse play
        track._ytId = source.id;
      }

    } else {
      // External — mostrar mensaje con links
      if (titleEl) titleEl.textContent = track.title || 'Sin título';
      setPlayState(false);
      showExternalMessage(track);
    }

    renderTracklist();
  }

  function showExternalMessage(track) {
    if (!platTagsEl) return;
    const entries = Object.entries(track.platforms||{}).filter(([,v])=>v);
    if (!entries.length) return;
    // Los tags ya se muestran — no hace falta hacer nada extra
    // El usuario ve los botones de plataformas para escuchar
  }

  // ── TRACKLIST ──────────────────────────────────────────────────
  function renderTracklist() {
    if (!tracklistBody) return;
    if (!tracks.length) {
      tracklistBody.innerHTML = `<div class="radio-empty">
        <i class="fas fa-music"></i>
        Importa tus canciones desde el panel de Sincronización
      </div>`;
      return;
    }
    const icons = { audio:'🎵', soundcloud:'☁️', youtube:'▶️', external:'🔗' };
    tracklistBody.innerHTML = tracks.map((t,i) => {
      const src = getBestSource(t);
      return `<div class="radio-track-item${i===currentIdx?' active':''}" onclick="radioPlayIdx(${i})">
        <span class="rtitem-num">${i+1}</span>
        <img class="rtitem-cover" src="${esc(t.cover||'logo.jpg')}" alt="" loading="lazy">
        <div class="rtitem-info">
          <div class="rtitem-title">${esc(t.title)}</div>
          <div class="rtitem-sub">${esc(t.type||'Single')}${t.year?' · '+t.year:''} <span title="${src.type}">${icons[src.type]||'🔗'}</span></div>
        </div>
      </div>`;
    }).join('');
  }

  // ── CONTROLES ──────────────────────────────────────────────────
  playBtn && playBtn.addEventListener('click', () => {
    if (!tracks.length) return;
    const track = tracks[currentIdx];

    if (isPlaying) {
      // Pausar
      if (currentMode === 'audio') audio.pause();
      else if (currentMode === 'soundcloud' && scWidget && scReady) scWidget.pause();
      else if (currentMode === 'youtube') stopYT();
    } else {
      // Reanudar o cargar
      if (currentMode === 'audio' && audio.src) {
        audio.play().catch(() => {});
      } else if (currentMode === 'soundcloud' && scWidget && scReady) {
        scWidget.play();
      } else if (currentMode === 'youtube') {
        const src = getBestSource(track);
        if (src.id || track._ytId) initYTEmbed(src.id || track._ytId);
      } else {
        loadTrack(currentIdx, true);
      }
    }
  });

  function nextTrack() {
    if (isShuffle) {
      let r = Math.floor(Math.random() * tracks.length);
      if (tracks.length > 1 && r === currentIdx) r = (r+1) % tracks.length;
      loadTrack(r, true);
    } else {
      loadTrack(currentIdx+1, true);
    }
  }

  function prevTrack() {
    if (currentMode === 'audio' && audio.currentTime > 3) { audio.currentTime = 0; return; }
    loadTrack(currentIdx-1, true);
  }

  prevBtn    && prevBtn.addEventListener('click', prevTrack);
  nextBtn    && nextBtn.addEventListener('click', nextTrack);
  shuffleBtn && shuffleBtn.addEventListener('click', () => {
    isShuffle = !isShuffle;
    shuffleBtn.classList.toggle('active', isShuffle);
  });

  muteBtn && muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    audio.muted = isMuted;
    if (scWidget && scReady) scWidget.setVolume(isMuted ? 0 : (volumeEl?.value || 80));
    if (volIcon) volIcon.className = isMuted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
  });

  volumeEl && volumeEl.addEventListener('input', () => {
    const v = volumeEl.value / 100;
    audio.volume = v;
    if (scWidget && scReady) scWidget.setVolume(volumeEl.value);
    if (volIcon) volIcon.className = v === 0 ? 'fas fa-volume-mute' : v < 0.5 ? 'fas fa-volume-down' : 'fas fa-volume-up';
  });

  // Progress seek (solo para audio nativo)
  progressEl && progressEl.addEventListener('click', e => {
    if (currentMode !== 'audio' || !audio.duration) return;
    const rect = progressEl.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
  });

  // Audio events
  audio.addEventListener('play',  () => { if (currentMode==='audio') setPlayState(true); });
  audio.addEventListener('pause', () => { if (currentMode==='audio') setPlayState(false); });
  audio.addEventListener('ended', nextTrack);
  audio.addEventListener('timeupdate', () => {
    if (currentMode !== 'audio' || !audio.duration) return;
    if (fillEl)    fillEl.style.width = (audio.currentTime / audio.duration * 100) + '%';
    if (curTimeEl) curTimeEl.textContent = fmt(audio.currentTime);
  });
  audio.addEventListener('durationchange', () => {
    if (durEl) durEl.textContent = fmt(audio.duration);
  });

  // Global
  window.radioPlayIdx = idx => loadTrack(idx, true);

  audio.volume = 0.8;

  // ── INIT ───────────────────────────────────────────────────────
  async function init() {
    try {
      const r = await fetch(`${API}/tracks`);
      if (r.ok) {
        const data = await r.json();
        if (data && data.length) tracks = data;
      }
    } catch(_) {}

    if (!tracks.length) {
      // Fallback: perfil completo de SoundCloud — carga todas las canciones
      tracks = [
        { id:'1', title:'RAYVER — Catálogo completo', type:'Perfil', year:'2025', cover:'logo.jpg',
          streamUrl: 'https://soundcloud.com/biel-rivero-sampol',
          platforms:{
            soundcloud: 'https://soundcloud.com/biel-rivero-sampol',
            spotify:    'https://open.spotify.com/artist/0GmwWh84e70RNGNkYOwE6d',
            apple:      'https://music.apple.com/us/artist/gabriel-rivero-sampol/1838996180',
            youtube:    'https://youtu.be/_5ay8vh1SJk'
          }
        }
      ];
    }

    loadTrack(0, false);
    renderTracklist();
  }

  init();
})();
