// AnimeFlix - Lightweight Blogger-powered anime site
// Preact + HTM, no build step
;(function () {
  'use strict';

  var h = preact.h, render = preact.render;
  var useState = preactHooks.useState, useEffect = preactHooks.useEffect,
      useRef = preactHooks.useRef, useCallback = preactHooks.useCallback,
      useMemo = preactHooks.useMemo;
  var html = htm.bind(h);

  // ─── Config ───────────────────────────────────────────────────
  var CONFIG = {
    blogUrl: window.location.origin,
    sections: [
      { label: 'Ongoing',  title: 'Ongoing Series',  badge: 'ON AIR' },
      { label: 'Movie',    title: 'Movies',           badge: 'MOVIE' },
      { label: 'OVA',      title: 'OVA / Special',    badge: 'OVA' },
      { label: 'Finished', title: 'Finished Series',  badge: 'END' },
    ],
    postsPerSection: 50,
    sectionLabels: ['Ongoing', 'Movie', 'OVA', 'Finished'],
  };

  // ─── Simple hash router ───────────────────────────────────────
  function getRoute() {
    var hash = window.location.hash.slice(1) || '/';
    return hash;
  }

  function navigate(path) {
    window.location.hash = path;
  }

  function useRouter() {
    var s = useState(getRoute()), route = s[0], setRoute = s[1];
    useEffect(function () {
      var fn = function () { setRoute(getRoute()); };
      window.addEventListener('hashchange', fn);
      return function () { window.removeEventListener('hashchange', fn); };
    }, []);
    return route;
  }

  // ─── Blogger Feed ─────────────────────────────────────────────
  var feedCache = {};

  function fetchByLabel(label) {
    if (feedCache[label]) return Promise.resolve(feedCache[label]);
    var url = CONFIG.blogUrl + '/feeds/posts/default/-/' +
      encodeURIComponent(label) + '?alt=json&max-results=' + CONFIG.postsPerSection;
    return fetch(url).then(function (r) { return r.json(); }).then(function (data) {
      var posts = (data.feed.entry || []).map(parseEntry);
      feedCache[label] = posts;
      return posts;
    }).catch(function () { return []; });
  }

  function searchPosts(q) {
    var url = CONFIG.blogUrl + '/feeds/posts/default?alt=json&max-results=50&q=' +
      encodeURIComponent(q);
    return fetch(url).then(function (r) { return r.json(); }).then(function (data) {
      return (data.feed.entry || []).map(parseEntry);
    }).catch(function () { return []; });
  }

  // ─── Post Parser ──────────────────────────────────────────────
  function parseEntry(entry) {
    var title = entry.title.$t || '';
    var rawContent = entry.content ? entry.content.$t : '';
    var published = entry.published.$t || '';
    var labels = entry.category ? entry.category.map(function (c) { return c.term; }) : [];
    var altLink = entry.link.find(function (l) { return l.rel === 'alternate'; });
    var url = altLink ? altLink.href : '#';
    var id = entry.id.$t || '';

    var video = '', links = [];
    var jsonMatch = rawContent.match(/<div[^>]*style=["'][^"']*display:\s*none[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (jsonMatch) {
      try {
        var parsed = JSON.parse(jsonMatch[1].trim());
        var d = parsed.data || parsed;
        video = d.video || '';
        links = Array.isArray(d.links) ? d.links : [];
      } catch (e) { }
    }
    if (video && video.indexOf('//') === 0) video = 'https:' + video;

    var thumbnail = '';
    if (entry['media$thumbnail']) {
      thumbnail = entry['media$thumbnail'].url.replace(/\/s\d+(-c)?\//, '/s400/');
    }
    if (!thumbnail) {
      var imgMatch = rawContent.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch) thumbnail = imgMatch[1];
    }
    if (thumbnail) thumbnail = thumbnail.replace(/\/s\d+(-c)?\//, '/s400/');

    // Derive a slug from the title for routing
    var slug = title.replace(/[^a-zA-Z0-9\u0400-\u04FF\u1800-\u18AF]+/g, '-')
      .replace(/^-|-$/g, '').toLowerCase();

    return { id: id, title: title, published: published, labels: labels,
      url: url, thumbnail: thumbnail, video: video, links: links, slug: slug };
  }

  // ─── Group posts by title (deduplicate for index) ─────────────
  // Returns array of { title, slug, thumbnail, labels, published, episodes }
  // where episodes is array of individual posts sorted by episode number
  function groupByTitle(posts) {
    var map = {};
    posts.forEach(function (p) {
      // Extract base series name: strip episode numbers like "- 9-р анги", "8-р анги", "Ep 5" etc.
      var base = p.title
        .replace(/\s*[-–]\s*\d+.*$/i, '')       // "DanMachi S2 - 9-р анги" → "DanMachi S2"
        .replace(/\s+\d+[-–].*$/i, '')           // "Арифүрэта 7-р анги" → "Арифүрэта"
        .replace(/\s*ep(?:isode)?\s*\d+.*$/i, '')
        .trim();
      if (!base) base = p.title;
      var key = base.toLowerCase();
      if (!map[key]) {
        map[key] = {
          title: base,
          slug: base.replace(/[^a-zA-Z0-9\u0400-\u04FF\u1800-\u18AF]+/g, '-')
            .replace(/^-|-$/g, '').toLowerCase(),
          thumbnail: p.thumbnail,
          labels: p.labels.slice(),
          published: p.published,
          episodes: []
        };
      }
      map[key].episodes.push(p);
      // Merge labels
      p.labels.forEach(function (l) {
        if (map[key].labels.indexOf(l) === -1) map[key].labels.push(l);
      });
      // Use latest thumbnail
      if (p.published > map[key].published) {
        map[key].published = p.published;
        if (p.thumbnail) map[key].thumbnail = p.thumbnail;
      }
    });
    // Sort episodes within each group
    Object.keys(map).forEach(function (key) {
      map[key].episodes.sort(function (a, b) {
        var na = parseInt((a.title.match(/(\d+)/) || [])[1]) || 0;
        var nb = parseInt((b.title.match(/(\d+)/) || [])[1]) || 0;
        return na - nb;
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  // ─── Fuzzy search helper ──────────────────────────────────────
  function fuzzyMatch(text, query) {
    text = text.toLowerCase();
    query = query.toLowerCase().trim();
    if (!query) return false;
    // Direct substring
    if (text.indexOf(query) !== -1) return true;
    // Split query into words, all must match somewhere
    var words = query.split(/\s+/);
    return words.every(function (w) { return text.indexOf(w) !== -1; });
  }

  // ─── Draggable slider hook ────────────────────────────────────
  function useDrag(ref) {
    var state = useRef({ isDown: false, startX: 0, scrollLeft: 0, moved: false });

    var onMouseDown = useCallback(function (e) {
      var el = ref.current; if (!el) return;
      state.current.isDown = true;
      state.current.moved = false;
      state.current.startX = e.pageX - el.offsetLeft;
      state.current.scrollLeft = el.scrollLeft;
      el.style.cursor = 'grabbing';
      el.style.userSelect = 'none';
    }, []);

    var onMouseLeave = useCallback(function () {
      state.current.isDown = false;
      if (ref.current) { ref.current.style.cursor = 'grab'; ref.current.style.userSelect = ''; }
    }, []);

    var onMouseUp = useCallback(function () {
      state.current.isDown = false;
      if (ref.current) { ref.current.style.cursor = 'grab'; ref.current.style.userSelect = ''; }
    }, []);

    var onMouseMove = useCallback(function (e) {
      if (!state.current.isDown) return;
      e.preventDefault();
      var el = ref.current; if (!el) return;
      var x = e.pageX - el.offsetLeft;
      var walk = (x - state.current.startX) * 1.5;
      if (Math.abs(walk) > 5) state.current.moved = true;
      el.scrollLeft = state.current.scrollLeft - walk;
    }, []);

    // Returns true if the user dragged (to prevent click)
    var wasDragged = useCallback(function () {
      return state.current.moved;
    }, []);

    return { onMouseDown: onMouseDown, onMouseLeave: onMouseLeave,
      onMouseUp: onMouseUp, onMouseMove: onMouseMove, wasDragged: wasDragged };
  }

  // ─── Components ───────────────────────────────────────────────

  function LazyImg(props) {
    var s = useState(false), loaded = s[0], setLoaded = s[1];
    var s2 = useState(false), inView = s2[0], setInView = s2[1];
    var ref = useRef();
    useEffect(function () {
      if (!ref.current) return;
      if (!('IntersectionObserver' in window)) { setInView(true); return; }
      var obs = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) { setInView(true); obs.disconnect(); }
      }, { rootMargin: '200px' });
      obs.observe(ref.current);
      return function () { obs.disconnect(); };
    }, []);
    return html`<img ref=${ref} class=${props.className} src=${inView ? props.src : ''}
      alt=${props.alt} data-loaded=${String(loaded)}
      onLoad=${function () { setLoaded(true); }} loading="lazy" decoding="async"/>`;
  }

  function Card(props) {
    var item = props.item, badge = props.badge, onClick = props.onClick;
    return html`<article class="card" onClick=${function () { onClick(item); }}
      role="button" tabindex="0"
      onKeyDown=${function (e) { if (e.key === 'Enter') onClick(item); }}
      aria-label=${item.title}>
      <${LazyImg} src=${item.thumbnail} alt=${item.title} className="card-img"/>
      ${badge && html`<span class="card-badge">${badge}</span>`}
      <div class="card-info">
        <div class="card-title">${item.title}</div>
        <div class="card-meta">${new Date(item.published).getFullYear()}</div>
      </div>
    </article>`;
  }

  function SkeletonCards(props) {
    return html`${Array.from({ length: props.count }, function (_, i) {
      return html`<div key=${i} class="skeleton skeleton-card"></div>`;
    })}`;
  }

  // ─── Section with draggable slider ────────────────────────────
  function Section(props) {
    var config = props.config, onCardClick = props.onCardClick;
    var s = useState([]), items = s[0], setItems = s[1];
    var s2 = useState(true), loading = s2[0], setLoading = s2[1];
    var trackRef = useRef();
    var drag = useDrag(trackRef);

    useEffect(function () {
      fetchByLabel(config.label).then(function (posts) {
        setItems(groupByTitle(posts));
        setLoading(false);
      });
    }, [config.label]);

    var scroll = useCallback(function (dir) {
      var el = trackRef.current; if (!el) return;
      var cardW = el.querySelector('.card,.skeleton-card');
      var amount = (cardW ? cardW.offsetWidth + 12 : 190) * 3;
      el.scrollBy({ left: dir * amount, behavior: 'smooth' });
    }, []);

    var handleClick = useCallback(function (item) {
      if (drag.wasDragged()) return;
      onCardClick(item);
    }, [onCardClick]);

    if (!loading && items.length === 0) return null;

    return html`<section class="section" aria-label=${config.title}>
      <div class="section-header">
        <h2 class="section-title">${config.title}</h2>
        <div class="section-nav">
          <button class="nav-btn" onClick=${function () { scroll(-1); }} aria-label="Scroll left">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button class="nav-btn" onClick=${function () { scroll(1); }} aria-label="Scroll right">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </div>
      <div class="slider-track" ref=${trackRef} style="cursor:grab"
        onMouseDown=${drag.onMouseDown} onMouseLeave=${drag.onMouseLeave}
        onMouseUp=${drag.onMouseUp} onMouseMove=${drag.onMouseMove}>
        ${loading
          ? html`<${SkeletonCards} count=${8}/>`
          : items.map(function (item) {
              return html`<${Card} key=${item.slug} item=${item} badge=${config.badge} onClick=${handleClick}/>`;
            })
        }
      </div>
    </section>`;
  }

  // ─── Detail Page (full page, not modal) ───────────────────────
  function DetailPage(props) {
    var slug = props.slug;
    var s = useState(null), item = s[0], setItem = s[1];
    var s2 = useState(true), loading = s2[0], setLoading = s2[1];

    useEffect(function () {
      setLoading(true);
      // Search all sections for the matching slug
      var promises = CONFIG.sections.map(function (sec) { return fetchByLabel(sec.label); });
      Promise.all(promises).then(function (results) {
        var allPosts = [];
        results.forEach(function (posts) { allPosts = allPosts.concat(posts); });
        var grouped = groupByTitle(allPosts);
        var found = grouped.find(function (g) { return g.slug === slug; });
        setItem(found || null);
        setLoading(false);
      });
    }, [slug]);

    useEffect(function () {
      window.scrollTo(0, 0);
    }, [slug]);

    if (loading) return html`<div class="detail-page">
      <div class="detail-loading"><div class="skeleton" style="width:100%;height:350px;border-radius:14px"></div></div>
    </div>`;

    if (!item) return html`<div class="detail-page">
      <div class="detail-not-found">
        <h2>Not found</h2>
        <p>This title could not be found.</p>
        <a href="#/" class="detail-blog-link">← Back to home</a>
      </div>
    </div>`;

    var heroImg = item.thumbnail ? item.thumbnail.replace(/\/s\d+(-c)?\//, '/s800/') : '';
    var sectionLabels = CONFIG.sectionLabels;
    var latestEp = item.episodes[item.episodes.length - 1];

    return html`<div class="detail-page">
      <a href="#/" class="detail-back">← Back</a>

      <div class="detail-hero-wrap">
        ${heroImg && html`<img class="detail-hero" src=${heroImg} alt=${item.title}/>`}
        <div class="detail-hero-overlay">
          <h1 class="detail-title">${item.title}</h1>
          <div class="detail-labels">
            ${item.labels.filter(function (l) { return sectionLabels.indexOf(l) !== -1; }).map(function (l) {
              return html`<span class="detail-label accent">${l}</span>`;
            })}
            ${item.labels.filter(function (l) { return sectionLabels.indexOf(l) === -1; }).map(function (l) {
              return html`<span class="detail-label">${l}</span>`;
            })}
            <span class="detail-label">${item.episodes.length} episode${item.episodes.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      ${latestEp && latestEp.video && html`
        <div class="detail-player">
          <h3>Latest Episode</h3>
          <div class="video">
            <iframe src=${latestEp.video} allowfullscreen="" allow="autoplay; encrypted-media"
              referrerpolicy="no-referrer" title=${latestEp.title}></iframe>
          </div>
        </div>
      `}

      <div class="detail-body">
        <div class="detail-episodes">
          <h3>Episodes</h3>
          <div class="ep-grid">
            ${item.episodes.map(function (ep, i) {
              var num = (ep.title.match(/(\d+)/) || [])[1] || (i + 1);
              return html`<div class="ep-card" key=${ep.id}>
                <div class="ep-num">${num}</div>
                <div class="ep-title">${ep.title}</div>
                <div class="ep-actions">
                  ${ep.video && html`<a class="ep-btn play" href=${ep.video} target="_blank" rel="noopener" title="Watch">▶</a>`}
                  ${ep.links.map(function (lnk) {
                    return html`<a class="ep-btn dl" href=${lnk.url} target="_blank" rel="noopener noreferrer" title=${lnk.name}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      ${lnk.name}
                    </a>`;
                  })}
                </div>
              </div>`;
            })}
          </div>
        </div>
      </div>
    </div>`;
  }

  // ─── Search Page ──────────────────────────────────────────────
  function SearchPage(props) {
    var initialQuery = props.query || '';
    var s = useState(initialQuery), query = s[0], setQuery = s[1];
    var s2 = useState([]), results = s2[0], setResults = s2[1];
    var s3 = useState(false), searching = s3[0], setSearching = s3[1];
    var s4 = useState(false), searched = s4[0], setSearched = s4[1];
    var timer = useRef();

    var doSearch = useCallback(function (q) {
      setQuery(q);
      clearTimeout(timer.current);
      if (!q.trim()) { setResults([]); setSearching(false); setSearched(false); return; }
      setSearching(true);
      timer.current = setTimeout(function () {
        searchPosts(q).then(function (posts) {
          // Group and then fuzzy filter
          var grouped = groupByTitle(posts);
          var filtered = grouped.filter(function (g) {
            return fuzzyMatch(g.title, q) ||
              g.labels.some(function (l) { return fuzzyMatch(l, q); });
          });
          // If Blogger returned results but our fuzzy filter is too strict, show all
          if (filtered.length === 0 && grouped.length > 0) filtered = grouped;
          setResults(filtered);
          setSearching(false);
          setSearched(true);
        });
      }, 300);
    }, []);

    // Trigger search on mount if query provided
    useEffect(function () {
      if (initialQuery) doSearch(initialQuery);
    }, [initialQuery]);

    var handleClick = useCallback(function (item) {
      navigate('/title/' + item.slug);
    }, []);

    return html`<div class="search-page">
      <div class="search-bar-large">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="search" placeholder="Search anime titles, labels..." value=${query}
          onInput=${function (e) { doSearch(e.target.value); }} aria-label="Search anime" autofocus/>
      </div>
      <div class="search-results">
        ${searching
          ? html`<div class="slider-track" style="flex-wrap:wrap;padding:0 4%"><${SkeletonCards} count=${6}/></div>`
          : results.length
            ? html`<div class="slider-track" style="flex-wrap:wrap;padding:0 4%">
                ${results.map(function (item) {
                  return html`<${Card} key=${item.slug} item=${item} onClick=${handleClick}/>`;
                })}
              </div>`
            : searched
              ? html`<p style="padding:20px 4%;color:#888">No results found for "${query}"</p>`
              : null
        }
      </div>
    </div>`;
  }

  // ─── Static Pages ─────────────────────────────────────────────
  function AboutPage() {
    return html`<div class="static-page">
      <h1>About</h1>
      <div class="static-content">
        <p>AnimeFlix is a lightweight anime streaming and download index powered by Google Blogger.</p>
        <p>All content is fetched directly from the blog's RSS feed and rendered client-side using Preact.</p>
        <p>No server required — just Blogger + a few kilobytes of JavaScript.</p>
      </div>
    </div>`;
  }

  function TimetablePage() {
    var s = useState([]), all = s[0], setAll = s[1];
    var s2 = useState(true), loading = s2[0], setLoading = s2[1];

    useEffect(function () {
      fetchByLabel('Ongoing').then(function (posts) {
        var grouped = groupByTitle(posts);
        // Sort by latest episode date
        grouped.sort(function (a, b) {
          return b.published > a.published ? 1 : -1;
        });
        setAll(grouped);
        setLoading(false);
      });
    }, []);

    return html`<div class="static-page">
      <h1>Timetable</h1>
      <p class="static-subtitle">Currently airing series, sorted by latest update</p>
      ${loading
        ? html`<div class="slider-track" style="flex-wrap:wrap;padding:0"><${SkeletonCards} count=${6}/></div>`
        : html`<div class="timetable-grid">
            ${all.map(function (item) {
              var latest = item.episodes[item.episodes.length - 1];
              var date = latest ? new Date(latest.published).toLocaleDateString() : '';
              return html`<a class="timetable-row" href=${'#/title/' + item.slug} key=${item.slug}>
                <img class="timetable-thumb" src=${item.thumbnail} alt=${item.title}/>
                <div class="timetable-info">
                  <div class="timetable-title">${item.title}</div>
                  <div class="timetable-meta">${item.episodes.length} ep · Updated ${date}</div>
                </div>
              </a>`;
            })}
          </div>`
      }
    </div>`;
  }

  function ReleasesPage() {
    var s = useState([]), posts = s[0], setPosts = s[1];
    var s2 = useState(true), loading = s2[0], setLoading = s2[1];

    useEffect(function () {
      // Fetch all sections and merge, sort by date
      var promises = CONFIG.sections.map(function (sec) { return fetchByLabel(sec.label); });
      Promise.all(promises).then(function (results) {
        var all = [];
        results.forEach(function (p) { all = all.concat(p); });
        // Deduplicate by id
        var seen = {};
        all = all.filter(function (p) {
          if (seen[p.id]) return false;
          seen[p.id] = true;
          return true;
        });
        all.sort(function (a, b) { return b.published > a.published ? 1 : -1; });
        setPosts(all.slice(0, 50));
        setLoading(false);
      });
    }, []);

    return html`<div class="static-page">
      <h1>Latest Releases</h1>
      <p class="static-subtitle">Most recent episode uploads across all categories</p>
      ${loading
        ? html`<div class="slider-track" style="flex-wrap:wrap;padding:0"><${SkeletonCards} count=${6}/></div>`
        : html`<div class="timetable-grid">
            ${posts.map(function (p) {
              var date = new Date(p.published).toLocaleDateString();
              var slug = p.slug;
              return html`<a class="timetable-row" href=${p.url} target="_blank" rel="noopener" key=${p.id}>
                <img class="timetable-thumb" src=${p.thumbnail} alt=${p.title}/>
                <div class="timetable-info">
                  <div class="timetable-title">${p.title}</div>
                  <div class="timetable-meta">${date} · ${p.labels.filter(function(l){ return CONFIG.sectionLabels.indexOf(l)!==-1; }).join(', ')}</div>
                </div>
                ${p.video && html`<span class="release-play">▶</span>`}
              </a>`;
            })}
          </div>`
      }
    </div>`;
  }

  // ─── Navbar ───────────────────────────────────────────────────
  function Navbar(props) {
    var route = props.route;
    var s = useState(false), menuOpen = s[0], setMenuOpen = s[1];

    var links = [
      { href: '#/', label: 'Home' },
      { href: '#/about', label: 'About' },
      { href: '#/timetable', label: 'Timetable' },
      { href: '#/releases', label: 'Releases' },
    ];

    return html`<header class="header">
      <a href="#/" class="logo">Anime<span>Flix</span></a>
      <nav class="nav-links ${menuOpen ? 'open' : ''}">
        ${links.map(function (lnk) {
          var active = route === lnk.href.slice(1) || (lnk.href === '#/' && route === '/');
          return html`<a href=${lnk.href} class=${'nav-link' + (active ? ' active' : '')}
            onClick=${function () { setMenuOpen(false); }}>${lnk.label}</a>`;
        })}
        <a href="#/search" class=${'nav-link nav-search-link' + (route.indexOf('/search') === 0 ? ' active' : '')}
          onClick=${function () { setMenuOpen(false); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </a>
      </nav>
      <button class="menu-toggle" onClick=${function () { setMenuOpen(!menuOpen); }} aria-label="Toggle menu">
        <span></span><span></span><span></span>
      </button>
    </header>`;
  }

  // ─── App with Router ──────────────────────────────────────────
  function App() {
    var route = useRouter();

    var handleCardClick = useCallback(function (item) {
      navigate('/title/' + item.slug);
    }, []);

    var page;
    if (route === '/' || route === '') {
      page = html`<main>
        ${CONFIG.sections.map(function (sec) {
          return html`<${Section} key=${sec.label} config=${sec} onCardClick=${handleCardClick}/>`;
        })}
      </main>`;
    } else if (route === '/about') {
      page = html`<${AboutPage}/>`;
    } else if (route === '/timetable') {
      page = html`<${TimetablePage}/>`;
    } else if (route === '/releases') {
      page = html`<${ReleasesPage}/>`;
    } else if (route.indexOf('/search') === 0) {
      var sq = decodeURIComponent(route.replace('/search/', '').replace('/search', ''));
      page = html`<${SearchPage} query=${sq}/>`;
    } else if (route.indexOf('/title/') === 0) {
      var titleSlug = route.replace('/title/', '');
      page = html`<${DetailPage} slug=${titleSlug}/>`;
    } else {
      page = html`<div class="static-page"><h1>404</h1><p>Page not found.</p><a href="#/">← Home</a></div>`;
    }

    return html`<div class="app">
      <${Navbar} route=${route}/>
      ${page}
      <footer class="footer">Powered by Blogger · Built with Preact</footer>
    </div>`;
  }

  // ─── Mount ────────────────────────────────────────────────────
  render(html`<${App}/>`, document.getElementById('root'));

  // ─── SEO: JSON-LD ─────────────────────────────────────────────
  var ld = { '@context': 'https://schema.org', '@type': 'WebSite', name: 'AnimeFlix',
    url: window.location.origin,
    potentialAction: { '@type': 'SearchAction',
      target: window.location.origin + '#/search/{search_term_string}',
      'query-input': 'required name=search_term_string' } };
  var sc = document.createElement('script');
  sc.type = 'application/ld+json';
  sc.textContent = JSON.stringify(ld);
  document.head.appendChild(sc);

})();
