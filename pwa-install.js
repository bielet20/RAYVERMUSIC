/**
 * pwa-install.js — registro del service worker + botón de instalación
 */
(function () {
  'use strict';

  // 1. Registrar el service worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js').catch((err) => {
        console.warn('[PWA] Service worker no se pudo registrar:', err);
      });
    });
  }

  // 2. Capturar el evento de instalación (Chrome/Edge/Android)
  let deferredPrompt = null;
  const installBtn = document.getElementById('pwa-install-btn');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.style.display = 'flex';
  });

  installBtn && installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.style.display = 'none';
  });

  window.addEventListener('appinstalled', () => {
    if (installBtn) installBtn.style.display = 'none';
    console.log('[PWA] RAYVER Music instalada');
  });

  // 3. iOS no soporta beforeinstallprompt — mostramos instrucciones manuales
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (isIOS && !isInStandaloneMode && installBtn) {
    installBtn.style.display = 'flex';
    installBtn.innerHTML = '<i class="fas fa-share-square"></i> Añadir a inicio';
    installBtn.addEventListener('click', () => {
      alert('En iPhone/iPad: pulsa el botón Compartir de Safari y luego "Añadir a pantalla de inicio".');
    });
  }
})();
