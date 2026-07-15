'use strict';

// ── UTILS (global scope — usadas tanto dentro como fuera de DOMContentLoaded) ──
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

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
  if (!r.ok || !r.data?.token) { errEl.textContent = r.data?.error || 'Error de conexión. Inténtalo de nuevo.'; return; }
  setToken(r.data.token, r.data.user);
  window.TRACKER?.onLogin('email');
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
  if (!r.ok || !r.data?.token) { errEl.textContent = r.data?.error || 'Error de conexión. Inténtalo de nuevo.'; return; }
  setToken(r.data.token, r.data.user);
  window.TRACKER?.onRegister('email');
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
  _updateMobileAuthBtn();
  // Recargar sección ambient al cambiar estado de auth
  if (typeof _ambData !== 'undefined' && document.getElementById('ambient-track-list')) {
    _ambData.access = null;
    if (typeof loadAmbient === 'function') loadAmbient();
  }
}

function _closeMobileMenu() {
  const h = document.getElementById('hamburger');
  const n = document.getElementById('nav-links');
  h?.classList.remove('open');
  n?.classList.remove('open');
}

function _updateMobileAuthBtn() {
  const li = document.querySelector('.nav-mobile-auth');
  if (!li) return;
  if (AUTH.user) {
    li.innerHTML = `<button onclick="_closeMobileMenu();logoutUser()" style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:#f87171;padding:10px 24px;border-radius:999px;font-family:inherit;font-size:1rem;font-weight:600;cursor:pointer"><i class="fas fa-sign-out-alt"></i> Cerrar sesión</button>`;
  } else {
    li.innerHTML = `<button onclick="_closeMobileMenu();openAuthModal()" style="background:rgba(61,184,255,.1);border:1px solid rgba(61,184,255,.3);color:var(--logo-blue);padding:10px 28px;border-radius:999px;font-family:inherit;font-size:1rem;font-weight:600;cursor:pointer"><i class="fas fa-user"></i> Entrar</button>`;
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
let _pickerPending = null; // { type, itemId, title, cover, url, scUrl }
let allTracks = [];
let allVideos = [];

// Expose for radio.js (runs in same global scope but accesses via window)
Object.defineProperty(window, 'userPlaylists', { get: () => userPlaylists, enumerable: true });

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

function renderTrackRows(pl) {
  if (!pl.tracks.length) {
    return `<div class="pl-empty-tracks"><i class="fas fa-plus-circle"></i> Lista vacía — busca canciones abajo para añadir</div>`;
  }
  return pl.tracks.map(t => `
    <div class="playlist-track-row" id="ptr-${esc(t.id)}" data-track-id="${esc(t.id)}" draggable="true">
      <i class="fas fa-grip-vertical pl-drag-handle"></i>
      <div class="ptr-cover" style="${t.cover ? `background-image:url('${t.cover.replace(/'/g,"\\'")}');background-size:cover;background-position:center` : 'background:rgba(168,85,247,.15)'}">
        ${t.cover ? '' : '<i class="fas fa-music" style="color:var(--primary-2);font-size:9px"></i>'}
      </div>
      <span class="playlist-track-title">${esc(t.title)}</span>
      ${t.url ? `<a href="${esc(t.url)}" target="_blank" class="ptr-link" title="Abrir"><i class="fas fa-external-link-alt"></i></a>` : ''}
      <button class="ptr-remove" onclick="removeTrackFromPlaylist('${esc(pl.id)}','${esc(t.id)}')" title="Quitar"><i class="fas fa-times"></i></button>
    </div>`).join('');
}

function renderAddSection(plId) {
  return `
    <div class="pl-add-section">
      <div class="pl-add-search-wrap">
        <i class="fas fa-search pl-add-search-icon"></i>
        <input type="text" class="pl-add-search" placeholder="Buscar canción para añadir..."
          oninput="plSearchTracks('${esc(plId)}', this.value)" autocomplete="off">
      </div>
      <div class="pl-sr-list" id="pl-sr-${esc(plId)}"></div>
    </div>`;
}

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
          <button onclick="playPlaylist('${esc(pl.id)}')" class="pl-play-btn" title="Reproducir"><i class="fas fa-play"></i></button>
          <button onclick="renamePlaylist('${esc(pl.id)}')" class="pl-rename-btn" title="Renombrar"><i class="fas fa-edit"></i></button>
          <button onclick="mergePlaylistModal('${esc(pl.id)}')" class="pl-merge-btn" title="Fusionar"><i class="fas fa-layer-group"></i></button>
          <button onclick="confirmDeletePlaylist('${esc(pl.id)}')" class="pl-delete-btn" title="Eliminar"><i class="fas fa-trash"></i></button>
        </div>
      </div>
      <div class="playlist-tracks-list" id="pl-tracks-${esc(pl.id)}" style="display:none">
        <div class="pl-track-rows" id="pl-rows-${esc(pl.id)}">
          ${renderTrackRows(pl)}
        </div>
        ${renderAddSection(pl.id)}
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
  if (!open) attachPlaylistDnD(plId);
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

// Helper: crea una playlist asegurando nombre único
async function _createPlaylist(name, inputEl) {
  const trimmed = (name || '').trim();
  if (!trimmed) { inputEl?.focus(); return null; }
  if (userPlaylists.find(p => p.name.toLowerCase() === trimmed.toLowerCase())) {
    showToastGlobal('Ya tienes una lista con ese nombre');
    inputEl?.select();
    return null;
  }
  if (inputEl) inputEl.disabled = true;
  const r = await apiUser('/playlists', { method: 'POST', body: JSON.stringify({ name: trimmed }) });
  if (inputEl) { inputEl.disabled = false; inputEl.value = ''; }
  if (r.status === 409) { showToastGlobal('Ya tienes una lista con ese nombre'); return null; }
  if (!r.ok)  { showToastGlobal(r.data?.error || 'Error al crear lista'); return null; }
  userPlaylists.push(r.data);
  return r.data;
}

// Crear lista desde el picker (input inline)
window.createPlaylistInline = async function() {
  const input = document.getElementById('picker-new-name');
  const pl = await _createPlaylist(input?.value, input);
  if (!pl) return;
  showToastGlobal('Lista "' + pl.name + '" creada ✓');
  if (_pickerPending) await addTrackToPlaylist(pl.id);
  else { renderPlaylistPicker(); renderPlaylistsModal(); }
};

// Crear lista desde el modal "Mis Listas"
window.createPlaylistDirect = async function() {
  const input = document.getElementById('pl-new-name');
  const pl = await _createPlaylist(input?.value, input);
  if (!pl) return;
  renderPlaylistsModal();
  showToastGlobal('Lista "' + pl.name + '" creada ✓');
};

window.createPlaylistModal = function() { openPlaylists(); };

window.deletePlaylist = async function(id) {
  const r = await apiUser('/playlists/' + id, { method: 'DELETE' });
  if (!r.ok) { showToastGlobal('Error al eliminar'); renderPlaylistsModal(); return; }
  userPlaylists = userPlaylists.filter(p => p.id !== id);
  renderPlaylistsModal();
  showToastGlobal('Lista eliminada');
};

window.removeTrackFromPlaylist = async function(plId, trackId) {
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
  const countEl = document.querySelector(`.playlist-item[data-plid="${plId}"] .playlist-item-count`);
  if (countEl && pl) countEl.textContent = pl.tracks.length + ' canción' + (pl.tracks.length !== 1 ? 'es' : '');
  const rowsEl = document.getElementById('pl-rows-' + plId);
  if (rowsEl) {
    if (!pl || !pl.tracks.length) {
      rowsEl.innerHTML = '<div class="pl-empty-tracks"><i class="fas fa-plus-circle"></i> Lista vacía — busca canciones abajo para añadir</div>';
    } else {
      rowEl?.remove();
    }
  }
};

// ── DRAG & DROP REORDER ──────────────────────────────────────
function attachPlaylistDnD(plId) {
  const container = document.getElementById('pl-rows-' + plId);
  if (!container) return;
  let dragSrc = null;

  container.querySelectorAll('.playlist-track-row[draggable]').forEach(row => {
    row.addEventListener('dragstart', e => {
      dragSrc = row;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.dataset.trackId);
      setTimeout(() => row.classList.add('pl-drag-dragging'), 0);
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('pl-drag-dragging');
      container.querySelectorAll('.playlist-track-row').forEach(r => r.classList.remove('pl-drag-over'));
      dragSrc = null;
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (row !== dragSrc) {
        container.querySelectorAll('.playlist-track-row').forEach(r => r.classList.remove('pl-drag-over'));
        row.classList.add('pl-drag-over');
      }
    });
    row.addEventListener('drop', e => {
      e.preventDefault();
      if (row !== dragSrc && dragSrc) {
        const rows = [...container.querySelectorAll('.playlist-track-row')];
        const fromIdx = rows.indexOf(dragSrc);
        const toIdx   = rows.indexOf(row);
        if (fromIdx < toIdx) container.insertBefore(dragSrc, row.nextSibling);
        else container.insertBefore(dragSrc, row);
        row.classList.remove('pl-drag-over');
        const newOrder = [...container.querySelectorAll('.playlist-track-row')].map(r => r.dataset.trackId);
        savePlaylistOrder(plId, newOrder);
      }
    });
  });
}

async function savePlaylistOrder(plId, trackIds) {
  const pl = userPlaylists.find(p => p.id === plId);
  if (!pl) return;
  pl.tracks = trackIds.map(id => pl.tracks.find(t => t.id === id)).filter(Boolean);
  await apiUser('/playlists/' + plId + '/reorder', { method: 'PUT', body: JSON.stringify({ trackIds }) });
}

// ── BUSCADOR DENTRO DE LA LISTA ───────────────────────────────
let _plSearchCache = {};

window.plSearchTracks = function(plId, query) {
  const resultsEl = document.getElementById('pl-sr-' + plId);
  if (!resultsEl) return;
  const q = (query || '').trim().toLowerCase();
  if (!q) { resultsEl.innerHTML = ''; return; }

  const pl = userPlaylists.find(p => p.id === plId);
  const existingKeys = new Set((pl?.tracks || []).map(t => t.type + ':' + t.itemId));
  const results = [];
  const seen = new Set();

  // 1. Coincidencias en título (orden del web)
  for (const t of allTracks) {
    if ((t.title || '').toLowerCase().includes(q)) {
      const itemId = String(t.id || '');
      seen.add(itemId);
      results.push({ type: 'track', itemId, title: t.title || '—', sub: t.artist || '',
        cover: t.cover || '', url: t.spotifyUrl || t.platforms?.spotify || t.scUrl || '',
        exists: existingKeys.has('track:' + itemId) });
    }
  }
  // 2. Coincidencias solo en artista (no repetir las del título)
  for (const t of allTracks) {
    const itemId = String(t.id || '');
    if (seen.has(itemId)) continue;
    if ((t.artist || '').toLowerCase().includes(q)) {
      results.push({ type: 'track', itemId, title: t.title || '—', sub: t.artist || '',
        cover: t.cover || '', url: t.spotifyUrl || t.platforms?.spotify || t.scUrl || '',
        exists: existingKeys.has('track:' + itemId) });
    }
  }
  // 3. Vídeos de YouTube
  for (const v of allVideos) {
    if ((v.title || '').toLowerCase().includes(q)) {
      const vid = v.videoId || v.id || '';
      results.push({ type: 'video', itemId: vid, title: v.title || vid, sub: 'YouTube',
        cover: vid ? `https://img.youtube.com/vi/${vid}/default.jpg` : '',
        url: vid ? `https://www.youtube.com/watch?v=${vid}` : '',
        exists: existingKeys.has('video:' + vid) });
    }
  }

  _plSearchCache[plId] = results.slice(0, 25);

  if (!results.length) {
    resultsEl.innerHTML = '<div class="pl-sr-empty">Sin resultados</div>';
    return;
  }

  const display = _plSearchCache[plId];
  resultsEl.innerHTML = display.map((r, i) => `
    <div class="pl-sr-row${r.exists ? ' pl-sr-exists' : ''}" data-idx="${i}" data-plid="${esc(plId)}">
      ${r.cover
        ? `<img class="pl-sr-cover" src="${esc(r.cover)}" alt="" onerror="this.style.display='none'">`
        : `<div class="pl-sr-nocover"><i class="fas fa-music"></i></div>`}
      <div class="pl-sr-info">
        <div class="pl-sr-title">${esc(r.title)}</div>
        ${r.sub ? `<div class="pl-sr-sub">${esc(r.sub)}</div>` : ''}
      </div>
      ${r.exists
        ? '<span class="pl-sr-badge">En lista</span>'
        : '<button class="pl-sr-add-btn" title="Añadir"><i class="fas fa-plus"></i></button>'}
    </div>`).join('');

  resultsEl.querySelectorAll('.pl-sr-row:not(.pl-sr-exists)').forEach(row => {
    row.addEventListener('click', () => {
      const idx = +row.dataset.idx;
      const r = _plSearchCache[plId]?.[idx];
      if (r) plAddSearchResult(plId, r);
    });
  });
};

