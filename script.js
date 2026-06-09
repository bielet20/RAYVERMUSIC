document.addEventListener('DOMContentLoaded', () => {
    // Navbar Scroll Effect
    const navbar = document.querySelector('.navbar');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // Mobile Menu Toggle
    const hamburger = document.querySelector('.hamburger');
    const navLinks = document.querySelector('.nav-links');

    hamburger.addEventListener('click', () => {
        navLinks.classList.toggle('active');
        const icon = hamburger.querySelector('i');
        if (navLinks.classList.contains('active')) {
            icon.classList.remove('fa-bars');
            icon.classList.add('fa-times');
        } else {
            icon.classList.remove('fa-times');
            icon.classList.add('fa-bars');
        }
    });

    // Close mobile menu when clicking a link
    document.querySelectorAll('.nav-links li a').forEach(link => {
        link.addEventListener('click', () => {
            navLinks.classList.remove('active');
            const icon = hamburger.querySelector('i');
            icon.classList.remove('fa-times');
            icon.classList.add('fa-bars');
        });
    });

    // Scroll Reveal Animation
    const revealElements = document.querySelectorAll(
        '.platform-card, .playlist-card, .about-content, .contact-container, .youtube-container'
    );
    
    revealElements.forEach(el => {
        el.classList.add('scroll-reveal');
    });

    const revealOnScroll = () => {
        const windowHeight = window.innerHeight;
        const revealPoint = 150;

        revealElements.forEach(el => {
            const elTop = el.getBoundingClientRect().top;
            if (elTop < windowHeight - revealPoint) {
                el.classList.add('active');
            }
        });
    };

    window.addEventListener('scroll', revealOnScroll);
    revealOnScroll();

    // Smooth scroll for nav links (enhanced for all anchors)
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });

    // Form — handled natively by FormSubmit (redirect to gracias.html)

    // ── Dynamic content from backend API ──────────────────────────────────────
    const API = '/api';

    // Latest release banner
    async function loadLatestRelease() {
      const banner = document.getElementById('latest-release-banner');
      if (!banner) return;
      try {
        const res = await fetch(`${API}/latest-release`);
        if (!res.ok) return;
        const release = await res.json();
        if (!release) return;
        const date = new Date(release.releaseDate).toLocaleDateString('es-ES', {
          year: 'numeric', month: 'long', day: 'numeric',
        });
        banner.innerHTML = `
          <div class="latest-inner">
            ${release.imageUrl ? `<img src="${release.imageUrl}" alt="${release.name}" class="latest-cover">` : ''}
            <div class="latest-text">
              <span class="latest-tag">✨ Nuevo Lanzamiento</span>
              <h3 class="latest-title">${release.name}</h3>
              <span class="latest-meta">${release.artistLabel} · ${release.artistGenre} · ${date}</span>
            </div>
            <a href="${release.externalUrl}" target="_blank" rel="noopener" class="btn primary-btn latest-btn">
              <i class="fab fa-spotify"></i> Escuchar
            </a>
          </div>`;
        banner.style.display = 'block';
      } catch { /* API not available — banner stays hidden */ }
    }

    // Update follower counts from Spotify API
    async function loadArtistStats() {
      try {
        const res = await fetch(`${API}/artists`);
        if (!res.ok) return;
        const artists = await res.json();
        artists.forEach(a => {
          const el = document.querySelector(`[data-artist-id="${a.id}"] .listeners`);
          if (el && a.followers) {
            el.textContent = `${a.followers.toLocaleString('es-ES')} seguidores`;
          }
        });
      } catch { /* Silently fail — static values remain */ }
    }

    loadLatestRelease();
    loadArtistStats();
});
