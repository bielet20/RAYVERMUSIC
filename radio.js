/**
 * RAYVER RADIO v9 — SC Widget core, UI mejorado
 * Audio: SoundCloud Widget (probado, funciona)
 * Metadata: /api/public/tracks para Spotify links + covers
 */
(function () {
  'use strict';

  const SC_PLAYLIST = 'https://soundcloud.com/biel-rivero-sampol/sets/marzo-best-ranking';

  // ── STATE ───────────────────────────────────────────────────────
  let widget    = null;   // SC.Widget instance
  let widgetRdy = false;
  let tracks    = [];     // de getSounds() o /api/public/sc-playlist
  let apiTracks = [];     // de /api/public/tracks (Spotify links, metadata extra)
  let currentIdx = 0;
  let playing   = false;
  let shuffle   = false;
  let repeat    = 'none'; // none | one | all
  let muted     = false;
  let iframe    = null;
  let pendingPlay = false; // usuario pulsó play antes de que el widget estuviera listo

  // ── DOM ─────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const titleEl    = $('radio-title');
  const artistEl   = $('radio-artist');
  const genreEl    = $('radio-genre');
  const platTagsEl = $('radio-platform-tags');
  const playBtn    = $('radio-play');
  const playIcon   = $('radio-play-icon');
  const prevBtn    = $('radio-prev');
  const nextBtn    = $('radio-next');
  const shuffleBtn = $('radio-shuffle');
  const muteBtn    = $('radio-mute');
  const volIcon    = $('radio-vol-icon');
  const volEl      = $('radio-volume');
  const fillEl     = $('radio-progress-fill');
  const curTimeEl  = $('radio-current-time');
  const durEl      = $('radio-duration');
  const onairDot   = $('radio-onair-dot');
  const counterEl  = $('radio-counter');
  const coverEl    = $('radio-cover');
  const coverPulse = $('radio-cover-pulse');
  const listBody   = $('radio-tracklist-body');
  const progEl     = $('radio-progress');
  // Silenciar el <audio> nativo que pueda existir
  const audioEl    = $('radio-audio');
  if (audioEl) { audioEl.pause(); audioEl.src = ''; audioEl.style.display = 'none'; }

  // ── UTILS ───────────────────────────────────────────────────────
  function fmt(ms) {
    if (!ms || isNaN(ms)) return '0:00';
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function v() { return parseInt(volEl?.value ?? 80); }

  // ── IFRAME SC ───────────────────────────────────────────────────
  function createIframe() {
    iframe = $('sc-radio-iframe') || document.createElement('iframe');
    iframe.id    = 'sc-radio-iframe';
    iframe.allow = 'autoplay';
    // Dentro del player con height:0 → el navegador no bloquea el autoplay
    // porque el elemento está en el DOM visible (no off-screen invisible).
    iframe.style.cssText = 'width:100%;height:0;border:none;display:block;overflow:hidden;border-radius:10px;transition:height .3s ease;';
    iframe.src = buildSCUrl(false);

    const playerDiv = document.querySelector('.radio-player');
    if (playerDiv && !iframe.parentNode) playerDiv.appendChild(iframe);
    else if (!iframe.parentNode) document.body.appendChild(iframe);
  }

  function buildSCUrl(autoplay) {
    return `https://w.soundcloud.com/player/?url=${encodeURIComponent(SC_PLAYLIST)}`
      + `&color=%23a855f7&auto_play=${autoplay ? 'true' : 'false'}`
      + `&hide_related=true&show_comments=false&show_user=true`
      + `&show_reposts=false&show_teaser=false&continuous_play=true`;
  }

  // ── SC WIDGET BIND ──────────────────────────────────────────────
  function bindWidget() {
    widget = SC.Widget(iframe);

    widget.bind(SC.Widget.Events.READY, () => {
      widgetRdy = true;
      // Altura real para que el navegador acepte el audio
      iframe.style.height = '116px';
      widget.setVolume(muted ? 0 : v());
      widget.getSounds(sounds => {
        if (!sounds?.length) return;
        tracks = sounds.map(s => {
          // SC artwork_url puede ser null en muchos tracks — usar avatar del artista como fallback
          const scCover = s.artwork_url
            ? s.artwork_url.replace('-large', '-t300x300').replace('large.jpg', 't300x300.jpg')
            : null;
          return {
            id:        String(s.id),
            title:     s.title || '—',
            artist:    s.user?.username || 'RAYVER',
            cover:     scCover || null,         // null → gradient en renderList
            scCover,                             // guardar para preferencia SC
            userAvatar: s.user?.avatar_url || null,
            scUrl:     s.permalink_url || '',
            durationMs: s.duration || 0,
          };
        });
        // Enriquecer con datos de la API (Spotify covers son más fiables)
        mergeApiData();
        renderList();
        if (counterEl) counterEl.textContent = `— / ${tracks.length}`;
      });
      if (pendingPlay) { pendingPlay = false; widget.play(); }
    });

    widget.bind(SC.Widget.Events.PLAY, () => {
      iframe.style.height = '116px';
      setPlaying(true);
      widget.getCurrentSoundIndex(idx => {
        currentIdx = idx ?? 0;
        updateUI(tracks[currentIdx]);
        highlightList(currentIdx);
        if (counterEl) counterEl.textContent = `${currentIdx + 1} / ${tracks.length}`;
      });
    });

    widget.bind(SC.Widget.Events.PAUSE, () => setPlaying(false));

    widget.bind(SC.Widget.Events.FINISH, () => {
      if (repeat === 'one') {
        widget.seekTo(0); widget.play();
      } else if (shuffle) {
        skipToRandom();
      } else if (repeat === 'all') {
        widget.next();
      } else {
        setPlaying(false);
        iframe.style.height = '0px';
      }
    });

    widget.bind(SC.Widget.Events.PLAY_PROGRESS, data => {
      if (!data) return;
      const pos = data.currentPosition || 0;
      const dur = data.duration || 1;
      if (fillEl)    fillEl.style.width = Math.min((pos / dur) * 100, 100) + '%';
      if (curTimeEl) curTimeEl.textContent = fmt(pos);
      if (durEl)     durEl.textContent     = fmt(dur);
    });

    widget.bind(SC.Widget.Events.ERROR, () => {
      setTimeout(() => widget.next(), 1500);
    });
  }

  function skipToRandom() {
    let r = Math.floor(Math.random() * tracks.length);
    if (r === currentIdx && tracks.length > 1) r = (r + 1) % tracks.length;
    widget.skip(r);
    widget.play();
  }

  // ── API DATA MERGE ──────────────────────────────────────────────
  // Normaliza títulos para matching flexible (quita paréntesis, feat, remix tags, etc.)
  function normTitle(s) {
    return (s || '').toLowerCase()
      .replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '')   // quita (Extended Mix), [Remix]
      .replace(/feat\..*$/i, '').replace(/ft\..*$/i, '')  // quita feat.
      .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  function mergeApiData() {
    if (!apiTracks.length || !tracks.length) return;
    tracks.forEach(t => {
      const nt = normTitle(t.title);
      const match = apiTracks.find(a => {
        if (a.scUrl && a.scUrl === t.scUrl) return true;
        const na = normTitle(a.title);
        return na === nt || na.includes(nt) || nt.includes(na);
      });
      if (match) {
        // Cover: Spotify suele tener covers de alta calidad aunque SC no tenga
        if (match.cover && !t.scCover) t.cover = match.cover;
        else if (match.cover)          t.cover = t.scCover || match.cover;
        if (match.genre)      t.genre      = match.genre;
        if (match.bpm)        t.bpm        = match.bpm;
        if (match.key)        t.key        = match.key;
        if (match.spotifyUrl) t.spotifyUrl = match.spotifyUrl;
        if (match.platforms)  t.platforms  = match.platforms;
      }
      // Último recurso: avatar del artista en SC
      if (!t.cover && t.userAvatar) t.cover = t.userAvatar;
    });
  }

  // ── UI ──────────────────────────────────────────────────────────
  function updateUI(t) {
    if (!t) return;
    if (titleEl)  titleEl.textContent  = t.title  || 'RAYVER Radio';
    if (artistEl) artistEl.textContent = t.artist || 'RAYVER';
    if (coverEl)  { coverEl.src = t.cover || 'logo.jpg'; coverEl.onerror = () => { coverEl.src = 'logo.jpg'; }; }

    const meta = [t.genre, t.bpm ? t.bpm + ' BPM' : '', t.key].filter(Boolean).join(' · ');
    if (genreEl) genreEl.textContent = meta || '';

    if (platTagsEl) {
      const tags = [];
      if (t.scUrl)       tags.push(`<a href="${esc(t.scUrl)}" target="_blank" class="radio-ptag ptag-soundcloud"><i class="fab fa-soundcloud"></i> SoundCloud</a>`);
      const sp = t.spotifyUrl || t.platforms?.spotify;
      if (sp) tags.push(`<a href="${esc(sp)}" target="_blank" class="radio-ptag ptag-s"><i class="fab fa-spotify"></i> Spotify</a>`);
      platTagsEl.innerHTML = tags.join('');
    }

    if (fillEl)    fillEl.style.width     = '0%';
    if (curTimeEl) curTimeEl.textContent  = '0:00';
    if (durEl)     durEl.textContent      = fmt(t.durationMs || 0);
  }

  function setPlaying(p) {
    playing = p;
    if (playIcon)   playIcon.className = p ? 'fas fa-pause' : 'fas fa-play';
    if (onairDot)   onairDot.classList.toggle('pulsing', p);
    if (coverEl)    coverEl.classList.toggle('spinning', p);
    if (coverPulse) coverPulse.classList.toggle('active', p);
  }

  // ── TRACKLIST ───────────────────────────────────────────────────
  function renderList() {
    if (!listBody) return;
    if (!tracks.length) {
      listBody.innerHTML = `<div class="radio-empty"><i class="fas fa-circle-notch fa-spin"></i><p>Cargando…</p></div>`;
      return;
    }
    const GRADS = [
      'linear-gradient(135deg,#a855f7,#ec4899)',
      'linear-gradient(135deg,#6366f1,#a855f7)',
      'linear-gradient(135deg,#0ea5e9,#6366f1)',
      'linear-gradient(135deg,#10b981,#0ea5e9)',
      'linear-gradient(135deg,#f59e0b,#ef4444)',
      'linear-gradient(135deg,#ec4899,#f59e0b)',
      'linear-gradient(135deg,#8b5cf6,#06b6d4)',
    ];
    listBody.innerHTML = tracks.map((t, i) => {
      const sp = t.spotifyUrl || t.platforms?.spotify;
      const platBadge = sp
        ? `<span class="rtitem-plat-badge ptag-s"><i class="fab fa-spotify"></i></span>`
        : `<span class="rtitem-plat-badge ptag-soundcloud"><i class="fab fa-soundcloud"></i></span>`;
      const meta = [t.genre, t.bpm ? t.bpm + ' BPM' : '', t.key].filter(Boolean).join(' · ');
      // Usar imagen si existe, si no: gradiente de color con inicial del título
      const initial = esc((t.title || '?')[0].toUpperCase());
      const coverHtml = t.cover
        ? `<img class="rtitem-cover" src="${esc(t.cover)}" alt="${esc(t.title)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
          + `<span class="rtitem-cover rtitem-cover-grad" style="display:none;background:${GRADS[i % GRADS.length]}">${initial}</span>`
        : `<span class="rtitem-cover rtitem-cover-grad" style="background:${GRADS[i % GRADS.length]}">${initial}</span>`;
      return `
        <div class="radio-track-item${i === currentIdx ? ' active' : ''}" onclick="RADIO_PLAYER.skip(${i})">
          <span class="rtitem-num">${i + 1}</span>
          ${coverHtml}
          <div class="rtitem-info">
            <div class="rtitem-title">${esc(t.title)}</div>
            <div class="rtitem-sub">${esc(t.artist || 'RAYVER')}${meta ? ' · <em>' + esc(meta) + '</em>' : ''}</div>
          </div>
          ${platBadge}
        </div>`;
    }).join('');
  }

  function highlightList(idx) {
    if (!listBody) return;
    listBody.querySelectorAll('.radio-track-item').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
      if (i === idx) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  // ── REPEAT BUTTON ───────────────────────────────────────────────
  function addRepeatBtn() {
    if ($('radio-repeat') || !nextBtn) return;
    const btn = document.createElement('button');
    btn.id = 'radio-repeat'; btn.className = 'radio-btn-sm'; btn.title = 'Repetir';
    btn.innerHTML = '<i class="fas fa-redo"></i>';
    nextBtn.insertAdjacentElement('afterend', btn);
    btn.addEventListener('click', () => {
      const m = ['none','one','all'];
      repeat = m[(m.indexOf(repeat) + 1) % m.length];
      btn.querySelector('i').className = repeat === 'one' ? 'fas fa-redo-alt' : 'fas fa-redo';
      btn.classList.toggle('active', repeat !== 'none');
      btn.title = { none:'Repetir', one:'Repetir: este', all:'Repetir: todo' }[repeat];
    });
  }

  // ── CONTROLS ────────────────────────────────────────────────────
  playBtn && playBtn.addEventListener('click', () => {
    if (!widgetRdy) { pendingPlay = true; return; }
    if (playing) { widget.pause(); iframe.style.height = '0px'; }
    else         { widget.play();  iframe.style.height = '116px'; }
  });

  prevBtn && prevBtn.addEventListener('click', () => {
    if (!widgetRdy) return;
    if (shuffle) skipToRandom();
    else widget.prev();
  });

  nextBtn && nextBtn.addEventListener('click', () => {
    if (!widgetRdy) return;
    if (shuffle) skipToRandom();
    else widget.next();
  });

  shuffleBtn && shuffleBtn.addEventListener('click', () => {
    shuffle = !shuffle;
    shuffleBtn.classList.toggle('active', shuffle);
  });

  muteBtn && muteBtn.addEventListener('click', () => {
    muted = !muted;
    widget && widgetRdy && widget.setVolume(muted ? 0 : v());
    if (volIcon) volIcon.className = muted ? 'fas fa-volume-mute' : v() < 50 ? 'fas fa-volume-down' : 'fas fa-volume-up';
  });

  volEl && volEl.addEventListener('input', () => {
    if (!muted && widget && widgetRdy) widget.setVolume(v());
    if (volIcon) volIcon.className = v() === 0 ? 'fas fa-volume-mute' : v() < 50 ? 'fas fa-volume-down' : 'fas fa-volume-up';
  });

  progEl && progEl.addEventListener('click', e => {
    if (!widget || !widgetRdy) return;
    const pct = (e.clientX - progEl.getBoundingClientRect().left) / progEl.offsetWidth;
    widget.getDuration(dur => widget.seekTo(Math.floor(pct * dur)));
  });

  // ── PUBLIC API ──────────────────────────────────────────────────
  window.RADIO_PLAYER = {
    skip: idx => {
      if (!widget || !widgetRdy) return;
      widget.skip(idx);
      widget.play();
      iframe.style.height = '116px';
    },
    play: () => playBtn?.click(),
    getPlaylist: () => tracks,
  };
  window.radioPlayIdx = idx => window.RADIO_PLAYER.skip(idx);

  // ── INIT ────────────────────────────────────────────────────────
  function init() {
    addRepeatBtn();

    // Estado inicial UI
    if (titleEl)   titleEl.textContent   = 'RAYVER Radio';
    if (artistEl)  artistEl.textContent  = 'Pulsa ▶ para escuchar';
    if (counterEl) counterEl.textContent = '— / —';
    if (listBody)  listBody.innerHTML = `<div class="radio-empty"><i class="fas fa-circle-notch fa-spin"></i><p>Cargando playlist…</p></div>`;

    // Pre-cargar tracklist desde endpoint para que aparezca antes de que el widget esté listo
    fetch('/api/public/sc-playlist')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.tracks?.length) {
          tracks = data.tracks;
          renderList();
          updateUI(tracks[0]);
          if (counterEl) counterEl.textContent = `— / ${tracks.length}`;
        }
      }).catch(() => {});

    // Cargar metadata de la API (para Spotify links, genre, BPM, etc.)
    fetch('/api/public/tracks')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.length) {
          apiTracks = data;
          mergeApiData();
          renderList();
        }
      }).catch(() => {});

    // Crear iframe y cargar SC Widget API
    createIframe();

    if (window.SC) {
      bindWidget();
    } else {
      const s = document.createElement('script');
      s.src    = 'https://w.soundcloud.com/player/api.js';
      s.onload = bindWidget;
      document.head.appendChild(s);
    }
  }

  init();
})();