async function plAddSearchResult(plId, r) {
  const pl = userPlaylists.find(p => p.id === plId);
  if (!pl) return;
  const res = await apiUser('/playlists/' + plId + '/tracks', {
    method: 'POST',
    body: JSON.stringify({ type: r.type, itemId: r.itemId, title: r.title, cover: r.cover, url: r.url })
  });
  if (res.status === 409) { showToastGlobal('Ya está en esa lista'); return; }
  if (!res.ok) { showToastGlobal(res.data?.error || 'Error'); return; }
  pl.tracks.push(res.data);
  showToastGlobal('Añadido a "' + pl.name + '" ✓');
  const countEl = document.querySelector(`.playlist-item[data-plid="${plId}"] .playlist-item-count`);
  if (countEl) countEl.textContent = pl.tracks.length + ' canción' + (pl.tracks.length !== 1 ? 'es' : '');
  const rowsEl = document.getElementById('pl-rows-' + plId);
  if (rowsEl) { rowsEl.innerHTML = renderTrackRows(pl); attachPlaylistDnD(plId); }
  // Re-run search to update "En lista" states
  const searchInput = document.querySelector(`#pl-tracks-${plId} .pl-add-search`);
  if (searchInput?.value) window.plSearchTracks(plId, searchInput.value);
}

