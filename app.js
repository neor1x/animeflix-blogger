// AnimeFlix - Lightweight Blogger-powered anime site
// Uses Preact + HTM (no build step, ~4KB total)
;(function () {
  'use strict';

  const { h, render } = preact;
  const { useState, useEffect, useRef, useCallback } = preactHooks;
  const html = htm.bind(h);

  // ─── Config ───────────────────────────────────────────────────
  const CONFIG = {
    blogUrl: 'https://shitpostj1.blogspot.com',
    sections: [
      { label: 'Ongoing',  title: 'Ongoing Series',  badge: 'ON AIR' },
      { label: 'Movie',    title: 'Movies',           badge: 'MOVIE' },
      { label: 'OVA',      title: 'OVA / Special',    badge: 'OVA' },
      { label: 'Finished', title: 'Finished Series',  badge: 'END' },
    ],
    postsPerSection: 20,
    cardScrollAmount: 3,
  };

  // ─── Blogger Feed Fetcher ─────────────────────────────────────
  const feedCache = {};

  async function fetchByLabel(label) {
    if (feedCache[label]) return feedCache[label];
    try {
      const url = `${CONFIG.blogUrl}/feeds/posts/default/-/${encodeURIComponent(label)}?alt=json&max-results=${CONFIG.postsPerSection}`;
      const res = await fetch(url);
      const data = await res.json();
      const posts = (data.feed.entry || []).map(parseEntry);
      feedCache[label] = posts;
      return posts;
    } catch (e) {
      return [];
    }
  }

  // ─── Post Parser (matches your blog format) ───────────────────
  // Post format:
  //   <div style="display: none">{ "data": { "video": "//ok.ru/...", "links": [{ "name":"MEGA", "url":"..." }] } }</div>
  //   <a ...><img src="thumbnail.jpg" /></a>

  function parseEntry(entry) {
    const title = entry.title.$t || '';
    const rawContent = entry.content ? entry.content.$t : '';
    const published = entry.published.$t || '';
    const labels = entry.category ? entry.category.map(c => c.term) : [];
    const altLink = entry.link.find(l => l.rel === 'alternate');
    const url = altLink ? altLink.href : '#';
    const id = entry.id.$t || '';

    // 1) Extract embedded JSON data from hidden div
    let video = '';
    let links = [];
    const jsonMatch = rawContent.match(/<div[^>]*style=["'][^"']*display:\s*none[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        const d = parsed.data || parsed;
        video = d.video || '';
        links = Array.isArray(d.links) ? d.links : [];
      } catch (e) { /* malformed JSON, skip */ }
    }

    // Normalize video URL (//ok.ru/... → https://ok.ru/...)
    if (video && video.startsWith('//')) video = 'https:' + video;

    // 2) Extract thumbnail from <img> tag in content
    let thumbnail = '';
    if (entry['media$thumbnail']) {
      thumbnail = entry['media$thumbnail'].url.replace(/\/s\d+(-c)?\//, '/s400/');
    }
    if (!thumbnail) {
      const imgMatch = rawContent.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch) thumbnail = imgMatch[1];
    }
    // Upscale blogger thumbnails
    if (thumbnail) {
      thumbnail = thumbnail.replace(/\/s\d+(-c)?\//, '/s400/');
    }

    return { id, title, published, labels, url, thumbnail, video, links };
  }

  // ─── Components ─────────────────────────────────────────────

  function LazyImg({ src, alt, className }) {
    const [loaded, setLoaded] = useState(false);
    const [inView, setInView] = useState(false);
    const ref = useRef();

    useEffect(() => {
      if (!ref.current) return;
      if (!('IntersectionObserver' in window)) { setInView(true); return; }
      const obs = new IntersectionObserver(([e]) => {
        if (e.isIntersecting) { setInView(true); obs.disconnect(); }
      }, { rootMargin: '200px' });
      obs.observe(ref.current);
      return () => obs.disconnect();
    }, []);

    return html`<img
      ref=${ref}
      class="${className}"
      src=${inView ? src : ''}
      alt=${alt}
      data-loaded=${String(loaded)}
      onLoad=${() => setLoaded(true)}
      loading="lazy"
      decoding="async"
    />`;
  }

  function Card({ post, badge, onClick }) {
    return html`
      <article class="card" onClick=${() => onClick(post)} role="button" tabindex="0"
        onKeyDown=${(e) => e.key === 'Enter' && onClick(post)}
        aria-label=${post.title}>
        <${LazyImg} src=${post.thumbnail} alt=${post.title} className="card-img" />
        ${badge && html`<span class="card-badge">${badge}</span>`}
        <div class="card-info">
          <div class="card-title">${post.title}</div>
          <div class="card-meta">${new Date(post.published).getFullYear()}</div>
        </div>
      </article>
    `;
  }

  function SkeletonCards({ count }) {
    return html`${Array.from({ length: count }, (_, i) =>
      html`<div key=${i} class="skeleton skeleton-card"></div>`
    )}`;
  }

  function Section({ config, onCardClick }) {
    const [posts, setPosts] = useState([]);
    const [loading, setLoading] = useState(true);
    const trackRef = useRef();

    useEffect(() => {
      fetchByLabel(config.label).then(p => { setPosts(p); setLoading(false); });
    }, [config.label]);

    const scroll = useCallback((dir) => {
      const el = trackRef.current;
      if (!el) return;
      const cardW = el.querySelector('.card, .skeleton-card');
      const amount = (cardW ? cardW.offsetWidth + 12 : 190) * CONFIG.cardScrollAmount;
      el.scrollBy({ left: dir * amount, behavior: 'smooth' });
    }, []);

    if (!loading && posts.length === 0) return null;

    return html`
      <section class="section" aria-label=${config.title}>
        <div class="section-header">
          <h2 class="section-title">${config.title}</h2>
          <div class="section-nav">
            <button class="nav-btn" onClick=${() => scroll(-1)} aria-label="Scroll left">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button class="nav-btn" onClick=${() => scroll(1)} aria-label="Scroll right">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>
        <div class="slider-track" ref=${trackRef}>
          ${loading
            ? html`<${SkeletonCards} count=${8} />`
            : posts.map(p => html`<${Card} key=${p.id} post=${p} badge=${config.badge} onClick=${onCardClick} />`)
          }
        </div>
      </section>
    `;
  }

  // ─── Detail Overlay ───────────────────────────────────────────
  function Detail({ post, onClose }) {
    useEffect(() => {
      const onKey = (e) => e.key === 'Escape' && onClose();
      document.addEventListener('keydown', onKey);
      document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('keydown', onKey);
        document.body.style.overflow = '';
      };
    }, []);

    const heroImg = post.thumbnail ? post.thumbnail.replace(/\/s\d+(-c)?\//, '/s800/') : '';

    return html`
      <div class="overlay" onClick=${(e) => e.target === e.currentTarget && onClose()}>
        <div class="detail-card" role="dialog" aria-label=${post.title}>
          <button class="detail-close" onClick=${onClose} aria-label="Close">✕</button>

          ${post.video
            ? html`<div class="detail-video">
                <div class="video">
                  <iframe src=${post.video} allowfullscreen allow="autoplay; encrypted-media" referrerpolicy="no-referrer" title=${post.title}></iframe>
                </div>
              </div>`
            : heroImg
              ? html`<img class="detail-hero" src=${heroImg} alt=${post.title} />`
              : null
          }

          <div class="detail-body">
            <h1 class="detail-title">${post.title}</h1>

            <div class="detail-labels">
              ${post.labels.map(l => html`
                <span class="detail-label ${['Ongoing','Movie','OVA','Finished'].includes(l) ? 'accent' : ''}">${l}</span>
              `)}
              <span class="detail-label">${new Date(post.published).toLocaleDateString()}</span>
            </div>

            ${post.links.length > 0 && html`
              <div class="detail-downloads">
                <h3>Download</h3>
                <div class="dl-grid">
                  ${post.links.map(lnk => html`
                    <a class="dl-btn" href=${lnk.url} target="_blank" rel="noopener noreferrer">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      ${lnk.name}
                    </a>
                  `)}
                </div>
              </div>
            `}

            <a href=${post.url} class="detail-blog-link" target="_blank" rel="noopener">View original post →</a>
          </div>
        </div>
      </div>
    `;
  }

  // ─── Search ───────────────────────────────────────────────────
  function useSearch() {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const timer = useRef();

    const search = useCallback((q) => {
      setQuery(q);
      clearTimeout(timer.current);
      if (!q.trim()) { setResults([]); setSearching(false); return; }
      setSearching(true);
      timer.current = setTimeout(() => {
        const url = `${CONFIG.blogUrl}/feeds/posts/default?alt=json&max-results=40&q=${encodeURIComponent(q)}`;
        fetch(url).then(r => r.json()).then(data => {
          setResults((data.feed.entry || []).map(parseEntry));
          setSearching(false);
        }).catch(() => { setResults([]); setSearching(false); });
      }, 400);
    }, []);

    return { query, results, searching, search };
  }

  // ─── App ──────────────────────────────────────────────────────
  function App() {
    const [selected, setSelected] = useState(null);
    const { query, results, searching, search } = useSearch();

    return html`
      <div class="app">
        <header class="header">
          <a href="/" class="logo">Anime<span>Flix</span></a>
          <div class="header-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="search" placeholder="Search anime..." value=${query} onInput=${(e) => search(e.target.value)} aria-label="Search anime" />
          </div>
        </header>

        <main>
          ${query.trim()
            ? html`
              <section class="section">
                <div class="section-header">
                  <h2 class="section-title">Search: "${query}"</h2>
                </div>
                <div class="slider-track" style="flex-wrap:wrap">
                  ${searching
                    ? html`<${SkeletonCards} count=${6} />`
                    : results.length
                      ? results.map(p => html`<${Card} key=${p.id} post=${p} onClick=${setSelected} />`)
                      : html`<p style="padding:0 4%;color:#888">No results found.</p>`
                  }
                </div>
              </section>
            `
            : CONFIG.sections.map(s => html`<${Section} key=${s.label} config=${s} onCardClick=${setSelected} />`)
          }
        </main>

        <footer class="footer">
          Powered by Blogger · Built with Preact
        </footer>

        ${selected && html`<${Detail} post=${selected} onClose=${() => setSelected(null)} />`}
      </div>
    `;
  }

  // ─── Mount ────────────────────────────────────────────────────
  render(html`<${App} />`, document.getElementById('root'));

  // ─── SEO: JSON-LD ─────────────────────────────────────────────
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'AnimeFlix',
    url: CONFIG.blogUrl,
    potentialAction: {
      '@type': 'SearchAction',
      target: CONFIG.blogUrl + '?q={search_term_string}',
      'query-input': 'required name=search_term_string'
    }
  };
  const s = document.createElement('script');
  s.type = 'application/ld+json';
  s.textContent = JSON.stringify(ld);
  document.head.appendChild(s);

})();
