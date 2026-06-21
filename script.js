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
    loadYoutube();
});

// ── YouTube dynamic section ────────────────────────────────────────────────────
async function loadYoutube() {
    try {
        const [videosRes, channelsRes] = await Promise.all([
            fetch(`${API}/youtube/videos?limit=7`),
            fetch(`${API}/youtube/channels`),
        ]);
        if (!videosRes.ok) return;

        const videos   = await videosRes.json();
        const channels = channelsRes.ok ? await channelsRes.json() : [];

        if (!videos.length) return;

        // Update featured video (latest)
        const featured = videos[0];
        const isNew = isWithinDays(featured.published_at, 7);

        const iframe = document.getElementById('yt-featured-iframe');
        const titleEl  = document.getElementById('yt-featured-title');
        const dateEl   = document.getElementById('yt-featured-date');
        const linkEl   = document.getElementById('yt-featured-link');
        const badgeEl  = document.getElementById('yt-new-badge');

        if (iframe) iframe.src = `${featured.embed_url}?rel=0&modestbranding=1`;
        if (titleEl) titleEl.textContent = featured.title;
        if (dateEl)  dateEl.textContent  = fmtDate(featured.published_at);
        if (linkEl)  linkEl.href         = featured.watch_url;
        if (badgeEl) badgeEl.style.display = isNew ? 'inline-flex' : 'none';

        // Render grid (remaining videos)
        const grid = document.getElementById('yt-grid');
        if (grid && videos.length > 1) {
            grid.innerHTML = videos.slice(1).map(v => `
                <a href="${v.watch_url}" target="_blank" rel="noopener" class="yt-card glass">
                    <div class="yt-card-thumb">
                        <img src="${v.thumbnail_url}" alt="${escHtml(v.title)}" loading="lazy">
                        <span class="yt-play-icon"><i class="fas fa-play"></i></span>
                        ${isWithinDays(v.published_at, 7) ? '<span class="yt-card-badge">NUEVO</span>' : ''}
                    </div>
                    <div class="yt-card-info">
                        <span class="yt-card-title">${escHtml(v.title)}</span>
                        <span class="yt-card-date">${fmtDate(v.published_at)}</span>
                    </div>
                </a>
            `).join('');
        }

        // Render channel stats bar
        const bar = document.getElementById('yt-channels-bar');
        if (bar && channels.length) {
            bar.innerHTML = channels.map(ch => `
                <div class="yt-channel-stat">
                    ${ch.thumbnail_url ? `<img src="${ch.thumbnail_url}" alt="${escHtml(ch.title)}" class="yt-ch-thumb">` : ''}
                    <div class="yt-ch-info">
                        <span class="yt-ch-name">${escHtml(ch.title)}</span>
                        <span class="yt-ch-subs">${fmtNum(ch.subscriber_count)} suscriptores · ${fmtNum(ch.video_count)} vídeos</span>
                    </div>
                </div>
            `).join('');
            bar.style.display = 'flex';
        }

    } catch { /* API not available — static fallback stays */ }
}

function fmtDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('es-ES', { year:'numeric', month:'long', day:'numeric' });
}
function fmtNum(n) {
    if (!n) return '0';
    return n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n);
}
function isWithinDays(iso, days) {
    if (!iso) return false;
    return (Date.now() - new Date(iso).getTime()) < days * 86400000;
}
function escHtml(str) {
    return String(str).replace(/[&<>"']/g, c =>
        ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}


/* ═══════════════════════════════════════════
   BEATS — filtros + prellenar contacto
═══════════════════════════════════════════ */
document.querySelectorAll('.beats-filter').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.beats-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const f = btn.dataset.filter;
        document.querySelectorAll('.beat-card').forEach(card => {
            card.classList.toggle('hidden', f !== 'all' && card.dataset.genre !== f);
        });
    });
});

function setMotivo(texto) {
    const sel = document.getElementById('motivo');
    if (!sel) return;
    // Busca la opción más cercana o la primera
    let found = false;
    for (const opt of sel.options) {
        if (texto.toLowerCase().includes(opt.value.toLowerCase().split(' ')[0].toLowerCase())) {
            sel.value = opt.value;
            found = true;
            break;
        }
    }
    if (!found) sel.value = 'Licencia de beat';

    // Añade el beat al mensaje si está vacío
    const msg = document.getElementById('message');
    if (msg && !msg.value) {
        const beat = texto.replace('Licencia de beat — ', '').replace('Licencia ', '').replace(/\s*\(.*\)/, '');
        msg.placeholder = `Hola! Me interesa "${beat}". ¿Podemos hablar sobre la licencia?`;
    }
}