async function openPlaylistPicker() {
  const modal = document.getElementById('playlist-picker');
  const box   = document.getElementById('picker-box');
  if (!modal || !box) return;
  if (!userPlaylists.length) await loadUserPlaylists();

  // Overlay transparente (captura clicks fuera del box para cerrar)
  modal.style.cssText = 'display:block;background:transparent;backdrop-filter:none;padding:0;pointer-events:all';
  box.className = 'modal-box glass picker-popover';
  renderPlaylistPicker();

  // Posicionar junto al botón "+" que lo abrió
  const pw = 272;
  const btn = window._lastPickerTrigger;
  if (btn && document.contains(btn)) {
    const r = btn.getBoundingClientRect();
    let left = r.left;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (left < 8) left = 8;
    const below = window.innerHeight - r.bottom > 200;
    box.style.cssText = below
      ? `position:fixed;left:${left}px;top:${r.bottom + 6}px;width:${pw}px`
      : `position:fixed;left:${left}px;bottom:${window.innerHeight - r.top + 6}px;width:${pw}px`;
  } else {
    box.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:${pw}px`;
  }

  setTimeout(() => {
    if (!userPlaylists.length) document.getElementById('picker-new-name')?.focus();
  }, 100);
}
window.closePlaylistPicker = function() {
  const modal = document.getElementById('playlist-picker');
  const box   = document.getElementById('picker-box');
  if (modal) modal.style.display = 'none';
  if (box) { box.style.cssText = ''; box.className = 'modal-box modal-sm glass'; }
  _pickerPending = null;
};

function renderPlaylistPicker() {
  const info = document.getElementById('picker-item-info');
  const list = document.getElementById('picker-list');
  if (!info || !list) return;

  info.innerHTML = _pickerPending?.title
    ? `<div class="picker-track-chip"><i class="fas fa-music"></i><span>${esc(_pickerPending.title)}</span></div>`
    : '';

  const rows = userPlaylists.map(pl => {
    const alreadyIn = pl.tracks.some(t => t.itemId === _pickerPending?.itemId && t.type === _pickerPending?.type);
    return `
    <div class="picker-pl-row${alreadyIn ? ' picker-pl-in' : ''}" onclick="${alreadyIn ? '' : `addTrackToPlaylist('${esc(pl.id)}')`}">
      <div class="picker-pl-icon"><i class="fas fa-music"></i></div>
      <div class="picker-pl-info">
        <span class="picker-pl-name">${esc(pl.name)}</span>
        <span class="picker-pl-count">${pl.tracks.length} canción${pl.tracks.length !== 1 ? 'es' : ''}</span>
      </div>
      ${alreadyIn
        ? '<i class="fas fa-check" style="color:#4ade80;font-size:12px;flex-shrink:0"></i>'
        : '<i class="fas fa-plus picker-pl-add"></i>'}
    </div>`;
  }).join('');

  list.innerHTML = `
    ${rows || '<p class="picker-empty">No tienes listas todavía.</p>'}
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

  // Captura qué botón "+" disparó el picker para posicionar el popover
  document.addEventListener('click', e => {
    if (e.target.closest('.btn-add-playlist')) window._lastPickerTrigger = e.target.closest('.btn-add-playlist');
  }, true);

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
  _updateMobileAuthBtn();

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
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 10000); // 10s máximo
      const r = await fetch(API + path, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!r.ok) return null;
      const json = await r.json();
      return json ?? null; // si el backend devuelve literal null, tratar como vacío
    } catch { return null; }
  }

  const PLATS = {
    spotify:{l:'Spotify',c:'ptag-s',i:'fab fa-spotify'},apple:{l:'Apple',c:'ptag-a',i:'fab fa-apple'},
    youtube:{l:'YouTube',c:'ptag-y',i:'fab fa-youtube'},tidal:{l:'Tidal',c:'ptag-t',i:'fas fa-water'},
    amazon:{l:'Amazon',c:'ptag-am',i:'fab fa-amazon'},soundcloud:{l:'SoundCloud',c:'ptag-sc',i:'fab fa-soundcloud'},
    deezer:{l:'Deezer',c:'ptag-dz',i:'fas fa-music'},distrokid:{l:'Link',c:'ptag-lk',i:'fas fa-link'}
  };
  const GRADS = ['linear-gradient(135deg,#1a0a2e,#4c1d95)','linear-gradient(135deg,#0f0520,#3b0764)','linear-gradient(135deg,#071424,#0c2d54)','linear-gradient(135deg,#200820,#451540)','linear-gradient(135deg,#0a1a08,#1a3510)','linear-gradient(135deg,#1a1008,#352a08)'];


  // ── TRACKS + FILTROS DINÁMICOS ────────────────────────────────────
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
    try { grid.innerHTML = tracks.map((t, i) => {
      const pillsArr = Object.entries(t.platforms||{}).filter(([,v])=>v).map(([k,v])=>{
        const p = PLATS[k]||{l:k,c:'ptag-lk',i:'fas fa-link'};
        return `<a href="${esc(v)}" target="_blank" class="ptag ${p.c}"><i class="${p.i}"></i> ${p.l}</a>`;
      });
      if (t.spotifyUrl && !t.platforms?.spotify) {
        const p = PLATS.spotify;
        pillsArr.push(`<a href="${esc(t.spotifyUrl)}" target="_blank" class="ptag ${p.c}"><i class="${p.i}"></i> ${p.l}</a>`);
      }
      if (t.scUrl && !pillsArr.length) {
        pillsArr.push(`<a href="${esc(t.scUrl)}" target="_blank" class="ptag ptag-sc"><i class="fab fa-soundcloud"></i> SoundCloud</a>`);
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
    } catch (e) {
      console.error('[renderMusicGrid] ERROR al renderizar tracks:', e);
      grid.innerHTML = '<div class="music-empty" style="color:#f87171">Error al mostrar canciones.<br><small>Revisa la consola del navegador.</small></div>';
    }
  }

  // ── TRACK ACTION SHEET (bottom sheet) ────────────────────────────
  let _tsTrack     = null;
  let _holdTimer   = null;

  // Botón "+" en card → picker emergente (el long-press sigue usando openTrackSheet)
  window._openTSByIdx = function(idx) {
    const track = _renderedTracks[idx];
    if (!track) return;
    if (!(AUTH.token || getToken())) {
      window._pendingTSTrack = track;
      openAuthModal();
      return;
    }
    _pickerPending = {
      type: 'track',
      itemId: String(track.id || ''),
      title: track.title || '',
      cover: track.cover || '',
      url: track.spotifyUrl || track.platforms?.spotify || track.scUrl || '',
      scUrl: track.scUrl || ''
    };
    openPlaylistPicker();
  };

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
    // Mostrar las listas que tenemos y refrescar en background
    renderTSPlaylists();
    loadUserPlaylists().then(renderTSPlaylists);
    // Show sheet
    document.getElementById('ts-backdrop')?.classList.add('visible');
    document.getElementById('track-sheet')?.classList.add('open');
    const tsInput = document.getElementById('ts-new-name');
    if (tsInput) tsInput.value = '';
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
    if (window.RADIO_PLAYER?.addAndPlay) {
      window.RADIO_PLAYER.addAndPlay(t);
    } else {
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
    const pl = await _createPlaylist(input?.value, input);
    if (!pl) return;
    showToastGlobal('Lista "' + pl.name + '" creada ✓');
    await window.tsAddToList(pl.id);
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
        if (userPlaylists.find(p => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) {
          showToastGlobal('Ya tienes una lista con ese nombre');
          renderPlaylistsModal();
          return;
        }
        const r = await apiUser('/playlists/' + id, { method: 'PUT', body: JSON.stringify({ name }) });
        if (r.ok) { pl.name = name; showToastGlobal('Lista renombrada ✓'); }
        else { showToastGlobal(r.data?.error || 'Error al renombrar'); }
      }
      renderPlaylistsModal();
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } if (e.key === 'Escape') renderPlaylistsModal(); });
  };

  // Reproducir la playlist del usuario
  window.playPlaylist = function(plId) {
    const pl = userPlaylists.find(p => p.id === plId);
    if (!pl || !pl.tracks.length) { showToastGlobal('La lista está vacía — añade canciones primero'); return; }

    // Delegar siempre al radio player unificado (gestiona SC, YouTube, Spotify)
    window.selectRadioPlaylist?.(plId);
    document.getElementById('radio')?.scrollIntoView({behavior:'smooth'});
    closePlaylists();
    showToastGlobal('Reproduciendo "' + pl.name + '" en radio');
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
    const grid = document.getElementById('music-grid');
    if (!grid) return;
    try {
      const tracks = await apiGet('/tracks');
      console.log('[loadTracks] respuesta API:', tracks ? tracks.length + ' tracks' : 'null/vacío');

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
    } catch (e) {
      console.error('[loadTracks] ERROR:', e);
      grid.innerHTML = '<div class="music-empty" style="color:#f87171">Error al cargar el catálogo.<br><small>Recarga la página o contacta al administrador.</small></div>';
    }
  }

  // ── VIDEOS + MINI PLAYER ─────────────────────────────────────────

  async function loadVideos() {
    const videos = await apiGet('/videos');
    const statEl = document.getElementById('stat-videos');
    if (!videos || !videos.length) return;
    allVideos = videos;
    if (statEl) statEl.textContent = videos.length;

    // Ordenar por order si existe
    allVideos.sort((a,b) => (a.order||0)-(b.order||0));

    const featured = allVideos.find(v=>v.featured) || allVideos[0];
    // Inicializar placeholder con el vídeo destacado (radio.js tomará el control al hacer click)
    _setVideoMeta(featured);
    // Exponer el vídeo destacado al placeholder para el botón de play
    const thumb = document.getElementById('yt-featured-thumb');
    if (thumb && featured) thumb.dataset.videoid = featured.videoId;

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

  }

  window.selectVideo = function(videoId, title, desc) {
    const idx = allVideos.findIndex(v => v.videoId === videoId);
    // Enrutar SIEMPRE por el reproductor unificado
    window.playVideoPlaylist?.(allVideos.length ? allVideos : [{videoId, title}], idx >= 0 ? idx : 0);
    // Actualizar el texto de la sección Videos (radio.js sincroniza el resto)
    _setVideoMeta({videoId, title, desc});
    // Scroll a la sección Videos para ver el vídeo
    document.getElementById('youtube')?.scrollIntoView({behavior:'smooth', block:'start'});
  };

  // Actualiza título / desc / link de la sección Videos (no toca el iframe — lo gestiona radio.js)
  function _setVideoMeta(video) {
    if (!video) return;
    const titleEl = document.getElementById('yt-featured-title');
    const descEl  = document.getElementById('yt-featured-desc');
    const linkEl  = document.getElementById('yt-featured-link');
    const thumb   = document.getElementById('yt-featured-thumb');
    if (titleEl) titleEl.textContent = video.title || 'RAYVER — Video Musical';
    if (descEl)  descEl.textContent  = video.desc  || '';
    if (linkEl)  linkEl.href = `https://www.youtube.com/watch?v=${esc(video.videoId)}`;
    if (thumb) {
      thumb.src = `https://img.youtube.com/vi/${esc(video.videoId)}/mqdefault.jpg`;
      thumb.dataset.videoid = video.videoId;
    }
  }

  // Compatibilidad con código interno que llama setMainVideo (solo metadatos ya)
  function setMainVideo(video) { _setVideoMeta(video); }

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

  // ── INIT ─────────────────────────────────────────────────────────
  initAuth();
  updateAuthUI();
  loadTracks();
  loadVideos();
  loadBeats();
  loadGenres();
  loadAmbient();

  // Auto-refresco del catálogo al volver a la pestaña (captura cambios de sync)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadTracks();
  });
});

