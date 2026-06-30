/**
 * platform-switcher.js — RAYVER Music
 * Permite elegir la plataforma de reproducción del player principal.
 * Por defecto: SoundCloud (la que tiene más catálogo).
 * Recuerda la elección del usuario en localStorage.
 *
 * Requiere que existan en el HTML estos contenedores (ver platform-switcher.html):
 *  #player-soundcloud  → ya gestionado por radio.js (no tocar)
 *  #player-youtube
 *  #player-spotify
 *  #platform-menu      → botones de selección
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'rayver_platform';
  const DEFAULT_PLATFORM = 'soundcloud'; // la que tiene más música

  const SPOTIFY_ARTIST_ID = '3GahfRI6NReH67a2CANemr';
  const YOUTUBE_HANDLE = '@rayvermusic';

  const containers = {
    soundcloud: document.getElementById('player-soundcloud'),
    youtube: document.getElementById('player-youtube'),
    spotify: document.getElementById('player-spotify'),
  };

  const menuButtons = document.querySelectorAll('[data-platform]');

  function getStoredPlatform() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && containers[stored]) return stored;
    return DEFAULT_PLATFORM;
  }

  function loadYouTubeEmbed() {
    const el = containers.youtube;
    if (!el || el.dataset.loaded) return;
    el.dataset.loaded = '1';
    // Player con la lista de uploads del canal. YouTube resuelve el handle a su uploads-playlist automáticamente.
    el.innerHTML = `
      <iframe
        width="100%" height="166" style="border-radius:10px;border:none;"
        src="https://www.youtube.com/embed?listType=user_uploads&list=${encodeURIComponent(YOUTUBE_HANDLE)}"
        title="RAYVER en YouTube" frameborder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen>
      </iframe>
      <p style="margin-top:8px;font-size:13px;opacity:.7">
        Si la lista no carga (puede pasar con canales nuevos),
        <a href="https://www.youtube.com/${YOUTUBE_HANDLE}/videos" target="_blank" rel="noopener">ábrelo directamente en YouTube</a>.
      </p>`;
  }

  function loadSpotifyEmbed() {
    const el = containers.spotify;
    if (!el || el.dataset.loaded) return;
    el.dataset.loaded = '1';
    el.innerHTML = `
      <iframe
        style="border-radius:10px" src="https://open.spotify.com/embed/artist/${SPOTIFY_ARTIST_ID}?utm_source=generator&theme=0"
        width="100%" height="352" frameborder="0" allowfullscreen=""
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy" title="RAYVER en Spotify">
      </iframe>`;
  }

  function pauseSoundCloud() {
    // radio.js expone window — reusamos su pausa si el widget está activo
    try {
      const iframe = document.getElementById('sc-widget');
      if (iframe && window.SC && window.SC.Widget) {
        window.SC.Widget(iframe).pause();
      }
    } catch (e) { /* noop */ }
  }

  function pauseYouTube() {
    const iframe = containers.youtube && containers.youtube.querySelector('iframe');
    if (iframe) iframe.src = iframe.src; // recarga = para el audio
  }

  function pauseSpotify() {
    // El iframe de Spotify gestiona su propio play/pause; no hace falta forzar nada al ocultarlo.
  }

  function showPlatform(platform) {
    if (!containers[platform]) platform = DEFAULT_PLATFORM;

    Object.entries(containers).forEach(([key, el]) => {
      if (!el) return;
      el.style.display = key === platform ? 'block' : 'none';
    });

    // Pausar lo que no está visible
    if (platform !== 'soundcloud') pauseSoundCloud();
    if (platform !== 'youtube') pauseYouTube();
    if (platform !== 'spotify') pauseSpotify();

    // Cargar el embed bajo demanda (evita peticiones innecesarias al entrar a la página)
    if (platform === 'youtube') loadYouTubeEmbed();
    if (platform === 'spotify') loadSpotifyEmbed();

    localStorage.setItem(STORAGE_KEY, platform);

    menuButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.platform === platform);
    });
  }

  menuButtons.forEach((btn) => {
    btn.addEventListener('click', () => showPlatform(btn.dataset.platform));
  });

  // Init
  showPlatform(getStoredPlatform());
})();
