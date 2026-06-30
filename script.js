'use strict';

// ── AUTH STATE ────────────────────────────────────────────────────
let AUTH = { token: null, user: null };

function getToken() { return localStorage.getItem('rv_token'); }
function setToken(t, user) {
  AUTH.token = t;
  AUTH.user = user;
  localStorage.setItem('rv_token', t);
  localStorage.setItem('rv_user', JSON.stringify(user));
}
function clearToken() {
  AUTH.token = null;
  AUTH.user = null;
  localStorage.removeItem('rv_token');
  localStorage.removeItem('rv_user');
}

async function apiUser(path, opts = {}) {
  const tok = AUTH.token || getToken();
  const headers = { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) };
  try {
    const r = await fetch('/api/user' + path, { headers, ...opts });
    const json = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data: json };
  } catch { return { ok: false, status: 0, data: {} }; }
}

// ── AUTH MODAL ────────────────────────────────────────────────────
window.openAuthModal = function(hint) {
  document.getElementById('auth-modal').style.display = 'flex';
  if (hint === 'register') switchAuthTab('register');
};
window.closeAuthModal = function() {
  document.getElementById('auth-modal').style.display = 'none';
};
window.switchAuthTab = function(tab) {
  document.getElementById('form-login').style.display    = tab === 'login'    ? '' : 'none';
  document.getElementById('form-register').style.display = tab === 'register' ? '' : 'none';
  document.getElementById('tab-login').classList.toggle('active',    tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  document.getElementById('login-error').textContent = '';
  document.getElementById('reg-error').textContent   = '';
};

window.submitLogin = async function(e) {
  e.preventDefault();
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  btn.disabled = true; btn.textContent = 'Entrando…';
  errEl.textContent = '';
  const r = await apiUser('/login', {
    method: 'POST',
    body: JSON.stringify({ email: document.getElementById('login-email').value, password: document.getElementById('login-password').value })
  });
  btn.disabled = false; btn.textContent = 'Iniciar sesión';
  if (!r.ok) { errEl.textContent = r.data.error || 'Error al iniciar sesión'; return; }
  setToken(r.data.token, r.data.user);
  closeAuthModal();
  updateAuthUI();
  await loadUserPlaylists();
  showToastGlobal('¡Bienvenido, ' + r.data.user.name + '!');
};

window.submitRegister = async function(e) {
  e.preventDefault();
  const btn = document.getElementById('reg-btn');
  const errEl = document.getElementById('reg-error');
  btn.disabled = true; btn.textContent = 'Creando cuenta…';
  errEl.textContent = '';
  const r = await apiUser('/register', {
    method: 'POST',
    body: JSON.stringify({ name: document.getElementById('reg-name').value, email: document.getElementById('reg-email').value, password: document.getElementById('reg-password').value })
  });
  btn.disabled = false; btn.textContent = 'Crear cuenta';
  if (!r.ok) { errEl.textContent = r.data.error || 'Error al registrarse'; return; }
  setToken(r.data.token, r.data.user);
  closeAuthModal();
  updateAuthUI();
  await loadUserPlaylists();
  showToastGlobal('¡Cuenta creada! Bienvenido, ' + r.data.user.name + ' 🎵');
};

window.logoutUser = async function() {
  await apiUser('/logout', { method: 'POST' });
  clearToken();
  userPlaylists = [];
  updateAuthUI();
  closeDropdownUser();
  showToastGlobal('Sesión cerrada');
};

function updateAuthUI() {
  const loginBtn  = document.getElementById('btn-open-auth');
  const userMenu  = document.getElementById('user-menu');
  const nameEl    = document.getElementById('nav-user-name');
  if (AUTH.user) {
    loginBtn && (loginBtn.style.display = 'none');
    userMenu && (userMenu.style.display = '');
    nameEl   && (nameEl.textContent = AUTH.user.name.split(' ')[0]);
  } else {
    loginBtn && (loginBtn.style.display = '');
    userMenu && (userMenu.style.display = 'none');
  }
}

window.toggleUserDropdown = function() {
  const dd = document.getElementById('user-dropdown');
  if (dd) dd.style.display = dd.style.display === 'none' ? '' : 'none';
};
function closeDropdownUser() {
  const dd = document.getElementById('user-dropdown');
  if (dd) dd.style.display = 'none';
}
document.addEventListener('click', e => {
  if (!e.target.closest('#user-menu')) closeDropdownUser();
});

// ── SERVER PLAYLISTS ──────────────────────────────────────────────
let userPlaylists = [];
let _pickerPending = null; // { type, itemId, title, cover, url }

async function loadUserPlaylists() {
  if (!AUTH.token && !getToken()) return;
  AUTH.token = AUTH.token || getToken();
  const r = await apiUser('/playlists');
  if (r.ok) userPlaylists = r.data;
}

window.addToPlaylist = function(type, itemId, title, cover, url) {
  if (!AUTH.user && !getToken()) {
    _pickerPending = { type, itemId, title, cover, url };
    openAuthModal();
    return;
  }
  _pickerPending = { type, itemId, title, cover, url };
  openPlaylistPicker();
};

window.openPlaylists = function() {
  document.getElementById('playlists-modal').style.display = 'flex';
  closeDropdownUser();
  renderPlaylistsModal();
};
window.closePlaylists = function() { document.getElementById('playlists-modal').style.display = 'none'; };

function renderPlaylistsModal() {
  const container = document.getElementById('playlists-list');
  if (!container) return;
  if (!userPlaylists.length) {
    container.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px 0">Sin listas todavía. Crea tu primera lista.</p>';
    return;
  }
  const TYPE_LABELS = { video: 'Video', track: 'Track', beat: 'Beat' };
  container.innerHTML = userPlaylists.map(pl => `
    <div class="playlist-item">
      <div class="playlist-item-header">
        <i class="fas fa-music" style="color:var(--primary-2)"></i>
        <span class="playlist-item-name">${esc(pl.name)}</span>
        <span class="playlist-item-count">${pl.tracks.length} item${pl.tracks.length !== 1 ? 's' : ''}</span>
        <div class="playlist-item-btns">
          <button onclick="deletePlaylist('${esc(pl.id)}')" class="danger" title="Eliminar lista"><i class="fas fa-trash"></i></button>
        </div>
      </div>
      ${pl.tracks.length ? `<div class="playlist-tracks-list">${pl.tracks.map(t => `
        <div class="playlist-track-row">
          <span class="track-type-badge">${TYPE_LABELS[t.type] || t.type}</span>
          <span class="playlist-track-title">${esc(t.title)}</span>
          ${t.url ? `<a href="${esc(t.url)}" target="_blank" style="color:var(--primary-2);font-size:12px"><i class="fas fa-external-link-alt"></i></a>` : ''}
          <button onclick="removeTrackFromPlaylist('${esc(pl.id)}','${esc(t.id)}')" title="Quitar"><i class="fas fa-times"></i></button>
        </div>`).join('')}</div>` : ''}
    </div>`).join('');
}

window.createPlaylistModal = async function(fromPicker) {
  const name = prompt('Nombre de la nueva lista:');
  if (!name || !name.trim()) return;
  const r = await apiUser('/playlists', { method: 'POST', body: JSON.stringify({ name }) });
  if (!r.ok) { showToastGlobal(r.data.error || 'Error al crear lista'); return; }
  userPlaylists.push(r.data);
  renderPlaylistsModal();
  if (fromPicker) { renderPlaylistPicker(); }
  showToastGlobal('Lista "' + r.data.name + '" creada');
};

window.deletePlaylist = async function(id) {
  if (!confirm('¿Eliminar esta lista?')) return;
  const r = await apiUser('/playlists/' + id, { method: 'DELETE' });
  if (!r.ok) { showToastGlobal('Error al eliminar'); return; }
  userPlaylists = userPlaylists.filter(p => p.id !== id);
  renderPlaylistsModal();
};

window.removeTrackFromPlaylist = async function(plId, trackId) {
  const r = await apiUser('/playlists/' + plId + '/tracks/' + trackId, { method: 'DELETE' });
  if (!r.ok) { showToastGlobal('Error al quitar'); return; }
  const pl = userPlaylists.find(p => p.id === plId);
  if (pl) pl.tracks = pl.tracks.filter(t => t.id !== trackId);
  renderPlaylistsModal();
};

function openPlaylistPicker() {
  const modal = document.getElementById('playlist-picker');
  if (!modal) return;
  modal.style.display = 'flex';
  renderPlaylistPicker();
}
window.closePlaylistPicker = function() {
  document.getElementById('playlist-picker').style.display = 'none';
};

function renderPlaylistPicker() {
  const info = document.getElementById('picker-item-info');
  const list = document.getElementById('picker-list');
  if (!info || !list || !_pickerPending) return;
  info.textContent = '🎵 ' + _pickerPending.title;
  if (!userPlaylists.length) {
    list.innerHTML = '<p style="color:var(--muted);font-size:13px;text-align:center;padding:12px 0">No tienes listas todavía.</p>';
    return;
  }
  list.innerHTML = userPlaylists.map(pl => `
    <div class="picker-pl-row" onclick="addTrackToPlaylist('${esc(pl.id)}')">
      <span class="picker-pl-name">${esc(pl.name)}</span>
      <span class="picker-pl-count">${pl.tracks.length} items</span>
    </div>`).join('');
}

async function addTrackToPlaylist(plId) {
  if (!_pickerPending) return;
  const r = await apiUser('/playlists/' + plId + '/tracks', {
    method: 'POST',
    body: JSON.stringify(_pickerPending)
  });
  if (r.status === 409) { showToastGlobal('Ya está en esa lista'); return; }
  if (!r.ok) { showToastGlobal(r.data.error || 'Error'); return; }
  const pl = userPlaylists.find(p => p.id === plId);
  if (pl) pl.tracks.push(r.data);
  closePlaylistPicker();
  _pickerPending = null;
  showToastGlobal('Añadido a "' + (pl ? pl.name : 'la lista') + '" ✓');
}

function showToastGlobal(msg) {
  let t = document.getElementById('rayver-toast');
  if (!t) { t = document.createElement('div'); t.id = 'rayver-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ── INIT AUTH (check stored token) ───────────────────────────────
async function initAuth() {
  const tok = getToken();
  if (!tok) return;
  AUTH.token = tok;
  const storedUser = localStorage.getItem('rv_user');
  if (storedUser) { try { AUTH.user = JSON.parse(storedUser); } catch {} }
  const r = await apiUser('/me');
  if (r.ok) {
    AUTH.user = r.data;
    updateAuthUI();
    await loadUserPlaylists();
  } else {
    clearToken();
  }
}

document.addEventListener('DOMContentLoaded', () => {

  // ── NAV SCROLL + ACTIVE ─────────────────────────────────────────
  const navbar = document.getElementById('navbar');
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-links a[data-section]');

  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 60);
    let current = '';
    sections.forEach(s => { if (window.scrollY >= s.offsetTop - 120) current = s.id; });
    navLinks.forEach(a => a.classList.toggle('active', a.dataset.section === current));
  }, { passive: true });

  // ── HAMBURGER ────────────────────────────────────────────────────
  const hamburger = document.getElementById('hamburger');
  const navLinksList = document.getElementById('nav-links');
  hamburger && hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('open');
    navLinksList.classList.toggle('open');
  });
  navLinksList && navLinksList.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      hamburger.classList.remove('open');
      navLinksList.classList.remove('open');
    });
  });

  // ── SMOOTH SCROLL ────────────────────────────────────────────────
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  });

  // ── HERO CANVAS PARTICLES ────────────────────────────────────────
  (function initParticles() {
    const canvas = document.getElementById('hero-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W, H, particles = [];
    function resize() { W = canvas.width = canvas.offsetWidth; H = canvas.height = canvas.offsetHeight; }
    function mkP() { return { x: Math.random()*W, y: Math.random()*H, r: Math.random()*1.5+.3, vx: (Math.random()-.5)*.4, vy: (Math.random()-.5)*.4, a: Math.random()*.6+.1 }; }
    resize();
    window.addEventListener('resize', () => { resize(); particles = Array.from({length:120},mkP); });
    particles = Array.from({length:120},mkP);
    function frame() {
      ctx.clearRect(0,0,W,H);
      particles.forEach(p => {
        p.x+=p.vx; p.y+=p.vy;
        if(p.x<0)p.x=W; if(p.x>W)p.x=0; if(p.y<0)p.y=H; if(p.y>H)p.y=0;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
        ctx.fillStyle=`rgba(168,85,247,${p.a})`; ctx.fill();
      });
      for(let i=0;i<particles.length;i++) for(let j=i+1;j<particles.length;j++) {
        const dx=particles[i].x-particles[j].x, dy=particles[i].y-particles[j].y;
        const dist=Math.sqrt(dx*dx+dy*dy);
        if(dist<100){ctx.beginPath();ctx.moveTo(particles[i].x,particles[i].y);ctx.lineTo(particles[j].x,particles[j].y);ctx.strokeStyle=`rgba(168,85,247,${(1-dist/100)*.12})`;ctx.lineWidth=.5;ctx.stroke();}
      }
      requestAnimationFrame(frame);
    }
    frame();
  })();

  // ── SCROLL REVEAL ────────────────────────────────────────────────
  document.querySelectorAll('.glass,.track-card,.beat-card,.license-card,.platform-card-link,.yt-card').forEach(el => el.classList.add('reveal'));
  const revealObs = new IntersectionObserver(entries => {
    entries.forEach(e => { if(e.isIntersecting){e.target.classList.add('visible');revealObs.unobserve(e.target);} });
  }, {threshold:0.08});
  document.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));

  // ── BEATS FILTER ─────────────────────────────────────────────────
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const genre = btn.dataset.genre;
      document.querySelectorAll('.beat-card').forEach(card => {
        const show = genre === 'all' || card.dataset.genre === genre;
        card.style.display = show ? '' : 'none';
      });
    });
  });

  // ── CONTACT MOTIVO ───────────────────────────────────────────────
  window.setMotivo = function(val) {
    const el = document.getElementById('motivo');
    if (!el) return;
    Array.from(el.options).forEach(o => { if(o.value===val||o.text.includes(val)) el.value=o.value; });
  };

  // ── API ──────────────────────────────────────────────────────────
  const API = '/api/public';
  async function apiGet(path) {
    try { const r = await fetch(API+path); if(!r.ok) return null; return await r.json(); }
    catch { return null; }
  }

  const PLATS = {
    spotify:{l:'Spotify',c:'ptag-s',i:'fab fa-spotify'},apple:{l:'Apple',c:'ptag-a',i:'fab fa-apple'},
    youtube:{l:'YouTube',c:'ptag-y',i:'fab fa-youtube'},tidal:{l:'Tidal',c:'ptag-t',i:'fas fa-water'},
    amazon:{l:'Amazon',c:'ptag-am',i:'fab fa-amazon'},soundcloud:{l:'SoundCloud',c:'ptag-sc',i:'fab fa-soundcloud'},
    deezer:{l:'Deezer',c:'ptag-dz',i:'fas fa-music'},distrokid:{l:'Link',c:'ptag-lk',i:'fas fa-link'}
  };
  const GRADS = ['linear-gradient(135deg,#1a0a2e,#4c1d95)','linear-gradient(135deg,#0f0520,#3b0764)','linear-gradient(135deg,#071424,#0c2d54)','linear-gradient(135deg,#200820,#451540)','linear-gradient(135deg,#0a1a08,#1a3510)','linear-gradient(135deg,#1a1008,#352a08)'];
  function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

  // ── TRACKS ───────────────────────────────────────────────────────
  async function loadTracks() {
    const tracks = await apiGet('/tracks');
    const grid = document.getElementById('music-grid');
    if (!grid) return;
    if (tracks && tracks.length) {
      const el = document.getElementById('stat-tracks');
      if (el) el.textContent = tracks.length;
      const ab = document.getElementById('about-tracks');
      if (ab) ab.textContent = tracks.length;
    }
    if (!tracks || !tracks.length) {
      grid.innerHTML = `<div class="track-card"><div class="track-art" style="background:${GRADS[0]}"><span>Feel It</span></div><div class="track-info"><div class="track-name">Feel It In The Air</div><div class="track-meta">Álbum · 2025</div><div class="track-platforms"><a href="https://open.spotify.com/artist/0GmwWh84e70RNGNkYOwE6d" target="_blank" class="ptag ptag-s"><i class="fab fa-spotify"></i> Spotify</a></div></div></div>`;
      return;
    }
    grid.innerHTML = tracks.map((t,i) => {
      const pills = Object.entries(t.platforms||{}).filter(([,v])=>v).map(([k,v])=>{const p=PLATS[k]||{l:k,c:'ptag-lk',i:'fas fa-link'};return `<a href="${esc(v)}" target="_blank" class="ptag ${p.c}"><i class="${p.i}"></i> ${p.l}</a>`;}).join('');
      const coverStyle = t.cover?`background-image:url(${t.cover});background-size:cover;background-position:center`:`background:${GRADS[i%GRADS.length]}`;
      const coverText = t.cover?'':`<span>${esc(t.title.split(' ').slice(0,2).join(' '))}</span>`;
      const spotifyUrl = t.spotifyUrl || (t.platforms && t.platforms.spotify) || '';
      return `<div class="track-card reveal"><div class="track-art" style="${coverStyle}">${coverText}</div><div class="track-info"><div class="track-name">${esc(t.title)}</div><div class="track-meta">${esc(t.type||'Single')}${t.year?' · '+t.year:''}</div><div class="track-platforms">${pills||'<span class="ptag ptag-lk">Próximamente</span>'}</div><button class="btn-add-playlist" onclick="addToPlaylist('track','${esc(t.id||t.spotifyId||t.title)}','${esc(t.title)}','${esc(t.cover||'')}','${esc(spotifyUrl)}')" style="margin-top:8px"><i class="fas fa-plus"></i> Mi lista</button></div></div>`;
    }).join('');
    grid.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));
  }

  // ── VIDEOS + MINI PLAYER ─────────────────────────────────────────
  let allVideos = [];

  async function loadVideos() {
    const videos = await apiGet('/videos');
    const statEl = document.getElementById('stat-videos');
    if (!videos || !videos.length) return;
    allVideos = videos;
    if (statEl) statEl.textContent = videos.length;

    // Ordenar por order si existe
    allVideos.sort((a,b) => (a.order||0)-(b.order||0));

    const featured = allVideos.find(v=>v.featured) || allVideos[0];
    setMainVideo(featured);

    // Grid de videos (todos menos el destacado en la posición principal)
    const grid = document.getElementById('yt-grid');
    if (grid) {
      grid.innerHTML = allVideos.map((v,i) => `
        <div class="yt-card reveal" data-videoid="${esc(v.videoId)}" onclick="selectVideo('${esc(v.videoId)}','${esc(v.title||'')}','${esc(v.desc||'')}')">
          <div class="yt-thumb">
            <img src="https://img.youtube.com/vi/${esc(v.videoId)}/mqdefault.jpg" alt="${esc(v.title||'')}" loading="lazy">
            <div class="yt-play-btn"><div class="yt-play-circle"><i class="fas fa-play"></i></div></div>
            ${v.featured?'<div class="yt-featured-badge">⭐ Destacado</div>':''}
          </div>
          <div class="yt-card-info">
            <div class="yt-card-title">${esc(v.title||v.videoId)}</div>
            <div class="yt-card-desc">${esc(v.desc||'')}</div>
            <button class="yt-add-playlist btn-add-playlist" onclick="event.stopPropagation();addToPlaylist('video','${esc(v.videoId)}','${esc(v.title||v.videoId)}','https://img.youtube.com/vi/${esc(v.videoId)}/mqdefault.jpg','https://www.youtube.com/watch?v=${esc(v.videoId)}')" title="Añadir a mi lista">
              <i class="fas fa-plus"></i> Mi lista
            </button>
          </div>
        </div>`).join('');
      grid.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));
    }

    // Añadir todos los videos al mini player
    miniPlayerSetPlaylist(allVideos);
  }

  window.selectVideo = function(videoId, title, desc) {
    setMainVideo({videoId, title, desc});
    // Actualizar highlight en grid
    document.querySelectorAll('.yt-card').forEach(c => {
      c.classList.toggle('yt-card-active', c.dataset.videoid === videoId);
    });
    // Scroll al video principal
    document.getElementById('youtube')?.scrollIntoView({behavior:'smooth', block:'start'});
  };

  function setMainVideo(video) {
    if (!video) return;
    const iframe = document.getElementById('yt-featured-iframe');
    const titleEl = document.getElementById('yt-featured-title');
    const descEl  = document.getElementById('yt-featured-desc');
    const linkEl  = document.getElementById('yt-featured-link');
    if (iframe)  iframe.src = `https://www.youtube.com/embed/${esc(video.videoId)}?rel=0`;
    if (titleEl) titleEl.textContent = video.title || 'RAYVER — Video Musical';
    if (descEl)  descEl.textContent  = video.desc  || '';
    if (linkEl)  linkEl.href = `https://www.youtube.com/watch?v=${esc(video.videoId)}`;
  }

  // ── BEATS ────────────────────────────────────────────────────────
  async function loadBeats() {
    const products = await apiGet('/products');
    const grid = document.getElementById('beats-grid');
    if (!grid) return;
    const beats = (products||[]).filter(p=>p.type==='product');
    if (!beats.length) {
      grid.innerHTML = `
        <div class="beat-card" data-genre="trance"><div class="beat-cover beat-trance"><span class="beat-genre-tag">Trance</span>🎹</div><div class="beat-body"><div class="beat-title">Feel It In The Air</div><div class="beat-meta">138 BPM · Am</div><div class="beat-footer"><span class="beat-price">desde <strong>49€</strong></span><a href="#contact" class="beats-btn" onclick="setMotivo('Licencia de beat — Feel It In The Air')">Licenciar</a></div></div></div>
        <div class="beat-card" data-genre="electronica"><div class="beat-cover beat-electronic"><span class="beat-genre-tag">Electrónica</span>🎛️</div><div class="beat-body"><div class="beat-title">Summum</div><div class="beat-meta">124 BPM · Gm</div><div class="beat-footer"><span class="beat-price">desde <strong>49€</strong></span><a href="#contact" class="beats-btn" onclick="setMotivo('Licencia de beat — Summum')">Licenciar</a></div></div></div>
        <div class="beat-card" data-genre="trance"><div class="beat-cover beat-trance2"><span class="beat-genre-tag">Trance</span>🎵</div><div class="beat-body"><div class="beat-title">Shine Together</div><div class="beat-meta">130 BPM · Em</div><div class="beat-footer"><span class="beat-price">desde <strong>49€</strong></span><a href="#contact" class="beats-btn" onclick="setMotivo('Licencia de beat — Shine Together')">Licenciar</a></div></div></div>
        <div class="beat-card" data-genre="orquestal"><div class="beat-cover beat-orquestal"><span class="beat-genre-tag">Orquestal</span>🎻</div><div class="beat-body"><div class="beat-title">Eternal Frequencies</div><div class="beat-meta">120 BPM · Dm</div><div class="beat-footer"><span class="beat-price">desde <strong>49€</strong></span><a href="#contact" class="beats-btn" onclick="setMotivo('Licencia de beat — Eternal Frequencies')">Licenciar</a></div></div></div>
        <div class="beat-card" data-genre="orquestal"><div class="beat-cover beat-orquestal2"><span class="beat-genre-tag">Orquestal</span>🎼</div><div class="beat-body"><div class="beat-title">Classic Essence</div><div class="beat-meta">80 BPM · Fm</div><div class="beat-footer"><span class="beat-price">desde <strong>69€</strong></span><a href="#contact" class="beats-btn" onclick="setMotivo('Licencia de beat — Classic Essence')">Licenciar</a></div></div></div>
        <div class="beat-card" data-genre="pop"><div class="beat-cover beat-pop"><span class="beat-genre-tag">Pop</span>🎤</div><div class="beat-body"><div class="beat-title">Vuelven las Emociones</div><div class="beat-meta">118 BPM · C</div><div class="beat-footer"><span class="beat-price">desde <strong>39€</strong></span><a href="#contact" class="beats-btn" onclick="setMotivo('Licencia de beat — Vuelven las Emociones')">Licenciar</a></div></div></div>`;
      return;
    }
    const EMOJIS=['🎹','🎛️','🎵','🎻','🎼','🎤','⚡','🌙'];
    const COVERS=['beat-trance','beat-electronic','beat-orquestal','beat-trance2','beat-electronic2','beat-pop'];
    grid.innerHTML = beats.map((p,i)=>{
      const price = p.price?`desde <strong>${p.price}€</strong>`:'Consultar';
      return `<div class="beat-card" data-genre="${esc(p.genre||'electronica')}"><div class="beat-cover ${COVERS[i%COVERS.length]}"><span class="beat-genre-tag">${esc(p.category||'Beat')}</span>${p.emoji||EMOJIS[i%EMOJIS.length]}</div><div class="beat-body"><div class="beat-title">${esc(p.name)}</div><div class="beat-meta">${esc(p.description||'')}</div><div class="beat-footer"><span class="beat-price">${price}</span><a href="#contact" class="beats-btn" onclick="setMotivo('Licencia de beat — ${esc(p.name)}')">Licenciar</a></div><button class="btn-add-playlist" onclick="addToPlaylist('beat','${esc(p.id)}','${esc(p.name)}','','')" style="margin-top:8px"><i class="fas fa-plus"></i> Mi lista</button></div></div>`;
    }).join('');
  }

  // ── MINI PLAYER FLOTANTE ─────────────────────────────────────────
  let miniPlaylist = [];
  let miniCurrentIdx = 0;
  let miniVisible = true;
  let miniMinimized = false;
  let activeUserPlaylist = null;

  function miniPlayerSetPlaylist(videos) {
    miniPlaylist = videos;
    miniRenderQueue();
  }

  function createMiniPlayer() {
    if (document.getElementById('mini-player')) return;
    const mp = document.createElement('div');
    mp.id = 'mini-player';
    mp.innerHTML = `
      <div id="mini-player-bar">
        <div id="mini-info">
          <img id="mini-thumb" src="" alt="">
          <div id="mini-meta">
            <div id="mini-title">RAYVER Radio</div>
            <div id="mini-sub">Selecciona un video</div>
          </div>
        </div>
        <div id="mini-controls">
          <button onclick="miniPrev()" title="Anterior"><i class="fas fa-step-backward"></i></button>
          <button id="mini-play-btn" onclick="miniTogglePlay()" title="Play/Pausa"><i class="fas fa-play" id="mini-play-icon"></i></button>
          <button onclick="miniNext()" title="Siguiente"><i class="fas fa-step-forward"></i></button>
        </div>
        <div id="mini-actions">
          <button onclick="miniToggleQueue()" title="Cola" id="mini-queue-btn"><i class="fas fa-list"></i></button>
          <button onclick="miniTogglePlaylists()" title="Mis listas" id="mini-pl-btn"><i class="fas fa-heart"></i></button>
          <button onclick="miniToggleMinimize()" title="Minimizar" id="mini-min-btn"><i class="fas fa-chevron-up"></i></button>
          <button onclick="miniClose()" title="Cerrar"><i class="fas fa-times"></i></button>
        </div>
      </div>
      <div id="mini-yt-wrap" style="display:none">
        <iframe id="mini-yt-iframe" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>
      </div>
      <div id="mini-panel" style="display:none">
        <div id="mini-panel-tabs">
          <button class="mini-tab active" onclick="miniSwitchTab('queue')">Cola</button>
          <button class="mini-tab" onclick="miniSwitchTab('playlists')">Mis listas</button>
        </div>
        <div id="mini-tab-queue" class="mini-tab-content">
          <div id="mini-queue-list"></div>
        </div>
        <div id="mini-tab-playlists" class="mini-tab-content" style="display:none">
          <div id="mini-pl-actions">
            <button onclick="miniCreatePlaylist()" class="mini-pl-new"><i class="fas fa-plus"></i> Nueva lista</button>
          </div>
          <div id="mini-pl-list"></div>
        </div>
      </div>
    `;
    document.body.appendChild(mp);
    miniRenderQueue();
    miniRenderPlaylists();
  }

  let miniPanelOpen = false;
  let miniActiveTab = 'queue';

  window.miniToggleQueue = function() {
    miniActiveTab = 'queue';
    miniPanelOpen = !miniPanelOpen || miniActiveTab !== 'queue';
    miniPanelOpen = true;
    updateMiniPanel();
  };

  window.miniTogglePlaylists = function() {
    miniActiveTab = 'playlists';
    miniPanelOpen = true;
    updateMiniPanel();
  };

  function updateMiniPanel() {
    const panel = document.getElementById('mini-panel');
    if (!panel) return;
    panel.style.display = miniPanelOpen ? '' : 'none';
    miniSwitchTab(miniActiveTab);
  }

  window.miniSwitchTab = function(tab) {
    miniActiveTab = tab;
    document.querySelectorAll('.mini-tab').forEach(t => t.classList.toggle('active', t.textContent.toLowerCase().includes(tab==='queue'?'cola':'lista')));
    document.getElementById('mini-tab-queue').style.display = tab==='queue'?'':'none';
    document.getElementById('mini-tab-playlists').style.display = tab==='playlists'?'':'none';
    if (tab==='playlists') miniRenderPlaylists();
  };

  window.miniToggleMinimize = function() {
    miniMinimized = !miniMinimized;
    const mp = document.getElementById('mini-player');
    if (!mp) return;
    mp.classList.toggle('mini-minimized', miniMinimized);
    const icon = document.getElementById('mini-min-btn')?.querySelector('i');
    if (icon) icon.className = miniMinimized ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
    if (miniMinimized) {
      const panel = document.getElementById('mini-panel');
      const wrap  = document.getElementById('mini-yt-wrap');
      if (panel) panel.style.display = 'none';
      if (wrap)  wrap.style.display  = 'none';
      miniPanelOpen = false;
    }
  };

  window.miniClose = function() {
    const mp = document.getElementById('mini-player');
    if (mp) { mp.style.display = 'none'; miniVisible = false; }
    const ytWrap = document.getElementById('mini-yt-wrap');
    if (ytWrap) ytWrap.style.display = 'none';
    const iframe = document.getElementById('mini-yt-iframe');
    if (iframe) iframe.src = '';
  };

  let miniPlaying = false;

  window.miniTogglePlay = function() {
    if (!miniPlaylist.length) return;
    if (!miniPlaying) {
      miniPlayVideo(miniCurrentIdx);
    } else {
      const iframe = document.getElementById('mini-yt-iframe');
      if (iframe) iframe.src = iframe.src.replace('autoplay=1','autoplay=0');
      const icon = document.getElementById('mini-play-icon');
      if (icon) icon.className = 'fas fa-play';
      miniPlaying = false;
    }
  };

  function miniPlayVideo(idx) {
    if (!miniPlaylist.length) return;
    miniCurrentIdx = ((idx%miniPlaylist.length)+miniPlaylist.length)%miniPlaylist.length;
    const v = miniPlaylist[miniCurrentIdx];
    if (!v) return;

    // Mostrar iframe
    const wrap = document.getElementById('mini-yt-wrap');
    const iframe = document.getElementById('mini-yt-iframe');
    if (wrap) { wrap.style.display = ''; }
    if (iframe) iframe.src = `https://www.youtube.com/embed/${v.videoId}?autoplay=1&rel=0`;

    // Update info
    const thumb = document.getElementById('mini-thumb');
    const titleEl = document.getElementById('mini-title');
    const subEl = document.getElementById('mini-sub');
    if (thumb) thumb.src = `https://img.youtube.com/vi/${v.videoId}/default.jpg`;
    if (titleEl) titleEl.textContent = v.title || v.videoId;
    if (subEl) subEl.textContent = 'RAYVER';

    const icon = document.getElementById('mini-play-icon');
    if (icon) icon.className = 'fas fa-pause';
    miniPlaying = true;

    // Si el mini player está cerrado, reabrirlo
    const mp = document.getElementById('mini-player');
    if (mp) mp.style.display = '';
    miniVisible = true;

    // Highlight en queue
    miniRenderQueue();

    // Actualizar video principal en sección YouTube si está visible
    setMainVideo(v);
  }

  window.miniNext = function() { miniPlayVideo(miniCurrentIdx+1); };
  window.miniPrev = function() { miniPlayVideo(miniCurrentIdx-1); };

  window.miniPlayFromQueue = function(idx) { miniPlayVideo(idx); };

  function miniRenderQueue() {
    const list = document.getElementById('mini-queue-list');
    if (!list) return;
    if (!miniPlaylist.length) {
      list.innerHTML = '<div style="padding:12px;color:rgba(255,255,255,.4);font-size:12px;text-align:center">Sin videos en cola</div>';
      return;
    }
    list.innerHTML = miniPlaylist.map((v,i) => `
      <div class="mini-queue-item ${i===miniCurrentIdx?'mini-queue-active':''}" onclick="miniPlayFromQueue(${i})">
        <img src="https://img.youtube.com/vi/${esc(v.videoId)}/default.jpg" alt="">
        <div class="mini-queue-info">
          <div class="mini-queue-title">${esc(v.title||v.videoId)}</div>
        </div>
        <button onclick="event.stopPropagation();addToPlaylist('video','${esc(v.videoId)}','${esc(v.title||v.videoId)}','','https://www.youtube.com/watch?v=${esc(v.videoId)}')" class="mini-add-btn" title="Añadir a lista"><i class="fas fa-plus"></i></button>
      </div>`).join('');
  }

  // ── MINI PLAYER — LISTAS SERVIDOR ────────────────────────────────
  window.miniCreatePlaylist = function() { openPlaylists(); };

  window.miniDeletePlaylist = async function(id) {
    const pl = userPlaylists.find(p=>p.id===id);
    if (!confirm(`¿Eliminar "${pl?.name}"?`)) return;
    await deletePlaylist(id);
    miniRenderPlaylists();
  };

  window.miniPlayPlaylist = function(id) {
    const pl = userPlaylists.find(p=>p.id===id);
    if (!pl) return;
    const videos = (pl.tracks||[]).filter(t=>t.type==='video').map(t=>({videoId:t.itemId, title:t.title}));
    if (!videos.length) { showToast('Sin videos en esta lista'); return; }
    miniPlaylist = videos;
    miniCurrentIdx = 0;
    miniPlayVideo(0);
    miniRenderQueue();
  };

  window._miniRemoveTrack = async function(plId, trackId) {
    await removeTrackFromPlaylist(plId, trackId);
    miniRenderPlaylists();
  };

  function miniRenderPlaylists() {
    const list = document.getElementById('mini-pl-list');
    if (!list) return;
    if (!userPlaylists.length) {
      list.innerHTML = `<div style="padding:16px;text-align:center;color:rgba(255,255,255,.4);font-size:12px">
        Sin listas aún.<br>
        <button onclick="openPlaylists()" style="margin-top:8px;background:none;border:1px solid rgba(255,255,255,.2);color:#fff;padding:4px 12px;border-radius:20px;cursor:pointer;font-size:12px">Crear lista</button>
      </div>`;
      return;
    }
    list.innerHTML = userPlaylists.map(pl => {
      const videos = (pl.tracks||[]).filter(t=>t.type==='video');
      return `
        <div class="mini-pl-item">
          <div class="mini-pl-header">
            <i class="fas fa-music" style="color:var(--primary-2);margin-right:6px"></i>
            <span class="mini-pl-name">${esc(pl.name)}</span>
            <span class="mini-pl-count">${(pl.tracks||[]).length} items</span>
            <div class="mini-pl-btns">
              <button onclick="miniPlayPlaylist('${esc(pl.id)}')" title="Reproducir"><i class="fas fa-play"></i></button>
              <button onclick="miniDeletePlaylist('${esc(pl.id)}')" style="color:#ef4444" title="Eliminar"><i class="fas fa-trash"></i></button>
            </div>
          </div>
          ${videos.length?`<div class="mini-pl-videos">${videos.slice(0,3).map(v=>`
            <div class="mini-pl-video">
              <img src="https://img.youtube.com/vi/${esc(v.itemId)}/default.jpg" alt="">
              <span>${esc(v.title||v.itemId)}</span>
              <button onclick="_miniRemoveTrack('${esc(pl.id)}','${esc(v.id)}')" title="Quitar"><i class="fas fa-times"></i></button>
            </div>`).join('')}
            ${videos.length>3?`<div style="font-size:11px;color:rgba(255,255,255,.4);padding:4px 8px">+${videos.length-3} más</div>`:''}
          </div>`:''}
        </div>`;
    }).join('');
  }

  // ── GÉNEROS DINÁMICOS ─────────────────────────────────────────────
  async function loadGenres() {
    const genres = await apiGet('/genres');
    const filterEl = document.getElementById('beats-filter');
    if (!filterEl || !genres || !genres.length) return;
    filterEl.innerHTML = `<button class="filter-btn active" data-genre="all">Todos</button>` +
      genres.map(g => `<button class="filter-btn" data-genre="${esc(g.slug)}">${esc(g.name)}</button>`).join('');
    filterEl.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        filterEl.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const genre = btn.dataset.genre;
        document.querySelectorAll('.beat-card').forEach(card => {
          card.style.display = genre === 'all' || card.dataset.genre === genre ? '' : 'none';
        });
      });
    });
  }

  // ── TOAST (alias para el global) ─────────────────────────────────
  function showToast(msg) { showToastGlobal(msg); }

  // ── INIT ─────────────────────────────────────────────────────────
  initAuth();
  updateAuthUI();
  createMiniPlayer();
  loadTracks();
  loadVideos();
  loadBeats();
  loadGenres();
});