// ══════════════════════════════════════════════════════════════
// MÓDULO MÚSICA AMBIENTE (frontend público)
// ══════════════════════════════════════════════════════════════
let _ambData = { packs: [], plans: [], tracks: [], access: null };

async function _ambFetch(path) {
  const tok = AUTH.token || getToken();
  const r = await fetch('/api' + path, tok ? { headers: { Authorization: 'Bearer ' + tok } } : {});
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Error');
  return r.json();
}

async function loadAmbient() {
  try {
    const [p, pk, tr] = await Promise.all([
      _ambFetch('/public/ambient/plans'),
      _ambFetch('/public/ambient/packs'),
      _ambFetch('/public/ambient/tracks'),
    ]);
    _ambData.plans  = p.plans  || [];
    _ambData.packs  = pk.packs || [];
    _ambData.tracks = tr.tracks || [];
  } catch(e) { console.warn('[Ambient] load error', e); }

  // Check access if logged in
  if (AUTH.user) {
    try {
      const acc = await _ambFetch('/ambient/access');
      _ambData.access = acc;
    } catch { _ambData.access = null; }
    await loadAmbientPlaylists();
  }

  renderAmbientPlans();
  renderAmbientPacks();
  renderAmbientTracks();
  renderAmbientAccessBanner();
}

