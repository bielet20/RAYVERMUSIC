/**
 * RAYVER RADIO v5 — SoundCloud iframe embed directo
 * El player ES el iframe de SoundCloud — sin API, sin CORS, funciona siempre
 * Carga los tracks desde /api/public/tracks y muestra la tracklist
 * Al seleccionar un track muestra su embed de SoundCloud o YouTube
 */
(function () {
  'use strict';

  const API = '/api/public';
  let tracks = [];
  let currentIdx = 0;
  let isPlaying = false;

  // DOM refs
  const playerWrap   = document.getElementById('radio-player');
  const titleEl      = document.getElementById('radio-title');
  const artistEl     = document.getElementById('radio-artist');
  const genreEl      = document.getElementById('radio-genre');
  const platTagsEl   = document.getElementById('radio-platform-tags');
  const onairDot     = document.getElementById('radio-onair-dot');
  const counterEl    = document.getElementById('radio-counter');
  const tracklistBody= document.getElementById('radio-tracklist-body');
  const coverEl      = document.getElementById('radio-cover');
  const coverPulse   = document.getElementById('radio-cover-pulse');

  // Ocultar controles nativos que no usamos en modo iframe
  const hideEls = ['radio-play','radio-prev','radio-next','radio-shuffle',
                   'radio-mute','radio-volume','radio-progress-wrap',
                   'radio-progress','radio-current-time','radio-duration'];
  hideEls.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Ocultar el audio element nativo
  const audioEl = document.getElementById('radio-audio');
  if (audioEl) audioEl.style.display = 'none';

  // Contenedor del embed
  let embedWrap = document.getElementById('radio-embed-wrap');
  if (!embedWrap) {
    embedWrap = document.createElement('div');
    embedWrap.id = 'radio-embed-wrap';
    embedWrap.style.cssText = 'width:100%;margin-top:16px;border-radius:10px;overflow:hidden;min-height:120px';
    if (playerWrap) playerWrap.appendChild(embedWrap);
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function getBestEmbed(track) {
    const sc = track.platforms?.soundcloud || track.streamUrl;
    if (sc && sc.includes('soundcloud.com')) {
      return {
        type: 'soundcloud',
        html: `<iframe width="100%" height="120" scrolling="no" frameborder="no" allow="autoplay"
          src="https://w.soundcloud.com/player/?url=${encodeURIComponent(sc)}&color=%23a855f7&auto_play=true&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false"
          style="border-radius:10px"></iframe>`
      };
    }
    const ytMatch = (track.streamUrl||track.platforms?.youtube||'').match(/(?:youtu\.be\/|v=)([A-Za-z0-9_-]{11})/);
    if (ytMatch) {
      return {
        type: 'youtube',
        html: `<iframe width="100%" height="120" frameborder="0" allow="autoplay; encrypted-media"
          src="https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&controls=1"
          style="border-radius:10px;background:#000"></iframe>`
      };
    }
    // Sin embed — mostrar links
    const links = Object.entries(track.platforms||{}).filter(([,v])=>v);
    if (links.length) {
      const btns = links.map(([k,v]) => {
        const names = {spotify:'Spotify',apple:'Apple Music',youtube:'YouTube',
                       soundcloud:'SoundCloud',tidal:'Tidal',amazon:'Amazon'};
        return `<a href="${esc(v)}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;padding:10px 18px;background:rgba(168,85,247,0.15);border:1px solid rgba(168,85,247,0.3);border-radius:8px;color:#a855f7;text-decoration:none;font-size:13px;font-weight:600;margin:4px">${names[k]||k}</a>`;
      }).join('');
      return {
        type: 'external',
        html: `<div style="text-align:center;padding:20px 0">
          <div style="font-size:12px;color:rgba(240,238,248,0.5);margin-bottom:12px">Escuchar en:</div>
          <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:8px">${btns}</div>
        </div>`
      };
    }
    return { type: 'none', html: '' };
  }

  function loadTrack(idx, play) {
    if (!tracks.length) return;
    currentIdx = ((idx % tracks.length) + tracks.length) % tracks.length;
    const track = tracks[currentIdx];

    // UI
    if (titleEl)  titleEl.textContent  = track.title || 'Sin título';
    if (artistEl) artistEl.textContent = 'RAYVER';
    if (genreEl)  genreEl.textContent  = track.type  || '';
    if (coverEl)  coverEl.src = track.cover || 'logo.jpg';
    if (counterEl) counterEl.textContent = `${currentIdx+1} / ${tracks.length}`;

    // Platform tags
    if (platTagsEl) {
      const entries = Object.entries(track.platforms||{}).filter(([,v])=>v);
      const PLAT = {spotify:'fab fa-spotify',apple:'fab fa-apple',youtube:'fab fa-youtube',
                    soundcloud:'fab fa-soundcloud',tidal:'fas fa-water',amazon:'fab fa-amazon'};
      const CLS  = {spotify:'ptag-spotify',apple:'ptag-apple',youtube:'ptag-youtube',
                    soundcloud:'ptag-soundcloud',tidal:'ptag-tidal',amazon:'ptag-amazon'};
      platTagsEl.innerHTML = entries.slice(0,4).map(([k,v])=>
        `<a href="${esc(v)}" target="_blank" class="radio-ptag ${CLS[k]||'ptag-lk'}">
          <i class="${PLAT[k]||'fas fa-link'}"></i> ${k}
        </a>`).join('');
    }

    // Tracklist highlight
    document.querySelectorAll('.radio-track-item').forEach((el,i) => {
      el.classList.toggle('active', i === currentIdx);
      if (i === currentIdx) el.scrollIntoView({behavior:'smooth',block:'nearest'});
    });

    // Embed
    if (play || isPlaying) {
      const embed = getBestEmbed(track);
      embedWrap.innerHTML = embed.html;
      isPlaying = embed.type !== 'none';
      if (onairDot) onairDot.classList.toggle('pulsing', isPlaying);
      if (coverEl)  coverEl.classList.toggle('spinning', isPlaying);
      if (coverPulse) coverPulse.classList.toggle('active', isPlaying);
    }
  }

  function renderTracklist() {
    if (!tracklistBody) return;
    if (!tracks.length) {
      tracklistBody.innerHTML = `<div class="radio-empty">
        <i class="fas fa-music"></i>
        Añade canciones desde el admin con URL de SoundCloud
      </div>`;
      return;
    }
    tracklistBody.innerHTML = tracks.map((t,i) => {
      const hasSC = !!(t.platforms?.soundcloud || (t.streamUrl||'').includes('soundcloud'));
      const hasYT = !!(t.platforms?.youtube || (t.streamUrl||'').match(/youtu/));
      const icon  = hasSC ? '☁️' : hasYT ? '▶️' : '🔗';
      return `<div class="radio-track-item${i===currentIdx?' active':''}" onclick="radioPlayIdx(${i})">
        <span class="rtitem-num">${i+1}</span>
        <img class="rtitem-cover" src="${esc(t.cover||'logo.jpg')}" alt="" loading="lazy">
        <div class="rtitem-info">
          <div class="rtitem-title">${esc(t.title)}</div>
          <div class="rtitem-sub">${esc(t.type||'Single')}${t.year?' · '+t.year:''} ${icon}</div>
        </div>
      </div>`;
    }).join('');
  }

  // Mostrar el embed del track inicial al hacer clic en play (primer click)
  // Añadir un botón de play grande encima del embed vacío
  function showPlayButton() {
    embedWrap.innerHTML = `
      <div id="radio-play-btn" onclick="radioStartPlay()"
        style="display:flex;align-items:center;justify-content:center;height:120px;cursor:pointer;
               background:rgba(168,85,247,0.08);border:1px solid rgba(168,85,247,0.2);
               border-radius:10px;gap:12px;transition:background 0.2s"
        onmouseover="this.style.background='rgba(168,85,247,0.18)'"
        onmouseout="this.style.background='rgba(168,85,247,0.08)'">
        <div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#a855f7);
                    display:flex;align-items:center;justify-content:center">
          <i class="fas fa-play" style="color:#fff;font-size:18px;margin-left:3px"></i>
        </div>
        <span style="color:rgba(240,238,248,0.7);font-size:14px">Pulsa para reproducir</span>
      </div>`;
  }

  window.radioStartPlay = function() {
    loadTrack(currentIdx, true);
  };

  window.radioPlayIdx = function(idx) {
    loadTrack(idx, true);
  };

  // Inicializar
  async function init() {
    try {
      const r = await fetch(`${API}/tracks`);
      if (r.ok) {
        const data = await r.json();
        if (data && data.length) tracks = data;
      }
    } catch(_) {}

    // Fallback con el perfil de SoundCloud
    if (!tracks.length) {
      tracks = [
        { id:'1', title:'We Were Always Light — Álbum', type:'Álbum', year:'2025',
          cover:'logo.jpg',
          platforms:{ soundcloud:'https://soundcloud.com/biel-rivero-sampol',
                      spotify:'https://open.spotify.com/artist/0GmwWh84e70RNGNkYOwE6d' }},
        { id:'2', title:'Summum', type:'Single', year:'2025',
          cover:'logo.jpg',
          platforms:{ soundcloud:'https://soundcloud.com/biel-rivero-sampol',
                      youtube:'https://youtu.be/_5ay8vh1SJk' }},
        { id:'3', title:'Feel It In The Air', type:'Álbum', year:'2025',
          cover:'logo.jpg',
          platforms:{ soundcloud:'https://soundcloud.com/biel-rivero-sampol' }}
      ];
    }

    loadTrack(0, false);
    showPlayButton();
    renderTracklist();
  }

  init();
})();
