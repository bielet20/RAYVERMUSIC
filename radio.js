/**
 * RAYVER RADIO v6
 * Usa el widget API de SoundCloud correctamente:
 * - Un solo iframe con la playlist completa del perfil
 * - Navegación prev/next via SC Widget API
 * - La tracklist se construye desde la API del backend
 * - Al hacer clic en un track salta a ese índice en el widget
 */
(function () {
  'use strict';

  const SC_PROFILE = 'https://soundcloud.com/biel-rivero-sampol/sets/marzo-best-ranking';
  const API = '/api/public';

  let tracks    = [];
  let currentIdx = 0;
  let isPlaying  = false;
  let widget     = null;
  let widgetReady = false;
  let scSoundCount = 0; // cuántos sonidos tiene SC

  // DOM
  const titleEl     = document.getElementById('radio-title');
  const artistEl    = document.getElementById('radio-artist');
  const genreEl     = document.getElementById('radio-genre');
  const platTagsEl  = document.getElementById('radio-platform-tags');
  const playBtn     = document.getElementById('radio-play');
  const playIcon    = document.getElementById('radio-play-icon');
  const prevBtn     = document.getElementById('radio-prev');
  const nextBtn     = document.getElementById('radio-next');
  const shuffleBtn  = document.getElementById('radio-shuffle');
  const volumeEl    = document.getElementById('radio-volume');
  const muteBtn     = document.getElementById('radio-mute');
  const volIcon     = document.getElementById('radio-vol-icon');
  const fillEl      = document.getElementById('radio-progress-fill');
  const curTimeEl   = document.getElementById('radio-current-time');
  const durEl       = document.getElementById('radio-duration');
  const onairDot    = document.getElementById('radio-onair-dot');
  const counterEl   = document.getElementById('radio-counter');
  const coverEl     = document.getElementById('radio-cover');
  const coverPulse  = document.getElementById('radio-cover-pulse');
  const tracklistBody = document.getElementById('radio-tracklist-body');
  const audioEl     = document.getElementById('radio-audio');
  const progEl      = document.getElementById('radio-progress');

  // Ocultar audio nativo
  if (audioEl) { audioEl.style.display='none'; audioEl.src=''; }

  // Ocultar barra de progreso (SC la maneja internamente)
  const progWrap = document.getElementById('radio-progress-wrap');
  if (progWrap) progWrap.style.display = 'none';

  // Crear iframe del widget SC
  function createWidget() {
    let iframe = document.getElementById('sc-widget');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'sc-widget';
      iframe.allow = 'autoplay';
      iframe.style.cssText = 'width:100%;height:0;border:none;display:block;overflow:hidden;border-radius:10px;margin-top:12px;transition:height 0.3s';
      iframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(SC_PROFILE)}`
        + `&color=%23a855f7&auto_play=false&hide_related=true&show_comments=false`
        + `&show_user=true&show_reposts=false&show_teaser=false&continuous_play=true`;
      const playerDiv = document.querySelector('.radio-player');
      if (playerDiv) playerDiv.appendChild(iframe);
    }
    return iframe;
  }

  function fmt(ms) {
    if (!ms || isNaN(ms)) return '0:00';
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function setPlayState(playing) {
    isPlaying = playing;
    if (playIcon) playIcon.className = playing ? 'fas fa-pause' : 'fas fa-play';
    if (onairDot) onairDot.classList.toggle('pulsing', playing);
    if (coverEl)  coverEl.classList.toggle('spinning', playing);
    if (coverPulse) coverPulse.classList.toggle('active', playing);
    const iframe = document.getElementById('sc-widget');
    if (iframe) iframe.style.height = playing ? '116px' : '0px';
  }

  function updateTrackUI(scSound) {
    // scSound viene del widget cuando cambia de pista
    if (!scSound) return;
    if (titleEl)  titleEl.textContent = scSound.title || '';
    if (artistEl) artistEl.textContent = scSound.user?.username || 'RAYVER';
    if (coverEl && scSound.artwork_url) {
      coverEl.src = scSound.artwork_url.replace('large','t300x300');
    }
    // Buscar en nuestra tracklist local
    const match = tracks.find(t =>
      t.title?.toLowerCase() === scSound.title?.toLowerCase()
    );
    if (match) {
      currentIdx = tracks.indexOf(match);
      if (platTagsEl) {
        const entries = Object.entries(match.platforms||{}).filter(([,v])=>v);
        platTagsEl.innerHTML = entries.slice(0,3).map(([k,v]) => {
          const cls = {spotify:'ptag-spotify',apple:'ptag-apple',youtube:'ptag-youtube',soundcloud:'ptag-soundcloud'}[k]||'ptag-lk';
          const icon = {spotify:'fab fa-spotify',apple:'fab fa-apple',youtube:'fab fa-youtube',soundcloud:'fab fa-soundcloud'}[k]||'fas fa-link';
          return `<a href="${esc(v)}" target="_blank" class="radio-ptag ${cls}"><i class="${icon}"></i> ${k}</a>`;
        }).join('');
      }
    }
    if (counterEl) counterEl.textContent = `${currentIdx+1} / ${Math.max(tracks.length, scSoundCount)||'?'}`;
    highlightTracklist(currentIdx);
  }

  function highlightTracklist(idx) {
    document.querySelectorAll('.radio-track-item').forEach((el,i) => {
      el.classList.toggle('active', i === idx);
      if (i === idx) el.scrollIntoView({behavior:'smooth',block:'nearest'});
    });
  }

  function initWidget() {
    const iframe = createWidget();
    // Cargar SC Widget API si no está
    if (!window.SC) {
      const s = document.createElement('script');
      s.src = 'https://w.soundcloud.com/player/api.js';
      s.onload = () => bindWidget(iframe);
      document.head.appendChild(s);
    } else {
      bindWidget(iframe);
    }
  }

  function bindWidget(iframe) {
    widget = window.SC.Widget(iframe);

    widget.bind(SC.Widget.Events.READY, () => {
      widgetReady = true;
      // Obtener cuántos sonidos hay en el perfil
      widget.getSounds(sounds => {
        scSoundCount = sounds ? sounds.length : 0;
        console.log('[radio] SC sounds:', scSoundCount);
      });
      if (counterEl) counterEl.textContent = `1 / ${tracks.length||'?'}`;
    });

    widget.bind(SC.Widget.Events.PLAY, () => {
      setPlayState(true);
      widget.getCurrentSound(s => updateTrackUI(s));
    });

    widget.bind(SC.Widget.Events.PAUSE, () => setPlayState(false));

    widget.bind(SC.Widget.Events.FINISH, () => {
      // Avanzar al siguiente automáticamente
      widget.next();
    });

    widget.bind(SC.Widget.Events.PLAY_PROGRESS, data => {
      if (fillEl && data.loadedProgress > 0) {
        const pct = (data.currentPosition / (data.duration||1)) * 100;
        fillEl.style.width = Math.min(pct,100) + '%';
      }
      if (curTimeEl) curTimeEl.textContent = fmt(data.currentPosition);
      if (durEl && data.duration) durEl.textContent = fmt(data.duration);
      if (progWrap) progWrap.style.display = '';
    });

    widget.bind(SC.Widget.Events.ERROR, () => {
      console.warn('[radio] SC error, skipping');
      setTimeout(() => widget.next(), 1000);
    });
  }

  // Controles
  if (playBtn) playBtn.addEventListener('click', () => {
    if (!widgetReady) {
      initWidget();
      setTimeout(() => { if (widget && widgetReady) widget.play(); }, 1500);
      return;
    }
    if (isPlaying) widget.pause();
    else widget.play();
  });

  if (prevBtn) prevBtn.addEventListener('click', () => {
    if (widget && widgetReady) widget.prev();
  });

  if (nextBtn) nextBtn.addEventListener('click', () => {
    if (widget && widgetReady) widget.next();
  });

  let isShuffle = false;
  if (shuffleBtn) shuffleBtn.addEventListener('click', () => {
    isShuffle = !isShuffle;
    shuffleBtn.classList.toggle('active', isShuffle);
  });

  let isMuted = false;
  if (muteBtn) muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    if (widget && widgetReady) widget.setVolume(isMuted ? 0 : (volumeEl?.value || 80));
    if (volIcon) volIcon.className = isMuted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
  });

  if (volumeEl) volumeEl.addEventListener('input', () => {
    if (widget && widgetReady) widget.setVolume(volumeEl.value);
    if (volIcon) {
      const v = volumeEl.value;
      volIcon.className = v == 0 ? 'fas fa-volume-mute' : v < 50 ? 'fas fa-volume-down' : 'fas fa-volume-up';
    }
  });

  // Seek
  if (progEl) progEl.addEventListener('click', e => {
    if (!widget || !widgetReady) return;
    const rect = progEl.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    widget.getDuration(dur => widget.seekTo(pct * dur));
  });

  // Tracklist click — salta al índice en SC
  window.radioPlayIdx = function(idx) {
    currentIdx = idx;
    if (!widgetReady) {
      initWidget();
      setTimeout(() => {
        if (widget && widgetReady) {
          widget.skip(idx);
          widget.play();
        }
      }, 1500);
      return;
    }
    widget.skip(idx);
    widget.play();
    highlightTracklist(idx);
  };

  function renderTracklist() {
    if (!tracklistBody) return;
    if (!tracks.length) {
      tracklistBody.innerHTML = `<div class="radio-empty">
        <i class="fas fa-music"></i>
        <p>Cargando canciones de SoundCloud…</p>
      </div>`;
      return;
    }
    tracklistBody.innerHTML = tracks.map((t,i) => `
      <div class="radio-track-item${i===currentIdx?' active':''}" onclick="radioPlayIdx(${i})">
        <span class="rtitem-num">${i+1}</span>
        <img class="rtitem-cover" src="${esc(t.cover||'logo.jpg')}" alt="" loading="lazy">
        <div class="rtitem-info">
          <div class="rtitem-title">${esc(t.title)}</div>
          <div class="rtitem-sub">${esc(t.type||'Single')}${t.year?' · '+t.year:''}</div>
        </div>
      </div>`).join('');
  }

  // Inicializar
  async function init() {
    // Cargar tracks de la API
    try {
      const r = await fetch(`${API}/tracks`);
      if (r.ok) {
        const data = await r.json();
        if (data && data.length) tracks = data;
      }
    } catch(_) {}

    // Fallback
    if (!tracks.length) {
      tracks = [
        {id:'1',title:'Feel It In The Air',type:'Álbum',year:'2025',cover:'logo.jpg',
          platforms:{soundcloud:SC_PROFILE,spotify:'https://open.spotify.com/artist/0GmwWh84e70RNGNkYOwE6d'}},
        {id:'2',title:'I Am Found',type:'Álbum',year:'2025',cover:'logo.jpg',
          platforms:{soundcloud:SC_PROFILE}},
        {id:'3',title:'Summum',type:'Single',year:'2025',cover:'logo.jpg',
          platforms:{soundcloud:SC_PROFILE,youtube:'https://youtu.be/_5ay8vh1SJk'}},
        {id:'4',title:'Hearts in Motion',type:'Álbum',year:'2025',cover:'logo.jpg',
          platforms:{soundcloud:SC_PROFILE}},
        {id:'5',title:'Shine Together',type:'Álbum',year:'2025',cover:'logo.jpg',
          platforms:{soundcloud:SC_PROFILE}},
        {id:'6',title:'We Were Always Light',type:'Álbum',year:'2025',cover:'logo.jpg',
          platforms:{soundcloud:SC_PROFILE}},
      ];
    }

    if (titleEl)  titleEl.textContent  = tracks[0]?.title || 'RAYVER Radio';
    if (artistEl) artistEl.textContent = 'RAYVER';
    if (counterEl) counterEl.textContent = `1 / ${tracks.length}`;

    renderTracklist();

    // Iniciar widget inmediatamente (sin autoplay — el usuario pulsa play)
    initWidget();
  }

  init();
})();