function _fmtDuration(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m} min`;
}

function renderAmbientPlans() {
  const el = document.getElementById('ambient-plans-wrap');
  if (!el || !_ambData.plans.length) return;
  el.innerHTML = _ambData.plans.map(p => {
    const featured = p.badge;
    return `<div class="ambient-plan-card${featured ? ' featured' : ''}">
      ${featured ? `<div class="ambient-plan-badge">${p.badge}</div>` : ''}
      <div class="ambient-plan-name">${p.title}</div>
      <div class="ambient-plan-price">${p.price} <span style="font-size:1rem">${p.currency}</span></div>
      <div class="ambient-plan-period">/${p.durationDays === 30 ? 'mes' : p.durationDays === 365 ? 'año' : p.durationDays + ' días'}</div>
      <div class="ambient-plan-desc">${p.description || ''}</div>
      <button class="btn btn-primary btn-sm" style="width:100%" onclick="ambRequestSubscription('${p.id}','${p.title}')">
        <i class="fas fa-star"></i> Suscribirse
      </button>
    </div>`;
  }).join('');
}

function renderAmbientPacks() {
  const el = document.getElementById('ambient-packs-wrap');
  if (!el || !_ambData.packs.length) { if (el) el.style.display = 'none'; return; }
  el.innerHTML = _ambData.packs.map(p => {
    const owned = _ambData.access?.packs?.includes(p.id);
    return `<div class="ambient-pack-card" onclick="ambFilterByPack('${p.id}')">
      ${p.cover
        ? `<img class="ambient-pack-cover" src="${p.cover}" alt="${p.title}">`
        : `<div class="ambient-pack-cover-placeholder">🎵</div>`}
      <div class="ambient-pack-body">
        <div class="ambient-pack-title">${p.title} ${p.badge ? `<span class="ambient-pack-badge">${p.badge}</span>` : ''}</div>
        <div class="ambient-pack-meta">${p.trackCount || 0} tracks${p.description ? ' · ' + p.description : ''}</div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div class="ambient-pack-price">${p.price} ${p.currency}</div>
          ${owned
            ? '<span style="font-size:12px;color:#34d399"><i class="fas fa-check-circle"></i> Adquirido</span>'
            : `<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();ambRequestPack('${p.id}','${p.title}','${p.price}','${p.currency}')"><i class="fas fa-shopping-bag"></i> Comprar</button>`}
        </div>
      </div>
    </div>`;
  }).join('');
}

let _ambActivePackFilter  = null;
let _ambActiveTab         = 'all'; // 'all' | 'favs' | playlistId
let _ambFavs              = new Set();
let _ambFavPlId           = null;
let _ambUserPlaylists     = [];
let _ambPendingAddTrackId = null;

function ambFilterByPack(packId) {
  _ambActivePackFilter = _ambActivePackFilter === packId ? null : packId;
  renderAmbientTracks();
}

// ── AMBIENT PLAYLISTS & FAVORITES ─────────────────────────────────
async function loadAmbientPlaylists() {
  if (!AUTH.user) { _ambFavs = new Set(); _ambFavPlId = null; _ambUserPlaylists = []; return; }
  try {
    const r = await apiUser('/playlists');
    if (!r.ok) return;
    _ambUserPlaylists = (r.data || []).filter(p => p.kind === 'ambient');
    const favPl = _ambUserPlaylists.find(p => p.name === '__favs__');
    _ambFavPlId = favPl?.id || null;
    _ambFavs    = new Set((favPl?.tracks || []).map(t => t.itemId));
  } catch {}
  const hasAccess = _ambData.access?.hasSubscription || (_ambData.access?.packs || []).length;
  const tabsEl = document.getElementById('ambient-tabs');
  if (tabsEl) tabsEl.style.display = hasAccess ? 'flex' : 'none';
  renderAmbientTabs();
}

function renderAmbientTabs() {
  const plsEl = document.getElementById('ambtab-playlists');
  if (!plsEl) return;
  const userPls = _ambUserPlaylists.filter(p => p.name !== '__favs__');
  plsEl.innerHTML = userPls.map(p =>
    `<button class="amb-tab${_ambActiveTab === p.id ? ' active' : ''}" onclick="ambSetTab('${p.id}')">
      <i class="fas fa-list-ul"></i> ${esc(p.name)}
      <span onclick="event.stopPropagation();ambDeletePlaylist('${p.id}')" title="Eliminar" style="margin-left:5px;opacity:.5;font-size:12px">✕</span>
    </button>`
  ).join('');
  // Sync active class on fixed tabs
  ['all','favs'].forEach(id => {
    const btn = document.getElementById('ambtab-' + id);
    if (btn) btn.classList.toggle('active', _ambActiveTab === id);
  });
}

function ambSetTab(tab) {
  _ambActiveTab = tab;
  renderAmbientTabs();
  renderAmbientTracks();
}

async function toggleAmbientFav(trackId, e) {
  if (e) e.stopPropagation();
  if (!AUTH.user) { openAuthModal(); return; }
  const track = _ambData.tracks.find(t => t.id === trackId);
  if (!track) return;
  if (!_ambFavPlId) {
    const r = await apiUser('/playlists', { method: 'POST', body: JSON.stringify({ name: '__favs__', kind: 'ambient' }) });
    if (!r.ok) return;
    _ambFavPlId = r.data.id;
    _ambUserPlaylists.push({ ...r.data, tracks: [] });
  }
  if (_ambFavs.has(trackId)) {
    const favPl = _ambUserPlaylists.find(p => p.id === _ambFavPlId);
    const entry = (favPl?.tracks || []).find(t => t.itemId === trackId);
    if (entry) {
      await apiUser(`/playlists/${_ambFavPlId}/tracks/${entry.id}`, { method: 'DELETE' });
      _ambFavs.delete(trackId);
      if (favPl) favPl.tracks = favPl.tracks.filter(t => t.itemId !== trackId);
    }
  } else {
    const r = await apiUser(`/playlists/${_ambFavPlId}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ type: 'ambient', itemId: trackId, title: track.title, cover: track.cover || '' })
    });
    if (r.ok) {
      _ambFavs.add(trackId);
      const favPl = _ambUserPlaylists.find(p => p.id === _ambFavPlId);
      if (favPl) favPl.tracks = [...(favPl.tracks || []), r.data];
    }
  }
  renderAmbientTracks();
}

