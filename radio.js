/**
 * RAYVER RADIO v10
 * Una sola fuente de verdad: SC Widget.
 * scSounds[] = lo que SC tiene. tracks[] = enriquecido con API.
 * El header SIEMPRE muestra scSounds[currentIdx] — nunca se desincroniza.
 */
(function () {
  'use strict';

  // URL de todos los tracks públicos del artista — se actualiza automáticamente con cada subida
  const SC_PLAYLIST = 'https://soundcloud.com/biel-rivero-sampol/tracks';

  const GRADS = [
    'linear-gradient(135deg,#a855f7,#ec4899)',
    'linear-gradient(135deg,#6366f1,#a855f7)',
    'linear-gradient(135deg,#0ea5e9,#6366f1)',
    'linear-gradient(135deg,#10b981,#0ea5e9)',
    'linear-gradient(135deg,#f59e0b,#ef4444)',
    'linear-gradient(135deg,#ec4899,#f59e0b)',
    'linear-gradient(135deg,#8b5cf6,#06b6d4)',
  ];

  // ── STATE ────────────────────────────────────────────────────────
  let widget      = null;
  let widgetRdy   = false;
  let scSounds       = [];   // raw de getSounds() — fuente de verdad de SC
  let enriched       = [];   // scSounds + covers/links de la API
  let _masterEnriched = []; // backup del enriched completo (no se sobreescribe con cargas individuales)
  let apiTracks   = [];   // de /api/public/tracks
  let currentIdx  = 0;
  let playing     = false;
  let shuffle     = false;
  let repeat      = 'none';
  let muted       = false;
  let iframe      = null;
  let pendingPlay = false;
  let userPlayed  = false; // true cuando el usuario ha pulsado play explícitamente
  let customCurrentIdx = 0;
  let loopPlaylist = false;
  let _autoSkipCount = 0;
  let customPlaylistStarted = false;
  let widgetCustomMode = false; // true cuando el widget está cargado con un track custom (no SC_PLAYLIST)
  let youtubeActive = false;   // true cuando el track actual juega desde YouTube IFrame API
  let ytPlayer = null;         // instancia YT.Player
  let ytPlayerReady = false;   // true cuando el YT.Player está listo
  let ytPlayerDiv = null;      // contenedor del YT player
  let ytUsingFeatured = false; // true cuando ytPlayer está montado en #yt-player-mount
  let videoExpanded = false;   // true cuando el video está expandido en el top bar
  let ytProgressTimer = null;  // intervalo para barra de progreso YouTube
  let _prevPlaylistState = null; // estado guardado antes de un "Escuchar" del catálogo

  // ── AMBIENT AUDIO STATE ──────────────────────────────────────────
  let ambientAudioActive = false;  // true cuando el track actual es de Ambiente
  let ambProgressTimer   = null;   // intervalo para barra de progreso de Ambiente

  // ── BACKGROUND TAB KEEP-ALIVE ────────────────────────────────────
  // Runs a near-silent oscillator in an AudioContext so the browser never
  // throttles JS timers or SC Widget events when the tab is in the background.
  // Created once on first user play; never destroyed (re-creating needs user gesture).
  let _kaCtx       = null;
  let _kaSrc       = null;
  let _kaHeartbeat = null; // periodic resume if browser suspends the context

  // ── WATCHDOG: SC track-end safety net ────────────────────────────
  // The SC Widget sends FINISH via postMessage to the main frame.
  // If the browser throttles the main frame during the silence between tracks,
  // FINISH may never arrive. The watchdog checks wall-clock time independently
  // and forces track advance if the track should have ended but hasn't.
  let _wdProgress = null; // { pos, dur, ts } — updated on every PLAY_PROGRESS tick

  // ── AUTOMIX STATE ────────────────────────────────────────────────
  let automixEnabled     = false;
  let isCrossfading      = false;
  let crossfadeDuration  = 8000;  // ms fade-out al final del track
  let fadeInDuration     = 2000;  // ms fade-in al arrancar el siguiente
  let crossfadeOutTimer  = null;
  let crossfadeInTimer   = null;
  let iframePre          = null;  // iframe oculto para precargar el siguiente track
  let widgetPre          = null;  // SC.Widget del iframe de precarga
  let widgetPreRdy       = false;
  let preloadTriggered   = false; // evita doble preload por tick de PLAY_PROGRESS

  // ── DOM ──────────────────────────────────────────────────────────
  const $        = id => document.getElementById(id);
  const titleEl  = $('radio-title');
  const artistEl = $('radio-artist');
  const genreEl  = $('radio-genre');
  const tagsEl   = $('radio-platform-tags');
  const coverEl  = $('radio-cover');
  const cpulse   = $('radio-cover-pulse');
  const onair    = $('radio-onair-dot');
  const counter  = $('radio-counter');
  const listBody = $('radio-tracklist-body');
  const playBtn  = $('radio-play');
  const playIco  = $('radio-play-icon');
  const prevBtn  = $('radio-prev');
  const nextBtn  = $('radio-next');
  const shufBtn  = $('radio-shuffle');
  const muteBtn  = $('radio-mute');
  const volIco   = $('radio-vol-icon');
  const volEl    = $('radio-volume');
  const fillEl   = $('radio-progress-fill');
  const curEl    = $('radio-current-time');
  const durEl    = $('radio-duration');
  const progEl   = $('radio-progress');
  const audioEl  = $('radio-audio');
  if (audioEl) { audioEl.pause(); audioEl.src = ''; audioEl.style.display = 'none'; }

  // ── UP-PLAYER (unified fixed top bar) ───────────────────────────
  const upTitleEl  = $('up-title');
  const upArtistEl = $('up-artist');
  const upTagsEl   = $('up-tags');
  const upCoverEl  = $('up-cover');
  const upPlayIcon = $('up-play-icon');
  const upFillEl   = $('up-fill');
  const upCurEl    = $('up-cur');
  const upDurEl    = $('up-dur');
  const upVolIcon  = $('up-vol-icon');
  const upVolEl    = $('up-vol');
  const upProgress = $('up-progress');

  function _adjustUpLayout() {
    const up = $('up-player');
    const navbar = document.querySelector('.navbar');
    if (!up || !navbar) return;
    if (up.classList.contains('up-minimized')) {
      navbar.style.top = '32px';
    } else {
      navbar.style.top = up.offsetHeight + 'px';
    }
  }

  function _syncUp(title, artist, coverSrc, tags) {
    if (upTitleEl)  upTitleEl.textContent  = title  || 'RAYVER Radio';
    if (upArtistEl) upArtistEl.textContent = artist || '';
    if (upTagsEl)   upTagsEl.innerHTML     = tags   || '';
    if (upCoverEl)  upCoverEl.src = coverSrc || 'logo.jpg';
  }

  function _syncUpPlayState(p) {
    if (upPlayIcon) upPlayIcon.className = p ? 'fas fa-pause' : 'fas fa-play';
  }

  function _syncUpProgress(pos, dur) {
    const pct = dur > 0 ? Math.min((pos / dur) * 100, 100) : 0;
    if (upFillEl) upFillEl.style.width = pct + '%';
    if (upCurEl)  upCurEl.textContent  = fmt(pos);
    if (upDurEl)  upDurEl.textContent  = dur > 0 ? fmt(dur) : '—';
  }

  // ── UTILS ────────────────────────────────────────────────────────
  const fmt = ms => {
    if (!ms || isNaN(ms)) return '0:00';
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const esc = s => String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const vol = () => parseInt(volEl?.value ?? 80);

  // ── MAPEAR SOUND DE SC ───────────────────────────────────────────
  function mapSound(s, idx) {
    const art = s.artwork_url
      ? s.artwork_url.replace('-large','-t300x300').replace('large.jpg','t300x300.jpg')
      : null;
    return {
      scIdx:  idx,
      id:     String(s.id),
      title:  s.title  || '—',
      artist: s.user?.username || 'RAYVER',
      cover:  art || s.user?.avatar_url || null,
      scUrl:  s.permalink_url || '',
      durationMs: s.duration || 0,
    };
  }

  // ── ENRIQUECER CON API ───────────────────────────────────────────
  function norm(s) {
    return (s || '').toLowerCase()
      .replace(/\(.*?\)/g,'').replace(/\[.*?\]/g,'')
      .replace(/feat\..*$/i,'').replace(/ft\..*$/i,'')
      .replace(/[^a-z0-9]/g,'');
  }

  function buildEnriched() {
    enriched = scSounds.map((s, i) => {
      const base = mapSound(s, i);
      if (!apiTracks.length) return base;
      const nb = norm(base.title);
      const match = apiTracks.find(a => {
        if (a.scUrl && a.scUrl === base.scUrl) return true;
        const na = norm(a.title);
        return nb && na && nb === na;
      });
      if (!match) return base;
      return {
        ...base,
        cover:      match.cover     || base.cover,
        genre:      match.genre     || base.genre,
        bpm:        match.bpm       || base.bpm,
        key:        match.key       || base.key,
        spotifyUrl: match.spotifyUrl|| base.spotifyUrl,
        platforms:  match.platforms || base.platforms,
      };
    });
    // Guardar como master cuando es una lista completa (no un track individual cargado en modo custom)
    if (scSounds.length > 1) _masterEnriched = enriched.slice();
  }

  // ── UI DEL HEADER ────────────────────────────────────────────────
  function showTrack(idx) {
    // Siempre usa scSounds[idx] para título y artista (fuente de verdad SC)
    // y enriched[idx] para cover y links extra
    const sc = scSounds[idx];
    const en = enriched[idx];
    if (!sc) return;

    const title  = sc.title  || '—';
    const artist = sc.user?.username || 'RAYVER';
    const art    = sc.artwork_url
      ? sc.artwork_url.replace('-large','-t300x300').replace('large.jpg','t300x300.jpg')
      : null;
    const cover  = (en && en.cover) || art || sc.user?.avatar_url || null;

    if (titleEl)  titleEl.textContent  = title;
    if (artistEl) artistEl.textContent = artist;
    if (coverEl) {
      if (cover) {
        coverEl.src = cover;
        coverEl.onerror = () => { coverEl.style.display='none'; };
        coverEl.style.display = '';
      } else {
        coverEl.style.display = 'none';
      }
    }

    const meta = [en?.genre, en?.bpm ? en.bpm+' BPM' : '', en?.key].filter(Boolean).join(' · ');
    if (genreEl) genreEl.textContent = meta;

    if (tagsEl) {
      const tags = [];
      if (sc.permalink_url) tags.push(`<a href="${esc(sc.permalink_url)}" target="_blank" class="radio-ptag ptag-soundcloud"><i class="fab fa-soundcloud"></i> SoundCloud</a>`);
      const sp = (en && (en.spotifyUrl || en.platforms?.spotify)) || '';
      if (sp) tags.push(`<a href="${esc(sp)}" target="_blank" class="radio-ptag ptag-s"><i class="fab fa-spotify"></i> Spotify</a>`);
      tagsEl.innerHTML = tags.join('');
    }

    if (fillEl) fillEl.style.width = '0%';
    if (curEl)  curEl.textContent  = '0:00';
    if (durEl)  durEl.textContent  = fmt(sc.duration || 0);
    if (counter) counter.textContent = `${idx + 1} / ${scSounds.length}`;

    const upTags = [];
    if (sc.permalink_url) upTags.push(`<a href="${esc(sc.permalink_url)}" target="_blank" class="radio-ptag ptag-soundcloud"><i class="fab fa-soundcloud"></i></a>`);
    const sp = (en && (en.spotifyUrl || en.platforms?.spotify)) || '';
    if (sp) upTags.push(`<a href="${esc(sp)}" target="_blank" class="radio-ptag ptag-s"><i class="fab fa-spotify"></i></a>`);
    _syncUp(title, artist, cover || 'logo.jpg', upTags.join(''));
    _syncUpProgress(0, sc.duration || 0);
    _updateMediaSession(title, artist, cover);
  }

  // Actualiza el header del radio con datos de la lista personalizada (no SC)
  function showCustomTrack(idx) {
    const t = customTrackList[idx];
    if (!t) return;
    const isVideo = t.type === 'video';
    const apiT    = apiTracks.find(a =>
      String(a.id) === String(t.itemId || t.id) ||
      (t.url   && a.scUrl === t.url)   ||
      (t.scUrl && a.scUrl === t.scUrl)
    );

    if (titleEl)  titleEl.textContent  = t.title || '—';
    if (artistEl) artistEl.textContent = apiT?.artist || 'RAYVER';
    if (genreEl)  genreEl.textContent  = apiT?.genre  || '';

    const coverSrc = isVideo
      ? (t.itemId ? `https://img.youtube.com/vi/${t.itemId}/mqdefault.jpg` : null)
      : (t.cover || apiT?.cover || null);
    if (coverEl) {
      if (coverSrc) {
        coverEl.src = coverSrc;
        coverEl.onerror = () => { coverEl.style.display = 'none'; };
        coverEl.style.display = '';
      } else {
        coverEl.style.display = 'none';
      }
    }

    if (tagsEl) {
      const scUrl = t.scUrl || t.url || apiT?.scUrl || null;
      const ytId  = isVideo ? t.itemId : (t.videoId || apiT?.videoId || null);
      const spUrl = t.spotifyUrl || apiT?.spotifyUrl || null;
      const links = [];
      if (scUrl) links.push(`<a href="${esc(scUrl)}" target="_blank" class="radio-ptag ptag-soundcloud" title="Escuchar en SoundCloud"><i class="fab fa-soundcloud"></i></a>`);
      if (ytId)  links.push(`<a href="https://www.youtube.com/watch?v=${esc(ytId)}" target="_blank" class="radio-ptag" style="color:#ff4444" title="Ver en YouTube"><i class="fab fa-youtube"></i></a>`);
      if (spUrl) links.push(`<a href="${esc(spUrl)}" target="_blank" class="radio-ptag ptag-s" title="Escuchar en Spotify"><i class="fab fa-spotify"></i></a>`);
      tagsEl.innerHTML = links.join('');
    }

    if (fillEl)  fillEl.style.width = '0%';
    if (curEl)   curEl.textContent  = '0:00';
    if (durEl)   durEl.textContent  = '—';
    if (counter) counter.textContent = `${idx + 1} / ${customTrackList.length}`;

    const upLinks = [];
    const scUrl2 = t.scUrl || t.url || null;
    const ytId2  = isVideo ? t.itemId : (t.videoId || null);
    const spUrl2 = t.spotifyUrl || null;
    if (scUrl2) upLinks.push(`<a href="${esc(scUrl2)}" target="_blank" class="radio-ptag ptag-soundcloud"><i class="fab fa-soundcloud"></i></a>`);
    if (ytId2)  upLinks.push(`<a href="https://www.youtube.com/watch?v=${esc(ytId2)}" target="_blank" class="radio-ptag" style="color:#ff4444"><i class="fab fa-youtube"></i></a>`);
    if (spUrl2) upLinks.push(`<a href="${esc(spUrl2)}" target="_blank" class="radio-ptag ptag-s"><i class="fab fa-spotify"></i></a>`);
    _syncUp(t.title || '—', apiT?.artist || 'RAYVER', coverSrc || 'logo.jpg', upLinks.join(''));
    _syncUpProgress(0, 0);
    _updateMediaSession(t.title || '—', apiT?.artist || 'RAYVER', coverSrc);

    // Sincronizar sección Videos cuando el track activo es un vídeo de YouTube
    if (isVideo) {
      const fTitle = document.getElementById('yt-featured-title');
      const fDesc  = document.getElementById('yt-featured-desc');
      const fLink  = document.getElementById('yt-featured-link');
      const fThumb = document.getElementById('yt-featured-thumb');
      if (fTitle) fTitle.textContent = t.title || '—';
      if (fDesc)  fDesc.textContent  = '';
      if (fLink)  fLink.href = `https://www.youtube.com/watch?v=${esc(ytId2 || '')}`;
      if (fThumb) fThumb.src = coverSrc || `https://img.youtube.com/vi/${ytId2}/mqdefault.jpg`;
      // Resaltar card activa en #yt-grid
      document.querySelectorAll('.yt-card').forEach(c =>
        c.classList.toggle('yt-card-active', c.dataset.videoid === (ytId2 || ''))
      );
    }
  }

  // ── KEEP-ALIVE: prevent background tab throttling ────────────────
  function _startKeepAlive() {
    if (_kaCtx) {
      // Already exists — just wake it up if the browser suspended it
      if (_kaCtx.state === 'suspended') _kaCtx.resume().catch(() => {});
      return;
    }
    try {
      _kaCtx = new (window.AudioContext || window.webkitAudioContext)();
      // 1 Hz oscillator — inaudible but counts as "active audio" so Chrome
      // doesn't throttle JS timers or SC Widget postMessage events in background
      const osc = _kaCtx.createOscillator();
      osc.frequency.value = 1;
      const g = _kaCtx.createGain();
      g.gain.value = 0.001;
      osc.connect(g);
      g.connect(_kaCtx.destination);
      osc.start();
      _kaSrc = osc;
      // Heartbeat: Chrome can silently suspend an AudioContext in background tabs;
      // poll every 20 s and resume immediately if that happens
      _kaHeartbeat = setInterval(() => {
        if (_kaCtx?.state === 'suspended') _kaCtx.resume().catch(() => {});
      }, 20000);
    } catch(e) {}
  }

  function _stopKeepAlive() {
    // Intentional no-op: keep the AudioContext alive permanently after first play.
    // Closing it would require a new user gesture to re-create — not possible in background.
  }

  // ── MEDIA SESSION API ─────────────────────────────────────────────
  function _updateMediaSession(title, artist, artwork) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title:  title  || 'RAYVER Radio',
        artist: artist || 'RAYVER Music',
        album:  'RAYVER Music',
        artwork: artwork ? [{ src: artwork, sizes: '512x512', type: 'image/jpeg' }] : []
      });
      navigator.mediaSession.setActionHandler('play',          () => playBtn?.click());
      navigator.mediaSession.setActionHandler('pause',         () => playBtn?.click());
      navigator.mediaSession.setActionHandler('previoustrack', () => prevBtn?.click());
      navigator.mediaSession.setActionHandler('nexttrack',     () => nextBtn?.click());
    } catch(e) {}
  }

  function _syncMediaSessionState(state) {
    if (!('mediaSession' in navigator)) return;
    try { navigator.mediaSession.playbackState = state; } catch(e) {}
  }

  function setPlaying(p) {
    if (!p && playing) _wdPausedAt = Date.now(); // track when we last stopped
    playing = p;
    if (playIco) playIco.className = p ? 'fas fa-pause' : 'fas fa-play';
    if (onair)   onair.classList.toggle('pulsing', p);
    if (coverEl) coverEl.classList.toggle('spinning', p);
    if (cpulse)  cpulse.classList.toggle('active', p);
    _syncUpPlayState(p);
    if (p) { _startKeepAlive(); _syncMediaSessionState('playing'); }
    else   { _stopKeepAlive();  _syncMediaSessionState('paused'); }
  }

  // ── TRACKLIST ────────────────────────────────────────────────────
  function renderList() {
    if (!listBody) return;
    if (!scSounds.length) {
      listBody.innerHTML = `<div class="radio-empty"><i class="fas fa-circle-notch fa-spin"></i><p>Cargando…</p></div>`;
      return;
    }
    listBody.innerHTML = scSounds.map((s, i) => {
      const en    = enriched[i] || {};
      const art   = s.artwork_url
        ? s.artwork_url.replace('-large','-t300x300').replace('large.jpg','t300x300.jpg')
        : null;
      const cover = en.cover || art || s.user?.avatar_url || null;
      const init  = esc((s.title || '?')[0].toUpperCase());
      const grad  = GRADS[i % GRADS.length];
      const sp    = en.spotifyUrl || en.platforms?.spotify;
      const badge = sp
        ? `<span class="rtitem-plat-badge ptag-s"><i class="fab fa-spotify"></i></span>`
        : `<span class="rtitem-plat-badge ptag-soundcloud"><i class="fab fa-soundcloud"></i></span>`;
      const meta  = [en.genre, en.bpm ? en.bpm+' BPM' : '', en.key].filter(Boolean).join(' · ');

      const coverHtml = cover
        ? `<img class="rtitem-cover" src="${esc(cover)}" alt="${esc(s.title)}" loading="lazy"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
          + `<span class="rtitem-cover rtitem-cover-grad" style="display:none;background:${grad}">${init}</span>`
        : `<span class="rtitem-cover rtitem-cover-grad" style="background:${grad}">${init}</span>`;

      return `
        <div class="radio-track-item${i === currentIdx ? ' active' : ''}" onclick="RADIO_PLAYER.skip(${i})">
          <span class="rtitem-num">${i + 1}</span>
          ${coverHtml}
          <div class="rtitem-info">
            <div class="rtitem-title">${esc(s.title || '—')}</div>
            <div class="rtitem-sub">${esc(s.user?.username || 'RAYVER')}${meta ? ' · <em>'+esc(meta)+'</em>' : ''}</div>
          </div>
          ${badge}
        </div>`;
    }).join('');
  }

  function highlight(idx) {
    if (!listBody) return;
    listBody.querySelectorAll('.radio-track-item').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
      if (i === idx) el.scrollIntoView({ behavior:'smooth', block:'nearest' });
    });
  }

  // ── AUTOMIX HELPERS ──────────────────────────────────────────────
  function getNextCustomIdx() {
    const next = customCurrentIdx + 1;
    if (next < customTrackList.length) return next;
    return loopPlaylist ? 0 : -1;
  }

  function getScUrlForCustomTrack(t) {
    if (!t || t.type === 'video') return null;
    let url = t.scUrl || t.url || null; // 'url' es el campo en playlists de usuario
    if (!url && t.itemId) url = apiTracks.find(a => String(a.id) === String(t.itemId))?.scUrl || null;
    if (!url) {
      const lookupList = _masterEnriched.length ? _masterEnriched : enriched;
      const nt = norm(t.title);
      const found = nt ? lookupList.find(e => norm(e.title) === nt) : null;
      if (found?.scUrl) url = found.scUrl;
    }
    if (!url) {
      const slug = (t.title || '').toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      url = SC_PLAYLIST.replace(/\/(tracks|sets\/.*)$/, '') + '/' + slug;
    }
    return url;
  }

  function createPreloadWidget() {
    if (iframePre) return;
    iframePre = document.createElement('iframe');
    iframePre.id    = 'sc-radio-preload';
    iframePre.allow = 'autoplay';
    // Oculto pero en el DOM para que el navegador cargue y cachee el audio en RAM
    iframePre.style.cssText = 'position:fixed;width:1px;height:1px;bottom:-2px;left:-2px;opacity:0;pointer-events:none;';
    iframePre.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(SC_PLAYLIST)}&auto_play=false&hide_related=true&show_comments=false`;
    document.body.appendChild(iframePre);
    widgetPre = SC.Widget(iframePre);
    widgetPre.bind(SC.Widget.Events.READY, () => { widgetPreRdy = true; widgetPre.setVolume(0); });
    widgetPre.bind(SC.Widget.Events.ERROR, () => {}); // silencio — preload best-effort
  }

  function doPreloadNext() {
    if (!widgetPreRdy || preloadTriggered) return;
    const nextIdx = getNextCustomIdx();
    if (nextIdx < 0) return;
    const url = getScUrlForCustomTrack(customTrackList[nextIdx]);
    if (!url) return;
    preloadTriggered = true;
    widgetPre.setVolume(0);
    // Cargar sin reproducir → el navegador descarga y cachea el audio en RAM
    widgetPre.load(url, { auto_play: false, hide_related: true, show_comments: false });
  }

  function stopCrossfade() {
    if (crossfadeOutTimer) { clearInterval(crossfadeOutTimer); crossfadeOutTimer = null; }
    if (crossfadeInTimer)  { clearInterval(crossfadeInTimer);  crossfadeInTimer  = null; }
    isCrossfading    = false;
    preloadTriggered = false;
    if (widget && widgetRdy && !muted) widget.setVolume(vol());
  }

  function startFadeOut() {
    if (isCrossfading) return;
    isCrossfading = true;
    const startVol  = muted ? 0 : vol();
    const startTime = Date.now();
    crossfadeOutTimer = setInterval(() => {
      if (muted) return;
      const p = Math.min((Date.now() - startTime) / crossfadeDuration, 1);
      widget.setVolume(Math.round(startVol * (1 - p)));
      if (p >= 1) { clearInterval(crossfadeOutTimer); crossfadeOutTimer = null; }
    }, 80);
  }

  function startFadeIn() {
    const targetVol = muted ? 0 : vol();
    widget.setVolume(0);
    const startTime = Date.now();
    crossfadeInTimer = setInterval(() => {
      if (muted) { clearInterval(crossfadeInTimer); crossfadeInTimer = null; return; }
      const p = Math.min((Date.now() - startTime) / fadeInDuration, 1);
      widget.setVolume(Math.round(targetVol * p));
      if (p >= 1) {
        clearInterval(crossfadeInTimer); crossfadeInTimer = null;
        isCrossfading = false; preloadTriggered = false;
      }
    }, 80);
  }

  function addAutomixBtn() {
    if ($('radio-automix')) return;
    const anchor = $('radio-repeat') || nextBtn;
    if (!anchor) return;
    const btn = document.createElement('button');
    btn.id        = 'radio-automix';
    btn.className = 'radio-btn-sm';
    btn.title     = 'Automix OFF — mezcla automática entre tracks';
    btn.innerHTML = '<i class="fas fa-magic"></i> MIX';
    btn.style.cssText = 'font-size:10px;display:inline-flex;align-items:center;gap:3px;';
    anchor.insertAdjacentElement('afterend', btn);
    btn.addEventListener('click', () => {
      // Automix only works in custom playlists (not RAYVER Radio SC Widget mode)
      if (activeRadioPlaylist === null) {
        btn.title = 'Activa una lista personal para usar Automix';
        btn.classList.add('mix-unavail');
        setTimeout(() => { btn.classList.remove('mix-unavail'); btn.title = automixEnabled ? 'Automix ON — click para desactivar' : 'Automix OFF — mezcla automática entre tracks'; }, 2000);
        return;
      }
      automixEnabled = !automixEnabled;
      btn.classList.toggle('active', automixEnabled);
      btn.title = automixEnabled ? 'Automix ON — click para desactivar' : 'Automix OFF — mezcla automática entre tracks';
      if (automixEnabled) {
        createPreloadWidget();
        stopCrossfade();
      } else {
        stopCrossfade();
      }
    });
  }

  // Called when playlist mode changes — sync MIX button state
  function _syncAutomixBtn() {
    const btn = $('radio-automix');
    if (!btn) return;
    const inCustom = activeRadioPlaylist !== null;
    btn.style.opacity = inCustom ? '' : '0.4';
    btn.title = !inCustom
      ? 'Automix — activa una lista personal para usarlo'
      : (automixEnabled ? 'Automix ON — click para desactivar' : 'Automix OFF — mezcla automática entre tracks');
  }

  // ── SC WIDGET ────────────────────────────────────────────────────
  function createIframe() {
    iframe = $('sc-radio-iframe') || document.createElement('iframe');
    iframe.id    = 'sc-radio-iframe';
    iframe.allow = 'autoplay';
    iframe.style.cssText = 'width:100%;height:0;border:none;display:block;overflow:hidden;border-radius:10px;transition:height .3s;';
    iframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(SC_PLAYLIST)}`
      + `&color=%23a855f7&auto_play=false&hide_related=true`
      + `&show_comments=false&show_user=true&show_reposts=false`
      + `&show_teaser=false&continuous_play=true`;
    const playerDiv = document.querySelector('.radio-player');
    if (playerDiv && !iframe.parentNode) playerDiv.appendChild(iframe);
    else if (!iframe.parentNode) document.body.appendChild(iframe);
  }

  // ── YOUTUBE IFRAME API ──────────────────────────────────────────────
  function _ytStateChange(e) {
    if (!youtubeActive) return;
    if (e.data === 1) {        // PLAYING
      setPlaying(true);
      startYtProgress();
    } else if (e.data === 2) { // PAUSED
      setPlaying(false);
      stopYtProgress();
    } else if (e.data === 0) { // ENDED
      stopYtProgress();
      youtubeActive = false;
      if (activeRadioPlaylist !== null) {
        const next = shuffle ? _nextCustomIdx() : customCurrentIdx + 1;
        if (customTrackList[next]) setTimeout(() => window.playCustomTrack(next), 400);
        else if (loopPlaylist)     setTimeout(() => window.playCustomTrack(0), 400);
        else if (!_restorePrevState()) setPlaying(false);
      }
    }
  }

  function getYtPlayerDiv() {
    if (ytPlayerDiv) return ytPlayerDiv;
    ytPlayerDiv = document.createElement('div');
    ytPlayerDiv.id = 'yt-radio-player';
    ytPlayerDiv.style.cssText = 'width:100%;height:0;overflow:hidden;border-radius:10px;transition:height .3s;';
    const playerDiv = document.querySelector('.radio-player');
    if (playerDiv) playerDiv.appendChild(ytPlayerDiv);
    return ytPlayerDiv;
  }

  function loadYtApiScript(cb) {
    if (window.YT?.Player) { cb(); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function() { if (prev) prev(); cb(); };
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    }
  }

  function initYtPlayer(videoId) {
    // Si el player ya existe, solo cambia el video
    if (ytPlayer) {
      try {
        ytPlayer.loadVideoById(videoId);
        if (!ytUsingFeatured) {
          if (ytPlayerDiv) ytPlayerDiv.style.height = '116px';
        } else {
          _showFeaturedPlayer();
        }
      } catch(_) {}
      return;
    }

    const events = { onReady: () => { ytPlayerReady = true; }, onStateChange: _ytStateChange };

    // Intentar montar en la sección Videos (#yt-player-mount)
    const mount = document.getElementById('yt-player-mount');
    if (mount) {
      ytUsingFeatured = true;
      mount.innerHTML = '<div id="yt-video-inner"></div>';
      ytPlayerDiv = mount;
      ytPlayer = new YT.Player('yt-video-inner', {
        height: '100%', width: '100%', videoId,
        playerVars: { autoplay: 1, controls: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, origin: location.origin },
        events: { ...events, onReady: () => { ytPlayerReady = true; } },
      });
      _showFeaturedPlayer();
      return;
    }

    // Fallback: crear dentro del radio card
    const div = getYtPlayerDiv();
    div.innerHTML = '<div id="yt-radio-inner"></div>';
    div.style.height = '116px';
    ytPlayer = new YT.Player('yt-radio-inner', {
      height: '116', width: '100%', videoId,
      playerVars: { autoplay: 1, controls: 1, rel: 0, modestbranding: 1, iv_load_policy: 3 },
      events,
    });
  }

  function _showFeaturedPlayer() {
    const thumbWrap = document.getElementById('yt-featured-thumb-wrap');
    const mount     = document.getElementById('yt-player-mount');
    if (thumbWrap) thumbWrap.style.display = 'none';
    if (mount)     mount.style.display     = '';
  }

  function _moveYtToTopBar() {
    const mount = document.getElementById('yt-player-mount');
    const videoArea = document.getElementById('up-video-area');
    if (!mount || !videoArea) return;
    videoArea.appendChild(mount);
    const thumbWrap = document.getElementById('yt-featured-thumb-wrap');
    if (thumbWrap) thumbWrap.style.display = '';
  }

  function _moveYtToSection() {
    const mount = document.getElementById('yt-player-mount');
    const featuredWrap = document.getElementById('yt-featured-player-wrap');
    if (!mount || !featuredWrap) return;
    featuredWrap.appendChild(mount);
    if (youtubeActive) {
      const thumbWrap = document.getElementById('yt-featured-thumb-wrap');
      if (thumbWrap) thumbWrap.style.display = 'none';
    }
  }

  window._toggleUpVideo = function() {
    const player = $('up-player');
    if (!player) return;
    videoExpanded = !videoExpanded;
    player.classList.toggle('up-video-open', videoExpanded);
    if (videoExpanded) _moveYtToTopBar();
    else _moveYtToSection();
    // Use rAF so the transition height is already applied before measuring
    requestAnimationFrame(_adjustUpLayout);
  };

  function _setVideoMode(active) {
    const btn = $('up-video-btn');
    if (btn) btn.style.display = active ? '' : 'none';
    if (!active && videoExpanded) {
      const player = $('up-player');
      if (player) player.classList.remove('up-video-open');
      videoExpanded = false;
      _moveYtToSection();
      _adjustUpLayout();
    }
  }

  window._upVideoFullscreen = function() {
    const videoArea = document.getElementById('up-video-area');
    if (!videoArea) return;
    const el = videoArea.querySelector('iframe') || videoArea;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
    if (req) req.call(el);
  };

  function _resetFeaturedPlaceholder(videoId, title) {
    const thumbWrap = document.getElementById('yt-featured-thumb-wrap');
    const thumb     = document.getElementById('yt-featured-thumb');
    const mount     = document.getElementById('yt-player-mount');
    if (thumbWrap) thumbWrap.style.display = '';
    if (mount)     mount.style.display     = 'none';
    if (thumb && videoId) thumb.src = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
  }

  // ── RESTAURAR ESTADO PREVIO tras un "Escuchar" del catálogo ────────
  function _restorePrevState() {
    if (!_prevPlaylistState) return false;
    const prev = _prevPlaylistState;
    _prevPlaylistState = null;
    stopCrossfade();

    const nameEl  = document.getElementById('radio-pl-name');
    const loopBtn = document.getElementById('radio-loop-btn');

    if (prev.mode === 'radio') {
      // Volver a RAYVER Radio y reanudar desde donde estaba
      activeRadioPlaylist = null;
      customTrackList = [];
      if (nameEl)  nameEl.textContent    = 'RAYVER Radio';
      if (loopBtn) loopBtn.style.display = 'none';
      renderList(); highlight(prev.scIdx); showTrack(prev.scIdx);
      userPlayed = true; currentIdx = prev.scIdx;
      widget.skip(prev.scIdx); widget.play();
      iframe.style.height = '116px';
    } else {
      // Volver a la lista personalizada y continuar con el siguiente track
      activeRadioPlaylist = prev.playlist;
      customTrackList     = prev.list;
      customCurrentIdx    = prev.idx;
      customPlaylistStarted = false;
      const pl = (window.userPlaylists || []).find(p => p.id === prev.playlist);
      if (nameEl) nameEl.textContent = pl?.name || (prev.playlist === '__default__' ? 'RAYVER Radio' : 'Lista');
      if (loopBtn) loopBtn.style.display = '';
      renderCustomTracklist(prev.list);
      const nextIdx = prev.idx + 1;
      if (nextIdx < prev.list.length) {
        setTimeout(() => window.playCustomTrack(nextIdx), 400);
      } else if (prev.loop) {
        setTimeout(() => window.playCustomTrack(0), 400);
      } else {
        showCustomTrack(0);
        setPlaying(false);
      }
    }
    return true;
  }

  function startYtProgress() {
    stopYtProgress();
    ytProgressTimer = setInterval(() => {
      if (!youtubeActive || !ytPlayer?.getCurrentTime) return;
      try {
        const pos = ytPlayer.getCurrentTime() * 1000;
        const dur = ytPlayer.getDuration()  * 1000;
        if (dur > 0) {
          if (fillEl) fillEl.style.width = Math.min((pos / dur) * 100, 100) + '%';
          if (curEl)  curEl.textContent  = fmt(pos);
          if (durEl)  durEl.textContent  = fmt(dur);
          _syncUpProgress(pos, dur);
        }
      } catch (_) {}
    }, 500);
  }

  function stopYtProgress() {
    if (ytProgressTimer) { clearInterval(ytProgressTimer); ytProgressTimer = null; }
  }

  // ── AMBIENT AUDIO HELPERS ────────────────────────────────────────
  function _stopAmbientProgress() {
    if (ambProgressTimer) { clearInterval(ambProgressTimer); ambProgressTimer = null; }
  }

  function _stopAmbientAudio() {
    ambientAudioActive = false;
    _stopAmbientProgress();
    if (audioEl) { audioEl.pause(); audioEl.src = ''; }
  }

  function _startAmbientProgress() {
    _stopAmbientProgress();
    if (!audioEl) return;
    ambProgressTimer = setInterval(() => {
      if (!ambientAudioActive || !audioEl) return;
      const pos = (audioEl.currentTime || 0) * 1000;
      const dur = (audioEl.duration   || 0) * 1000;
      if (dur > 0) {
        if (fillEl) fillEl.style.width = Math.min((pos / dur) * 100, 100) + '%';
        if (curEl)  curEl.textContent  = fmt(pos);
        if (durEl)  durEl.textContent  = fmt(dur);
        _syncUpProgress(pos, dur);
      }
    }, 500);
  }

  // Bind native audioEl events for ambient playback
  if (audioEl) {
    audioEl.addEventListener('play',  () => { if (ambientAudioActive) setPlaying(true);  });
    audioEl.addEventListener('pause', () => { if (ambientAudioActive) setPlaying(false); });
    audioEl.addEventListener('ended', () => {
      if (!ambientAudioActive) return;
      _stopAmbientAudio();
      setPlaying(false);
      if (activeRadioPlaylist !== null) {
        const next = _nextCustomIdx();
        const within = shuffle ? true : next < customTrackList.length;
        if (within && customTrackList[next]) {
          window.playCustomTrack(next);
        } else if (loopPlaylist || shuffle) {
          window.playCustomTrack(shuffle ? _nextCustomIdx() : 0);
        } else {
          if (!_restorePrevState()) { stopCrossfade(); setPlaying(false); }
        }
      }
    });
    audioEl.addEventListener('error', () => {
      if (!ambientAudioActive) return;
      _stopAmbientAudio();
      setPlaying(false);
      const t = customTrackList[customCurrentIdx];
      if (t) showUnavailable(t);
    });
    audioEl.addEventListener('durationchange', () => {
      if (!ambientAudioActive || !audioEl?.duration) return;
      if (durEl) durEl.textContent = fmt(audioEl.duration * 1000);
      _syncUpProgress((audioEl.currentTime || 0) * 1000, audioEl.duration * 1000);
    });
  }

  function playYoutubeTrack(videoId, title) {
    _autoSkipCount = 0;
    window._pendingYtFallback = null;
    youtubeActive = true;
    widget.pause();
    iframe.style.height = '0px';
    customPlaylistStarted = true;
    userPlayed = true;
    setPlaying(true);
    _setVideoMode(true);
    loadYtApiScript(() => initYtPlayer(videoId));
  }

  // Muestra un aviso de "no disponible en radio" o salta al siguiente track
  function showUnavailable(t) {
    const apiTrack = apiTracks.find(a => String(a.id) === String(t.itemId || t.id));
    const spotifyUrl = apiTrack?.spotifyUrl || t.spotifyUrl || null;

    // Auto-skip al siguiente track; protección contra loop infinito si todos son Spotify-only
    if (_autoSkipCount < customTrackList.length) {
      const nextIdx = _nextCustomIdx();
      const target  = nextIdx < customTrackList.length ? nextIdx : (loopPlaylist ? 0 : -1);
      if (target >= 0) {
        _autoSkipCount++;
        setTimeout(() => window.playCustomTrack(target), 200);
        return;
      }
    }

    _autoSkipCount = 0;
    customPlaylistStarted = true;
    setPlaying(false);
    if (artistEl) artistEl.innerHTML = spotifyUrl
      ? `<a href="${esc(spotifyUrl)}" target="_blank" class="radio-ptag ptag-s" style="font-size:12px"><i class="fab fa-spotify"></i> Escuchar en Spotify</a>`
      : '<span style="opacity:.5;font-size:12px">No disponible en radio</span>';
  }

  function stopYoutube() {
    youtubeActive = false;
    stopYtProgress();
    if (ytPlayer?.pauseVideo) try { ytPlayer.pauseVideo(); } catch(_) {}
    if (ytPlayerDiv && !ytUsingFeatured) ytPlayerDiv.style.height = '0px';
    _setVideoMode(false);
  }

  function bindWidget() {
    widget = SC.Widget(iframe);

    function loadSounds(onDone) {
      widget.getSounds(sounds => {
        if (!sounds?.length) return;
        scSounds = sounds;
        buildEnriched();
        // Solo actualizar la lista visual cuando estamos en modo SC Widget puro
        if (activeRadioPlaylist === null) {
          renderList();
          if (counter) counter.textContent = `— / ${scSounds.length}`;
          if (!playing) showTrack(0);
        }
        if (pendingPlay) {
          pendingPlay = false;
          // En modo custom: reproducir el track de la lista personalizada, NO el de SC Widget
          if (activeRadioPlaylist !== null && customTrackList.length) window.playCustomTrack(customCurrentIdx);
          else widget.play();
        }
        if (onDone) onDone();
      });
    }

    widget.bind(SC.Widget.Events.READY, () => {
      widgetRdy = true;
      // Solo mostrar SC si no hay lista personalizada activa
      if (activeRadioPlaylist === null) iframe.style.height = '116px';
      widget.setVolume(muted ? 0 : vol());
      loadSounds();
    });

    widget.bind(SC.Widget.Events.PLAY, () => {
      _wdProgress = null; // new track started — reset watchdog
      window._pendingYtFallback = null;
      if (youtubeActive) stopYoutube();
      setPlaying(true);
      // Ignorar PLAY automático del widget (antes de que el usuario pulse play)
      if (!userPlayed) return;
      // Solo expandir el SC iframe en modo RAYVER Radio, no en listas personalizadas
      if (activeRadioPlaylist === null) iframe.style.height = '116px';
      widget.getCurrentSoundIndex(idx => {
        if (typeof idx !== 'number') return;
        currentIdx = idx;
        // Tracker: registrar reproducción
        const playTitle = activeRadioPlaylist !== null
          ? (customTrackList[customCurrentIdx]?.title || '')
          : (scSounds[idx]?.title || '');
        if (playTitle) window.TRACKER?.onTrackPlay(playTitle, activeRadioPlaylist ? 'custom' : 'radio');
        // Si hay lista personalizada activa, no sobrescribir el header con datos de SC
        if (activeRadioPlaylist !== null) return;
        if (!scSounds[idx]?.title) {
          loadSounds(() => { showTrack(idx); highlight(idx); });
        } else {
          showTrack(idx);
          highlight(idx);
        }
        if (counter) counter.textContent = `${idx + 1} / ${scSounds.length}`;
      });
    });

    widget.bind(SC.Widget.Events.PAUSE, () => {
      setPlaying(false);
      // Tracker: pausa (aproximación de % escuchado via fillEl)
      const pct = parseFloat(fillEl?.style.width) || 0;
      const title = activeRadioPlaylist !== null
        ? (customTrackList[customCurrentIdx]?.title || '')
        : (scSounds[currentIdx]?.title || '');
      if (title) window.TRACKER?.onTrackPause(title, pct);
    });

    widget.bind(SC.Widget.Events.FINISH, () => {
      _wdProgress = null;
      // Ignore SC Widget FINISH if ambient audio is active — the widget was running
      // in the hidden iframe from the previous track and its FINISH must not skip the playlist.
      if (ambientAudioActive) return;
      // In background: switch to native SC auto_play instead of sending more
      // postMessages that the throttled iframe won't process in time
      if (document.hidden && !_bgContinuousMode) { _bgContinuousPlay(); return; }
      if (_bgContinuousMode) return; // SC Widget self-managing, don't interfere
      iframe.style.height = '0px';
      if (fillEl) fillEl.style.width = '0%';
      if (curEl) curEl.textContent = '0:00';
      // Tracker: track terminado
      const finTitle = activeRadioPlaylist !== null
        ? (customTrackList[customCurrentIdx]?.title || '')
        : (scSounds[currentIdx]?.title || '');
      if (finTitle) window.TRACKER?.onTrackFinish(finTitle);
      // Modo lista personalizada: avanzar al siguiente track de la lista
      if (activeRadioPlaylist !== null) {
        const next = _nextCustomIdx();
        const withinBounds = shuffle ? true : next < customTrackList.length;
        if (withinBounds && customTrackList[next]) {
          if (automixEnabled) {
            // Clear crossfade state WITHOUT restoring volume — fade-out already zeroed it.
            // If stopCrossfade() ran here it would flash vol to max then immediately back to 0.
            if (crossfadeOutTimer) { clearInterval(crossfadeOutTimer); crossfadeOutTimer = null; }
            if (crossfadeInTimer)  { clearInterval(crossfadeInTimer);  crossfadeInTimer  = null; }
            isCrossfading = false; preloadTriggered = false;
            window.playCustomTrack(next);
            startFadeIn();
          } else {
            // Immediate advance — no setTimeout delay so Chrome can't throttle the gap
            window.playCustomTrack(next);
          }
        } else if (loopPlaylist || shuffle) {
          const loopIdx = shuffle ? _nextCustomIdx() : 0;
          if (automixEnabled) {
            if (crossfadeOutTimer) { clearInterval(crossfadeOutTimer); crossfadeOutTimer = null; }
            if (crossfadeInTimer)  { clearInterval(crossfadeInTimer);  crossfadeInTimer  = null; }
            isCrossfading = false; preloadTriggered = false;
            window.playCustomTrack(loopIdx);
            startFadeIn();
          } else {
            window.playCustomTrack(loopIdx); // immediate
          }
        } else {
          // Fin de lista — intentar restaurar estado previo (tras "Escuchar")
          if (!_restorePrevState()) { stopCrossfade(); setPlaying(false); }
        }
        return;
      }
      if (repeat === 'one')      { widget.seekTo(0); widget.play(); }
      else if (shuffle)          { doShuffle(); }
      else if (repeat === 'all') { widget.next(); }
      else                       { widget.next(); } // always continue in radio mode
    });

    widget.bind(SC.Widget.Events.PLAY_PROGRESS, d => {
      if (!d) return;
      const pos = d.currentPosition || 0, dur = d.duration || 1;
      if (fillEl) fillEl.style.width = Math.min((pos/dur)*100, 100) + '%';
      if (curEl)  curEl.textContent  = fmt(pos);
      if (durEl)  durEl.textContent  = fmt(dur);
      _syncUpProgress(pos, dur);
      // Watchdog: snapshot of current position + wall-clock time so we can detect
      // a stalled track even if FINISH never arrives (background tab throttle)
      if (dur > 5000) _wdProgress = { pos, dur, ts: Date.now() };

      // AUTOMIX: solo en modo lista personalizada con SC (no YouTube)
      if (automixEnabled && activeRadioPlaylist !== null && !youtubeActive && dur > 5000) {
        const remaining = dur - pos;
        if (getNextCustomIdx() >= 0) {
          // Precargar en RAM cuando quedan (crossfadeDuration + 4s)
          if (remaining < crossfadeDuration + 4000) doPreloadNext();
          // Iniciar fade-out cuando quedan crossfadeDuration ms
          if (remaining < crossfadeDuration && remaining > 0) startFadeOut();
        }
      }
    });

    widget.bind(SC.Widget.Events.ERROR, () => {
      if (activeRadioPlaylist !== null) {
        const ytId = window._pendingYtFallback;
        window._pendingYtFallback = null;
        if (ytId) {
          const t = customTrackList[customCurrentIdx];
          playYoutubeTrack(ytId, t?.title || '');
        } else {
          // Sin SC ni YouTube → mostrar link Spotify y dejar al usuario decidir
          const t = customTrackList[customCurrentIdx];
          if (t) showUnavailable(t);
        }
      } else {
        setTimeout(() => widget.next(), 1500);
      }
    });
  }

  function doShuffle() {
    let r = Math.floor(Math.random() * scSounds.length);
    if (r === currentIdx && scSounds.length > 1) r = (r+1) % scSounds.length;
    userPlayed = true;
    widget.skip(r); // SC Widget API: skip() selects AND plays — no separate play() needed
  }

  // Calcula el siguiente índice en la playlist personalizada respetando shuffle
  function _nextCustomIdx() {
    if (shuffle && customTrackList.length > 1) {
      let r = Math.floor(Math.random() * customTrackList.length);
      if (r === customCurrentIdx) r = (r + 1) % customTrackList.length;
      return r;
    }
    return customCurrentIdx + 1; // secuencial por defecto
  }

  // ── REPEAT BTN ───────────────────────────────────────────────────
  function addRepeatBtn() {
    if ($('radio-repeat') || !nextBtn) return;
    const btn = document.createElement('button');
    btn.id = 'radio-repeat'; btn.className = 'radio-btn-sm'; btn.title = 'Repetir';
    btn.innerHTML = '<i class="fas fa-redo"></i>';
    nextBtn.insertAdjacentElement('afterend', btn);
    btn.addEventListener('click', () => {
      const m = ['none','one','all'];
      repeat = m[(m.indexOf(repeat)+1) % m.length];
      btn.querySelector('i').className = repeat==='one' ? 'fas fa-redo-alt' : 'fas fa-redo';
      btn.classList.toggle('active', repeat !== 'none');
      btn.title = {none:'Repetir',one:'Repetir este',all:'Repetir todo'}[repeat];
    });
  }

  // ── CONTROLS ─────────────────────────────────────────────────────
  playBtn && playBtn.addEventListener('click', () => {
    if (!widgetRdy) { pendingPlay = true; return; }
    userPlayed = true;

    if (activeRadioPlaylist !== null && customTrackList.length > 0) {
      if (!customPlaylistStarted) {
        window.playCustomTrack(customCurrentIdx);
      } else if (playing) {
        if (youtubeActive) {
          try { ytPlayer?.pauseVideo(); } catch(_) {}
        } else if (ambientAudioActive) {
          audioEl?.pause();
        } else {
          widget.pause();
          iframe.style.height = '0px';
          setPlaying(false);
        }
      } else {
        if (youtubeActive) {
          if (!ytUsingFeatured && ytPlayerDiv) ytPlayerDiv.style.height = '116px';
          if (ytUsingFeatured) _showFeaturedPlayer();
          try { ytPlayer?.playVideo(); } catch(_) {}
        } else if (ambientAudioActive) {
          audioEl?.play().catch(() => {});
        } else {
          widget.play();
          // SC widget permanece oculto en modo lista personalizada
        }
      }
      return;
    }

    // Modo RAYVER Radio normal
    if (playing) {
      widget.pause();
      iframe.style.height = '0px';
    } else {
      widget.play();
      iframe.style.height = '116px';
    }
  });

  prevBtn && prevBtn.addEventListener('click', () => {
    if (!widgetRdy) return;
    userPlayed = true;
    if (activeRadioPlaylist !== null && customTrackList.length > 0) {
      const prev = customCurrentIdx - 1;
      if (prev >= 0) window.playCustomTrack(prev);
      else if (loopPlaylist) window.playCustomTrack(customTrackList.length - 1);
      return;
    }
    if (shuffle) doShuffle(); else widget.prev();
  });

  nextBtn && nextBtn.addEventListener('click', () => {
    if (!widgetRdy) return;
    userPlayed = true;
    if (activeRadioPlaylist !== null && customTrackList.length > 0) {
      const next = _nextCustomIdx();
      if (shuffle || next < customTrackList.length) {
        window.playCustomTrack(customTrackList[next] ? next : 0);
      } else if (loopPlaylist) {
        window.playCustomTrack(0);
      }
      return;
    }
    if (shuffle) doShuffle(); else widget.next();
  });

  shufBtn && shufBtn.addEventListener('click', () => {
    shuffle = !shuffle;
    shufBtn.classList.toggle('active', shuffle);
  });

  muteBtn && muteBtn.addEventListener('click', () => {
    muted = !muted;
    if (widget && widgetRdy) widget.setVolume(muted ? 0 : vol());
    if (youtubeActive && ytPlayer?.setVolume) try { ytPlayer.setVolume(muted ? 0 : vol()); } catch(_) {}
    if (ambientAudioActive && audioEl) audioEl.volume = muted ? 0 : vol() / 100;
    if (volIco) volIco.className = muted ? 'fas fa-volume-mute' : vol()<50 ? 'fas fa-volume-down' : 'fas fa-volume-up';
  });

  volEl && volEl.addEventListener('input', () => {
    if (!muted && widget && widgetRdy) widget.setVolume(vol());
    if (!muted && youtubeActive && ytPlayer?.setVolume) try { ytPlayer.setVolume(vol()); } catch(_) {}
    if (!muted && ambientAudioActive && audioEl) audioEl.volume = vol() / 100;
    if (volIco) volIco.className = vol()===0 ? 'fas fa-volume-mute' : vol()<50 ? 'fas fa-volume-down' : 'fas fa-volume-up';
  });

  progEl && progEl.addEventListener('click', e => {
    const pct = Math.max(0, Math.min(1, (e.clientX - progEl.getBoundingClientRect().left) / progEl.offsetWidth));
    if (youtubeActive && ytPlayer?.seekTo) {
      try { ytPlayer.seekTo(ytPlayer.getDuration() * pct, true); } catch(_) {}
      return;
    }
    if (ambientAudioActive && audioEl?.duration) {
      audioEl.currentTime = pct * audioEl.duration;
      if (fillEl) fillEl.style.width = (pct * 100) + '%';
      return;
    }
    if (!widget || !widgetRdy) return;
    widget.getDuration(dur => widget.seekTo(Math.floor(pct * dur)));
  });

  // ── UP-PLAYER CONTROLS ───────────────────────────────────────────
  (function bindUpPlayer() {
    const upPlay   = $('up-play');
    const upPrev   = $('up-prev');
    const upNext   = $('up-next');
    const upShuf   = $('up-shuffle');
    const upRep    = $('up-repeat');
    const upMute   = $('up-mute');
    const upMinBtn = $('up-min-btn');
    const upMinIco = $('up-min-icon');

    upPlay && upPlay.addEventListener('click', () => playBtn?.click());
    upPrev && upPrev.addEventListener('click', () => prevBtn?.click());
    upNext && upNext.addEventListener('click', () => nextBtn?.click());

    upShuf && upShuf.addEventListener('click', () => {
      shufBtn?.click();
      upShuf.classList.toggle('up-active', shuffle);
    });

    upRep && upRep.addEventListener('click', () => {
      const repeatBtn = $('radio-repeat');
      repeatBtn?.click();
      const m = ['none','one','all'];
      const next = m[(m.indexOf(repeat) + 1) % m.length];
      upRep.querySelector('i').className = next === 'one' ? 'fas fa-redo-alt' : 'fas fa-redo';
      upRep.classList.toggle('up-active', next !== 'none');
    });

    upMute && upMute.addEventListener('click', () => {
      muteBtn?.click();
      if (upVolIcon) upVolIcon.className = muted ? 'fas fa-volume-mute' : vol() < 50 ? 'fas fa-volume-down' : 'fas fa-volume-up';
    });

    upVolEl && upVolEl.addEventListener('input', () => {
      const v = parseInt(upVolEl.value, 10);
      if (!muted && widget && widgetRdy) widget.setVolume(v);
      if (!muted && youtubeActive && ytPlayer?.setVolume) try { ytPlayer.setVolume(v); } catch(_) {}
      if (upVolIcon) upVolIcon.className = v === 0 ? 'fas fa-volume-mute' : v < 50 ? 'fas fa-volume-down' : 'fas fa-volume-up';
      if (volEl) { volEl.value = v; volEl.dispatchEvent(new Event('input')); }
    });

    upProgress && upProgress.addEventListener('click', e => {
      const pct = Math.max(0, Math.min(1, (e.clientX - upProgress.getBoundingClientRect().left) / upProgress.offsetWidth));
      if (youtubeActive && ytPlayer?.seekTo) {
        try { ytPlayer.seekTo(ytPlayer.getDuration() * pct, true); } catch(_) {}
        return;
      }
      if (ambientAudioActive && audioEl?.duration) {
        audioEl.currentTime = pct * audioEl.duration;
        if (upFillEl) upFillEl.style.width = (pct * 100) + '%';
        return;
      }
      if (widget && widgetRdy) widget.getDuration(dur => widget.seekTo(Math.floor(pct * dur)));
    });

    let upMinimized = false;
    upMinBtn && upMinBtn.addEventListener('click', () => {
      upMinimized = !upMinimized;
      $('up-player')?.classList.toggle('up-minimized', upMinimized);
      if (upMinIco) upMinIco.className = upMinimized ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
      _adjustUpLayout();
    });
  })();

  // ── PUBLIC API ───────────────────────────────────────────────────
  window.RADIO_PLAYER = {
    skip: idx => {
      if (!widget || !widgetRdy || !scSounds[idx]) return;
      userPlayed = true;
      currentIdx = idx;
      showTrack(idx);
      highlight(idx);
      iframe.style.height = '116px';
      widget.skip(idx);
      widget.play();
    },
    play: () => {
      playBtn?.click();
    },
    pause: () => {
      if (youtubeActive) {
        try { ytPlayer?.pauseVideo(); } catch(_) {}
        return;
      }
      if (widget && widgetRdy && playing) {
        widget.pause();
        iframe.style.height = '0px';
        setPlaying(false);
      }
    },
    isPlaying: () => playing,
    isUsingMiniPlayer: () => youtubeActive,
    getPlaylist: () => enriched,
    setVolume: v => {
      v = Math.max(0, Math.min(100, v));
      if (volEl) volEl.value = v;
      if (upVolEl) upVolEl.value = v;
      if (widget && widgetRdy) widget.setVolume(v);
      if (youtubeActive && ytPlayer?.setVolume) try { ytPlayer.setVolume(v); } catch(_) {}
      if (volIco) volIco.className = v === 0 ? 'fas fa-volume-mute' : v < 50 ? 'fas fa-volume-down' : 'fas fa-volume-up';
      if (upVolIcon) upVolIcon.className = v === 0 ? 'fas fa-volume-mute' : v < 50 ? 'fas fa-volume-down' : 'fas fa-volume-up';
    },
    setShuffle: v => {
      if (shuffle !== !!v) shufBtn?.click();
    },
    // Reproduce un track del catálogo y luego reanuda lo que había antes
    addAndPlay: (catalogTrack) => {
      // Construir objeto de track estándar desde los datos del catálogo
      const t = {
        id:         String(catalogTrack.id || ''),
        itemId:     String(catalogTrack.id || ''),
        title:      catalogTrack.title || '—',
        cover:      catalogTrack.cover || null,
        scUrl:      catalogTrack.scUrl || null,
        url:        catalogTrack.scUrl || null,
        videoId:    catalogTrack.youtubeId || catalogTrack.videoId || null,
        spotifyUrl: catalogTrack.spotifyUrl || catalogTrack.platforms?.spotify || null,
        type:       'track',
      };

      // Guardar estado actual para restaurar después
      _prevPlaylistState = activeRadioPlaylist === null
        ? { mode: 'radio',  scIdx: currentIdx }
        : { mode: 'custom', playlist: activeRadioPlaylist, idx: customCurrentIdx,
            list: customTrackList.slice(), loop: loopPlaylist };

      // Parar lo que hay
      if (youtubeActive) stopYoutube();
      else { widget.pause(); iframe.style.height = '0px'; }
      stopCrossfade();
      pendingPlay = false;

      // Modo one-shot: lista de un solo track
      activeRadioPlaylist = '__oneshot__';
      customCurrentIdx    = 0;
      customPlaylistStarted = false;
      loopPlaylist        = false;
      customTrackList     = [t];

      const nameEl  = document.getElementById('radio-pl-name');
      const loopBtn = document.getElementById('radio-loop-btn');
      if (nameEl)  nameEl.textContent    = t.title;
      if (loopBtn) loopBtn.style.display = 'none';
      renderCustomTracklist([t]);
      showCustomTrack(0);
      window.playCustomTrack(0);
      document.getElementById('radio')?.scrollIntoView({ behavior: 'smooth' });
    },
  };
  window.radioPlayIdx = idx => window.RADIO_PLAYER.skip(idx);

  // ── VIDEO PLAYLIST (sección YouTube → reproductor unificado) ─────
  window.playVideoPlaylist = function(videos, startIdx) {
    if (!videos?.length) return;
    const tracks = videos.map(v => ({
      id:         v.videoId || v.id,
      itemId:     v.videoId,
      title:      v.title || v.videoId,
      cover:      v.cover || `https://img.youtube.com/vi/${v.videoId}/mqdefault.jpg`,
      videoId:    v.videoId,
      type:       'video',
    }));

    // Parar reproducción actual
    if (youtubeActive) stopYoutube();
    else if (widgetRdy) { widget.pause(); iframe.style.height = '0px'; }
    stopCrossfade();
    pendingPlay = false;
    window._pendingYtFallback = null;

    // Configurar playlist de vídeos
    activeRadioPlaylist   = '__videos__';
    customCurrentIdx      = Math.max(0, Math.min(startIdx || 0, tracks.length - 1));
    customPlaylistStarted = false;
    loopPlaylist          = true;
    customTrackList       = tracks;

    const nameEl  = document.getElementById('radio-pl-name');
    const loopBtn = document.getElementById('radio-loop-btn');
    if (nameEl)  nameEl.textContent = 'Videos';
    if (loopBtn) { loopBtn.style.display = ''; loopBtn.classList.add('active'); }

    renderCustomTracklist(customTrackList);
    showCustomTrack(customCurrentIdx);
    window.playCustomTrack(customCurrentIdx);
    _syncUpPlaylistBtn();
  };

  // Reproducir el vídeo destacado actual (llamado desde el placeholder)
  window.selectFeaturedVideo = function() {
    if (customTrackList.length && activeRadioPlaylist === '__videos__') {
      // Ya hay playlist de vídeos activa — reanudar
      _showFeaturedPlayer();
      window.playCustomTrack(customCurrentIdx);
    } else {
      // Delegar a selectVideo (script.js) para que use la lista completa de vídeos
      const thumb    = document.getElementById('yt-featured-thumb');
      const titleEl  = document.getElementById('yt-featured-title');
      const videoId  = thumb?.dataset.videoid;
      if (videoId && window.selectVideo) {
        window.selectVideo(videoId, titleEl?.textContent || '', '');
      }
    }
  };

  // ── PLAYLIST SELECTOR ────────────────────────────────────────────
  let activeRadioPlaylist = null; // null o '__default__' = RAYVER Radio; id = lista de usuario
  let customTrackList = [];
  let rplDropOpen = false;
  let upPlDropOpen = false;
  let defaultRadioTracks = []; // lista curada desde el admin

  window.toggleRadioPlSelector = function() {
    rplDropOpen = !rplDropOpen;
    const drop = document.getElementById('radio-pl-dropdown');
    const chev = document.getElementById('radio-pl-chevron');
    if (!drop) return;
    drop.style.display = rplDropOpen ? '' : 'none';
    if (chev) chev.style.transform = rplDropOpen ? 'rotate(180deg)' : '';
    if (rplDropOpen) renderRplDropdown();
  };

  function closeRplDropdown() {
    rplDropOpen = false;
    const drop = document.getElementById('radio-pl-dropdown');
    const chev = document.getElementById('radio-pl-chevron');
    if (drop) drop.style.display = 'none';
    if (chev) chev.style.transform = '';
  }

  // ── TOP BAR PLAYLIST SELECTOR ────────────────────────────────────────
  function _syncUpPlaylistBtn() {
    const btn = $('up-playlist-btn');
    if (!btn) return;
    const isUserPl = activeRadioPlaylist && activeRadioPlaylist !== '__default__' && activeRadioPlaylist !== '__videos__' && activeRadioPlaylist !== '__oneshot__';
    btn.classList.toggle('up-pl-active', !!isUserPl);
    if (activeRadioPlaylist === '__videos__') {
      btn.title = 'Videos';
    } else if (isUserPl) {
      const pl = (window.userPlaylists || []).find(p => p.id === activeRadioPlaylist);
      btn.title = pl?.name || 'Lista personalizada';
    } else {
      btn.title = 'RAYVER Radio';
    }
  }

  window._closeUpPlDrop = function() {
    upPlDropOpen = false;
    const drop = $('up-playlist-drop');
    const btn  = $('up-playlist-btn');
    if (drop) drop.style.display = 'none';
    if (btn)  btn.classList.remove('up-pl-open');
  };

  window._renderUpPlDrop = function() {
    const drop = $('up-playlist-drop');
    if (!drop) return;
    const q = (document.getElementById('up-pl-search')?.value || '').trim().toLowerCase();
    const playlists = (window.userPlaylists || []).filter(pl =>
      !q || pl.name.toLowerCase().includes(q)
    );
    const loggedIn = !!(window.getToken?.());
    const trackCount = (activeRadioPlaylist === '__default__' ? customTrackList.length : null) || defaultRadioTracks.length || scSounds.length;

    drop.innerHTML = `
      <div class="rpl-header">
        <span><i class="fas fa-layer-group" style="margin-right:6px"></i>Mis listas</span>
        <button class="rpl-header-close" onclick="window._closeUpPlDrop()" title="Cerrar"><i class="fas fa-times"></i></button>
      </div>
      <div class="rpl-search-wrap">
        <i class="fas fa-search rpl-search-icon"></i>
        <input type="text" id="up-pl-search" class="rpl-search" placeholder="Buscar lista…"
          oninput="window._renderUpPlDrop()" autocomplete="off">
      </div>
      <div class="rpl-list">
        <div class="rpl-item${(activeRadioPlaylist === null || activeRadioPlaylist === '__default__') ? ' rpl-active' : ''}"
          onclick="window.selectRadioPlaylist(null);window._closeUpPlDrop()">
          <span class="rpl-icon"><i class="fas fa-broadcast-tower"></i></span>
          <span class="rpl-name">RAYVER Radio</span>
          <span class="rpl-count">${trackCount} tracks</span>
        </div>
        ${!loggedIn
          ? `<div class="rpl-login-hint"><i class="fas fa-lock"></i> <a onclick="openAuthModal?.()" style="color:var(--primary-2);cursor:pointer">Inicia sesión</a> para ver tus listas</div>`
          : !playlists.length && !q
            ? '<div class="rpl-empty">Sin listas guardadas</div>'
            : playlists.map(pl => `
                <div class="rpl-item${activeRadioPlaylist === pl.id ? ' rpl-active' : ''}"
                  onclick="window.selectRadioPlaylist('${esc(pl.id)}');window._closeUpPlDrop()">
                  <span class="rpl-icon"><i class="fas fa-music"></i></span>
                  <span class="rpl-name">${esc(pl.name)}</span>
                  <span class="rpl-count">${pl.tracks?.length ?? 0} tracks</span>
                </div>`).join('')
        }
      </div>`;
    setTimeout(() => document.getElementById('up-pl-search')?.focus(), 0);
  };

  window.toggleUpPlSelector = function() {
    upPlDropOpen = !upPlDropOpen;
    const drop = $('up-playlist-drop');
    const btn  = $('up-playlist-btn');
    if (!drop) return;
    // Position the dropdown just below the current player height
    const upEl = $('up-player');
    if (upEl) drop.style.top = upEl.offsetHeight + 'px';
    drop.style.display = upPlDropOpen ? '' : 'none';
    if (btn) btn.classList.toggle('up-pl-open', upPlDropOpen);
    if (upPlDropOpen) window._renderUpPlDrop();
  };

  window.renderRplDropdown = function() {
    const drop = document.getElementById('radio-pl-dropdown');
    if (!drop) return;
    const q = (document.getElementById('rpl-search')?.value || '').trim().toLowerCase();
    const playlists = (window.userPlaylists || []).filter(pl =>
      !q || pl.name.toLowerCase().includes(q)
    );
    const loggedIn = !!(window.getToken?.());

    drop.innerHTML = `
      <div class="rpl-search-wrap">
        <i class="fas fa-search rpl-search-icon"></i>
        <input type="text" id="rpl-search" class="rpl-search" placeholder="Buscar lista…"
          oninput="window.renderRplDropdown()" autocomplete="off">
      </div>
      <div class="rpl-list">
        <div class="rpl-item${(activeRadioPlaylist === null || activeRadioPlaylist === '__default__') ? ' rpl-active' : ''}"
          onclick="window.selectRadioPlaylist(null)">
          <span class="rpl-icon"><i class="fas fa-broadcast-tower"></i></span>
          <span class="rpl-name">RAYVER Radio</span>
          <span class="rpl-count">${(activeRadioPlaylist === '__default__' ? customTrackList.length : null) || defaultRadioTracks.length || scSounds.length} tracks</span>
        </div>
        ${!loggedIn
          ? '<div class="rpl-login-hint"><i class="fas fa-lock"></i> Inicia sesión para ver tus listas</div>'
          : !playlists.length && !q
            ? '<div class="rpl-empty">Sin listas guardadas</div>'
            : playlists.map(pl => `
                <div class="rpl-item${activeRadioPlaylist === pl.id ? ' rpl-active' : ''}"
                  onclick="window.selectRadioPlaylist('${esc(pl.id)}')">
                  <span class="rpl-icon"><i class="fas fa-music"></i></span>
                  <span class="rpl-name">${esc(pl.name)}</span>
                  <span class="rpl-count">${pl.tracks.length} tracks</span>
                </div>`).join('')
        }
      </div>`;
    // Keep focus on search input
    setTimeout(() => document.getElementById('rpl-search')?.focus(), 0);
  };

  window.selectRadioPlaylist = function(id) {
    activeRadioPlaylist = id;
    customCurrentIdx = 0;
    customPlaylistStarted = false;
    closeRplDropdown();

    widget.pause();
    iframe.style.height = '0px';
    stopYoutube();
    stopCrossfade();
    if (ambientAudioActive) _stopAmbientAudio();
    pendingPlay = false; // evitar que RAYVER Radio empiece si READY llega tarde
    window._pendingYtFallback = null;

    const nameEl  = document.getElementById('radio-pl-name');
    const loopBtn = document.getElementById('radio-loop-btn');
    if (id === null) {
      if (nameEl) nameEl.textContent = 'RAYVER Radio';
      if (defaultRadioTracks.length) {
        // Lista curada por el admin
        loopPlaylist = true;
        if (loopBtn) { loopBtn.style.display = ''; loopBtn.classList.add('active'); }
        activeRadioPlaylist = '__default__';
        customCurrentIdx    = 0;
        customPlaylistStarted = false;
        customTrackList = defaultRadioTracks.map(t => ({
          id: t.id, itemId: t.id, title: t.title,
          cover: t.cover, scUrl: t.scUrl, videoId: t.videoId,
          spotifyUrl: t.spotifyUrl, type: 'track',
        }));
        renderCustomTracklist(customTrackList);
        showCustomTrack(0);
      } else {
        // Sin lista configurada → modo SC Widget completo
        if (loopBtn) loopBtn.style.display = 'none';
        customTrackList = [];
        activeRadioPlaylist = null;
        if (widgetCustomMode) {
          widgetCustomMode = false;
          scSounds = []; enriched = [];
          widget.load(SC_PLAYLIST, {
            auto_play: false, hide_related: true, show_comments: false,
            show_user: true, show_reposts: false, show_teaser: false,
          });
          setTimeout(() => widget.getSounds(sounds => {
            if (!sounds?.length) return;
            scSounds = sounds; buildEnriched(); renderList();
            showTrack(currentIdx); highlight(currentIdx);
          }), 1500);
        } else {
          renderList();
          highlight(currentIdx);
          showTrack(currentIdx);
        }
      }
    } else {
      const pl = (window.userPlaylists || []).find(p => p.id === id);
      if (nameEl)  nameEl.textContent = pl?.name || 'Lista';
      loopPlaylist = true;
      if (loopBtn) { loopBtn.style.display = ''; loopBtn.classList.add('active'); }
      const tracks = pl?.tracks || [];
      renderCustomTracklist(tracks);
      if (tracks.length) showCustomTrack(0);
    }
    _syncUpPlaylistBtn();
    _syncAutomixBtn();
  };

  function renderCustomTracklist(tracks) {
    if (!listBody) return;
    customTrackList = tracks;
    if (!tracks.length) {
      listBody.innerHTML = '<div class="radio-empty"><i class="fas fa-music"></i><p>Lista vacía</p></div>';
      return;
    }
    listBody.innerHTML = tracks.map((t, i) => {
      const isVideo   = t.type === 'video';
      const isAmbient = t.type === 'ambient';
      const vid = t.itemId || '';
      const coverHtml = isVideo
        ? `<img class="rtitem-cover" src="https://img.youtube.com/vi/${esc(vid)}/default.jpg" alt="" onerror="this.style.display='none'">`
        : t.cover
          ? `<img class="rtitem-cover" src="${esc(t.cover)}" alt="" onerror="this.style.display='none'">`
          : `<span class="rtitem-cover rtitem-cover-grad" style="background:${GRADS[i%GRADS.length]}">${esc((t.title||'?')[0].toUpperCase())}</span>`;
      const badge = isVideo
        ? `<span class="rtitem-plat-badge" style="color:#ff4444"><i class="fab fa-youtube"></i></span>`
        : isAmbient
          ? `<span class="rtitem-plat-badge" style="color:#4ade80"><i class="fas fa-leaf"></i></span>`
          : `<span class="rtitem-plat-badge ptag-soundcloud"><i class="fab fa-soundcloud"></i></span>`;
      const subLabel = isVideo ? 'YouTube' : isAmbient ? 'Ambiente' : 'SoundCloud';
      return `
        <div class="radio-track-item${i === customCurrentIdx ? ' active' : ''}" draggable="true" data-ridx="${i}" onclick="window.playCustomTrack(${i})">
          <span class="rtitem-drag-handle" title="Arrastrar"><i class="fas fa-grip-lines"></i></span>
          <span class="rtitem-num">${i + 1}</span>
          ${coverHtml}
          <div class="rtitem-info">
            <div class="rtitem-title">${esc(t.title || '—')}</div>
            <div class="rtitem-sub">${subLabel}</div>
          </div>
          ${badge}
        </div>`;
    }).join('');
    attachRadioDnD();
  }

  function attachRadioDnD() {
    if (!listBody) return;
    const items = Array.from(listBody.querySelectorAll('.radio-track-item[draggable]'));
    let dragSrc = null;

    items.forEach(item => {
      item.addEventListener('dragstart', e => {
        dragSrc = item;
        item.classList.add('rtdrag-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.stopPropagation();
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('rtdrag-dragging');
        listBody.querySelectorAll('.rtdrag-over').forEach(el => el.classList.remove('rtdrag-over'));
        dragSrc = null;
      });
      item.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (item !== dragSrc) item.classList.add('rtdrag-over');
      });
      item.addEventListener('dragleave', () => item.classList.remove('rtdrag-over'));
      item.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        if (!dragSrc || dragSrc === item) return;
        const from = +dragSrc.dataset.ridx;
        const to   = +item.dataset.ridx;
        const moved = customTrackList.splice(from, 1)[0];
        customTrackList.splice(to, 0, moved);
        // Ajustar índice activo
        if (customCurrentIdx === from) customCurrentIdx = to;
        else if (from < customCurrentIdx && to >= customCurrentIdx) customCurrentIdx--;
        else if (from > customCurrentIdx && to <= customCurrentIdx) customCurrentIdx++;
        renderCustomTracklist(customTrackList);
        showCustomTrack(customCurrentIdx);
        // Persistir orden en backend
        if (activeRadioPlaylist && window.getToken?.()) {
          const ids = customTrackList.map(t => t.id).filter(Boolean);
          fetch(`/api/user/playlists/${activeRadioPlaylist}/reorder`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + window.getToken() },
            body: JSON.stringify({ trackIds: ids })
          }).catch(() => {});
        }
      });
    });
  }

  window.playCustomTrack = function(idx) {
    const t = customTrackList[idx];
    if (!t) return;
    _wdProgress = null;  // reset watchdog immediately so previous SC position can't trigger skip
    customCurrentIdx = idx;
    // Cancelar cualquier fade en curso si el usuario cambió manualmente
    if (!isCrossfading) { preloadTriggered = false; }
    else { stopCrossfade(); }
    // NO marcar customPlaylistStarted aquí — solo se marca cuando realmente arranca audio
    showCustomTrack(idx);

    // Resaltar fila activa
    listBody?.querySelectorAll('.radio-track-item').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
      if (i === idx) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    // Stop ambient if it was playing
    if (ambientAudioActive) _stopAmbientAudio();

    if (t.type === 'ambient') {
      iframe.style.height = '0px';
      stopYoutube();
      stopCrossfade();
      // Explicitly pause the SC Widget — otherwise its FINISH event can fire for the
      // previous track while ambient is loading and skip to the next list item.
      if (widgetRdy) widget.pause();

      const token = window.getToken?.();
      if (!token) {
        if (artistEl) artistEl.textContent = 'Inicia sesión para escuchar';
        return;
      }

      // Mark ambient as active immediately so the watchdog and FINISH handler
      // ignore SC Widget events during the async fetch+play window.
      ambientAudioActive = true;
      if (artistEl) artistEl.textContent = 'Cargando…';

      fetch(`/api/ambient/stream/${encodeURIComponent(t.itemId || t.id)}`, {
        headers: { 'Authorization': 'Bearer ' + token }
      })
        .then(r => r.json())
        .then(data => {
          if (!ambientAudioActive) return; // track changed while fetching
          if (data.type === 'audio' && data.streamUrl) {
            // Native audio — full player control
            if (!audioEl) return;
            audioEl.src  = data.streamUrl;
            audioEl.volume = muted ? 0 : vol() / 100;
            audioEl.play()
              .then(() => {
                customPlaylistStarted = true;
                userPlayed           = true;
                setPlaying(true);
                _startAmbientProgress();
                if (artistEl) artistEl.textContent = 'Ambiente';
              })
              .catch(err => {
                ambientAudioActive = false;
                console.warn('[Ambient] play error:', err);
                if (artistEl) artistEl.textContent = 'Error al reproducir';
                setPlaying(false);
              });
          } else if (data.type === 'gdrive' && data.fileId) {
            // Fallback when no GOOGLE_API_KEY: Google Drive iframe in ambient area
            ambientAudioActive = false; // gdrive is uncontrolled, don't block normal flow
            const ambArea  = document.getElementById('radio-ambient-area');
            const ambFrame = document.getElementById('radio-ambient-iframe');
            if (ambArea && ambFrame) {
              ambFrame.src = `https://drive.google.com/file/d/${encodeURIComponent(data.fileId)}/preview`;
              ambArea.style.display = '';
            }
            customPlaylistStarted = true;
            userPlayed = true;
            if (artistEl) artistEl.textContent = 'Ambiente';
          } else if (data.error) {
            ambientAudioActive = false;
            if (artistEl) artistEl.textContent = data.error;
          }
        })
        .catch(() => {
          ambientAudioActive = false;
          if (artistEl) artistEl.textContent = 'Error de conexión';
        });
      return;
    }

    // Hide ambient fallback area for non-ambient tracks
    const _ambArea = document.getElementById('radio-ambient-area');
    const _ambFrame = document.getElementById('radio-ambient-iframe');
    if (_ambArea)  _ambArea.style.display = 'none';
    if (_ambFrame) _ambFrame.src = '';

    if (t.type === 'video') {
      playYoutubeTrack(t.itemId || t.videoId, t.title || '');
    } else {
      // Detener YouTube si estaba activo — evita reproducción simultánea YT+SC
      if (youtubeActive) stopYoutube();

      // Resolver fuentes del track (SC, YouTube, Spotify)
      // Nota: tracks de playlists de usuario guardan la URL en campo 'url', no 'scUrl'
      const apiTrack   = apiTracks.find(a =>
        String(a.id) === String(t.itemId || t.id) ||
        (t.url   && a.scUrl === t.url)   ||
        (t.scUrl && a.scUrl === t.scUrl)
      );
      // Para tracks de vídeo, itemId ES el videoId de YouTube
      const trackYtId  = t.videoId || apiTrack?.videoId
        || (t.type === 'video' ? t.itemId : null) || null;
      // Campo 'url' es el que usa el backend para playlists de usuario
      let   trackScUrl = t.scUrl || t.url || apiTrack?.scUrl || null;

      // Helper: carga una URL de SC directamente en el widget (siempre oculto)
      const _loadScUrl = (url, ytFallback) => {
        _autoSkipCount = 0;
        customPlaylistStarted = true;
        widgetCustomMode = true;
        userPlayed = true;
        window._pendingYtFallback = ytFallback || null;
        // SC widget permanece oculto — nuestros controles manejan todo
        widget.load(url, {
          auto_play: true, hide_related: true, show_comments: false,
          show_user: true, show_reposts: false, show_teaser: false,
        });
      };

      if (trackScUrl) {
        // Ruta directa: URL de SC conocida → cargar en widget oculto, YouTube como fallback
        _loadScUrl(trackScUrl, trackYtId);
      } else if (trackYtId) {
        // No hay URL de SC pero sí YouTube → reproducir directamente
        playYoutubeTrack(trackYtId, t.title);
      } else if (_masterEnriched.length || enriched.length) {
        // Fallback 1: buscar por título normalizado en el catálogo SC completo
        const lookupList = _masterEnriched.length ? _masterEnriched : enriched;
        const nt = norm(t.title);
        const scIdx = nt ? lookupList.findIndex(e => norm(e.title) === nt) : -1;
        if (scIdx >= 0 && lookupList[scIdx].scUrl) {
          _loadScUrl(lookupList[scIdx].scUrl, trackYtId);
        } else {
          // Fallback 2: construir URL desde slug del título
          const slug = (t.title || '').toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          // scBase = base del perfil SC (sin /tracks ni /sets/...)
          const scBase = SC_PLAYLIST.replace(/\/(tracks|sets\/.*)$/, '');
          _loadScUrl(scBase + '/' + slug, trackYtId);
        }
      } else {
        // enriched vacío aún: reintentar cuando cargue
        setTimeout(() => window.playCustomTrack(idx), 500);
      }
    }
  };

  // Activa la lista curada del admin como playlist por defecto del radio
  function activateDefaultRadioPlaylist() {
    if (!defaultRadioTracks.length) return;
    activeRadioPlaylist = '__default__';
    customCurrentIdx    = 0;
    customPlaylistStarted = false;
    loopPlaylist = true;
    customTrackList = defaultRadioTracks.map(t => ({
      id: t.id, itemId: t.id, title: t.title,
      cover: t.cover, scUrl: t.scUrl, videoId: t.videoId,
      spotifyUrl: t.spotifyUrl, type: 'track',
    }));
    const nameEl  = document.getElementById('radio-pl-name');
    const loopBtn = document.getElementById('radio-loop-btn');
    if (nameEl)  nameEl.textContent = 'RAYVER Radio';
    if (loopBtn) { loopBtn.style.display = ''; loopBtn.classList.add('active'); }
    renderCustomTracklist(customTrackList);
    showCustomTrack(0);
    _syncUpPlaylistBtn();
  }

  window.toggleRadioLoop = function() {
    loopPlaylist = !loopPlaylist;
    const btn = document.getElementById('radio-loop-btn');
    if (btn) btn.classList.toggle('active', loopPlaylist);
    btn.title = loopPlaylist ? 'Repetir lista: ON' : 'Repetir lista: OFF';
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    // Tab visible again: exit background-continuous mode
    // SC Widget is now playing SC_PLAYLIST in auto_play mode (RAYVER Radio)
    if (_bgContinuousMode) {
      _bgContinuousMode = false;
      // Only sync SC Widget UI if ambient is not active — otherwise we'd overwrite
      // the ambient track info in the header with whatever SC Widget track is loaded.
      if (!ambientAudioActive) {
        widget.getCurrentSoundIndex(idx => {
          if (typeof idx === 'number') { currentIdx = idx; showTrack(idx); highlight(idx); }
        });
      }
    }
    _wdCheck();
    if (playing && ambientAudioActive && audioEl?.paused) audioEl.play().catch(() => {});
  });

  // Close dropdowns when clicking outside
  document.addEventListener('click', e => {
    if (rplDropOpen && !e.target.closest('#radio-pl-dropdown') && !e.target.closest('#radio-pl-selector-btn')) {
      closeRplDropdown();
    }
    if (upPlDropOpen && !e.target.closest('#up-playlist-drop') && !e.target.closest('#up-playlist-btn')) {
      window._closeUpPlDrop();
    }
  });

  // ── BACKGROUND CONTINUOUS PLAY ───────────────────────────────────
  // The SC Widget iframe is throttled by Chrome when the tab is hidden and
  // audio has stopped. Our postMessage commands (widget.next / playCustomTrack)
  // queue up but are processed very slowly or not at all.
  //
  // Solution: when a track ends in background, reload the SC Widget with
  // SC_PLAYLIST + auto_play=true. From that point the SC Widget manages ALL
  // track advancement INTERNALLY — its own iframe audio keeps it unthrottled.
  // No further JS from our main thread is needed between tracks.
  let _bgContinuousMode = false;

  function _bgContinuousPlay() {
    if (_bgContinuousMode) return;
    _bgContinuousMode = true;
    _wdProgress       = null;
    activeRadioPlaylist   = null;  // switch to RAYVER Radio state
    customPlaylistStarted = false;
    // Load SC_PLAYLIST with auto_play — SC Widget handles all advancement
    widget.load(SC_PLAYLIST, {
      auto_play: true, hide_related: true, show_comments: false,
      show_user: true, show_reposts: false, show_teaser: false
    });
  }

  // ── WATCHDOG ─────────────────────────────────────────────────────
  let _wdPausedAt = 0;

  function _wdCheck() {
    if (_kaCtx?.state === 'suspended') _kaCtx.resume().catch(() => {});
    if (!_wdProgress || youtubeActive || ambientAudioActive) return;
    if (!playing && Date.now() - _wdPausedAt > 10000) return;
    const elapsed   = Date.now() - _wdProgress.ts;
    const estimated = _wdProgress.pos + elapsed;
    if (estimated < _wdProgress.dur + 1500) return;
    _wdProgress = null;

    // Tab in background: don't try widget.next/playCustomTrack (SC iframe throttled).
    // Instead switch to native SC auto_play — self-sustaining, no JS needed.
    if (document.hidden) { _bgContinuousPlay(); return; }

    if (activeRadioPlaylist !== null) {
      const next = _nextCustomIdx();
      const withinBounds = shuffle ? true : next < customTrackList.length;
      if (withinBounds && customTrackList[next]) {
        window.playCustomTrack(next);
      } else if (loopPlaylist || shuffle) {
        window.playCustomTrack(shuffle ? _nextCustomIdx() : 0);
      } else {
        if (!_restorePrevState()) { stopCrossfade(); setPlaying(false); }
      }
    } else if (repeat === 'one') {
      widget.seekTo(0); widget.play();
    } else if (shuffle) {
      doShuffle();
    } else {
      widget.next();
    }
  }

  try {
    const _wWorker = new Worker('/radio-worker.js');
    _wWorker.onmessage = _wdCheck;
  } catch(e) {
    setInterval(_wdCheck, 1000);
  }

  if (typeof navigator !== 'undefined' && navigator.locks) {
    navigator.locks.request('rayver-radio-playback', { mode: 'shared' }, () => new Promise(() => {}));
  }

  function init() {
    _adjustUpLayout();
    window.addEventListener('resize', _adjustUpLayout);
    // Keep navbar position in sync while video area animates open/close
    const upPlayer = $('up-player');
    if (upPlayer) upPlayer.addEventListener('transitionend', e => {
      if (e.target === upPlayer || e.target.id === 'up-video-area') _adjustUpLayout();
    });
    addRepeatBtn();
    addAutomixBtn();
    if (titleEl)  titleEl.textContent  = 'RAYVER Radio';
    if (artistEl) artistEl.textContent = 'Pulsa ▶ para escuchar';
    if (counter)  counter.textContent  = '— / —';
    if (listBody) listBody.innerHTML   = `<div class="radio-empty"><i class="fas fa-circle-notch fa-spin"></i><p>Cargando playlist…</p></div>`;

    // Coordinar los dos fetches de arranque: activar la mejor playlist
    // cuando los dos han respondido (para saber si hay lista curada o no).
    let _apiDone = false, _rplDone = false;

    function _checkActivate() {
      if (!_apiDone || !_rplDone) return;
      if (activeRadioPlaylist !== null) return; // usuario ya seleccionó algo

      if (defaultRadioTracks.length) {
        // El admin tiene una lista curada configurada
        activateDefaultRadioPlaylist();
      } else {
        // Sin lista curada → usar TODOS los tracks del backend como default
        // (SC sync trae hasta 300 via API con paginación, sin límites de Widget)
        const playable = apiTracks
          .filter(t => t.scUrl || t.videoId)
          .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
        if (playable.length) {
          activeRadioPlaylist = '__default__';
          customCurrentIdx    = 0;
          customPlaylistStarted = false;
          loopPlaylist = true;
          customTrackList = playable.map(t => ({
            id: t.id, itemId: t.id, title: t.title, cover: t.cover || null,
            scUrl: t.scUrl || null, videoId: t.videoId || null,
            spotifyUrl: t.spotifyUrl || null, type: 'track',
          }));
          const nameEl  = document.getElementById('radio-pl-name');
          const loopBtn = document.getElementById('radio-loop-btn');
          if (nameEl)  nameEl.textContent = 'RAYVER Radio';
          if (loopBtn) { loopBtn.style.display = ''; loopBtn.classList.add('active'); }
          renderCustomTracklist(customTrackList);
          showCustomTrack(0);
          _syncUpPlaylistBtn();
        }
        // Si tampoco hay tracks en el backend → SC Widget mode (getSounds())
      }
    }

    fetch('/api/public/tracks')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        _apiDone = true;
        if (data?.length) {
          apiTracks = data;
          if (activeRadioPlaylist === null && scSounds.length) { buildEnriched(); renderList(); }
        }
        _checkActivate();
      }).catch(() => { _apiDone = true; _checkActivate(); });

    fetch('/api/public/radio-playlist')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        _rplDone = true;
        if (data?.tracks?.length) defaultRadioTracks = data.tracks;
        _checkActivate();
      }).catch(() => { _rplDone = true; _checkActivate(); });

    createIframe();

    if (window.SC) {
      bindWidget();
    } else {
      const s = document.createElement('script');
      s.src = 'https://w.soundcloud.com/player/api.js';
      s.onload = bindWidget;
      document.head.appendChild(s);
    }
  }

  init();
})();
