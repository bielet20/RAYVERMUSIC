/**
 * RAYVER HYBRID PLAYER v8
 * Prioridad: YouTube → SoundCloud → Spotify
 * Carga tracks desde /api/public/tracks con fallback a playlist SC.
 */
(function () {
  'use strict';

  const SC_PLAYLIST_FALLBACK = 'https://soundcloud.com/biel-rivero-sampol/sets/marzo-best-ranking';

  // ── STATE ──────────────────────────────────────────────────────
  let playlist     = [];
  let currentIdx   = 0;
  let isPlaying    = false;
  let isShuffle    = false;
  let repeatMode   = 'none'; // none | one | all
  let activePlat   = null;   // youtube | soundcloud | spotify | null
  let isMuted      = false;

  // ── DOM ────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const titleEl      = $('radio-title');
  const artistEl     = $('radio-artist');
  const genreEl      = $('radio-genre');
  const platTagsEl   = $('radio-platform-tags');
  const playBtn      = $('radio-play');
  const playIcon     = $('radio-play-icon');
  const prevBtn      = $('radio-prev');
  const nextBtn      = $('radio-next');
  const shuffleBtn   = $('radio-shuffle');
  const muteBtn      = $('radio-mute');
  const volIcon      = $('radio-vol-icon');
  const volumeEl     = $('radio-volume');
  const fillEl       = $('radio-progress-fill');
  const curTimeEl    = $('radio-current-time');
  const durEl        = $('radio-duration');
  const onairDot     = $('radio-onair-dot');
  const counterEl    = $('radio-counter');
  const coverEl      = $('radio-cover');
  const coverPulse   = $('radio-cover-pulse');
  const tracklistBody = $('radio-tracklist-body');
  const progEl       = $('radio-progress');
  const progWrap     = $('radio-progress-wrap');
  const audioEl      = $('radio-audio');
  if (audioEl) { audioEl.style.display = 'none'; audioEl.src = ''; }

  // ── UTILS ──────────────────────────────────────────────────────
  function fmt(ms) {
    if (!ms || isNaN(ms)) return '0:00';
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function getBestPlatform(t) {
    if (t.youtubeId)                        return 'youtube';
    if (t.scUrl)                            return 'soundcloud';
    if (t.spotifyUrl || t.platforms?.spotify) return 'spotify';
    return null;
  }
  function vol() { return parseInt(volumeEl?.value ?? 80); }

  // ── YOUTUBE ENGINE ─────────────────────────────────────────────
  // El iframe debe tener dimensiones reales aunque esté fuera de pantalla
  // para que el navegador no bloquee el autoplay.
  let ytPlayer   = null;
  let ytReady    = false;
  let ytTimer    = null;

  function ytContainer() {
    let el = $('yt-radio-hidden');
    if (!el) {
      el = document.createElement('div');
      el.id = 'yt-radio-hidden';
      el.style.cssText = 'position:fixed;top:-9999px;left:0;width:480px;height:270px;pointer-events:none;overflow:hidden;';
      document.body.appendChild(el);
    }
    return el;
  }

  function loadYTApi(cb) {
    if (window.YT?.Player) { cb(); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); cb(); };
    if (!$('yt-iframe-api')) {
      const s = document.createElement('script');
      s.id  = 'yt-iframe-api';
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    }
  }

  function ytInitPlayer(videoId) {
    if (ytPlayer) { try { ytPlayer.destroy(); } catch(e) {} ytPlayer = null; }
    ytReady = false;
    loadYTApi(() => {
      ytPlayer = new YT.Player(ytContainer(), {
        videoId,
        playerVars: { autoplay: 1, controls: 0, rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: () => {
            ytReady = true;
            ytPlayer.setVolume(isMuted ? 0 : vol());
          },
          onStateChange: e => {
            if (e.data === YT.PlayerState.PLAYING) { setPlayState(true);  ytStartProgress(); }
            if (e.data === YT.PlayerState.PAUSED)  { setPlayState(false); ytStopProgress(); }
            if (e.data === YT.PlayerState.ENDED)   { ytStopProgress(); autoAdvance(); }
          }
        }
      });
    });
  }

  function ytStartProgress() {
    ytStopProgress();
    ytTimer = setInterval(() => {
      if (!ytPlayer || !ytReady) return;
      try {
        const cur = ytPlayer.getCurrentTime() * 1000;
        const dur = ytPlayer.getDuration() * 1000;
        if (fillEl && dur > 0) fillEl.style.width = Math.min((cur / dur) * 100, 100) + '%';
        if (curTimeEl) curTimeEl.textContent = fmt(cur);
        if (durEl)     durEl.textContent     = fmt(dur);
        if (progWrap)  progWrap.style.display = '';
      } catch(e) {}
    }, 500);
  }
  function ytStopProgress() { clearInterval(ytTimer); ytTimer = null; }

  // ── SOUNDCLOUD ENGINE ──────────────────────────────────────────
  let scWidget      = null;
  let scReady       = false;
  let scIframe      = null;
  let scFallbackMode = false; // true cuando usamos la playlist SC completa

  function loadSCApi(cb) {
    if (window.SC) { cb(); return; }
    const s = document.createElement('script');
    s.src   = 'https://w.soundcloud.com/player/api.js';
    s.onload = cb;
    document.head.appendChild(s);
  }

  function ensureSCIframe() {
    if (scIframe) return scIframe;
    scIframe = document.createElement('iframe');
    scIframe.id    = 'sc-radio-iframe';
    scIframe.allow = 'autoplay';
    // Dentro del player con height:0 — el navegador acepta autoplay porque
    // el elemento está en el DOM visible, no verdaderamente oculto.
    scIframe.style.cssText = 'width:100%;height:0;border:none;display:block;overflow:hidden;border-radius:10px;transition:height .3s;';
    const playerDiv = document.querySelector('.radio-player');
    if (playerDiv) playerDiv.appendChild(scIframe);
    else document.body.appendChild(scIframe);
    return scIframe;
  }

  function scBind() {
    scWidget = SC.Widget(scIframe);
    scWidget.bind(SC.Widget.Events.READY, () => {
      scReady = true;
      // Dar altura real al iframe para que el navegador permita el audio
      scIframe.style.height = '116px';
      if (!scFallbackMode) scWidget.play();
    });
    scWidget.bind(SC.Widget.Events.PLAY,  () => setPlayState(true));
    scWidget.bind(SC.Widget.Events.PAUSE, () => setPlayState(false));
    scWidget.bind(SC.Widget.Events.FINISH, () => {
      scIframe.style.height = '0px';
      if (!scFallbackMode) autoAdvance();
      else if (isShuffle) scShufflePlay();
      else scWidget.next();
    });
    scWidget.bind(SC.Widget.Events.PLAY_PROGRESS, data => {
      if (!data) return;
      const pos = data.currentPosition || 0, dur = data.duration || 1;
      if (fillEl)    fillEl.style.width = Math.min((pos / dur) * 100, 100) + '%';
      if (curTimeEl) curTimeEl.textContent = fmt(pos);
      if (durEl)     durEl.textContent     = fmt(dur);
      if (progWrap)  progWrap.style.display = '';
    });
    scWidget.bind(SC.Widget.Events.ERROR, () => {
      setTimeout(() => { if (!scFallbackMode) autoAdvance(); else scWidget.next(); }, 1000);
    });
    // En modo fallback SC playlist: sincronizar tracklist con la playlist SC
    if (scFallbackMode) {
      scWidget.bind(SC.Widget.Events.PLAY, () => {
        scWidget.getCurrentSoundIndex(idx => {
          scWidget.getSounds(sounds => {
            if (!sounds?.length) return;
            if (!playlist.length) {
              playlist = sounds.map(s => ({
                id: String(s.id), title: s.title,
                artist: s.user?.username || 'RAYVER',
                cover: s.artwork_url ? s.artwork_url.replace('large', 't300x300') : (s.user?.avatar_url || 'logo.jpg'),
                scUrl: s.permalink_url, durationMs: s.duration
              }));
              renderTracklist();
              if (counterEl) counterEl.textContent = `1 / ${playlist.length}`;
            }
            currentIdx = idx || 0;
            if (playlist[currentIdx]) updateTrackUI(playlist[currentIdx]);
            highlightTracklist(currentIdx);
          });
        });
      });
    }
  }

  function scPlayUrl(url) {
    ensureSCIframe();
    scFallbackMode = false;
    if (!scWidget) {
      // Primera carga: setear src e inicializar widget
      scIframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=true&hide_related=true&show_comments=false&show_reposts=false`;
      loadSCApi(() => scBind());
    } else {
      // Widget ya existe: recargar con nueva URL
      scReady = false;
      scIframe.style.height = '0px';
      scWidget.load(url, {
        auto_play: true,
        callback: () => {
          scReady = true;
          scIframe.style.height = '116px';
        }
      });
    }
  }

  function scPlayFallbackPlaylist() {
    scFallbackMode = true;
    const iframe = ensureSCIframe();
    iframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(SC_PLAYLIST_FALLBACK)}&color=%23a855f7&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&continuous_play=true`;
    loadSCApi(() => scBind());
  }

  function scShufflePlay() {
    let r = Math.floor(Math.random() * playlist.length);
    if (r === currentIdx) r = (r + 1) % playlist.length;
    if (scWidget && scReady) { scWidget.skip(r); scWidget.play(); }
  }

  // ── SPOTIFY ENGINE (embed visual) ─────────────────────────────
  function showSpotifyEmbed(track) {
    let wrap = $('radio-spotify-embed');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'radio-spotify-embed';
      wrap.style.cssText = 'padding:12px 0 4px;border-radius:12px;overflow:hidden;';
      const playerDiv = document.querySelector('.radio-player');
      if (playerDiv) playerDiv.appendChild(wrap);
    }
    const rawUrl = track.spotifyUrl || track.platforms?.spotify || '';
    if (rawUrl) {
      const embedUrl = rawUrl.replace('open.spotify.com/', 'open.spotify.com/embed/');
      wrap.innerHTML = `<iframe src="${esc(embedUrl)}" width="100%" height="152" frameborder="0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" style="border-radius:12px;display:block"></iframe>`;
      wrap.style.display = '';
    } else {
      wrap.style.display = 'none';
    }
  }
  function hideSpotifyEmbed() {
    const w = $('radio-spotify-embed');
    if (w) { w.style.display = 'none'; w.innerHTML = ''; }
  }

  // ── PLAYBACK ───────────────────────────────────────────────────
  function stopAll() {
    if (ytPlayer && ytReady) { try { ytPlayer.pauseVideo(); } catch(e) {} }
    ytStopProgress();
    if (scWidget && scReady) { try { scWidget.pause(); } catch(e) {} }
    if (scIframe) scIframe.style.height = '0px';
    hideSpotifyEmbed();
  }

  function playTrack(idx) {
    if (!playlist.length) return;
    currentIdx = ((idx % playlist.length) + playlist.length) % playlist.length;
    const t = playlist[currentIdx];
    if (!t) return;

    stopAll();
    updateTrackUI(t);
    highlightTracklist(currentIdx);
    document.getElementById('radio')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const plat = getBestPlatform(t);
    activePlat = plat;

    if (plat === 'youtube') {
      ytInitPlayer(t.youtubeId);
    } else if (plat === 'soundcloud') {
      scPlayUrl(t.scUrl);
    } else if (plat === 'spotify') {
      showSpotifyEmbed(t);
      setPlayState(true);
    } else {
      setPlayState(false);
    }
  }

  function togglePlay() {
    if (!activePlat) { if (playlist.length) playTrack(0); return; }
    if (activePlat === 'youtube') {
      if (!ytPlayer || !ytReady) return;
      isPlaying ? ytPlayer.pauseVideo() : ytPlayer.playVideo();
    } else if (activePlat === 'soundcloud') {
      if (!scWidget || !scReady) return;
      if (scFallbackMode) { isPlaying ? scWidget.pause() : scWidget.play(); }
      else { isPlaying ? scWidget.pause() : scWidget.play(); }
    } else if (activePlat === 'spotify') {
      setPlayState(!isPlaying);
    }
  }

  function autoAdvance() {
    if (repeatMode === 'one') { playTrack(currentIdx); return; }
    if (isShuffle) {
      let r = Math.floor(Math.random() * playlist.length);
      if (r === currentIdx && playlist.length > 1) r = (r + 1) % playlist.length;
      playTrack(r);
    } else if (repeatMode === 'all' || currentIdx < playlist.length - 1) {
      playTrack((currentIdx + 1) % playlist.length);
    } else {
      setPlayState(false);
    }
  }

  // ── UI ─────────────────────────────────────────────────────────
  const PLAT_META = {
    youtube:    { cls: 'ptag-youtube',    icon: 'fab fa-youtube',    label: 'YouTube' },
    soundcloud: { cls: 'ptag-soundcloud', icon: 'fab fa-soundcloud', label: 'SoundCloud' },
    spotify:    { cls: 'ptag-s',          icon: 'fab fa-spotify',    label: 'Spotify' },
  };

  function updateTrackUI(t) {
    if (titleEl)  titleEl.textContent  = t.title  || 'RAYVER Radio';
    if (artistEl) artistEl.textContent = t.artist || 'RAYVER';
    if (coverEl)  coverEl.src = t.cover || t.thumbnail || 'logo.jpg';
    if (counterEl) counterEl.textContent = `${currentIdx + 1} / ${playlist.length}`;

    // Genre · BPM · Key
    const meta = [t.genre, t.bpm ? t.bpm + ' BPM' : '', t.key].filter(Boolean).join(' · ');
    if (genreEl) genreEl.textContent = meta;

    // Platform tags
    if (platTagsEl) {
      const tags = [];
      if (t.youtubeId)                      tags.push(`<span class="radio-ptag ptag-youtube"><i class="fab fa-youtube"></i> YouTube</span>`);
      if (t.scUrl)                          tags.push(`<a href="${esc(t.scUrl)}" target="_blank" class="radio-ptag ptag-soundcloud"><i class="fab fa-soundcloud"></i> SoundCloud</a>`);
      const sp = t.spotifyUrl || t.platforms?.spotify;
      if (sp) tags.push(`<a href="${esc(sp)}" target="_blank" class="radio-ptag ptag-s"><i class="fab fa-spotify"></i> Spotify</a>`);
      platTagsEl.innerHTML = tags.join('');
    }

    if (fillEl)    fillEl.style.width = '0%';
    if (curTimeEl) curTimeEl.textContent = '0:00';
    if (durEl)     durEl.textContent     = '0:00';
  }

  function setPlayState(playing) {
    isPlaying = playing;
    if (playIcon)   playIcon.className = playing ? 'fas fa-pause' : 'fas fa-play';
    if (onairDot)   onairDot.classList.toggle('pulsing', playing);
    if (coverEl)    coverEl.classList.toggle('spinning', playing);
    if (coverPulse) coverPulse.classList.toggle('active', playing);
    // El SC iframe gestiona su propia altura en scBind / stopAll
  }

  // ── TRACKLIST ──────────────────────────────────────────────────
  function renderTracklist() {
    if (!tracklistBody || !playlist.length) return;
    tracklistBody.innerHTML = playlist.map((t, i) => {
      const plat = getBestPlatform(t);
      const pm   = plat ? PLAT_META[plat] : null;
      const meta = [t.genre, t.bpm ? t.bpm + ' BPM' : '', t.key].filter(Boolean).join(' · ');
      const platBadge = pm ? `<span class="rtitem-plat-badge ${pm.cls}"><i class="${pm.icon}"></i></span>` : '';
      return `
        <div class="radio-track-item${i === currentIdx ? ' active' : ''}" onclick="RADIO_PLAYER.play(${i})">
          <span class="rtitem-num">${i + 1}</span>
          <img class="rtitem-cover" src="${esc(t.cover || t.thumbnail || 'logo.jpg')}" alt="${esc(t.title)}" loading="lazy" onerror="this.src='logo.jpg'">
          <div class="rtitem-info">
            <div class="rtitem-title">${esc(t.title)}</div>
            <div class="rtitem-sub">${esc(t.artist || 'RAYVER')}${meta ? ' · <em>' + esc(meta) + '</em>' : ''}</div>
          </div>
          ${platBadge}
        </div>`;
    }).join('');
  }

  function highlightTracklist(idx) {
    if (!tracklistBody) return;
    tracklistBody.querySelectorAll('.radio-track-item').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
      if (i === idx) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  // ── REPEAT BUTTON (insert if missing) ─────────────────────────
  function addRepeatButton() {
    if ($('radio-repeat') || !nextBtn) return;
    const btn = document.createElement('button');
    btn.id        = 'radio-repeat';
    btn.className = 'radio-btn-sm';
    btn.title     = 'Repetir';
    btn.setAttribute('aria-label', 'Repetir');
    btn.innerHTML = '<i class="fas fa-redo"></i>';
    nextBtn.insertAdjacentElement('afterend', btn);
    btn.addEventListener('click', () => {
      const modes = ['none', 'one', 'all'];
      repeatMode  = modes[(modes.indexOf(repeatMode) + 1) % modes.length];
      btn.querySelector('i').className = repeatMode === 'one' ? 'fas fa-redo-alt' : 'fas fa-redo';
      btn.classList.toggle('active', repeatMode !== 'none');
      const labels = { none: 'Repetir', one: 'Repetir: este track', all: 'Repetir: todo' };
      btn.title = labels[repeatMode];
    });
  }

  // ── CONTROLS ───────────────────────────────────────────────────
  playBtn && playBtn.addEventListener('click', togglePlay);

  prevBtn && prevBtn.addEventListener('click', () => {
    if (scFallbackMode && scWidget && scReady) { scWidget.prev(); return; }
    if (!playlist.length) return;
    const idx = isShuffle
      ? Math.floor(Math.random() * playlist.length)
      : (currentIdx - 1 + playlist.length) % playlist.length;
    playTrack(idx);
  });

  nextBtn && nextBtn.addEventListener('click', () => {
    if (scFallbackMode && scWidget && scReady) { scWidget.next(); return; }
    if (!playlist.length) return;
    const idx = isShuffle
      ? Math.floor(Math.random() * playlist.length)
      : (currentIdx + 1) % playlist.length;
    playTrack(idx);
  });

  shuffleBtn && shuffleBtn.addEventListener('click', () => {
    isShuffle = !isShuffle;
    shuffleBtn.classList.toggle('active', isShuffle);
  });

  muteBtn && muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    const v = isMuted ? 0 : vol();
    if (ytPlayer && ytReady) ytPlayer.setVolume(v);
    if (scWidget && scReady) scWidget.setVolume(v);
    if (volIcon) volIcon.className = isMuted ? 'fas fa-volume-mute' : vol() < 50 ? 'fas fa-volume-down' : 'fas fa-volume-up';
  });

  volumeEl && volumeEl.addEventListener('input', () => {
    if (!isMuted) {
      if (ytPlayer && ytReady) ytPlayer.setVolume(vol());
      if (scWidget && scReady) scWidget.setVolume(vol());
    }
    if (volIcon) volIcon.className = vol() === 0 ? 'fas fa-volume-mute' : vol() < 50 ? 'fas fa-volume-down' : 'fas fa-volume-up';
  });

  progEl && progEl.addEventListener('click', e => {
    const rect = progEl.getBoundingClientRect();
    const pct  = (e.clientX - rect.left) / rect.width;
    if (activePlat === 'youtube' && ytPlayer && ytReady) {
      ytPlayer.seekTo(pct * ytPlayer.getDuration(), true);
    } else if (activePlat === 'soundcloud' && scWidget && scReady) {
      scWidget.getDuration(dur => scWidget.seekTo(pct * dur));
    }
  });

  // ── PUBLIC API ─────────────────────────────────────────────────
  window.RADIO_PLAYER = {
    play:           idx  => playTrack(idx),
    playById:       id   => { const i = playlist.findIndex(t => t.id === id); if (i >= 0) playTrack(i); },
    addAndPlay:     track => { playlist.push(track); playTrack(playlist.length - 1); },
    getPlaylist:    ()   => playlist,
    getCurrentIdx:  ()   => currentIdx,
    isPlaying:      ()   => isPlaying,
  };
  window.radioPlayIdx = idx => playTrack(idx);

  // ── INIT ───────────────────────────────────────────────────────
  async function init() {
    addRepeatButton();

    if (tracklistBody) tracklistBody.innerHTML = `<div class="radio-empty"><i class="fas fa-circle-notch fa-spin"></i><p>Cargando playlist…</p></div>`;
    if (titleEl)   titleEl.textContent   = 'RAYVER Radio';
    if (artistEl)  artistEl.textContent  = 'Pulsa ▶ para escuchar';
    if (counterEl) counterEl.textContent = '— / —';

    try {
      const r = await fetch('/api/public/tracks');
      if (r.ok) {
        const tracks = await r.json();
        if (tracks?.length) {
          playlist = tracks;
          renderTracklist();
          updateTrackUI(playlist[0]);
          if (counterEl) counterEl.textContent = `1 / ${playlist.length}`;
          return;
        }
      }
    } catch(e) { /* fall through */ }

    // Fallback: SC playlist completa
    scPlayFallbackPlaylist();
  }

  init();
})();