function ambNewPlaylistModal() {
  if (!AUTH.user) { openAuthModal(); return; }
  document.getElementById('amb-playlist-name-input').value = '';
  document.getElementById('amb-playlist-new-modal').style.display = 'flex';
}

async function ambCreatePlaylist() {
  const name = document.getElementById('amb-playlist-name-input').value.trim();
  if (!name) return;
  const r = await apiUser('/playlists', { method: 'POST', body: JSON.stringify({ name, kind: 'ambient' }) });
  if (!r.ok) { alert(r.data?.error || 'Error al crear la lista'); return; }
  _ambUserPlaylists.push({ ...r.data, tracks: [] });
  document.getElementById('amb-playlist-new-modal').style.display = 'none';
  renderAmbientTabs();
  ambSetTab(r.data.id);
}

async function ambDeletePlaylist(plId) {
  if (!confirm('¿Eliminar esta lista?')) return;
  await apiUser(`/playlists/${plId}`, { method: 'DELETE' });
  _ambUserPlaylists = _ambUserPlaylists.filter(p => p.id !== plId);
  if (_ambActiveTab === plId) _ambActiveTab = 'all';
  renderAmbientTabs();
  renderAmbientTracks();
}

function ambShowAddToPlaylist(trackId, e) {
  if (e) e.stopPropagation();
  if (!AUTH.user) { openAuthModal(); return; }
  _ambPendingAddTrackId = trackId;
  const listEl = document.getElementById('amb-playlist-picker-list');
  const userPls = _ambUserPlaylists.filter(p => p.name !== '__favs__');
  listEl.innerHTML = userPls.length
    ? userPls.map(p =>
        `<button class="btn btn-sm" style="width:100%;text-align:left;justify-content:flex-start" onclick="ambAddTrackToPlaylist('${p.id}')">
          <i class="fas fa-list-ul" style="color:var(--primary-2);margin-right:8px"></i>${esc(p.name)}
        </button>`
      ).join('')
    : `<div style="color:var(--muted);font-size:13px;text-align:center;padding:16px 0">No tienes listas aún.<br>
        <button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="document.getElementById('amb-add-to-playlist-modal').style.display='none';ambNewPlaylistModal()">
          <i class="fas fa-plus"></i> Crear lista
        </button></div>`;
  document.getElementById('amb-add-to-playlist-modal').style.display = 'flex';
}

