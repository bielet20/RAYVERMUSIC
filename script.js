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
  if (window._pendingTSTrack) { window.openTrackSheet(window._pendingTSTrack); window._pendingTSTrack = null; }
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
  if (window._pendingTSTrack) { window.openTrackSheet(window._pendingTSTrack); window._pendingTSTrack = null; }
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
  // Verificar por token, no por objeto de usuario (puede no estar cargado aún)
  if (!(AUTH.token || getToken())) {
    _pickerPending = { type, itemId, title, cover, url };
    openAuthModal();
    return;
  }
  _pickerPending = { type, itemId, title, cover, url };
  openPlaylistPicker();
};

window.openPlaylists = async function() {
  const modal = document.getElementById('playlists-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  closeDropdownUser();
  if (!(AUTH.token || getToken())) { renderPlaylistsModal(); return; }
  await loadUserPlaylists();
  renderPlaylistsModal();
};
window.closePlaylists = function() { document.getElementById('playlists-modal').style.display = 'none'; };

function renderPlaylistsModal() {
  const container = document.getElementById('playlists-list');
  if (!container) return;
  if (!(AUTH.token || getToken())) {
    container.innerHTML = '<p class="pl-empty-msg">Inicia sesión para ver tus listas.</p>';
    return;
  }
  if (!userPlaylists.length) {
    container.innerHTML = '<p class="pl-empty-msg">Sin listas todavía.<br>Escribe un nombre arriba y pulsa Crear.</p>';
    return;
  }
  container.innerHTML = userPlaylists.map(pl => `
    <div class="playlist-item" data-plid="${esc(pl.id)}">
      <div class="playlist-item-header" onclick="togglePlaylistTracks('${esc(pl.id)}')">
        <div class="pl-icon"><i class="fas fa-music"></i></div>
        <div class="pl-info">
          <span class="playlist-item-name">${esc(pl.name)}</span>
          <span class="playlist-item-count">${pl.tracks.length} canción${pl.tracks.length !== 1 ? 'es' : ''}</span>
        </div>
        <i class="fas fa-chevron-down pl-chevron"></i>
        <div class="playlist-item-btns" onclick="event.stopPropagation()">
          <button onclick="renamePlaylist('${esc(pl.id)}')" class="pl-rename-btn" title="Renombrar"><i class="fas fa-edit"></i></button>
          <button onclick="mergePlaylistModal('${esc(pl.id)}')" class="pl-merge-btn" title="Fusionar"><i class="fas fa-layer-group"></i></button>
          <button onclick="confirmDeletePlaylist('${esc(pl.id)}')" class="pl-delete-btn" title="Eliminar lista"><i class="fas fa-trash"></i></button>
        </div>
      </div>
      <div class="playlist-tracks-list" id="pl-tracks-${esc(pl.id)}" style="display:none">
        ${pl.tracks.length ? pl.tracks.map(t => `
          <div class="playlist-track-row" id="ptr-${esc(t.id)}">
            <div class="ptr-cover" style="${t.cover ? `background-image:url('${t.cover.replace(/'/g,"\\'")}');background-size:cover;background-position:center` : 'background:rgba(168,85,247,.15)'}">
              ${t.cover ? '' : '<i class="fas fa-music" style="color:var(--primary-2);font-size:9px"></i>'}
            </div>
            <span class="playlist-track-title">${esc(t.title)}</span>
            ${t.url ? `<a href="${esc(t.url)}" target="_blank" class="ptr-link" title="Abrir enlace"><i class="fas fa-external-link-alt"></i></a>` : ''}
            <button class="ptr-remove" onclick="removeTrackFromPlaylist('${esc(pl.id)}','${esc(t.id)}')" title="Quitar de la lista"><i class="fas fa-times"></i></button>
          </div>`).join('')
        : '<div class="pl-empty-tracks"><i class="fas fa-plus-circle"></i> Lista vacía — añade canciones desde la sección Música</div>'}
      </div>
    </div>`).join('');
}

window.togglePlaylistTracks = function(plId) {
  const el   = document.getElementById('pl-tracks-' + plId);
  const hdr  = document.querySelector(`.playlist-item[data-plid="${plId}"] .playlist-item-header`);
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  hdr?.classList.toggle('pl-expanded', !open);
};

window.confirmDeletePlaylist = function(id) {
  const item = document.querySelector(`.playlist-item[data-plid="${id}"]`);
  if (!item) return;
  const btns = item.querySelector('.playlist-item-btns');
  if (!btns) return;
  btns.innerHTML = `
    <span class="pl-confirm-label">¿Eliminar?</span>
    <button class="pl-confirm-yes" onclick="deletePlaylist('${esc(id)}')">Sí</button>
    <button class="pl-confirm-no" onclick="renderPlaylistsModal()"><i class="fas fa-times"></i></button>
  `;
};

// Crear lista desde el picker (input inline, sin prompt)
window.createPlaylistInline = async function() {
  const input = document.getElementById('picker-new-name');
  const name = input?.value?.trim();
  if (!name) { input?.focus(); return; }
  input.disabled = true;
  const r = await apiUser('/playlists', { method: 'POST', body: JSON.stringify({ name }) });
  input.disabled = false;
  if (!r.ok) { showToastGlobal(r.data.error || 'Error al crear lista'); return; }
  userPlaylists.push(r.data);
  showToastGlobal('Lista "' + r.data.name + '" creada ✓');
  if (_pickerPending) {
    // Añadir la canción pendiente automáticamente a la nueva lista
    await addTrackToPlaylist(r.data.id);
  } else {
    renderPlaylistPicker();
    renderPlaylistsModal();
  }
};

// Crear lista desde el modal "Mis Listas"
window.createPlaylistDirect = async function() {
  const input = document.getElementById('pl-new-name');
  const name = input?.value?.trim();
  if (!name) { input?.focus(); return; }
  input.disabled = true;
  const r = await apiUser('/playlists', { method: 'POST', body: JSON.stringify({ name }) });
  input.disabled = false;
  if (!r.ok) { showToastGlobal(r.data.error || 'Error al crear lista'); return; }
  userPlaylists.push(r.data);
  input.value = '';
  renderPlaylistsModal();
  showToastGlobal('Lista "' + r.data.name + '" creada ✓');
};

// Compat: algunos botones aún llaman a esto
window.createPlaylistModal = function() { openPlaylists(); };

window.deletePlaylist = async function(id) {
  const r = await apiUser('/playlists/' + id, { method: 'DELETE' });
  if (!r.ok) { showToastGlobal('Error al eliminar'); renderPlaylistsModal(); return; }
  userPlaylists = userPlaylists.filter(p => p.id !== id);
  renderPlaylistsModal();
  showToastGlobal('Lista eliminada');
};

window.removeTrackFromPlaylist = async function(plId, trackId) {
  // Feedback visual inmediato
  const rowEl = document.getElementById('ptr-' + trackId);
  if (rowEl) { rowEl.style.opacity = '.4'; rowEl.style.pointerEvents = 'none'; }
  const r = await apiUser('/playlists/' + plId + '/tracks/' + trackId, { method: 'DELETE' });
  if (!r.ok) {
    if (rowEl) { rowEl.style.opacity = ''; rowEl.style.pointerEvents = ''; }
    showToastGlobal('Error al quitar');
    return;
  }
  const pl = userPlaylists.find(p => p.id === plId);
  if (pl) pl.tracks = pl.tracks.filter(t => t.id !== trackId);
  // Actualizar solo la sección de tracks de esta lista
  const tracksEl = document.getElementById('pl-tracks-' + plId);
  const countEl  = document.querySelector(`.playlist-item[data-plid="${plId}"] .playlist-item-count`);
  if (countEl && pl) countEl.textContent = pl.tracks.length + ' canción' + (pl.tracks.length !== 1 ? 'es' : '');
  if (tracksEl) {
    if (!pl || !pl.tracks.length) {
      tracksEl.innerHTML = '<div class="pl-empty-tracks"><i class="fas fa-plus-circle"></i> Lista vacía — añade canciones desde la sección Música</div>';
    } else {
      rowEl?.remove();
    }
  }
};

async function openPlaylistPicker() {
  const modal = document.getElementById('playlist-picker');
  if (!modal) return;
  // Refrescar listas si están vacías o si no se han cargado aún
  if (!userPlaylists.length) await loadUserPlaylists();
  modal.style.display = 'flex';
  renderPlaylistPicker();
  // Focus al input de nueva lista si no hay listas
  setTimeout(() => {
    if (!userPlaylists.length) document.getElementById('picker-new-name')?.focus();
  }, 150);
}
window.closePlaylistPicker = function() {
  document.getElementById('playlist-picker').style.display = 'none';
  _pickerPending = null;
};

function renderPlaylistPicker() {
  const info = document.getElementById('picker-item-info');
  const list = document.getElementById('picker-list');
  if (!info || !list) return;
  if (_pickerPending) {
    info.innerHTML = `<div class="picker-track-chip"><i class="fas fa-music"></i><span>${esc(_pickerPending.title)}</span></div>`;
  }
  const rows = userPlaylists.map(pl => `
    <div class="picker-pl-row" onclick="addTrackToPlaylist('${esc(pl.id)}')">
      <div class="picker-pl-icon"><i class="fas fa-music"></i></div>
      <div class="picker-pl-info">
        <span class="picker-pl-name">${esc(pl.name)}</span>
        <span class="picker-pl-count">${pl.tracks.length} canción${pl.tracks.length !== 1 ? 'es' : ''}</span>
      </div>
      <i class="fas fa-plus picker-pl-add"></i>
    </div>`).join('');
  list.innerHTML = `
    ${rows || '<p class="picker-empty">Crea tu primera lista para guardar canciones.</p>'}
    <div class="picker-new-list">
      <input type="text" id="picker-new-name" placeholder="Nueva lista…" maxlength="60"
        onkeydown="if(event.key==='Enter')createPlaylistInline()" autocomplete="off">
      <button class="picker-new-btn" onclick="createPlaylistInline()" title="Crear lista">
        <i class="fas fa-plus"></i>
      </button>
    </div>`;
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
    if (r.data) localStorage.setItem('rv_user', JSON.stringify(r.data));
    updateAuthUI();
    await loadUserPlaylists();
  } else if (r.status === 401) {
    // Solo limpiar en 401 explícito, no en error de red (status 0)
    clearToken();
    updateAuthUI();
  }
  // En error de red: conservar token y datos almacenados
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

  // ── TRACKS + FILTROS DINÁMICOS ────────────────────────────────────
  let allTracks      = [];
  let _renderedTracks = []; // copia del array visible actualmente en el grid
  let trackGenres    = [];
  let filterState    = { q: '', genre: 'all', type: 'all', sort: 'default' };

  function buildFilterBar() {
    if (document.getElementById('music-filter-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'music-filter-bar';
    bar.innerHTML = `
      <div class="mf-search-wrap">
        <i class="fas fa-search mf-search-icon"></i>
        <input type="search" id="mf-search" placeholder="Buscar por título, artista, género…" autocomplete="off" class="mf-search-input">
        <button id="mf-search-clear" class="mf-clear-btn" style="display:none" title="Limpiar"><i class="fas fa-times"></i></button>
      </div>
      <div class="mf-row">
        <div class="mf-group" id="mf-genres">
          <button class="filter-btn active" data-genre="all">Todos</button>
        </div>
        <div class="mf-group" id="mf-types">
          <button class="filter-btn active" data-type="all">Todo</button>
          <button class="filter-btn" data-type="single">Singles</button>
          <button class="filter-btn" data-type="ep">EPs</button>
          <button class="filter-btn" data-type="album">Álbumes</button>
          <button class="filter-btn" data-type="remix">Remixes</button>
        </div>
        <div class="mf-group">
          <select id="mf-sort" class="mf-select">
            <option value="default">Orden original</option>
            <option value="newest">Más recientes</option>
            <option value="az">A → Z</option>
            <option value="bpm_asc">BPM ↑</option>
            <option value="bpm_desc">BPM ↓</option>
          </select>
        </div>
      </div>
      <div id="mf-results-info" class="mf-results-info"></div>`;
    const grid = document.getElementById('music-grid');
    if (grid) grid.parentNode.insertBefore(bar, grid);

    // Search
    const searchEl = document.getElementById('mf-search');
    const clearBtn = document.getElementById('mf-search-clear');
    searchEl.addEventListener('input', () => {
      filterState.q = searchEl.value.trim().toLowerCase();
      clearBtn.style.display = filterState.q ? '' : 'none';
      applyFilters();
    });
    clearBtn.addEventListener('click', () => {
      searchEl.value = '';
      filterState.q = '';
      clearBtn.style.display = 'none';
      applyFilters();
    });

    // Genre buttons (base + from API)
    populateGenreFilters();

    // Type buttons
    document.getElementById('mf-types').querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('mf-types').querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filterState.type = btn.dataset.type;
        applyFilters();
      });
    });

    // Sort
    document.getElementById('mf-sort').addEventListener('change', e => {
      filterState.sort = e.target.value;
      applyFilters();
    });
  }

  function populateGenreFilters() {
    const container = document.getElementById('mf-genres');
    if (!container) return;
    const genres = trackGenres.length ? trackGenres : [...new Set(allTracks.map(t => t.genre).filter(Boolean))];
    const extra   = genres.map(g => `<button class="filter-btn" data-genre="${esc(g)}">${esc(g)}</button>`).join('');
    container.innerHTML = `<button class="filter-btn active" data-genre="all">Todos</button>${extra}`;
    container.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filterState.genre = btn.dataset.genre;
        applyFilters();
      });
    });
  }

  function applyFilters() {
    let tracks = [...allTracks];

    if (filterState.q) {
      tracks = tracks.filter(t =>
        (t.title  || '').toLowerCase().includes(filterState.q) ||
        (t.artist || '').toLowerCase().includes(filterState.q) ||
        (t.genre  || '').toLowerCase().includes(filterState.q) ||
        (t.tags   || []).some(tag => tag.toLowerCase().includes(filterState.q))
      );
    }
    if (filterState.genre !== 'all') {
      tracks = tracks.filter(t => (t.genre || '').toLowerCase() === filterState.genre.toLowerCase());
    }
    if (filterState.type !== 'all') {
      tracks = tracks.filter(t => {
        const type = (t.type || 'single').toLowerCase();
        return type === filterState.type ||
          (filterState.type === 'single' && !['ep','album','remix'].includes(type));
      });
    }

    switch (filterState.sort) {
      case 'newest':   tracks.sort((a,b) => new Date(b.releaseDate||b.updatedAt||0) - new Date(a.releaseDate||a.updatedAt||0)); break;
      case 'az':       tracks.sort((a,b) => (a.title||'').localeCompare(b.title||'')); break;
      case 'bpm_asc':  tracks.sort((a,b) => (a.bpm||0) - (b.bpm||0)); break;
      case 'bpm_desc': tracks.sort((a,b) => (b.bpm||0) - (a.bpm||0)); break;
    }

    renderMusicGrid(tracks);

    const info = document.getElementById('mf-results-info');
    if (info) {
      const hasFilter = filterState.q || filterState.genre !== 'all' || filterState.type !== 'all' || filterState.sort !== 'default';
      info.textContent = hasFilter ? `${tracks.length} resultado${tracks.length !== 1 ? 's' : ''}` : '';
    }
  }

  function renderMusicGrid(tracks) {
    const grid = document.getElementById('music-grid');
    if (!grid) return;
    if (!tracks.length) {
      grid.innerHTML = `<div class="music-empty"><i class="fas fa-search" style="font-size:2rem;margin-bottom:12px;opacity:.3"></i><p>Sin resultados. Prueba otro filtro.</p></div>`;
      return;
    }
    _renderedTracks = tracks;
    grid.innerHTML = tracks.map((t, i) => {
      const pillsArr = Object.entries(t.platforms||{}).filter(([,v])=>v).map(([k,v])=>{
        const p = PLATS[k]||{l:k,c:'ptag-lk',i:'fas fa-link'};
        return `<a href="${esc(v)}" target="_blank" class="ptag ${p.c}"><i class="${p.i}"></i> ${p.l}</a>`;
      });
      if (t.spotifyUrl && !t.platforms?.spotify) {
        const p = PLATS.spotify;
        pillsArr.push(`<a href="${esc(t.spotifyUrl)}" target="_blank" class="ptag ${p.c}"><i class="${p.i}"></i> ${p.l}</a>`);
      }
      const pills = pillsArr.join('');
      const coverStyle = t.cover
        ? `background-image:url(${esc(t.cover)});background-size:cover;background-position:center`
        : `background:${GRADS[i % GRADS.length]}`;
      const coverText = t.cover ? '' : `<span>${esc((t.title||'').split(' ').slice(0,2).join(' '))}</span>`;
      const spotifyUrl = t.spotifyUrl || t.platforms?.spotify || '';

      // Badges: genre, BPM, key
      const badges = [];
      if (t.genre) badges.push(`<span class="track-badge track-badge-genre">${esc(t.genre)}</span>`);
      if (t.bpm)   badges.push(`<span class="track-badge track-badge-bpm">${t.bpm} BPM</span>`);
      if (t.key)   badges.push(`<span class="track-badge track-badge-key">${esc(t.key)}</span>`);

      // Can this track be played in radio?
      const canPlay = !!(t.youtubeId || t.scUrl || t.spotifyUrl || t.platforms?.spotify);
      const playBtn = canPlay
        ? `<button class="btn-play-radio" onclick="RADIO_PLAYER.addAndPlay(${esc(JSON.stringify({...t, _gridIdx: i}))});document.getElementById('radio').scrollIntoView({behavior:'smooth'})" title="Reproducir en Radio"><i class="fas fa-play"></i> Escuchar</button>`
        : '';

      return `
        <div class="track-card reveal" data-tidx="${i}" data-genre="${esc(t.genre||'')}" data-type="${esc((t.type||'single').toLowerCase())}">
          <div class="track-art" style="${coverStyle}">${coverText}</div>
          <div class="track-info">
            <div class="track-name">${esc(t.title)}</div>
            <div class="track-meta">${esc(t.type||'Single')}${t.releaseDate?' · '+(t.releaseDate||'').slice(0,4):t.year?' · '+t.year:''}</div>
            ${badges.length ? `<div class="track-badges">${badges.join('')}</div>` : ''}
            <div class="track-platforms">${pills||'<span class="ptag ptag-lk">Próximamente</span>'}</div>
            <div class="track-actions">
              ${playBtn}
              <button class="btn-add-playlist" onclick="event.stopPropagation();window._openTSByIdx(${i})" title="Añadir a lista"><i class="fas fa-plus"></i></button>
            </div>
          </div>
          <div class="track-hold-hint">Mantén pulsado para más opciones</div>
        </div>`;
    }).join('');
    grid.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));
  }

  // ── TRACK ACTION SHEET (bottom sheet) ────────────────────────────
  let _tsTrack     = null;
  let _holdTimer   = null;

  // Exponer índice → track para onclick en HTML
  window._openTSByIdx = idx => openTrackSheet(_renderedTracks[idx]);

  function openTrackSheet(track) {
    if (!track) return;
    if (!(AUTH.token || getToken())) {
      window._pendingTSTrack = track;
      openAuthModal();
      return;
    }
    _tsTrack = track;
    // Header: cover + título + artista
    const art = track.cover
      ? `background-image:url('${track.cover.replace(/'/g,"\\'")}');background-size:cover;background-position:center`
      : GRADS[Math.abs((track.title||'').charCodeAt(0)||0) % GRADS.length];
    const hdr = document.getElementById('ts-header');
    if (hdr) hdr.innerHTML = `
      <div class="ts-cover" style="${art}"></div>
      <div class="ts-title-block">
        <div class="ts-track-title">${esc(track.title)}</div>
        <div class="ts-track-artist">${esc(track.artist || 'RAYVER')}</div>
      </div>
      <button class="ts-close-btn" onclick="window.closeTrackSheet()"><i class="fas fa-times"></i></button>
    `;
    // Refresh playlists then render
    if (!userPlaylists.length) {
      loadUserPlaylists().then(renderTSPlaylists);
    } else {
      renderTSPlaylists();
    }
    // Show sheet
    document.getElementById('ts-backdrop')?.classList.add('visible');
    document.getElementById('track-sheet')?.classList.add('open');
    document.getElementById('ts-new-name').value = '';
  }

  window.openTrackSheet = openTrackSheet;

  window.closeTrackSheet = function() {
    document.getElementById('ts-backdrop')?.classList.remove('visible');
    document.getElementById('track-sheet')?.classList.remove('open');
    _tsTrack = null;
  };

  function renderTSPlaylists() {
    const list = document.getElementById('ts-pl-list');
    if (!list) return;
    if (!userPlaylists.length) {
      list.innerHTML = '<p class="ts-pl-empty">Aún no tienes listas.<br>Escribe un nombre arriba para crear una.</p>';
      setTimeout(() => document.getElementById('ts-new-name')?.focus(), 100);
      return;
    }
    list.innerHTML = userPlaylists.map(pl => `
      <div class="ts-pl-row" id="ts-row-${esc(pl.id)}" onclick="window.tsAddToList('${esc(pl.id)}')">
        <div class="ts-pl-icon"><i class="fas fa-music"></i></div>
        <div class="ts-pl-info">
          <span class="ts-pl-name">${esc(pl.name)}</span>
          <span class="ts-pl-count">${pl.tracks.length} canción${pl.tracks.length !== 1 ? 'es' : ''}</span>
        </div>
        <i class="fas fa-plus ts-pl-add-icon"></i>
      </div>
    `).join('');
  }

  window.tsPlay = function() {
    if (!_tsTrack) return;
    const t = _tsTrack;
    window.closeTrackSheet();
    if (window.RADIO_PLAYER?.skip !== undefined) {
      document.getElementById('radio')?.scrollIntoView({behavior:'smooth'});
    }
  };

  window.tsAddToList = async function(plId) {
    if (!_tsTrack) return;
    const t = _tsTrack;
    const row = document.getElementById('ts-row-' + plId);
    if (row) { row.style.opacity = '.5'; row.style.pointerEvents = 'none'; }
    const r = await apiUser('/playlists/' + plId + '/tracks', {
      method: 'POST',
      body: JSON.stringify({ type: 'track', itemId: t.id||t.spotifyId||t.title, title: t.title, cover: t.cover||'', url: t.spotifyUrl||t.platforms?.spotify||'' })
    });
    if (row) { row.style.opacity = ''; row.style.pointerEvents = ''; }
    if (r.status === 409) { showToastGlobal('Ya está en esa lista'); return; }
    if (!r.ok) { showToastGlobal('Error al añadir'); return; }
    const pl = userPlaylists.find(p => p.id === plId);
    if (pl) pl.tracks.push(r.data);
    window.closeTrackSheet();
    showToastGlobal('Añadido a "' + (pl?.name || 'lista') + '" ✓');
  };

  window.tsCreateList = async function() {
    const input = document.getElementById('ts-new-name');
    const name  = input?.value?.trim();
    if (!name) { input?.focus(); return; }
    input.disabled = true;
    const r = await apiUser('/playlists', { method: 'POST', body: JSON.stringify({ name }) });
    input.disabled = false;
    if (!r.ok) { showToastGlobal(r.data?.error || 'Error al crear lista'); return; }
    userPlaylists.push(r.data);
    showToastGlobal('Lista "' + r.data.name + '" creada ✓');
    await window.tsAddToList(r.data.id);
  };

  function attachTrackCtxMenu() {
    const grid = document.getElementById('music-grid');
    if (!grid || grid._tsAttached) return;
    grid._tsAttached = true;

    grid.addEventListener('pointerdown', e => {
      const card = e.target.closest('.track-card');
      if (!card || e.target.closest('a, button')) return;
      const track = _renderedTracks[+card.dataset.tidx];
      if (!track) return;
      clearTimeout(_holdTimer);
      card.classList.add('holding');
      _holdTimer = setTimeout(() => {
        card.classList.remove('holding');
        openTrackSheet(track);
      }, 600);
    });
    const clearHold = () => { clearTimeout(_holdTimer); document.querySelectorAll('.track-card.holding').forEach(c => c.classList.remove('holding')); };
    grid.addEventListener('pointerup',     clearHold);
    grid.addEventListener('pointermove',   clearHold);
    grid.addEventListener('pointercancel', clearHold);
    grid.addEventListener('contextmenu', e => {
      const card = e.target.closest('.track-card');
      if (!card) return;
      e.preventDefault();
      const track = _renderedTracks[+card.dataset.tidx];
      if (track) openTrackSheet(track);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') window.closeTrackSheet(); });
  }

  // ── RENOMBRAR + FUSIONAR PLAYLISTS ────────────────────────────────
  window.renamePlaylist = function(id) {
    const pl = userPlaylists.find(p => p.id === id);
    if (!pl) return;
    // Edición inline: reemplazar el span del nombre con un input
    const nameEl = document.querySelector(`.playlist-item[data-plid="${id}"] .playlist-item-name`);
    if (!nameEl) return;
    const input = document.createElement('input');
    input.type = 'text'; input.value = pl.name; input.maxLength = 60;
    input.className = 'pl-name-edit-input';
    nameEl.replaceWith(input);
    input.focus(); input.select();
    const save = async () => {
      const name = input.value.trim();
      if (name && name !== pl.name) {
        const r = await apiUser('/playlists/' + id, { method: 'PUT', body: JSON.stringify({ name }) });
        if (r.ok) { pl.name = name; showToastGlobal('Lista renombrada ✓'); }
        else showToastGlobal('Error al renombrar');
      }
      renderPlaylistsModal();
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } if (e.key === 'Escape') renderPlaylistsModal(); });
  };

  window.mergePlaylistModal = function(sourceId) {
    const targets = userPlaylists.filter(p => p.id !== sourceId);
    if (!targets.length) { showToastGlobal('Necesitas al menos 2 listas para fusionar'); return; }
    const source = userPlaylists.find(p => p.id === sourceId);
    document.getElementById('pl-merge-ui')?.remove();
    const ui = document.createElement('div');
    ui.id = 'pl-merge-ui';
    ui.innerHTML = `
      <div class="pl-merge-panel">
        <p>Fusionar <strong>${esc(source.name)}</strong> con:</p>
        <div class="pl-merge-list">
          ${targets.map(t => `<button class="pl-merge-target" onclick="executePlaylistMerge('${esc(sourceId)}','${esc(t.id)}')">${esc(t.name)} <span>(${t.tracks.length})</span></button>`).join('')}
        </div>
        <button class="pl-merge-cancel" onclick="document.getElementById('pl-merge-ui').remove()"><i class="fas fa-times"></i> Cancelar</button>
      </div>`;
    const box = document.querySelector('#playlists-modal .modal-box');
    if (box) box.prepend(ui); else document.getElementById('playlists-modal').prepend(ui);
  };

  window.executePlaylistMerge = async function(sourceId, targetId) {
    const source = userPlaylists.find(p => p.id === sourceId);
    const target = userPlaylists.find(p => p.id === targetId);
    if (!source || !target) return;
    document.getElementById('pl-merge-ui')?.remove();
    let added = 0, skipped = 0;
    for (const track of source.tracks) {
      const r = await apiUser('/playlists/' + targetId + '/tracks', {
        method: 'POST',
        body: JSON.stringify({ type: track.type, itemId: track.itemId, title: track.title, cover: track.cover, url: track.url })
      });
      if (r.status === 409) skipped++;
      else if (r.ok) { added++; target.tracks.push(r.data); }
    }
    renderPlaylistsModal();
    showToastGlobal(`Fusionadas: ${added} añadidas${skipped ? ', ' + skipped + ' ya existían' : ''} ✓`);
  };

  async function loadTracks() {
    const tracks = await apiGet('/tracks');
    const grid   = document.getElementById('music-grid');
    if (!grid) return;

    if (tracks?.length) {
      allTracks = tracks;
      const el = document.getElementById('stat-tracks');  if (el) el.textContent = tracks.length;
      const ab = document.getElementById('about-tracks'); if (ab) ab.textContent = tracks.length;
    } else {
      allTracks = [{
        id: 'feel-it', title: 'Feel It In The Air', artist: 'RAYVER', type: 'single',
        platforms: { spotify: 'https://open.spotify.com/artist/0GmwWh84e70RNGNkYOwE6d' }
      }];
    }

    buildFilterBar();
    applyFilters();
    attachTrackCtxMenu();
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

    // Pausar el radio SC si está sonando
    if (window.RADIO_PLAYER?.pause) window.RADIO_PLAYER.pause();

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

    // Alimentar filtros de la sección de música
    if (genres?.length) {
      trackGenres = genres.map(g => g.name);
      populateGenreFilters();
    }

    // Filtros de la sección beats
    const filterEl = document.getElementById('beats-filter');
    if (!filterEl || !genres?.length) return;
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

  // ── API PÚBLICA MINI-PLAYER (para radio.js) ──────────────────────
  window.MINI_PLAYER = {
    pause: () => {
      const iframe = document.getElementById('mini-yt-iframe');
      if (iframe && iframe.src) iframe.src = iframe.src.replace('autoplay=1','autoplay=0');
      const icon = document.getElementById('mini-play-icon');
      if (icon) icon.className = 'fas fa-play';
      miniPlaying = false;
    },
    isPlaying: () => miniPlaying,
  };

  // ── INIT ─────────────────────────────────────────────────────────
  initAuth();
  updateAuthUI();
  createMiniPlayer();
  loadTracks();
  loadVideos();
  loadBeats();
  loadGenres();
});
