'use strict';
document.addEventListener('DOMContentLoaded', () => {

  // ── NAV SCROLL + ACTIVE ─────────────────────────────────────────
  const navbar = document.getElementById('navbar');
  const navLinks = document.querySelectorAll('.nav-links a[data-section]');
  const sections = document.querySelectorAll('section[id]');

  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 60);
    // Active nav
    let current = '';
    sections.forEach(s => {
      if (window.scrollY >= s.offsetTop - 120) current = s.id;
    });
    navLinks.forEach(a => a.classList.toggle('active', a.dataset.section === current));
  }, { passive: true });

  // ── HAMBURGER ────────────────────────────────────────────────────
  const hamburger = document.getElementById('hamburger');
  const navLinksList = document.getElementById('nav-links');
  hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('open');
    navLinksList.classList.toggle('open');
  });
  navLinksList.querySelectorAll('a').forEach(a => {
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

  // ── HERO CANVAS — PARTICLES ─────────────────────────────────────
  (function initParticles() {
    const canvas = document.getElementById('hero-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W, H, particles = [];

    function resize() {
      W = canvas.width  = canvas.offsetWidth;
      H = canvas.height = canvas.offsetHeight;
    }

    function mkParticle() {
      return {
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.5 + .3,
        vx: (Math.random() - .5) * .4,
        vy: (Math.random() - .5) * .4,
        a: Math.random() * .6 + .1
      };
    }

    resize();
    window.addEventListener('resize', () => { resize(); particles = Array.from({ length: 120 }, mkParticle); });
    particles = Array.from({ length: 120 }, mkParticle);

    function frame() {
      ctx.clearRect(0, 0, W, H);
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = W;
        if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H;
        if (p.y > H) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(168,85,247,${p.a})`;
        ctx.fill();
      });
      // Connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(168,85,247,${(1 - dist / 100) * .12})`;
            ctx.lineWidth = .5;
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(frame);
    }
    frame();
  })();

  // ── SCROLL REVEAL ────────────────────────────────────────────────
  document.querySelectorAll('.glass, .track-card, .beat-card, .license-card, .platform-card-link, .yt-card').forEach(el => {
    el.classList.add('reveal');
  });

  const revealObs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); revealObs.unobserve(e.target); } });
  }, { threshold: 0.08 });

  document.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));

  // ── BEATS FILTER ─────────────────────────────────────────────────
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const genre = btn.dataset.genre;
      document.querySelectorAll('.beat-card').forEach(card => {
        const show = genre === 'all' || card.dataset.genre === genre;
        card.dataset.hidden = show ? 'false' : 'true';
        card.style.display = show ? '' : 'none';
      });
    });
  });

  // ── CONTACT MOTIVO ───────────────────────────────────────────────
  window.setMotivo = function(val) {
    const el = document.getElementById('motivo');
    if (!el) return;
    Array.from(el.options).forEach(o => { if (o.value === val || o.text.includes(val)) el.value = o.value; });
  };

  // ── API: CARGAR DATOS ────────────────────────────────────────────
  const API = '/api/public';

  async function apiGet(path) {
    try {
      const r = await fetch(API + path);
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  // Plataformas para las tarjetas de tracks
  const PLATS = {
    spotify:    { l: 'Spotify',     c: 'ptag-s',  i: 'fab fa-spotify' },
    apple:      { l: 'Apple',       c: 'ptag-a',  i: 'fab fa-apple' },
    youtube:    { l: 'YouTube',     c: 'ptag-y',  i: 'fab fa-youtube' },
    tidal:      { l: 'Tidal',       c: 'ptag-t',  i: 'fas fa-water' },
    amazon:     { l: 'Amazon',      c: 'ptag-am', i: 'fab fa-amazon' },
    soundcloud: { l: 'SoundCloud',  c: 'ptag-sc', i: 'fab fa-soundcloud' },
    deezer:     { l: 'Deezer',      c: 'ptag-dz', i: 'fas fa-music' },
    distrokid:  { l: 'Link',        c: 'ptag-lk', i: 'fas fa-link' }
  };

  const GRADS = [
    'linear-gradient(135deg,#1a0a2e,#4c1d95)',
    'linear-gradient(135deg,#0f0520,#3b0764)',
    'linear-gradient(135deg,#071424,#0c2d54)',
    'linear-gradient(135deg,#200820,#451540)',
    'linear-gradient(135deg,#0a1a08,#1a3510)',
    'linear-gradient(135deg,#1a1008,#352a08)'
  ];

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // TRACKS / DISCOGRAFÍA
  async function loadTracks() {
    const tracks = await apiGet('/tracks');
    const grid = document.getElementById('music-grid');
    if (!grid) return;

    // Actualizar stats
    if (tracks && tracks.length) {
      const el = document.getElementById('stat-tracks');
      if (el) el.textContent = tracks.length;
      const ab = document.getElementById('about-tracks');
      if (ab) ab.textContent = tracks.length;
    }

    if (!tracks || !tracks.length) {
      // Fallback estático
      grid.innerHTML = `
        <div class="track-card"><div class="track-art" style="background:linear-gradient(135deg,#1a0a2e,#4c1d95)"><span>Feel It</span></div>
          <div class="track-info"><div class="track-name">Feel It In The Air</div><div class="track-meta">Álbum · 2025</div>
          <div class="track-platforms"><a href="https://open.spotify.com/artist/0GmwWh84e70RNGNkYOwE6d" target="_blank" class="ptag ptag-s"><i class="fab fa-spotify"></i> Spotify</a></div></div></div>
        <div class="track-card"><div class="track-art" style="background:linear-gradient(135deg,#0f0520,#3b0764)"><span>Summum</span></div>
          <div class="track-info"><div class="track-name">Summum</div><div class="track-meta">Single · 2025</div>
          <div class="track-platforms"><a href="https://youtu.be/_5ay8vh1SJk" target="_blank" class="ptag ptag-y"><i class="fab fa-youtube"></i> YouTube</a></div></div></div>
        <div class="track-card"><div class="track-art" style="background:linear-gradient(135deg,#071424,#0c2d54)"><span>I Am Found</span></div>
          <div class="track-info"><div class="track-name">I Am Found</div><div class="track-meta">Álbum · 2025</div>
          <div class="track-platforms"><a href="https://open.spotify.com/artist/0GmwWh84e70RNGNkYOwE6d" target="_blank" class="ptag ptag-s"><i class="fab fa-spotify"></i> Spotify</a></div></div></div>
      `;
      return;
    }

    grid.innerHTML = tracks.map((t, i) => {
      const pills = Object.entries(t.platforms || {}).filter(([, v]) => v).map(([k, v]) => {
        const p = PLATS[k] || { l: k, c: 'ptag-lk', i: 'fas fa-link' };
        return `<a href="${esc(v)}" target="_blank" class="ptag ${p.c}"><i class="${p.i}"></i> ${p.l}</a>`;
      }).join('');
      const coverStyle = t.cover
        ? `background-image:url(${t.cover});background-size:cover;background-position:center`
        : `background:${GRADS[i % GRADS.length]}`;
      const coverText = t.cover ? '' : `<span>${esc(t.title.split(' ').slice(0, 2).join(' '))}</span>`;
      return `<div class="track-card reveal">
        <div class="track-art" style="${coverStyle}">${coverText}</div>
        <div class="track-info">
          <div class="track-name">${esc(t.title)}</div>
          <div class="track-meta">${esc(t.type || 'Single')}${t.year ? ' · ' + t.year : ''}</div>
          <div class="track-platforms">${pills || '<span class="ptag ptag-lk">Próximamente</span>'}</div>
        </div>
      </div>`;
    }).join('');
    // Re-observe new elements
    grid.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));
  }

  // VIDEOS YOUTUBE
  async function loadVideos() {
    const videos = await apiGet('/videos');
    const statEl = document.getElementById('stat-videos');

    if (!videos || !videos.length) return;
    if (statEl) statEl.textContent = videos.length;

    const featured = videos.find(v => v.featured) || videos[0];
    const rest = videos.filter(v => v.id !== featured.id);

    // Featured
    const iframe = document.getElementById('yt-featured-iframe');
    const titleEl = document.getElementById('yt-featured-title');
    const descEl  = document.getElementById('yt-featured-desc');
    const linkEl  = document.getElementById('yt-featured-link');

    if (iframe) iframe.src = `https://www.youtube.com/embed/${esc(featured.videoId)}?rel=0`;
    if (titleEl) titleEl.textContent = featured.title || 'RAYVER — Video Musical';
    if (descEl)  descEl.textContent  = featured.desc  || '';
    if (linkEl)  linkEl.href = `https://www.youtube.com/watch?v=${esc(featured.videoId)}`;

    // Grid
    const grid = document.getElementById('yt-grid');
    if (grid && rest.length) {
      grid.innerHTML = rest.map(v => `
        <div class="yt-card reveal">
          <div class="yt-thumb" onclick="playYtVideo('${esc(v.videoId)}', this)">
            <img src="https://img.youtube.com/vi/${esc(v.videoId)}/mqdefault.jpg" alt="${esc(v.title || '')}" loading="lazy">
            <div class="yt-play-btn"><div class="yt-play-circle"><i class="fas fa-play"></i></div></div>
          </div>
          <div class="yt-card-info">
            <div class="yt-card-title">${esc(v.title || v.videoId)}</div>
            <div class="yt-card-desc">${esc(v.desc || '')}</div>
          </div>
        </div>`).join('');
      grid.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));
    }
  }

  window.playYtVideo = function(videoId, thumbEl) {
    const wrap = thumbEl.closest('.yt-thumb');
    wrap.innerHTML = `<iframe width="100%" height="100%" style="aspect-ratio:16/9;border:none;display:block"
      src="https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
  };

  // BEATS desde API (productos de tipo "product" o "beat")
  async function loadBeats() {
    const products = await apiGet('/products');
    const grid = document.getElementById('beats-grid');
    if (!grid) return;

    const beats = (products || []).filter(p => p.type === 'product');

    if (!beats.length) {
      // Fallback beats hardcoded
      grid.innerHTML = `
        <div class="beat-card" data-genre="trance">
          <div class="beat-cover beat-trance"><span class="beat-genre-tag">Trance</span>🎹</div>
          <div class="beat-body"><div class="beat-title">Feel It In The Air</div><div class="beat-meta">138 BPM · Am · Melodic</div>
          <div class="beat-footer"><span class="beat-price">desde <strong>49€</strong></span>
          <a href="#contact" class="beats-btn" onclick="setMotivo('Licencia de beat — Feel It In The Air')">Licenciar</a></div></div></div>
        <div class="beat-card" data-genre="electronica">
          <div class="beat-cover beat-electronic"><span class="beat-genre-tag">Electrónica</span>🎛️</div>
          <div class="beat-body"><div class="beat-title">Summum</div><div class="beat-meta">124 BPM · Gm · Dark &amp; Deep</div>
          <div class="beat-footer"><span class="beat-price">desde <strong>49€</strong></span>
          <a href="#contact" class="beats-btn" onclick="setMotivo('Licencia de beat — Summum')">Licenciar</a></div></div></div>
        <div class="beat-card" data-genre="trance">
          <div class="beat-cover beat-trance2"><span class="beat-genre-tag">Trance</span>🎵</div>
          <div class="beat-body"><div class="beat-title">Shine Together</div><div class="beat-meta">130 BPM · Em · Uplifting</div>
          <div class="beat-footer"><span class="beat-price">desde <strong>49€</strong></span>
          <a href="#contact" class="beats-btn" onclick="setMotivo('Licencia de beat — Shine Together')">Licenciar</a></div></div></div>
        <div class="beat-card" data-genre="orquestal">
          <div class="beat-cover beat-orquestal"><span class="beat-genre-tag">Orquestal</span>🎻</div>
          <div class="beat-body"><div class="beat-title">Eternal Frequencies</div><div class="beat-meta">120 BPM · Dm · Ideal para sync</div>
          <div class="beat-footer"><span class="beat-price">desde <strong>49€</strong></span>
          <a href="#contact" class="beats-btn" onclick="setMotivo('Licencia de beat — Eternal Frequencies')">Licenciar</a></div></div></div>
        <div class="beat-card" data-genre="orquestal">
          <div class="beat-cover beat-orquestal2"><span class="beat-genre-tag">Orquestal</span>🎼</div>
          <div class="beat-body"><div class="beat-title">Classic Essence</div><div class="beat-meta">80 BPM · Fm · Cinematográfico</div>
          <div class="beat-footer"><span class="beat-price">desde <strong>69€</strong></span>
          <a href="#contact" class="beats-btn" onclick="setMotivo('Licencia de beat — Classic Essence')">Licenciar</a></div></div></div>
        <div class="beat-card" data-genre="pop">
          <div class="beat-cover beat-pop"><span class="beat-genre-tag">Pop</span>🎤</div>
          <div class="beat-body"><div class="beat-title">Vuelven las Emociones</div><div class="beat-meta">118 BPM · C · Emotivo</div>
          <div class="beat-footer"><span class="beat-price">desde <strong>39€</strong></span>
          <a href="#contact" class="beats-btn" onclick="setMotivo('Licencia de beat — Vuelven las Emociones')">Licenciar</a></div></div></div>
        <div class="beat-card" data-genre="electronica">
          <div class="beat-cover beat-electronic2"><span class="beat-genre-tag">Electrónica</span>⚡</div>
          <div class="beat-body"><div class="beat-title">DEEPBRAVE</div><div class="beat-meta">138 BPM · Bm · Hipnótico</div>
          <div class="beat-footer"><span class="beat-price">desde <strong>49€</strong></span>
          <a href="#contact" class="beats-btn" onclick="setMotivo('Licencia de beat — DEEPBRAVE')">Licenciar</a></div></div></div>
        <div class="beat-card" data-genre="pop">
          <div class="beat-cover beat-pop2"><span class="beat-genre-tag">Balada</span>🌙</div>
          <div class="beat-body"><div class="beat-title">Cuando el Silencio Grita</div><div class="beat-meta">90 BPM · Am · Íntimo</div>
          <div class="beat-footer"><span class="beat-price">desde <strong>39€</strong></span>
          <a href="#contact" class="beats-btn" onclick="setMotivo('Licencia de beat — Cuando el Silencio Grita')">Licenciar</a></div></div></div>
      `;
      return;
    }

    const EMOJIS = ['🎹','🎛️','🎵','🎻','🎼','🎤','⚡','🌙','🔊','🎸'];
    const COVERS = ['beat-trance','beat-electronic','beat-orquestal','beat-trance2','beat-electronic2','beat-orquestal2','beat-pop','beat-pop2'];
    grid.innerHTML = beats.map((p, i) => {
      const genre = p.genre || 'electronica';
      const cov   = COVERS[i % COVERS.length];
      const em    = p.emoji || EMOJIS[i % EMOJIS.length];
      const price = p.price ? `desde <strong>${p.price}€</strong>` : 'Consultar';
      return `<div class="beat-card" data-genre="${esc(genre)}">
        <div class="beat-cover ${cov}"><span class="beat-genre-tag">${esc(p.category || genre)}</span>${em}</div>
        <div class="beat-body">
          <div class="beat-title">${esc(p.name)}</div>
          <div class="beat-meta">${esc(p.description || '')}</div>
          <div class="beat-footer">
            <span class="beat-price">${price}</span>
            <a href="#contact" class="beats-btn" onclick="setMotivo('Licencia de beat — ${esc(p.name)}')">Licenciar</a>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  // Iniciar carga
  loadTracks();
  loadVideos();
  loadBeats();
});