async function ambAddTrackToPlaylist(plId) {
  const trackId = _ambPendingAddTrackId;
  if (!trackId) return;
  const track = _ambData.tracks.find(t => t.id === trackId);
  const r = await apiUser(`/playlists/${plId}/tracks`, {
    method: 'POST',
    body: JSON.stringify({ type: 'ambient', itemId: trackId, title: track?.title || '', cover: track?.cover || '' })
  });
  document.getElementById('amb-add-to-playlist-modal').style.display = 'none';
  if (!r.ok) { alert(r.data?.error || 'Error al añadir'); return; }
  const pl = _ambUserPlaylists.find(p => p.id === plId);
  if (pl) pl.tracks = [...(pl.tracks || []), r.data];
  _ambPendingAddTrackId = null;
}

function renderAmbientTracks() {
  const el = document.getElementById('ambient-track-list');
  if (!el) return;

  const hasSub   = _ambData.access?.hasSubscription;
  const myPacks  = _ambData.access?.packs || [];
  const hasAccess = hasSub || myPacks.length > 0;

  let tracks = _ambActivePackFilter
    ? _ambData.tracks.filter(t => t.packId === _ambActivePackFilter)
    : _ambData.tracks;

  if (_ambActiveTab === 'favs') {
    tracks = tracks.filter(t => _ambFavs.has(t.id));
  } else if (_ambActiveTab !== 'all') {
    const pl = _ambUserPlaylists.find(p => p.id === _ambActiveTab);
    const plIds = new Set((pl?.tracks || []).map(tr => tr.itemId));
    tracks = tracks.filter(t => plIds.has(t.id));
  }

  if (!tracks.length) {
    const msg = _ambActiveTab === 'favs'
      ? 'Aún no tienes favoritas. Haz clic en ♥ en cualquier track.'
      : _ambActiveTab !== 'all'
        ? 'Esta lista no tiene tracks aún. Usa + en cualquier track para añadir.'
        : 'No hay tracks disponibles aún.';
    el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted)">${msg}</div>`;
    return;
  }

  el.innerHTML = tracks.map(t => {
    const unlocked = hasSub || myPacks.includes(t.packId);
    const durationStr = _fmtDuration(t.duration);
    const pack = _ambData.packs.find(p => p.id === t.packId);
    const isFav = _ambFavs.has(t.id);
    const actionBtns = AUTH.user && hasAccess ? `
      <button class="amb-fav-btn ${isFav ? 'active' : ''}" title="${isFav ? 'Quitar de favoritas' : 'Añadir a favoritas'}"
        onclick="event.stopPropagation();toggleAmbientFav('${t.id}',this)">
        <i class="fas fa-heart"></i>
      </button>
      <button class="amb-add-btn" title="Añadir a lista"
        onclick="event.stopPropagation();ambShowAddToPlaylist('${t.id}')">
        <i class="fas fa-plus"></i>
      </button>` : '';
    return `<div class="ambient-track-row" onclick="ambPlayTrack('${t.id}')">
      ${t.cover
        ? `<img class="ambient-track-cover" src="${t.cover}" alt="${t.title}">`
        : `<div class="ambient-track-cover" style="display:flex;align-items:center;justify-content:center;font-size:22px">🎵</div>`}
      <div class="ambient-track-info">
        <div class="ambient-track-title">${t.title}</div>
        <div class="ambient-track-tags">${pack ? pack.title + ' · ' : ''}${(t.tags||[]).join(', ')}</div>
      </div>
      <div class="ambient-track-meta">
        ${durationStr ? `<div class="ambient-track-duration">${durationStr}</div>` : ''}
        ${actionBtns}
        <div class="ambient-track-lock ${unlocked ? 'unlocked' : ''}">
          <i class="fas fa-${unlocked ? 'unlock' : 'lock'}"></i>
        </div>
      </div>
    </div>`;
  }).join('');

  // Show CTA if not logged in
  const ctaEl = document.getElementById('ambient-cta-login');
  if (ctaEl) ctaEl.style.display = AUTH.user ? 'none' : '';
}

