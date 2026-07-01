/**
 * RAYVER RADIO v10
 * Una sola fuente de verdad: SC Widget.
 * scSounds[] = lo que SC tiene. tracks[] = enriquecido con API.
 * El header SIEMPRE muestra scSounds[currentIdx] — nunca se desincroniza.
 */
(function () {
  'use strict';

  const SC_PLAYLIST = 'https://soundcloud.com/biel-rivero-sampol/sets/marzo-best-ranking';

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
  let widget     = null;
  let widgetRdy  = false;
  let scSounds   = [];   // raw de getSounds() — fuente de verdad de SC
  let enriched   = [];   // scSounds + covers/links de la API
  let apiTracks  = [];   // de /api/public/tracks
  let currentIdx = 0;
  let playing    = false;
  let shuffle    = false;
  let repeat     = 'none';
  let muted      = false;
  let iframe     = null;
  let pendingPlay = false;

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

  function bindWidget() {
    widget = SC.Widget(iframe);

    widget.bind(SC.Widget.Events.READY, () => {
      widgetRdy = true;
      iframe.style.height = '116px';
      widget.setVolume(muted ? 0 : vol());

      widget.getSounds(sounds => {
        if (!sounds?.length) return;
        scSounds = sounds;
        buildEnriched();
        renderList();
        showTrack(0);
        if (counter) counter.textContent = `— / ${scSounds.length}`;
        if (pendingPlay) { pendingPlay = false; widget.play(); }
      });
    });

    widget.bind(SC.Widget.Events.PLAY, () => {
      iframe.style.height = '116px';
      setPlaying(true);
      widget.getCurrentSoundIndex(idx => {
        if (typeof idx !== 'number') return;
        currentIdx = idx;
        showTrack(idx);   // siempre desde scSounds[idx]
        highlight(idx);
        if (counter) counter.textContent = `${idx + 1} / ${scSounds.length}`;
      });
    });

    widget.bind(SC.Widget.Events.PAUSE, () => setPlaying(false));

    widget.bind(SC.Widget.Events.FINISH, () => {
      iframe.style.height = '0px';
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
    });

    widget.bind(SC.Widget.Events.ERROR, () => setTimeout(() => widget.next(), 1500));
  }

  function doShuffle() {
    let r = Math.floor(Math.random() * scSounds.length);
    if (r === currentIdx && scSounds.length > 1) r = (r+1) % scSounds.length;
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
    if (playing) { widget.pause(); iframe.style.height = '0px'; }
    else         { widget.play();  iframe.style.height = '116px'; }
  });

  prevBtn && prevBtn.addEventListener('click', () => {
    if (!widgetRdy) return;
    if (shuffle) doShuffle(); else widget.prev();
  });

  nextBtn && nextBtn.addEventListener('click', () => {
    if (!widgetRdy) return;
    if (shuffle) doShuffle(); else widget.next();
  });

  shufBtn && shufBtn.addEventListener('click', () => {
    shuffle = !shuffle;
    shufBtn.classList.toggle('active', shuffle);
  });

  muteBtn && muteBtn.addEventListener('click', () => {
    muted = !muted;
    if (widget && widgetRdy) widget.setVolume(muted ? 0 : vol());
    if (volIco) volIco.className = muted ? 'fas fa-volume-mute' : vol()<50 ? 'fas fa-volume-down' : 'fas fa-volume-up';
  });

  volEl && volEl.addEventListener('input', () => {
    if (!muted && widget && widgetRdy) widget.setVolume(vol());
    if (volIco) volIco.className = vol()===0 ? 'fas fa-volume-mute' : vol()<50 ? 'fas fa-volume-down' : 'fas fa-volume-up';
  });

  progEl && progEl.addEventListener('click', e => {
    if (!widget || !widgetRdy) return;
    const pct = (e.clientX - progEl.getBoundingClientRect().left) / progEl.offsetWidth;
    widget.getDuration(dur => widget.seekTo(Math.floor(pct * dur)));
  });

  // ── PUBLIC API ───────────────────────────────────────────────────
  window.RADIO_PLAYER = {
    skip: idx => {
      if (!widget || !widgetRdy || !scSounds[idx]) return;
      // Actualizar UI inmediatamente con scSounds[idx] — fuente de verdad
      currentIdx = idx;
      showTrack(idx);
      highlight(idx);
      iframe.style.height = '116px';
      widget.skip(idx);
      widget.play();
    },
    play: () => playBtn?.click(),
    getPlaylist: () => enriched,
  };
  window.radioPlayIdx = idx => window.RADIO_PLAYER.skip(idx);

  // ── INIT ─────────────────────────────────────────────────────────
  function init() {
    addRepeatBtn();
    if (titleEl)  titleEl.textContent  = 'RAYVER Radio';
    if (artistEl) artistEl.textContent = 'Pulsa ▶ para escuchar';
    if (counter)  counter.textContent  = '— / —';
    if (listBody) listBody.innerHTML   = `<div class="radio-empty"><i class="fas fa-circle-notch fa-spin"></i><p>Cargando playlist…</p></div>`;

    // Cargar metadata de API (covers Spotify, genre, BPM) sin bloquear
    fetch('/api/public/tracks')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.length) return;
        apiTracks = data;
        if (scSounds.length) { buildEnriched(); renderList(); }
      }).catch(() => {});

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
