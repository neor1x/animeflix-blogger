// AnimeFlix - Lightweight Blogger-powered anime site
;(function () {
  'use strict';

  var h = preact.h, render = preact.render;
  var useState = preactHooks.useState, useEffect = preactHooks.useEffect,
      useRef = preactHooks.useRef, useCallback = preactHooks.useCallback;
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

  // ─── Firebase Config (optional — leave empty to use localStorage only) ──
  var FIREBASE_CONFIG = {
    apiKey: "AIzaSyAHqVMnFAcbA13GrgVpT-nAhBgDLvc9uKc",
    authDomain: "animeflix-blogger.firebaseapp.com",
    projectId: "animeflix-blogger",
    storageBucket: "animeflix-blogger.firebasestorage.app",
    messagingSenderId: "307752501362",
    appId: "1:307752501362:web:448e299d92188ca75142eb"
  };

  // Auto-init Firebase if config is provided
  if (FIREBASE_CONFIG.apiKey) {
    // Load Firebase SDK dynamically
    var fbScripts = [
      'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
      'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js',
      'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js'
    ];
    var loaded = 0;
    fbScripts.forEach(function(src) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function() {
        loaded++;
        if (loaded === fbScripts.length) initFirebase(FIREBASE_CONFIG);
      };
      document.head.appendChild(s);
    });
  }

  // ─── User Data (localStorage + optional Firebase sync) ────────
  var STORAGE_KEY = 'animeflix_user';
  var firebaseReady = false;
  var firebaseAuth = null;
  var firebaseDb = null;

  function loadLocal() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch(e) { return {}; }
  }
  function saveLocal(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch(e) {}
  }

  function getUserData() {
    var d = loadLocal();
    if (!d.bookmarks) d.bookmarks = [];
    if (!d.history) d.history = [];
    return d;
  }

  function saveUserData(data) {
    saveLocal(data);
    // Sync to Firestore if signed in
    if (firebaseReady && firebaseAuth && firebaseAuth.currentUser && firebaseDb) {
      var uid = firebaseAuth.currentUser.uid;
      firebaseDb.collection('users').doc(uid).set({
        bookmarks: data.bookmarks || [],
        history: data.history || []
      }, { merge: true }).catch(function(){});
    }
  }

  function addBookmark(slug, title, thumbnail) {
    var d = getUserData();
    if (d.bookmarks.some(function(b){ return b.slug === slug; })) return d;
    d.bookmarks.unshift({ slug: slug, title: title, thumbnail: thumbnail, addedAt: Date.now() });
    saveUserData(d);
    return d;
  }

  function removeBookmark(slug) {
    var d = getUserData();
    d.bookmarks = d.bookmarks.filter(function(b){ return b.slug !== slug; });
    saveUserData(d);
    return d;
  }

  function isBookmarked(slug) {
    return getUserData().bookmarks.some(function(b){ return b.slug === slug; });
  }

  function addHistory(slug, title, thumbnail, epTitle) {
    var d = getUserData();
    // Remove old entry for same slug
    d.history = d.history.filter(function(h){ return h.slug !== slug; });
    d.history.unshift({ slug: slug, title: title, thumbnail: thumbnail, epTitle: epTitle, watchedAt: Date.now() });
    // Keep last 50
    if (d.history.length > 50) d.history = d.history.slice(0, 50);
    saveUserData(d);
    return d;
  }

  // Firebase init (called when SDK loads)
  function initFirebase(config) {
    if (typeof firebase === 'undefined') return;
    try {
      if (!firebase.apps.length) firebase.initializeApp(config);
      firebaseAuth = firebase.auth();
      firebaseDb = firebase.firestore();
      firebaseReady = true;
    } catch(e) { firebaseReady = false; }
  }

  function signInWithGoogle() {
    if (!firebaseReady || !firebaseAuth) return Promise.reject('Firebase not ready');
    var provider = new firebase.auth.GoogleAuthProvider();
    return firebaseAuth.signInWithPopup(provider).then(function(result) {
      // Pull cloud data and merge with local
      return syncFromCloud().then(function(){ return result.user; });
    });
  }

  function signOut() {
    if (!firebaseReady || !firebaseAuth) return Promise.resolve();
    return firebaseAuth.signOut();
  }

  function syncFromCloud() {
    if (!firebaseReady || !firebaseAuth || !firebaseAuth.currentUser || !firebaseDb) return Promise.resolve();
    var uid = firebaseAuth.currentUser.uid;
    return firebaseDb.collection('users').doc(uid).get().then(function(doc) {
      if (doc.exists) {
        var cloud = doc.data();
        var local = getUserData();
        // Merge: cloud bookmarks that aren't in local
        (cloud.bookmarks || []).forEach(function(cb) {
          if (!local.bookmarks.some(function(lb){ return lb.slug === cb.slug; })) {
            local.bookmarks.push(cb);
          }
        });
        // Merge history
        (cloud.history || []).forEach(function(ch) {
          if (!local.history.some(function(lh){ return lh.slug === ch.slug && lh.epTitle === ch.epTitle; })) {
            local.history.push(ch);
          }
        });
        local.history.sort(function(a,b){ return (b.watchedAt||0) - (a.watchedAt||0); });
        local.history = local.history.slice(0, 50);
        saveLocal(local);
        // Push merged data back to cloud
        saveUserData(local);
      }
    }).catch(function(){});
  }

  // Auth state hook
  function useAuth() {
    var s = useState(null), user = s[0], setUser = s[1];
    var s2 = useState(true), loading = s2[0], setLoading = s2[1];
    useEffect(function() {
      if (!firebaseReady || !firebaseAuth) { setLoading(false); return; }
      var unsub = firebaseAuth.onAuthStateChanged(function(u) {
        setUser(u);
        setLoading(false);
        if (u) syncFromCloud();
      });
      return unsub;
    }, []);
    return { user: user, loading: loading };
  }

  // ─── Router ───────────────────────────────────────────────────
  function getRoute() { return window.location.hash.slice(1) || '/'; }
  function navigate(path) { window.location.hash = path; }

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
  var allPostsCache = null;

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

  function fetchAllPosts() {
    if (allPostsCache) return Promise.resolve(allPostsCache);
    var promises = CONFIG.sections.map(function (s) { return fetchByLabel(s.label); });
    return Promise.all(promises).then(function (results) {
      var all = [];
      var seen = {};
      results.forEach(function (posts) {
        posts.forEach(function (p) {
          if (!seen[p.id]) { seen[p.id] = true; all.push(p); }
        });
      });
      allPostsCache = all;
      return all;
    });
  }

  // ─── Post Parser ──────────────────────────────────────────────
  function parseEntry(entry) {
    var title = entry.title.$t || '';
    var rawContent = entry.content ? entry.content.$t : '';
    var published = entry.published.$t || '';
    var updated = entry.updated ? entry.updated.$t : published;
    var labels = entry.category ? entry.category.map(function (c) { return c.term; }) : [];
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

    var slug = title.replace(/[^a-zA-Z0-9\u0400-\u04FF\u1800-\u18AF]+/g, '-')
      .replace(/^-|-$/g, '').toLowerCase();

    return { id: id, title: title, published: published, updated: updated,
      labels: labels, thumbnail: thumbnail, video: video, links: links, slug: slug };
  }

  // ─── Format date ──────────────────────────────────────────────
  function formatDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  // ─── Group posts by title ─────────────────────────────────────
  function getBaseName(title) {
    return title
      .replace(/\s*[-–]\s*\d+[-\u0440].*$/i, '')
      .replace(/\s+\d+[-\u0440].*$/i, '')
      .replace(/\s+\d+[-–]\s*\u0440.*$/i, '')
      .replace(/\s*ep(?:isode)?\s*\d+.*$/i, '')
      .replace(/\s*\d+[-–]\s*\u0440\s+\u0430\u043D\u0433\u0438.*$/i, '')
      .trim() || title;
  }

  function groupByTitle(posts) {
    var map = {};
    posts.forEach(function (p) {
      var base = getBaseName(p.title);
      var key = base.toLowerCase();
      if (!map[key]) {
        map[key] = {
          title: base,
          slug: base.replace(/[^a-zA-Z0-9\u0400-\u04FF\u1800-\u18AF]+/g, '-')
            .replace(/^-|-$/g, '').toLowerCase(),
          thumbnail: p.thumbnail,
          labels: p.labels.slice(),
          published: p.published,
          updated: p.updated,
          episodes: []
        };
      }
      map[key].episodes.push(p);
      p.labels.forEach(function (l) {
        if (map[key].labels.indexOf(l) === -1) map[key].labels.push(l);
      });
      if (p.published > map[key].published || p.updated > map[key].updated) {
        map[key].published = p.published;
        map[key].updated = p.updated;
        if (p.thumbnail) map[key].thumbnail = p.thumbnail;
      }
    });
    Object.keys(map).forEach(function (key) {
      map[key].episodes.sort(function (a, b) {
        var na = parseInt((a.title.match(/(\d+)/) || [])[1]) || 0;
        var nb = parseInt((b.title.match(/(\d+)/) || [])[1]) || 0;
        return na - nb;
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  // ─── Prefix search (starts-with matching) ─────────────────────
  function prefixMatch(text, query) {
    if (!query) return false;
    text = text.toLowerCase();
    query = query.toLowerCase().trim();
    // Check if any word in text starts with query or any query word
    var qWords = query.split(/\s+/);
    var tWords = text.split(/\s+/);
    return qWords.every(function (qw) {
      return tWords.some(function (tw) { return tw.indexOf(qw) === 0; }) ||
        text.indexOf(qw) !== -1;
    });
  }

  // ─── Draggable slider ─────────────────────────────────────────
  function useDrag(ref) {
    var state = useRef({ isDown: false, startX: 0, scrollLeft: 0, moved: false });
    var onMouseDown = useCallback(function (e) {
      var el = ref.current; if (!el) return;
      state.current = { isDown: true, moved: false, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft };
      el.style.cursor = 'grabbing'; el.style.userSelect = 'none';
    }, []);
    var onEnd = useCallback(function () {
      state.current.isDown = false;
      if (ref.current) { ref.current.style.cursor = 'grab'; ref.current.style.userSelect = ''; }
    }, []);
    var onMouseMove = useCallback(function (e) {
      if (!state.current.isDown) return;
      e.preventDefault();
      var el = ref.current; if (!el) return;
      var walk = (e.pageX - el.offsetLeft - state.current.startX) * 1.5;
      if (Math.abs(walk) > 5) state.current.moved = true;
      el.scrollLeft = state.current.scrollLeft - walk;
    }, []);
    var wasDragged = useCallback(function () { return state.current.moved; }, []);
    return { onMouseDown: onMouseDown, onMouseLeave: onEnd, onMouseUp: onEnd, onMouseMove: onMouseMove, wasDragged: wasDragged };
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
    var item = props.item, badge = props.badge, onClick = props.onClick, subtitle = props.subtitle;
    var dateStr = formatDate(item.updated || item.published);
    return html`<article class="card" onClick=${function () { onClick(item); }}
      role="button" tabindex="0"
      onKeyDown=${function (e) { if (e.key === 'Enter') onClick(item); }}
      aria-label=${item.title}>
      <${LazyImg} src=${item.thumbnail} alt=${item.title} className="card-img"/>
      ${badge && html`<span class="card-badge">${badge}</span>`}
      <div class="card-info">
        <div class="card-title">${item.title}</div>
        ${subtitle && html`<div class="card-subtitle">${subtitle}</div>`}
        <div class="card-meta">${dateStr}</div>
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

    // For Ongoing, show latest episode subtitle
    var isOngoing = config.label === 'Ongoing';

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
              var sub = isOngoing && item.episodes.length > 0
                ? 'Ep ' + ((item.episodes[item.episodes.length-1].title.match(/(\d+)/) || [])[1] || item.episodes.length)
                : null;
              return html`<${Card} key=${item.slug} item=${item} badge=${config.badge} onClick=${handleClick} subtitle=${sub}/>`;
            })
        }
      </div>
    </section>`;
  }

  // ─── Detail Page ──────────────────────────────────────────────
  function DetailPage(props) {
    var slug = props.slug;
    var s = useState(null), item = s[0], setItem = s[1];
    var s2 = useState(true), loading = s2[0], setLoading = s2[1];
    var s3 = useState(null), activeEp = s3[0], setActiveEp = s3[1];
    var s4 = useState(false), bookmarked = s4[0], setBookmarked = s4[1];

    useEffect(function () {
      setLoading(true);
      setActiveEp(null);
      fetchAllPosts().then(function (all) {
        var grouped = groupByTitle(all);
        var found = grouped.find(function (g) { return g.slug === slug; });
        setItem(found || null);
        if (found && found.episodes.length > 0) {
          setActiveEp(found.episodes[found.episodes.length - 1]);
        }
        setBookmarked(isBookmarked(slug));
        setLoading(false);
      });
    }, [slug]);

    useEffect(function () { window.scrollTo(0, 0); }, [slug]);

    var selectEp = useCallback(function (ep) {
      setActiveEp(ep);
      // Track history
      if (item) addHistory(slug, item.title, item.thumbnail, ep.title);
    }, [item, slug]);

    var toggleBookmark = useCallback(function () {
      if (bookmarked) {
        removeBookmark(slug);
        setBookmarked(false);
      } else if (item) {
        addBookmark(slug, item.title, item.thumbnail);
        setBookmarked(true);
      }
    }, [bookmarked, item, slug]);

    if (loading) return html`<div class="detail-page">
      <div class="detail-loading"><div class="skeleton" style="width:100%;height:350px;border-radius:14px"></div></div>
    </div>`;

    if (!item) return html`<div class="detail-page">
      <div class="detail-not-found">
        <h2>Not found</h2><p>This title could not be found.</p>
        <a href="#/" class="detail-blog-link">← Back to home</a>
      </div>
    </div>`;

    var heroImg = item.thumbnail ? item.thumbnail.replace(/\/s\d+(-c)?\//, '/s800/') : '';
    var sectionLabels = CONFIG.sectionLabels;

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
          <button class=${'bookmark-btn' + (bookmarked ? ' active' : '')} onClick=${toggleBookmark}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill=${bookmarked ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
            ${bookmarked ? 'Bookmarked' : 'Bookmark'}
          </button>
        </div>
      </div>

      ${activeEp && activeEp.video && html`
        <div class="detail-player" id="player">
          <h3>Now Playing: ${activeEp.title}</h3>
          <div class="video">
            <iframe src=${activeEp.video} key=${activeEp.id} allowfullscreen="" allow="autoplay; encrypted-media"
              referrerpolicy="no-referrer" title=${activeEp.title}></iframe>
          </div>
          ${activeEp.links.length > 0 && html`
            <div class="player-downloads">
              ${activeEp.links.map(function (lnk) {
                return html`<a class="dl-btn" href=${lnk.url} target="_blank" rel="noopener noreferrer">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  ${lnk.name}</a>`;
              })}
            </div>
          `}
        </div>
      `}

      <div class="detail-body">
        <div class="detail-episodes">
          <h3>Episodes</h3>
          <div class="ep-grid">
            ${item.episodes.map(function (ep, i) {
              var num = (ep.title.match(/(\d+)/) || [])[1] || (i + 1);
              var isActive = activeEp && activeEp.id === ep.id;
              return html`<div class=${'ep-card' + (isActive ? ' active' : '')} key=${ep.id}
                onClick=${function () { selectEp(ep); }}>
                <div class="ep-num">${num}</div>
                <div class="ep-title">${ep.title}</div>
                <div class="ep-meta">${formatDate(ep.published)}</div>
                <div class="ep-actions">
                  ${ep.links.map(function (lnk) {
                    return html`<a class="ep-btn dl" href=${lnk.url} target="_blank" rel="noopener noreferrer"
                      onClick=${function(e){e.stopPropagation();}} title=${lnk.name}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      ${lnk.name}</a>`;
                  })}
                </div>
              </div>`;
            })}
          </div>
        </div>
      </div>
    </div>`;
  }

  // ─── Search Page (prefix matching, instant results) ───────────
  function SearchPage(props) {
    var initialQuery = props.query || '';
    var s = useState(initialQuery), query = s[0], setQuery = s[1];
    var s2 = useState([]), results = s2[0], setResults = s2[1];
    var s3 = useState(false), loading = s3[0], setLoading = s3[1];
    var allGrouped = useRef([]);

    // Load all posts once for instant local filtering
    useEffect(function () {
      setLoading(true);
      fetchAllPosts().then(function (all) {
        allGrouped.current = groupByTitle(all);
        if (initialQuery) filterResults(initialQuery);
        setLoading(false);
      });
    }, []);

    var filterResults = useCallback(function (q) {
      if (!q.trim()) { setResults([]); return; }
      var filtered = allGrouped.current.filter(function (g) {
        return prefixMatch(g.title, q) ||
          g.labels.some(function (l) { return prefixMatch(l, q); });
      });
      setResults(filtered);
    }, []);

    var handleInput = useCallback(function (e) {
      var q = e.target.value;
      setQuery(q);
      filterResults(q);
    }, []);

    var handleClick = useCallback(function (item) {
      navigate('/title/' + encodeURIComponent(item.slug));
    }, []);

    return html`<div class="search-page">
      <div class="search-bar-large">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="search" placeholder="Search anime titles, labels..." value=${query}
          onInput=${handleInput} aria-label="Search anime" autofocus/>
      </div>
      <div class="search-results">
        ${loading
          ? html`<div class="slider-track" style="flex-wrap:wrap;padding:0 4%"><${SkeletonCards} count=${6}/></div>`
          : results.length
            ? html`<div class="slider-track" style="flex-wrap:wrap;padding:0 4%">
                ${results.map(function (item) {
                  return html`<${Card} key=${item.slug} item=${item} onClick=${handleClick}/>`;
                })}
              </div>`
            : query.trim()
              ? html`<p style="padding:20px 4%;color:#888">No results for "${query}"</p>`
              : html`<p style="padding:20px 4%;color:#666">Start typing to search...</p>`
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
        <p>All content is fetched directly from the blog's RSS feed and rendered client-side.</p>
      </div>
    </div>`;
  }

  function TimetablePage() {
    var s = useState([]), all = s[0], setAll = s[1];
    var s2 = useState(true), loading = s2[0], setLoading = s2[1];
    useEffect(function () {
      fetchByLabel('Ongoing').then(function (posts) {
        var grouped = groupByTitle(posts);
        grouped.sort(function (a, b) { return b.updated > a.updated ? 1 : -1; });
        setAll(grouped);
        setLoading(false);
      });
    }, []);
    return html`<div class="static-page">
      <h1>Timetable</h1>
      <p class="static-subtitle">Currently airing, sorted by latest update</p>
      ${loading
        ? html`<div class="slider-track" style="flex-wrap:wrap;padding:0"><${SkeletonCards} count=${6}/></div>`
        : html`<div class="timetable-grid">
            ${all.map(function (item) {
              var latest = item.episodes[item.episodes.length - 1];
              return html`<a class="timetable-row" href=${'#/title/' + encodeURIComponent(item.slug)} key=${item.slug}>
                <img class="timetable-thumb" src=${item.thumbnail} alt=${item.title}/>
                <div class="timetable-info">
                  <div class="timetable-title">${item.title}</div>
                  <div class="timetable-meta">${item.episodes.length} ep · ${formatDate(latest ? latest.updated || latest.published : '')}</div>
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
      fetchAllPosts().then(function (all) {
        var sorted = all.slice().sort(function (a, b) { return b.published > a.published ? 1 : -1; });
        setPosts(sorted.slice(0, 50));
        setLoading(false);
      });
    }, []);
    return html`<div class="static-page">
      <h1>Latest Releases</h1>
      <p class="static-subtitle">Most recent uploads across all categories</p>
      ${loading
        ? html`<div class="slider-track" style="flex-wrap:wrap;padding:0"><${SkeletonCards} count=${6}/></div>`
        : html`<div class="timetable-grid">
            ${posts.map(function (p) {
              var titleSlug = getBaseName(p.title).replace(/[^a-zA-Z0-9\u0400-\u04FF\u1800-\u18AF]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
              return html`<a class="timetable-row" href=${'#/title/' + encodeURIComponent(titleSlug)} key=${p.id}>
                <img class="timetable-thumb" src=${p.thumbnail} alt=${p.title}/>
                <div class="timetable-info">
                  <div class="timetable-title">${p.title}</div>
                  <div class="timetable-meta">${formatDate(p.updated || p.published)} · ${p.labels.filter(function(l){ return CONFIG.sectionLabels.indexOf(l)!==-1; }).join(', ')}</div>
                </div>
                ${p.video && html`<span class="release-play">▶</span>`}
              </a>`;
            })}
          </div>`
      }
    </div>`;
  }

  // ─── Profile Page (bookmarks, history, sign in) ────────────────
  function ProfilePage() {
    var auth = useAuth();
    var s = useState(getUserData()), data = s[0], setData = s[1];
    var s2 = useState('bookmarks'), tab = s2[0], setTab = s2[1];

    var refresh = useCallback(function() { setData(getUserData()); }, []);

    var handleSignIn = useCallback(function() {
      signInWithGoogle().then(function() { refresh(); }).catch(function(){});
    }, []);

    var handleSignOut = useCallback(function() {
      signOut().then(function() { refresh(); });
    }, []);

    var handleRemoveBookmark = useCallback(function(slug) {
      removeBookmark(slug);
      refresh();
    }, []);

    var handleClearHistory = useCallback(function() {
      var d = getUserData();
      d.history = [];
      saveUserData(d);
      refresh();
    }, []);

    return html`<div class="static-page">
      <div class="profile-header">
        <h1>My Profile</h1>
        ${firebaseReady && html`
          <div class="profile-auth">
            ${auth.user
              ? html`<div class="profile-user">
                  <img class="profile-avatar" src=${auth.user.photoURL || ''} alt=""/>
                  <span>${auth.user.displayName || 'User'}</span>
                  <button class="btn-small" onClick=${handleSignOut}>Sign out</button>
                </div>`
              : html`<button class="btn-google" onClick=${handleSignIn}>
                  <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/></svg>
                  Sign in with Google
                </button>`
            }
          </div>
        `}
      </div>

      ${!firebaseReady && html`<p class="profile-note">Sign in is not configured. Bookmarks and history are saved locally in this browser.</p>`}

      <div class="profile-tabs">
        <button class=${'profile-tab' + (tab === 'bookmarks' ? ' active' : '')} onClick=${function(){ setTab('bookmarks'); }}>
          Bookmarks (${data.bookmarks.length})
        </button>
        <button class=${'profile-tab' + (tab === 'history' ? ' active' : '')} onClick=${function(){ setTab('history'); }}>
          History (${data.history.length})
        </button>
      </div>

      ${tab === 'bookmarks' && html`
        <div class="timetable-grid">
          ${data.bookmarks.length === 0
            ? html`<p style="color:#888;padding:20px 0">No bookmarks yet. Open a title and click Bookmark.</p>`
            : data.bookmarks.map(function(b) {
                return html`<div class="timetable-row" key=${b.slug}>
                  <a href=${'#/title/' + encodeURIComponent(b.slug)} style="display:contents;color:inherit">
                    <img class="timetable-thumb" src=${b.thumbnail} alt=${b.title}/>
                    <div class="timetable-info">
                      <div class="timetable-title">${b.title}</div>
                      <div class="timetable-meta">Added ${formatDate(new Date(b.addedAt).toISOString())}</div>
                    </div>
                  </a>
                  <button class="btn-remove" onClick=${function(){ handleRemoveBookmark(b.slug); }} title="Remove">✕</button>
                </div>`;
              })
          }
        </div>
      `}

      ${tab === 'history' && html`
        <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
          ${data.history.length > 0 && html`<button class="btn-small" onClick=${handleClearHistory}>Clear history</button>`}
        </div>
        <div class="timetable-grid">
          ${data.history.length === 0
            ? html`<p style="color:#888;padding:20px 0">No watch history yet.</p>`
            : data.history.map(function(h) {
                return html`<a class="timetable-row" href=${'#/title/' + encodeURIComponent(h.slug)} key=${h.slug + h.watchedAt}>
                  <img class="timetable-thumb" src=${h.thumbnail} alt=${h.title}/>
                  <div class="timetable-info">
                    <div class="timetable-title">${h.title}</div>
                    <div class="timetable-meta">${h.epTitle || ''} · ${formatDate(new Date(h.watchedAt).toISOString())}</div>
                  </div>
                </a>`;
              })
          }
        </div>
      `}
    </div>`;
  }

  // ─── Admin: Add Post ───────────────────────────────────────────
  function AdminPage() {
    var s1 = useState(''), title = s1[0], setTitle = s1[1];
    var s2 = useState(''), videoUrl = s2[0], setVideoUrl = s2[1];
    var s3 = useState(''), thumbUrl = s3[0], setThumbUrl = s3[1];
    var s4 = useState([{ name: '', url: '' }]), links = s4[0], setLinks = s4[1];
    var s5 = useState([]), labels = s5[0], setLabels = s5[1];
    var s6 = useState(''), customLabel = s6[0], setCustomLabel = s6[1];
    var s7 = useState(''), output = s7[0], setOutput = s7[1];
    var s8 = useState(false), copied = s8[0], setCopied = s8[1];

    var addLink = useCallback(function () {
      setLinks(links.concat([{ name: '', url: '' }]));
    }, [links]);

    var removeLink = useCallback(function (i) {
      setLinks(links.filter(function (_, idx) { return idx !== i; }));
    }, [links]);

    var updateLink = useCallback(function (i, field, val) {
      var updated = links.map(function (l, idx) {
        if (idx !== i) return l;
        var copy = { name: l.name, url: l.url };
        copy[field] = val;
        return copy;
      });
      setLinks(updated);
    }, [links]);

    var toggleLabel = useCallback(function (label) {
      if (labels.indexOf(label) !== -1) {
        setLabels(labels.filter(function (l) { return l !== label; }));
      } else {
        setLabels(labels.concat([label]));
      }
    }, [labels]);

    var addCustomLabel = useCallback(function () {
      var l = customLabel.trim();
      if (l && labels.indexOf(l) === -1) {
        setLabels(labels.concat([l]));
        setCustomLabel('');
      }
    }, [customLabel, labels]);

    var generate = useCallback(function () {
      if (!title.trim()) { setOutput(''); return; }

      var validLinks = links.filter(function (l) { return l.name.trim() && l.url.trim(); });

      // Build JSON data matching exact blog format with spacing
      var linksStr = validLinks.map(function (l) {
        return '          {' +
          '\n               "name": "' + l.name.trim() + '",' +
          '\n              "url": "' + l.url.trim() + '"' +
          '\n          }';
      }).join(',\n');

      var jsonBlock = '{' +
        '\n     "data":' +
        '\n     {' +
        '\n         "video": "' + videoUrl.trim() + '",' +
        '\n         "links": [' +
        '\n' + linksStr +
        '\n         ]' +
        '\n     }' +
        '\n }';

      // Build exact HTML matching existing posts
      var contentHtml = '<div style="display: none">' + jsonBlock + ' </div>';
      if (thumbUrl.trim()) {
        contentHtml += '<a href="' + thumbUrl.trim() + '" imageanchor="1" >' +
          '<img border="0" src="' + thumbUrl.trim() + '"' +
          ' data-original-width="400" data-original-height="566" /></a>';
      }

      setOutput(contentHtml);
      setCopied(false);
    }, [title, videoUrl, thumbUrl, links, labels]);

    var copyOutput = useCallback(function () {
      if (!output) return;
      navigator.clipboard.writeText(output).then(function () {
        setCopied(true);
        setTimeout(function () { setCopied(false); }, 2000);
      });
    }, [output]);

    var resetForm = useCallback(function () {
      setTitle(''); setVideoUrl(''); setThumbUrl('');
      setLinks([{ name: '', url: '' }]);
      setLabels([]); setOutput(''); setCopied(false);
    }, []);

    return html`<div class="static-page">
      <h1>Add Episode</h1>
      <p class="static-subtitle">Fill in the fields and generate the post JSON for Blogger</p>

      <div class="admin-form">
        <div class="form-group">
          <label class="form-label">Title *</label>
          <input class="form-input" type="text" placeholder="e.g. DanMachi S2 - 10-р анги"
            value=${title} onInput=${function (e) { setTitle(e.target.value); }}/>
        </div>

        <div class="form-group">
          <label class="form-label">Video Embed URL</label>
          <input class="form-input" type="text" placeholder="e.g. //ok.ru/videoembed/123456"
            value=${videoUrl} onInput=${function (e) { setVideoUrl(e.target.value); }}/>
        </div>

        <div class="form-group">
          <label class="form-label">Thumbnail Image URL</label>
          <input class="form-input" type="text" placeholder="e.g. https://blogger.googleusercontent.com/img/..."
            value=${thumbUrl} onInput=${function (e) { setThumbUrl(e.target.value); }}/>
          ${thumbUrl && html`<img class="admin-thumb-preview" src=${thumbUrl} alt="Preview"/>`}
        </div>

        <div class="form-group">
          <label class="form-label">Download Links</label>
          ${links.map(function (lnk, i) {
            return html`<div class="admin-link-row" key=${i}>
              <input class="form-input form-input-sm" type="text" placeholder="Name (e.g. MEGA)"
                value=${lnk.name} onInput=${function (e) { updateLink(i, 'name', e.target.value); }}/>
              <input class="form-input" type="text" placeholder="URL"
                value=${lnk.url} onInput=${function (e) { updateLink(i, 'url', e.target.value); }}/>
              ${links.length > 1 && html`<button class="btn-remove" onClick=${function () { removeLink(i); }}>✕</button>`}
            </div>`;
          })}
          <button class="btn-small" onClick=${addLink} style="margin-top:6px">+ Add link</button>
        </div>

        <div class="form-group">
          <label class="form-label">Labels</label>
          <div class="admin-labels">
            ${CONFIG.sectionLabels.map(function (l) {
              var active = labels.indexOf(l) !== -1;
              return html`<button class=${'label-chip' + (active ? ' active' : '')}
                onClick=${function () { toggleLabel(l); }}>${l}</button>`;
            })}
          </div>
          <div class="admin-custom-label">
            <input class="form-input form-input-sm" type="text" placeholder="Custom label..."
              value=${customLabel} onInput=${function (e) { setCustomLabel(e.target.value); }}
              onKeyDown=${function (e) { if (e.key === 'Enter') addCustomLabel(); }}/>
            <button class="btn-small" onClick=${addCustomLabel}>Add</button>
          </div>
          ${labels.length > 0 && html`<div class="admin-labels" style="margin-top:8px">
            ${labels.map(function (l) {
              return html`<span class="label-chip active" key=${l}>
                ${l} <span class="label-x" onClick=${function () { toggleLabel(l); }}>✕</span>
              </span>`;
            })}
          </div>`}
        </div>

        <div class="admin-actions">
          <button class="btn-generate" onClick=${generate}>Generate JSON</button>
          <button class="btn-small" onClick=${resetForm}>Reset</button>
        </div>

        ${output && html`
          <div class="form-group">
            <label class="form-label">Title</label>
            <pre class="admin-output" style="color:#fff">${title}</pre>
          </div>
          <div class="form-group">
            <label class="form-label">Labels</label>
            <pre class="admin-output" style="color:#fff">${labels.join(', ') || '(none)'}</pre>
          </div>
          <div class="form-group">
            <label class="form-label">HTML Content — paste into Blogger HTML editor</label>
            <div class="admin-output-wrap">
              <pre class="admin-output">${output}</pre>
              <button class=${'btn-copy' + (copied ? ' copied' : '')} onClick=${copyOutput}>
                ${copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        `}
      </div>
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
      { href: '#/profile', label: 'Profile' },
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

  // ─── App ──────────────────────────────────────────────────────
  function App() {
    var route = useRouter();
    var handleCardClick = useCallback(function (item) {
      navigate('/title/' + encodeURIComponent(item.slug));
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
    } else if (route === '/profile') {
      page = html`<${ProfilePage}/>`;
    } else if (route === '/admin') {
      page = html`<${AdminPage}/>`;
    } else if (route.indexOf('/search') === 0) {
      var sq = decodeURIComponent(route.replace('/search/', '').replace('/search', ''));
      page = html`<${SearchPage} query=${sq}/>`;
    } else if (route.indexOf('/title/') === 0) {
      var titleSlug = decodeURIComponent(route.replace('/title/', ''));
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

  render(html`<${App}/>`, document.getElementById('root'));

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