function renderAmbientAccessBanner() {
  const el = document.getElementById('ambient-access-banner');
  const lbl = document.getElementById('ambient-access-label');
  if (!el || !AUTH.user || !_ambData.access) return;
  const { hasSubscription, subscription, packs } = _ambData.access;
  if (hasSubscription) {
    el.style.display = '';
    const exp = subscription?.expiresAt ? ' (hasta ' + subscription.expiresAt.slice(0,10) + ')' : ' (sin límite)';
    lbl.textContent = '✓ Suscripción activa' + exp;
  } else if (packs?.length) {
    el.style.display = '';
    lbl.textContent = `✓ ${packs.length} pack${packs.length > 1 ? 's' : ''} adquirido${packs.length > 1 ? 's' : ''}`;
  }
}

async function ambPlayTrack(id) {
  const track = _ambData.tracks.find(t => t.id === id);
  if (!track) return;

  // Open modal with track info
  const modal = document.getElementById('ambient-player-modal');
  document.getElementById('ambient-player-title').textContent = track.title;
  document.getElementById('ambient-player-tags').textContent = (track.tags || []).join(' · ');
  const coverEl = document.getElementById('ambient-player-cover');
  if (track.cover) { coverEl.src = track.cover; coverEl.style.display = ''; } else { coverEl.style.display = 'none'; }

  // Reset all player areas
  ['ambient-player-sc','ambient-player-yt','ambient-player-paywall','ambient-player-noauth'].forEach(elId => {
    document.getElementById(elId).style.display = 'none';
  });
  const audio = document.getElementById('ambient-player-audio');
  audio.style.display = 'none'; audio.pause(); audio.src = '';

  modal.style.display = 'flex';

  // If not logged in
  if (!AUTH.user) {
    // Show preview if available
    if (track.previewUrl) {
      audio.src = track.previewUrl; audio.style.display = ''; audio.play().catch(() => {});
    } else {
      document.getElementById('ambient-player-noauth').style.display = '';
    }
    return;
  }

  // Try to get stream
  try {
    const tok = AUTH.token || getToken();
    const r = await fetch('/api/ambient/stream/' + id, { headers: { Authorization: 'Bearer ' + tok } });
    const data = await r.json();
    if (r.status === 403) {
      // No access — show preview or paywall
      if (track.previewUrl) {
        audio.src = track.previewUrl; audio.style.display = '';
        audio.play().catch(() => {});
        const pw = document.getElementById('ambient-player-paywall');
        pw.style.display = ''; // show paywall below
      } else {
        document.getElementById('ambient-player-paywall').style.display = '';
      }
      return;
    }
    if (!r.ok) throw new Error(data.error);

    if (data.type === 'gdrive') {
      const gd = document.getElementById('ambient-player-gdrive');
      const gf = document.getElementById('ambient-player-gdrive-frame');
      gf.src = `https://drive.google.com/file/d/${encodeURIComponent(data.fileId)}/preview`;
      gd.style.display = '';
    } else if (data.type === 'file' || data.type === 'url') {
      audio.src = data.url; audio.style.display = ''; audio.play().catch(() => {});
    } else if (data.type === 'platform') {
      if (data.platformType === 'youtube') {
        const ytEl = document.getElementById('ambient-player-yt');
        const vid = data.url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
        if (vid) { ytEl.innerHTML = `<iframe width="100%" height="200" src="https://www.youtube.com/embed/${vid}?autoplay=1" frameborder="0" allow="autoplay;encrypted-media" allowfullscreen></iframe>`; ytEl.style.display = ''; }
      } else {
        const scEl = document.getElementById('ambient-player-sc');
        scEl.innerHTML = `<iframe width="100%" height="166" scrolling="no" frameborder="no" allow="autoplay" src="https://w.soundcloud.com/player/?url=${encodeURIComponent(data.url)}&color=%23a855f7&auto_play=true&show_user=false"></iframe>`;
        scEl.style.display = '';
      }
    }
  } catch(e) {
    console.error('[Ambient] stream error', e);
    if (track.previewUrl) { audio.src = track.previewUrl; audio.style.display = ''; audio.play().catch(() => {}); }
    else { document.getElementById('ambient-player-paywall').style.display = ''; }
  }
}

function ambClosePlayer() {
  const modal = document.getElementById('ambient-player-modal');
  if (modal) modal.style.display = 'none';
  const audio = document.getElementById('ambient-player-audio');
  if (audio) { audio.pause(); audio.src = ''; }
  const gf = document.getElementById('ambient-player-gdrive-frame');
  if (gf) { gf.src = ''; document.getElementById('ambient-player-gdrive').style.display = 'none'; }
  ['ambient-player-sc','ambient-player-yt'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
}

function ambRequestSubscription(planId, planTitle) {
  if (!AUTH.user) { openAuthModal(); return; }
  showToastGlobal(`Para suscribirte al plan "${planTitle}", contacta con el administrador o usa el método de pago habitual.`);
}

function ambRequestPack(packId, packTitle, price, currency) {
  if (!AUTH.user) { openAuthModal(); return; }
  showToastGlobal(`Para comprar "${packTitle}" (${price} ${currency}), contacta con el administrador.`);
}
