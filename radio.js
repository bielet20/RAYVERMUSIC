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
  let customPlaylistStarted = false;
  let widgetCustomMode = false; // true cuando el widget está cargado con un track custom (no SC_PLAYLIST)
  let youtubeActive = false;   // true cuando el track actual juega desde YouTube IFrame API
  let ytPlayer = null;         // instancia YT.Player
  let ytPlayerReady = false;   // true cuando el YT.Player está listo
  let ytPlayerDiv = null;      // contenedor del YT player dentro del radio card
  let ytProgressTimer = null;  // intervalo para barra de progreso YouTube

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
  }

  // Actualiza el header del radio con datos de la lista personalizada (no SC)
  function showCustomTrack(idx) {
    const t = customTrackList[idx];
    if (!t) return;
    const isVideo = t.type === 'video';
    const apiT    = apiTracks.find(a => String(a.id) === String(t.itemId || t.id));

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
      const scUrl = t.scUrl  || apiT?.scUrl  || null;
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
  }

  function setPlaying(p) {
    playing = p;
    if (playIco) playIco.className = p ? 'fas fa-pause' : 'fas fa-play';
    if (onair)   onair.classList.toggle('pulsing', p);
    if (coverEl) coverEl.classList.toggle('spinning', p);
    if (cpulse)  cpulse.classList.toggle('active', p);
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
    let url = t.scUrl || null;
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
      url = SC_PLAYLIST.split('/sets/')[0] + '/' + slug;
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

  // ── YOUTUBE IFRAME API (dentro del radio card, igual que SC Widget) ──
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
    const div = getYtPlayerDiv();
    if (ytPlayer) {
      ytPlayer.loadVideoById(videoId);
      div.style.height = '116px';
      return;
    }
    // Crear un <div> interno que YT.Player reemplazará
    div.innerHTML = '<div id="yt-radio-inner"></div>';
    div.style.height = '116px';
    ytPlayer = new YT.Player('yt-radio-inner', {
      height: '116',
      width: '100%',
      videoId,
      playerVars: { autoplay: 1, controls: 1, rel: 0, modestbranding: 1, iv_load_policy: 3 },
      events: {
        onReady: () => { ytPlayerReady = true; },
        onStateChange: (e) => {
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
              const next = customCurrentIdx + 1;
              if (next < customTrackList.length) setTimeout(() => window.playCustomTrack(next), 400);
              else if (loopPlaylist) setTimeout(() => window.playCustomTrack(0), 400);
              else setPlaying(false);
            }
          }
        },
      },
    });
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
        }
      } catch (_) {}
    }, 500);
  }

  function stopYtProgress() {
    if (ytProgressTimer) { clearInterval(ytProgressTimer); ytProgressTimer = null; }
  }

  function playYoutubeTrack(videoId, title) {
    window._pendingYtFallback = null;
    youtubeActive = true;
    widget.pause();
    iframe.style.height = '0px';
    if (window.MINI_PLAYER?.pause) window.MINI_PLAYER.pause();
    customPlaylistStarted = true;
    userPlayed = true;
    setPlaying(true);
    loadYtApiScript(() => initYtPlayer(videoId));
  }

  // Muestra un aviso de "no disponible en radio" con link a Spotify
  function showUnavailable(t) {
    const apiTrack = apiTracks.find(a => String(a.id) === String(t.itemId || t.id));
    const spotifyUrl = apiTrack?.spotifyUrl || t.spotifyUrl || null;
    customPlaylistStarted = true; // para que play button no reintente
    setPlaying(false);
    // Mostrar badge de "sin fuente" en el artista
    if (artistEl) artistEl.innerHTML = spotifyUrl
      ? `<a href="${esc(spotifyUrl)}" target="_blank" class="radio-ptag ptag-s" style="font-size:12px"><i class="fab fa-spotify"></i> Escuchar en Spotify</a>`
      : '<span style="opacity:.5;font-size:12px">No disponible en radio</span>';
  }

  function stopYoutube() {
    youtubeActive = false;
    stopYtProgress();
    if (ytPlayer?.pauseVideo) try { ytPlayer.pauseVideo(); } catch(_) {}
    if (ytPlayerDiv) ytPlayerDiv.style.height = '0px';
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
        if (pendingPlay) { pendingPlay = false; widget.play(); }
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
        const next = customCurrentIdx + 1;
        if (next < customTrackList.length) {
          if (automixEnabled) {
            // Arranque inmediato (audio ya en RAM) + fade-in
            window.playCustomTrack(next);
            startFadeIn();
          } else {
            setTimeout(() => window.playCustomTrack(next), 400);
          }
        } else if (loopPlaylist) {
          if (automixEnabled) {
            window.playCustomTrack(0);
            startFadeIn();
          } else {
            setTimeout(() => window.playCustomTrack(0), 400);
          }
        } else {
          stopCrossfade();
          setPlaying(false);
        }
        return;
      }
      if (repeat === 'one')   { widget.seekTo(0); widget.play(); }
      else if (shuffle)       { doShuffle(); }
      else if (repeat === 'all') { widget.next(); }
      else                    { setPlaying(false); }
    });

    widget.bind(SC.Widget.Events.PLAY_PROGRESS, d => {
      if (!d) return;
      const pos = d.currentPosition || 0, dur = d.duration || 1;
      if (fillEl) fillEl.style.width = Math.min((pos/dur)*100, 100) + '%';
      if (curEl)  curEl.textContent  = fmt(pos);
      if (durEl)  durEl.textContent  = fmt(dur);

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
    widget.skip(r); widget.play();
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
        } else {
          widget.pause();
          iframe.style.height = '0px';
          setPlaying(false);
        }
      } else {
        if (youtubeActive) {
          if (ytPlayerDiv) ytPlayerDiv.style.height = '116px';
          try { ytPlayer?.playVideo(); } catch(_) {}
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
      if (window.MINI_PLAYER?.pause) window.MINI_PLAYER.pause();
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
      const next = customCurrentIdx + 1;
      if (next < customTrackList.length) window.playCustomTrack(next);
      else if (loopPlaylist) window.playCustomTrack(0);
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
    if (volIco) volIco.className = muted ? 'fas fa-volume-mute' : vol()<50 ? 'fas fa-volume-down' : 'fas fa-volume-up';
  });

  volEl && volEl.addEventListener('input', () => {
    if (!muted && widget && widgetRdy) widget.setVolume(vol());
    if (!muted && youtubeActive && ytPlayer?.setVolume) try { ytPlayer.setVolume(vol()); } catch(_) {}
    if (volIco) volIco.className = vol()===0 ? 'fas fa-volume-mute' : vol()<50 ? 'fas fa-volume-down' : 'fas fa-volume-up';
  });

  progEl && progEl.addEventListener('click', e => {
    const pct = Math.max(0, Math.min(1, (e.clientX - progEl.getBoundingClientRect().left) / progEl.offsetWidth));
    if (youtubeActive && ytPlayer?.seekTo) {
      try { ytPlayer.seekTo(ytPlayer.getDuration() * pct, true); } catch(_) {}
      return;
    }
    if (!widget || !widgetRdy) return;
    widget.getDuration(dur => widget.seekTo(Math.floor(pct * dur)));
  });

  // ── PUBLIC API ───────────────────────────────────────────────────
  window.RADIO_PLAYER = {
    skip: idx => {
      if (!widget || !widgetRdy || !scSounds[idx]) return;
      userPlayed = true;
      if (window.MINI_PLAYER?.pause) window.MINI_PLAYER.pause();
      currentIdx = idx;
      showTrack(idx);
      highlight(idx);
      iframe.style.height = '116px';
      widget.skip(idx);
      widget.play();
    },
    play: () => {
      if (window.MINI_PLAYER?.pause) window.MINI_PLAYER.pause();
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
    // Busca el track por título/id en la playlist y lo reproduce
    addAndPlay: (track) => {
      if (!enriched || !enriched.length) {
        document.getElementById('radio')?.scrollIntoView({behavior:'smooth'});
        return;
      }
      const title = (track.title || '').toLowerCase();
      const scId  = track.scId || track.id || '';
      let idx = enriched.findIndex(t => (t.scId && t.scId === scId) || (t.title||'').toLowerCase() === title);
      if (idx < 0) idx = 0; // fallback: primera canción
      window.RADIO_PLAYER.skip(idx);
      document.getElementById('radio')?.scrollIntoView({behavior:'smooth'});
    },
  };
  window.radioPlayIdx = idx => window.RADIO_PLAYER.skip(idx);

  // ── PLAYLIST SELECTOR ────────────────────────────────────────────
  let activeRadioPlaylist = null; // null o '__default__' = RAYVER Radio; id = lista de usuario
  let customTrackList = [];
  let rplDropOpen = false;
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
    window._pendingYtFallback = null;
    if (window.MINI_PLAYER?.pause) window.MINI_PLAYER.pause();

    const nameEl  = document.getElementById('radio-pl-name');
    const loopBtn = document.getElementById('radio-loop-btn');
    if (id === null) {
      if (nameEl) nameEl.textContent = 'RAYVER Radio';
      if (defaultRadioTracks.length) {
        // Lista curada por el admin
        if (loopBtn) loopBtn.style.display = '';
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
      if (nameEl)  nameEl.textContent    = pl?.name || 'Lista';
      if (loopBtn) loopBtn.style.display = '';
      const tracks = pl?.tracks || [];
      renderCustomTracklist(tracks);
      if (tracks.length) showCustomTrack(0);
    }
  };

  function renderCustomTracklist(tracks) {
    if (!listBody) return;
    customTrackList = tracks;
    if (!tracks.length) {
      listBody.innerHTML = '<div class="radio-empty"><i class="fas fa-music"></i><p>Lista vacía</p></div>';
      return;
    }
    listBody.innerHTML = tracks.map((t, i) => {
      const isVideo = t.type === 'video';
      const vid = t.itemId || '';
      const coverHtml = isVideo
        ? `<img class="rtitem-cover" src="https://img.youtube.com/vi/${esc(vid)}/default.jpg" alt="" onerror="this.style.display='none'">`
        : t.cover
          ? `<img class="rtitem-cover" src="${esc(t.cover)}" alt="" onerror="this.style.display='none'">`
          : `<span class="rtitem-cover rtitem-cover-grad" style="background:${GRADS[i%GRADS.length]}">${esc((t.title||'?')[0].toUpperCase())}</span>`;
      const badge = isVideo
        ? `<span class="rtitem-plat-badge" style="color:#ff4444"><i class="fab fa-youtube"></i></span>`
        : `<span class="rtitem-plat-badge ptag-soundcloud"><i class="fab fa-soundcloud"></i></span>`;
      return `
        <div class="radio-track-item${i === customCurrentIdx ? ' active' : ''}" draggable="true" data-ridx="${i}" onclick="window.playCustomTrack(${i})">
          <span class="rtitem-drag-handle" title="Arrastrar"><i class="fas fa-grip-lines"></i></span>
          <span class="rtitem-num">${i + 1}</span>
          ${coverHtml}
          <div class="rtitem-info">
            <div class="rtitem-title">${esc(t.title || '—')}</div>
            <div class="rtitem-sub">${isVideo ? 'YouTube' : 'SoundCloud'}</div>
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

    if (t.type === 'video') {
      const allVids = customTrackList.filter(x => x.type === 'video').map(x => ({ videoId: x.itemId, title: x.title }));
      const vidIdx  = customTrackList.slice(0, idx + 1).filter(x => x.type === 'video').length - 1;
      if (window.MINI_PLAYER?.loadAndPlay) {
        window.MINI_PLAYER.loadAndPlay(allVids, Math.max(0, vidIdx));
        customPlaylistStarted = true;
      }
      if (playing) { widget.pause(); iframe.style.height = '0px'; setPlaying(false); }
    } else {
      if (window.MINI_PLAYER?.pause) window.MINI_PLAYER.pause();

      // Resolver fuentes del track (SC, YouTube, Spotify)
      const apiTrack   = apiTracks.find(a => String(a.id) === String(t.itemId || t.id));
      const trackYtId  = t.videoId || apiTrack?.videoId || null;
      let   trackScUrl = t.scUrl   || apiTrack?.scUrl   || null;

      // Helper: carga una URL de SC directamente en el widget (siempre oculto)
      const _loadScUrl = (url, ytFallback) => {
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
          const scBase = SC_PLAYLIST.split('/sets/')[0];
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
    customTrackList = defaultRadioTracks.map(t => ({
      id: t.id, itemId: t.id, title: t.title,
      cover: t.cover, scUrl: t.scUrl, videoId: t.videoId,
      spotifyUrl: t.spotifyUrl, type: 'track',
    }));
    const nameEl  = document.getElementById('radio-pl-name');
    const loopBtn = document.getElementById('radio-loop-btn');
    if (nameEl)  nameEl.textContent    = 'RAYVER Radio';
    if (loopBtn) loopBtn.style.display = '';
    renderCustomTracklist(customTrackList);
    showCustomTrack(0);
  }

  window.toggleRadioLoop = function() {
    loopPlaylist = !loopPlaylist;
    const btn = document.getElementById('radio-loop-btn');
    if (btn) btn.classList.toggle('active', loopPlaylist);
    btn.title = loopPlaylist ? 'Repetir lista: ON' : 'Repetir lista: OFF';
  };

  // Close dropdown when clicking outside
  document.addEventListener('click', e => {
    if (rplDropOpen && !e.target.closest('#radio-pl-dropdown') && !e.target.closest('#radio-pl-selector-btn')) {
      closeRplDropdown();
    }
  });

  // ── INIT ─────────────────────────────────────────────────────────
  function init() {
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
          customTrackList = playable.map(t => ({
            id: t.id, itemId: t.id, title: t.title, cover: t.cover || null,
            scUrl: t.scUrl || null, videoId: t.videoId || null,
            spotifyUrl: t.spotifyUrl || null, type: 'track',
          }));
          const nameEl  = document.getElementById('radio-pl-name');
          const loopBtn = document.getElementById('radio-loop-btn');
          if (nameEl)  nameEl.textContent    = 'RAYVER Radio';
          if (loopBtn) loopBtn.style.display = '';
          renderCustomTracklist(customTrackList);
          showCustomTrack(0);
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
