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
    premiumLabel: 'Premium',
    ranks: [
      { name: 'Free', color: '#888', minMonths: 0, icon: '👤' },
      { name: 'Bronze', color: '#cd7f32', minMonths: 1, icon: '🥉' },
      { name: 'Silver', color: '#c0c0c0', minMonths: 3, icon: '🥈' },
      { name: 'Gold', color: '#ffd700', minMonths: 6, icon: '🥇' },
      { name: 'Diamond', color: '#b9f2ff', minMonths: 12, icon: '💎' },
    ],
    plans: [
      { id: '1m', label: '1 Month', months: 1, price: '$4.99' },
      { id: '3m', label: '3 Months', months: 3, price: '$12.99' },
      { id: '6m', label: '6 Months', months: 6, price: '$22.99' },
      { id: '1y', label: '1 Year', months: 12, price: '$39.99' },
    ],
    bookmarkCategories: ['Watching', 'Completed', 'On Hold', 'Dropped'],
  };

  // ─── Firebase ─────────────────────────────────────────────────
  var FIREBASE_CONFIG = {
    apiKey: "AIzaSyAHqVMnFAcbA13GrgVpT-nAhBgDLvc9uKc",
    authDomain: "animeflix-blogger.firebaseapp.com",
    projectId: "animeflix-blogger",
    storageBucket: "animeflix-blogger.firebasestorage.app",
    messagingSenderId: "307752501362",
    appId: "1:307752501362:web:448e299d92188ca75142eb"
  };

  var firebaseReady = false, firebaseAuth = null, firebaseDb = null;

  if (FIREBASE_CONFIG.apiKey) {
    var fbScripts = [
      'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
      'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js',
      'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js'
    ];
    var loaded = 0;
    fbScripts.forEach(function(src) {
      var s = document.createElement('script'); s.src = src;
      s.onload = function() { loaded++; if (loaded === fbScripts.length) initFirebase(FIREBASE_CONFIG); };
      document.head.appendChild(s);
    });
  }

  function initFirebase(config) {
    if (typeof firebase === 'undefined') return;
    try {
      if (!firebase.apps.length) firebase.initializeApp(config);
      firebaseAuth = firebase.auth();
      firebaseDb = firebase.firestore();
      firebaseReady = true;
    } catch(e) { firebaseReady = false; }
  }

  // ─── User Data ────────────────────────────────────────────────
  var STORAGE_KEY = 'animeflix_user';

  function loadLocal() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch(e) { return {}; } }
  function saveLocal(data) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch(e) {} }

  function getUserData() {
    var d = loadLocal();
    if (!d.bookmarks) d.bookmarks = {};
    CONFIG.bookmarkCategories.forEach(function(c) { if (!d.bookmarks[c]) d.bookmarks[c] = []; });
    if (!d.history) d.history = [];
    return d;
  }

  function saveUserData(data) {
    saveLocal(data);
    if (firebaseReady && firebaseAuth && firebaseAuth.currentUser && firebaseDb) {
      var uid = firebaseAuth.currentUser.uid;
      firebaseDb.collection('users').doc(uid).set({ bookmarks: data.bookmarks || {}, history: data.history || [] }, { merge: true }).catch(function(){});
    }
  }

  // Bookmark with categories
  function addBookmark(slug, title, thumbnail, category) {
    var d = getUserData();
    // Remove from all categories first
    CONFIG.bookmarkCategories.forEach(function(c) {
      d.bookmarks[c] = (d.bookmarks[c] || []).filter(function(b) { return b.slug !== slug; });
    });
    if (!d.bookmarks[category]) d.bookmarks[category] = [];
    d.bookmarks[category].unshift({ slug: slug, title: title, thumbnail: thumbnail, addedAt: Date.now() });
    saveUserData(d);
    return d;
  }

  function removeBookmark(slug) {
    var d = getUserData();
    CONFIG.bookmarkCategories.forEach(function(c) {
      d.bookmarks[c] = (d.bookmarks[c] || []).filter(function(b) { return b.slug !== slug; });
    });
    saveUserData(d);
    return d;
  }

  function getBookmarkCategory(slug) {
    var d = getUserData();
    for (var i = 0; i < CONFIG.bookmarkCategories.length; i++) {
      var c = CONFIG.bookmarkCategories[i];
      if ((d.bookmarks[c] || []).some(function(b) { return b.slug === slug; })) return c;
    }
    return null;
  }

  function addHistory(slug, title, thumbnail, epTitle) {
    var d = getUserData();
    d.history = d.history.filter(function(h) { return h.slug !== slug; });
    d.history.unshift({ slug: slug, title: title, thumbnail: thumbnail, epTitle: epTitle, watchedAt: Date.now() });
    if (d.history.length > 50) d.history = d.history.slice(0, 50);
    saveUserData(d);
    return d;
  }

  // ─── Subscription & Rank ──────────────────────────────────────
  function getSubData(userDoc) {
    try {
      if (!userDoc || !userDoc.subscription) return { active: false, rank: CONFIG.ranks[0], totalMonths: 0 };
      var sub = userDoc.subscription;
      var now = Date.now();
      // Handle Firestore Timestamp or plain number
      var exp = sub.expiresAt;
      if (exp && typeof exp === 'object' && exp.toMillis) exp = exp.toMillis();
      else if (exp && typeof exp === 'object' && exp.seconds) exp = exp.seconds * 1000;
      else exp = Number(exp) || 0;
      var active = exp > now;
      var totalMonths = Number(sub.totalMonths) || 0;
      var rank = CONFIG.ranks[0];
      for (var i = CONFIG.ranks.length - 1; i >= 0; i--) {
        if (totalMonths >= CONFIG.ranks[i].minMonths) { rank = CONFIG.ranks[i]; break; }
      }
      return { active: active, rank: rank, totalMonths: totalMonths, expiresAt: exp };
    } catch(e) {
      return { active: false, rank: CONFIG.ranks[0], totalMonths: 0 };
    }
  }

  function isPremium(userDoc) { try { return getSubData(userDoc).active; } catch(e) { return false; } }

  // ─── Auth hooks ───────────────────────────────────────────────
  function signInWithGoogle() {
    if (!firebaseReady) return Promise.reject('not ready');
    return firebaseAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).then(function(r) {
      return syncFromCloud().then(function() { return r.user; });
    });
  }
  function signOut() { return firebaseReady ? firebaseAuth.signOut() : Promise.resolve(); }

  function syncFromCloud() {
    if (!firebaseReady || !firebaseAuth.currentUser) return Promise.resolve();
    return firebaseDb.collection('users').doc(firebaseAuth.currentUser.uid).get().then(function(doc) {
      if (doc.exists) {
        var cloud = doc.data();
        var local = getUserData();
        // Merge bookmarks
        CONFIG.bookmarkCategories.forEach(function(c) {
          (cloud.bookmarks && cloud.bookmarks[c] || []).forEach(function(cb) {
            if (!(local.bookmarks[c] || []).some(function(lb) { return lb.slug === cb.slug; })) {
              if (!local.bookmarks[c]) local.bookmarks[c] = [];
              local.bookmarks[c].push(cb);
            }
          });
        });
        // Merge history
        (cloud.history || []).forEach(function(ch) {
          if (!local.history.some(function(lh) { return lh.slug === ch.slug && lh.epTitle === ch.epTitle; })) local.history.push(ch);
        });
        local.history.sort(function(a,b) { return (b.watchedAt||0) - (a.watchedAt||0); });
        local.history = local.history.slice(0, 50);
        saveLocal(local);
        saveUserData(local);
      }
    }).catch(function(){});
  }

  // Global auth state
  var authListeners = [];
  var currentUser = null;
  var currentUserDoc = null;

  function useAuth() {
    var s = useState({ user: currentUser, doc: currentUserDoc, loading: true });
    var state = s[0], setState = s[1];
    useEffect(function() {
      var fn = function(data) { setState(data); };
      authListeners.push(fn);
      if (!state.loading || currentUser !== null) fn({ user: currentUser, doc: currentUserDoc, loading: false });
      return function() { authListeners = authListeners.filter(function(f) { return f !== fn; }); };
    }, []);
    return state;
  }

  function notifyAuth(data) {
    currentUser = data.user; currentUserDoc = data.doc;
    authListeners.forEach(function(fn) { fn(data); });
  }

  // Start listening once Firebase is ready
  function startAuthListener() {
    if (!firebaseReady) { notifyAuth({ user: null, doc: null, loading: false }); return; }
    firebaseAuth.onAuthStateChanged(function(u) {
      if (u) {
        syncFromCloud();
        firebaseDb.collection('users').doc(u.uid).onSnapshot(function(doc) {
          notifyAuth({ user: u, doc: doc.exists ? doc.data() : {}, loading: false });
        });
      } else {
        notifyAuth({ user: null, doc: null, loading: false });
      }
    });
  }
  // Delayed start (wait for Firebase SDK)
  var authStartInterval = setInterval(function() {
    if (firebaseReady || typeof firebase !== 'undefined') { clearInterval(authStartInterval); startAuthListener(); }
  }, 200);
  setTimeout(function() { clearInterval(authStartInterval); if (!firebaseReady) notifyAuth({ user: null, doc: null, loading: false }); }, 5000);

  // ─── Comments (Firestore) ────────────────────────────────────
  function loadComments(slug) {
    if (!firebaseReady || !firebaseDb) return Promise.resolve([]);
    return firebaseDb.collection('comments').doc(slug).collection('messages')
      .orderBy('createdAt', 'desc').limit(50).get().then(function(snap) {
        return snap.docs.map(function(d) { var data = d.data(); data._id = d.id; return data; });
      }).catch(function() { return []; });
  }

  function postComment(slug, user, text) {
    if (!firebaseReady || !firebaseDb || !user) return Promise.reject('not signed in');
    return firebaseDb.collection('comments').doc(slug).collection('messages').add({
      uid: user.uid,
      name: user.displayName || 'Anonymous',
      avatar: user.photoURL || '',
      text: text,
      createdAt: Date.now()
    });
  }

  // Simple markdown: **bold**, *italic*, `code`, [link](url), newlines
  function renderMd(text) {
    if (!text) return '';
    var s = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, '<br/>');
    return s;
  }

  // ─── Router ───────────────────────────────────────────────────
  function getRoute() { return window.location.hash.slice(1) || '/'; }
  function navigate(path) { window.location.hash = path; }
  function useRouter() {
    var s = useState(getRoute()), route = s[0], setRoute = s[1];
    useEffect(function() {
      var fn = function() { setRoute(getRoute()); };
      window.addEventListener('hashchange', fn);
      return function() { window.removeEventListener('hashchange', fn); };
    }, []);
    return route;
  }

  // ─── Blogger Feed ─────────────────────────────────────────────
  var feedCache = {}, allPostsCache = null;
  function fetchByLabel(label) {
    if (feedCache[label]) return Promise.resolve(feedCache[label]);
    var url = CONFIG.blogUrl + '/feeds/posts/default/-/' + encodeURIComponent(label) + '?alt=json&max-results=' + CONFIG.postsPerSection;
    return fetch(url).then(function(r) { return r.json(); }).then(function(data) {
      var posts = (data.feed.entry || []).map(parseEntry); feedCache[label] = posts; return posts;
    }).catch(function() { return []; });
  }
  function fetchAllPosts() {
    if (allPostsCache) return Promise.resolve(allPostsCache);
    return Promise.all(CONFIG.sections.map(function(s) { return fetchByLabel(s.label); })).then(function(results) {
      var all = [], seen = {};
      results.forEach(function(posts) { posts.forEach(function(p) { if (!seen[p.id]) { seen[p.id] = true; all.push(p); } }); });
      allPostsCache = all; return all;
    });
  }

  // ─── Post Parser ──────────────────────────────────────────────
  function parseEntry(entry) {
    var title = entry.title.$t || '', rawContent = entry.content ? entry.content.$t : '';
    var published = entry.published.$t || '', updated = entry.updated ? entry.updated.$t : published;
    var labels = entry.category ? entry.category.map(function(c) { return c.term; }) : [];
    var id = entry.id.$t || '';
    var video = '', links = [];
    var jsonMatch = rawContent.match(/<div[^>]*style=["'][^"']*display:\s*none[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (jsonMatch) { try { var parsed = JSON.parse(jsonMatch[1].trim()); var d = parsed.data || parsed; video = d.video || ''; links = Array.isArray(d.links) ? d.links : []; } catch(e) {} }
    if (video && video.indexOf('//') === 0) video = 'https:' + video;
    var thumbnail = '';
    if (entry['media$thumbnail']) thumbnail = entry['media$thumbnail'].url.replace(/\/s\d+(-c)?\//, '/s400/');
    if (!thumbnail) { var imgMatch = rawContent.match(/<img[^>]+src=["']([^"']+)["']/i); if (imgMatch) thumbnail = imgMatch[1]; }
    if (thumbnail) thumbnail = thumbnail.replace(/\/s\d+(-c)?\//, '/s400/');
    var slug = title.replace(/[^a-zA-Z0-9\u0400-\u04FF\u1800-\u18AF]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    var premium = labels.indexOf(CONFIG.premiumLabel) !== -1;
    return { id:id, title:title, published:published, updated:updated, labels:labels, thumbnail:thumbnail, video:video, links:links, slug:slug, premium:premium };
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function getBaseName(title) {
    return title.replace(/\s*[-–]\s*\d+[-\u0440].*$/i,'').replace(/\s+\d+[-\u0440].*$/i,'').replace(/\s+\d+[-–]\s*\u0440.*$/i,'').replace(/\s*ep(?:isode)?\s*\d+.*$/i,'').replace(/\s*\d+[-–]\s*\u0440\s+\u0430\u043D\u0433\u0438.*$/i,'').trim() || title;
  }

  function groupByTitle(posts) {
    var map = {};
    posts.forEach(function(p) {
      var base = getBaseName(p.title), key = base.toLowerCase();
      if (!map[key]) { map[key] = { title:base, slug:base.replace(/[^a-zA-Z0-9\u0400-\u04FF\u1800-\u18AF]+/g,'-').replace(/^-|-$/g,'').toLowerCase(), thumbnail:p.thumbnail, labels:p.labels.slice(), published:p.published, updated:p.updated, episodes:[], premium:false }; }
      map[key].episodes.push(p);
      if (p.premium) map[key].premium = true;
      p.labels.forEach(function(l) { if (map[key].labels.indexOf(l)===-1) map[key].labels.push(l); });
      if (p.published > map[key].published || p.updated > map[key].updated) { map[key].published = p.published; map[key].updated = p.updated; if (p.thumbnail) map[key].thumbnail = p.thumbnail; }
    });
    Object.keys(map).forEach(function(key) {
      map[key].episodes.sort(function(a,b) { return (parseInt((a.title.match(/(\d+)/)||[])[1])||0) - (parseInt((b.title.match(/(\d+)/)||[])[1])||0); });
    });
    return Object.keys(map).map(function(k) { return map[k]; });
  }

  function prefixMatch(text, query) {
    if (!query) return false;
    text = text.toLowerCase(); query = query.toLowerCase().trim();
    var qWords = query.split(/\s+/), tWords = text.split(/\s+/);
    return qWords.every(function(qw) { return tWords.some(function(tw) { return tw.indexOf(qw)===0; }) || text.indexOf(qw)!==-1; });
  }

  // ─── Draggable slider ─────────────────────────────────────────
  function useDrag(ref) {
    var state = useRef({ isDown:false, startX:0, scrollLeft:0, moved:false });
    var onMouseDown = useCallback(function(e) { var el=ref.current; if(!el)return; state.current={isDown:true,moved:false,startX:e.pageX-el.offsetLeft,scrollLeft:el.scrollLeft}; el.style.cursor='grabbing'; el.style.userSelect='none'; },[]);
    var onEnd = useCallback(function() { state.current.isDown=false; if(ref.current){ref.current.style.cursor='grab';ref.current.style.userSelect='';} },[]);
    var onMouseMove = useCallback(function(e) { if(!state.current.isDown)return; e.preventDefault(); var el=ref.current; if(!el)return; var walk=(e.pageX-el.offsetLeft-state.current.startX)*1.5; if(Math.abs(walk)>5)state.current.moved=true; el.scrollLeft=state.current.scrollLeft-walk; },[]);
    var wasDragged = useCallback(function() { return state.current.moved; },[]);
    return { onMouseDown:onMouseDown, onMouseLeave:onEnd, onMouseUp:onEnd, onMouseMove:onMouseMove, wasDragged:wasDragged };
  }

  // ─── UI Components ────────────────────────────────────────────
  function LazyImg(props) {
    var s=useState(false),loaded=s[0],setLoaded=s[1]; var s2=useState(false),inView=s2[0],setInView=s2[1]; var ref=useRef();
    useEffect(function(){if(!ref.current)return;if(!('IntersectionObserver' in window)){setInView(true);return}var obs=new IntersectionObserver(function(entries){if(entries[0].isIntersecting){setInView(true);obs.disconnect();}},{rootMargin:'200px'});obs.observe(ref.current);return function(){obs.disconnect();};},[]);
    return html`<img ref=${ref} class=${props.className} src=${inView?props.src:''} alt=${props.alt} data-loaded=${String(loaded)} onLoad=${function(){setLoaded(true);}} loading="lazy" decoding="async"/>`;
  }

  function Card(props) {
    var item=props.item, badge=props.badge, onClick=props.onClick, subtitle=props.subtitle;
    var dateStr = formatDate(item.updated || item.published);
    return html`<article class="card" onClick=${function(){onClick(item);}} role="button" tabindex="0" onKeyDown=${function(e){if(e.key==='Enter')onClick(item);}} aria-label=${item.title}>
      <${LazyImg} src=${item.thumbnail} alt=${item.title} className="card-img"/>
      ${badge && html`<span class="card-badge">${badge}</span>`}
      ${item.premium && html`<span class="card-badge premium-badge">★ PREMIUM</span>`}
      <div class="card-info">
        <div class="card-title">${item.title}</div>
        ${subtitle && html`<div class="card-subtitle">${subtitle}</div>`}
        <div class="card-meta">${dateStr}</div>
      </div>
    </article>`;
  }

  function SkeletonCards(props) { return html`${Array.from({length:props.count},function(_,i){return html`<div key=${i} class="skeleton skeleton-card"></div>`;})}`; }

  function Section(props) {
    var config=props.config, onCardClick=props.onCardClick;
    var s=useState([]),items=s[0],setItems=s[1]; var s2=useState(true),loading=s2[0],setLoading=s2[1];
    var trackRef=useRef(); var drag=useDrag(trackRef);
    useEffect(function(){fetchByLabel(config.label).then(function(posts){setItems(groupByTitle(posts));setLoading(false);});},[config.label]);
    var scroll=useCallback(function(dir){var el=trackRef.current;if(!el)return;var cardW=el.querySelector('.card,.skeleton-card');var amount=(cardW?cardW.offsetWidth+12:190)*3;el.scrollBy({left:dir*amount,behavior:'smooth'});},[]);
    var handleClick=useCallback(function(item){if(drag.wasDragged())return;onCardClick(item);},[onCardClick]);
    if(!loading&&items.length===0)return null;
    var isOngoing=config.label==='Ongoing';
    return html`<section class="section" aria-label=${config.title}>
      <div class="section-header"><h2 class="section-title">${config.title}</h2>
        <div class="section-nav">
          <button class="nav-btn" onClick=${function(){scroll(-1);}} aria-label="Scroll left"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
          <button class="nav-btn" onClick=${function(){scroll(1);}} aria-label="Scroll right"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>
        </div>
      </div>
      <div class="slider-track" ref=${trackRef} style="cursor:grab" onMouseDown=${drag.onMouseDown} onMouseLeave=${drag.onMouseLeave} onMouseUp=${drag.onMouseUp} onMouseMove=${drag.onMouseMove}>
        ${loading?html`<${SkeletonCards} count=${8}/>`:items.map(function(item){
          var sub=isOngoing&&item.episodes.length>0?'Ep '+((item.episodes[item.episodes.length-1].title.match(/(\d+)/)||[])[1]||item.episodes.length):null;
          return html`<${Card} key=${item.slug} item=${item} badge=${config.badge} onClick=${handleClick} subtitle=${sub}/>`;
        })}
      </div>
    </section>`;
  }

  // ─── Comment Section ──────────────────────────────────────────
  function CommentSection(props) {
    var slug = props.slug, premiumOnly = props.premiumOnly;
    var auth = useAuth();
    var s1=useState([]),comments=s1[0],setComments=s1[1];
    var s2=useState(''),text=s2[0],setText=s2[1];
    var s3=useState(false),posting=s3[0],setPosting=s3[1];
    var s4=useState(false),showGuide=s4[0],setShowGuide=s4[1];

    useEffect(function(){ loadComments(slug).then(setComments); },[slug]);

    var canComment = auth.user && (!premiumOnly || isPremium(auth.doc));

    var handlePost = useCallback(function(){
      if(!text.trim()||!auth.user)return;
      setPosting(true);
      postComment(slug, auth.user, text.trim()).then(function(){
        setText('');
        return loadComments(slug);
      }).then(setComments).finally(function(){ setPosting(false); });
    },[text, slug, auth.user]);

    return html`<div class="comment-section">
      <h3>Comments (${comments.length})</h3>

      ${canComment ? html`
        <div class="comment-form">
          <button class="md-guide-toggle" onClick=${function(){setShowGuide(!showGuide);}}>
            ${showGuide ? 'Hide' : 'Show'} formatting guide
          </button>
          ${showGuide && html`<div class="md-guide">
            <code>**bold**</code> → <strong>bold</strong> · 
            <code>*italic*</code> → <em>italic</em> · 
            <code>\`code\`</code> → <code>code</code> · 
            <code>[text](url)</code> → link · 
            New line = line break
          </div>`}
          <textarea class="comment-input" placeholder="Write a comment..." value=${text}
            onInput=${function(e){setText(e.target.value);}} rows="3"></textarea>
          <div class="comment-form-actions">
            <button class="btn-post" onClick=${handlePost} disabled=${posting||!text.trim()}>
              ${posting ? 'Posting...' : 'Post'}
            </button>
          </div>
        </div>
      ` : html`
        <div class="comment-locked">
          ${!auth.user
            ? html`<p>Sign in to comment</p>`
            : premiumOnly
              ? html`<p>Only premium members can comment on premium episodes</p>`
              : null
          }
        </div>
      `}

      <div class="comment-list">
        ${comments.length === 0 ? html`<p class="comment-empty">No comments yet</p>` :
          comments.map(function(c) {
            return html`<div class="comment" key=${c._id}>
              <img class="comment-avatar" src=${c.avatar || ''} alt=""/>
              <div class="comment-body">
                <div class="comment-header">
                  <span class="comment-name">${c.name}</span>
                  <span class="comment-date">${formatDate(new Date(c.createdAt).toISOString())}</span>
                </div>
                <div class="comment-text" dangerouslySetInnerHTML=${{ __html: renderMd(c.text) }}></div>
              </div>
            </div>`;
          })
        }
      </div>
    </div>`;
  }

  // ─── Detail Page ──────────────────────────────────────────────
  function DetailPage(props) {
    var slug = props.slug;
    var auth = useAuth();
    var s=useState(null),item=s[0],setItem=s[1]; var s2=useState(true),loading=s2[0],setLoading=s2[1];
    var s3=useState(null),activeEp=s3[0],setActiveEp=s3[1];
    var s4=useState(null),bmCat=s4[0],setBmCat=s4[1];
    var s5=useState(false),showBmMenu=s5[0],setShowBmMenu=s5[1];

    useEffect(function(){
      setLoading(true); setActiveEp(null);
      fetchAllPosts().then(function(all){
        var grouped=groupByTitle(all);
        var found=grouped.find(function(g){return g.slug===slug;});
        setItem(found||null);
        if(found&&found.episodes.length>0) setActiveEp(found.episodes[found.episodes.length-1]);
        setBmCat(getBookmarkCategory(slug));
        setLoading(false);
      });
    },[slug]);
    useEffect(function(){window.scrollTo(0,0);},[slug]);

    var selectEp = useCallback(function(ep){
      // Premium gate: require sign-in, then check subscription
      if (ep.premium) {
        if (!auth.user) { navigate('/signin'); return; }
        if (!isPremium(auth.doc)) { navigate('/subscribe'); return; }
      }
      setActiveEp(ep);
      if(item) addHistory(slug, item.title, item.thumbnail, ep.title);
    },[item, slug, auth]);

    var handleBookmark = useCallback(function(cat){
      if(cat===bmCat) { removeBookmark(slug); setBmCat(null); }
      else if(item) { addBookmark(slug, item.title, item.thumbnail, cat); setBmCat(cat); }
      setShowBmMenu(false);
    },[bmCat, item, slug]);

    if(loading) return html`<div class="detail-page"><div class="detail-loading"><div class="skeleton" style="width:100%;height:350px;border-radius:14px"></div></div></div>`;
    if(!item) return html`<div class="detail-page"><div class="detail-not-found"><h2>Not found</h2><a href="#/" class="detail-blog-link">← Home</a></div></div>`;

    var heroImg=item.thumbnail?item.thumbnail.replace(/\/s\d+(-c)?\//,'/s800/'):'';
    var sectionLabels=CONFIG.sectionLabels;
    var hasPremiumEps = item.episodes.some(function(ep){return ep.premium;});

    return html`<div class="detail-page">
      <a href="#/" class="detail-back">← Back</a>
      <div class="detail-hero-wrap">
        ${heroImg&&html`<img class="detail-hero" src=${heroImg} alt=${item.title}/>`}
        <div class="detail-hero-overlay">
          <h1 class="detail-title">${item.title}</h1>
          <div class="detail-labels">
            ${item.labels.filter(function(l){return sectionLabels.indexOf(l)!==-1;}).map(function(l){return html`<span class="detail-label accent">${l}</span>`;})}
            ${item.labels.filter(function(l){return sectionLabels.indexOf(l)===-1&&l!==CONFIG.premiumLabel;}).map(function(l){return html`<span class="detail-label">${l}</span>`;})}
            ${item.premium&&html`<span class="detail-label premium-label">★ Premium</span>`}
            <span class="detail-label">${item.episodes.length} ep</span>
          </div>
          <div class="detail-actions">
            <div class="bookmark-dropdown">
              <button class=${'bookmark-btn'+(bmCat?' active':'')} onClick=${function(){setShowBmMenu(!showBmMenu);}}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill=${bmCat?'currentColor':'none'} stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
                ${bmCat||'Bookmark'}
              </button>
              ${showBmMenu&&html`<div class="bookmark-menu">
                ${CONFIG.bookmarkCategories.map(function(c){
                  return html`<button class=${'bm-option'+(c===bmCat?' active':'')} key=${c} onClick=${function(){handleBookmark(c);}}>${c}</button>`;
                })}
                ${bmCat&&html`<button class="bm-option remove" onClick=${function(){handleBookmark(bmCat);}}>Remove</button>`}
              </div>`}
            </div>
          </div>
        </div>
      </div>

      ${activeEp&&activeEp.video&&html`
        <div class="detail-player" id="player">
          <h3>Now Playing: ${activeEp.title}</h3>
          <div class="video"><iframe src=${activeEp.video} key=${activeEp.id} allowfullscreen="" allow="autoplay; encrypted-media" referrerpolicy="no-referrer" title=${activeEp.title}></iframe></div>
          ${activeEp.links.length>0&&html`<div class="player-downloads">${activeEp.links.map(function(lnk){return html`<a class="dl-btn" href=${lnk.url} target="_blank" rel="noopener noreferrer"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>${lnk.name}</a>`;})}</div>`}
        </div>
      `}

      <div class="detail-body">
        <div class="detail-episodes"><h3>Episodes</h3>
          <div class="ep-grid">
            ${item.episodes.map(function(ep,i){
              var num=(ep.title.match(/(\d+)/)||[])[1]||(i+1);
              var isActive=activeEp&&activeEp.id===ep.id;
              var locked=ep.premium&&(!auth.user||!isPremium(auth.doc));
              return html`<div class=${'ep-card'+(isActive?' active':'')+(locked?' locked':'')} key=${ep.id} onClick=${function(){selectEp(ep);}}>
                <div class="ep-num">${num}</div>
                <div class="ep-title">${ep.title}${ep.premium?html` <span class="ep-premium">★</span>`:null}</div>
                <div class="ep-meta">${formatDate(ep.published)}</div>
                ${locked?html`<div class="ep-lock">🔒</div>`:html`<div class="ep-actions">${ep.links.map(function(lnk){return html`<a class="ep-btn dl" href=${lnk.url} target="_blank" rel="noopener noreferrer" onClick=${function(e){e.stopPropagation();}} title=${lnk.name}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>${lnk.name}</a>`;})}</div>`}
              </div>`;
            })}
          </div>
        </div>
        <${CommentSection} slug=${slug} premiumOnly=${hasPremiumEps}/>
      </div>
    </div>`;
  }

  // ─── Subscribe Page ───────────────────────────────────────────
  function SubscribePage() {
    var auth = useAuth();
    var subData = getSubData(auth.doc);
    return html`<div class="static-page">
      <h1>Subscription Plans</h1>
      <p class="static-subtitle">Unlock premium episodes, exclusive perks, and earn your rank</p>

      ${auth.user && subData.active && html`
        <div class="sub-current">
          <span class="rank-badge" style=${'background:'+subData.rank.color}>${subData.rank.icon} ${subData.rank.name}</span>
          Active until ${formatDate(new Date(subData.expiresAt).toISOString())}
        </div>
      `}

      <div class="plans-grid">
        ${CONFIG.plans.map(function(plan){
          var rank = CONFIG.ranks[0];
          for(var i=CONFIG.ranks.length-1;i>=0;i--){if(plan.months>=CONFIG.ranks[i].minMonths){rank=CONFIG.ranks[i];break;}}
          return html`<div class="plan-card" key=${plan.id}>
            <div class="plan-rank"><span class="rank-dot" style=${'background:'+rank.color}></span>${rank.icon} ${rank.name}</div>
            <div class="plan-label">${plan.label}</div>
            <div class="plan-price">${plan.price}</div>
            <ul class="plan-perks">
              <li>Access all Premium episodes</li>
              <li>Comment on premium content</li>
              <li>${rank.name} rank badge</li>
              ${plan.months>=6?html`<li>Priority support</li>`:null}
              ${plan.months>=12?html`<li>Early access to new releases</li>`:null}
            </ul>
            ${auth.user
              ? html`<button class="btn-plan" onClick=${function(){alert('Contact admin to activate your '+plan.label+' plan. Send payment proof to activate.');}}>Select Plan</button>`
              : html`<button class="btn-plan" onClick=${function(){navigate('/signin');}}>Sign in first</button>`
            }
          </div>`;
        })}
      </div>

      <div class="sub-note">
        <h3>How it works</h3>
        <p>1. Select a plan and contact the admin with your payment proof</p>
        <p>2. Admin activates your subscription manually</p>
        <p>3. Your rank upgrades based on total subscription months</p>
      </div>
    </div>`;
  }

  // ─── Sign In Page ─────────────────────────────────────────────
  function SignInPage() {
    var auth = useAuth();
    if (auth.user) { navigate('/profile'); return null; }
    return html`<div class="static-page" style="text-align:center;padding-top:60px">
      <h1>Sign In</h1>
      <p class="static-subtitle">Sign in to bookmark, comment, and access premium content</p>
      <button class="btn-google" style="margin-top:20px" onClick=${function(){signInWithGoogle().then(function(){navigate('/profile');});}}>
        <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/></svg>
        Sign in with Google
      </button>
    </div>`;
  }

  // ─── Profile Page ─────────────────────────────────────────────
  function ProfilePage() {
    var auth = useAuth();
    var s=useState(getUserData()),data=s[0],setData=s[1];
    var s2=useState('Watching'),tab=s2[0],setTab=s2[1];
    var s3=useState('bookmarks'),section=s3[0],setSection=s3[1];

    var refresh = useCallback(function(){setData(getUserData());},[]);
    var subData = getSubData(auth.doc);

    if (!auth.user) return html`<${SignInPage}/>`;

    return html`<div class="static-page">
      <div class="profile-card">
        <img class="profile-avatar-lg" src=${auth.user.photoURL||''} alt=""/>
        <div class="profile-info">
          <h2>${auth.user.displayName||'User'}</h2>
          <span class="rank-badge" style=${'background:'+subData.rank.color}>${subData.rank.icon} ${subData.rank.name}</span>
          ${subData.active
            ? html`<p class="profile-sub">Premium · expires ${formatDate(new Date(subData.expiresAt).toISOString())}</p>`
            : html`<p class="profile-sub"><a href="#/subscribe">Get Premium →</a></p>`
          }
          <p class="profile-sub">${subData.totalMonths} month${subData.totalMonths!==1?'s':''} total</p>
        </div>
        <button class="btn-small" onClick=${function(){signOut();}}>Sign out</button>
      </div>

      <div class="profile-tabs">
        <button class=${'profile-tab'+(section==='bookmarks'?' active':'')} onClick=${function(){setSection('bookmarks');}}>Bookmarks</button>
        <button class=${'profile-tab'+(section==='history'?' active':'')} onClick=${function(){setSection('history');}}>History (${data.history.length})</button>
      </div>

      ${section==='bookmarks'&&html`
        <div class="profile-tabs sub-tabs">
          ${CONFIG.bookmarkCategories.map(function(c){
            var count=(data.bookmarks[c]||[]).length;
            return html`<button class=${'profile-tab sm'+(tab===c?' active':'')} key=${c} onClick=${function(){setTab(c);}}>${c} (${count})</button>`;
          })}
        </div>
        <div class="timetable-grid">
          ${(data.bookmarks[tab]||[]).length===0
            ? html`<p style="color:#888;padding:20px 0">No titles in ${tab}</p>`
            : (data.bookmarks[tab]||[]).map(function(b){
                return html`<div class="timetable-row" key=${b.slug}>
                  <a href=${'#/title/'+encodeURIComponent(b.slug)} style="display:contents;color:inherit">
                    <img class="timetable-thumb" src=${b.thumbnail} alt=${b.title}/>
                    <div class="timetable-info"><div class="timetable-title">${b.title}</div></div>
                  </a>
                  <button class="btn-remove" onClick=${function(){removeBookmark(b.slug);refresh();}} title="Remove">✕</button>
                </div>`;
              })
          }
        </div>
      `}

      ${section==='history'&&html`
        <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
          ${data.history.length>0&&html`<button class="btn-small" onClick=${function(){var d=getUserData();d.history=[];saveUserData(d);refresh();}}>Clear</button>`}
        </div>
        <div class="timetable-grid">
          ${data.history.length===0?html`<p style="color:#888;padding:20px 0">No history yet</p>`:
            data.history.map(function(h){
              return html`<a class="timetable-row" href=${'#/title/'+encodeURIComponent(h.slug)} key=${h.slug+h.watchedAt}>
                <img class="timetable-thumb" src=${h.thumbnail} alt=${h.title}/>
                <div class="timetable-info"><div class="timetable-title">${h.title}</div><div class="timetable-meta">${h.epTitle||''} · ${formatDate(new Date(h.watchedAt).toISOString())}</div></div>
              </a>`;
            })
          }
        </div>
      `}
    </div>`;
  }

  // ─── Search, Static, Admin Pages (unchanged) ──────────────────
  function SearchPage(props) {
    var initialQuery=props.query||''; var s=useState(initialQuery),query=s[0],setQuery=s[1];
    var s2=useState([]),results=s2[0],setResults=s2[1]; var s3=useState(false),loading=s3[0],setLoading=s3[1];
    var allGrouped=useRef([]);
    useEffect(function(){setLoading(true);fetchAllPosts().then(function(all){allGrouped.current=groupByTitle(all);if(initialQuery)filterResults(initialQuery);setLoading(false);});},[]);
    var filterResults=useCallback(function(q){if(!q.trim()){setResults([]);return;}setResults(allGrouped.current.filter(function(g){return prefixMatch(g.title,q)||g.labels.some(function(l){return prefixMatch(l,q);});}));},[]);
    var handleInput=useCallback(function(e){var q=e.target.value;setQuery(q);filterResults(q);},[]);
    var handleClick=useCallback(function(item){navigate('/title/'+encodeURIComponent(item.slug));},[]);
    return html`<div class="search-page">
      <div class="search-bar-large"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="search" placeholder="Search anime titles, labels..." value=${query} onInput=${handleInput} aria-label="Search anime" autofocus/></div>
      <div class="search-results">${loading?html`<div class="slider-track" style="flex-wrap:wrap;padding:0 4%"><${SkeletonCards} count=${6}/></div>`:results.length?html`<div class="slider-track" style="flex-wrap:wrap;padding:0 4%">${results.map(function(item){return html`<${Card} key=${item.slug} item=${item} onClick=${handleClick}/>`})}</div>`:query.trim()?html`<p style="padding:20px 4%;color:#888">No results for "${query}"</p>`:html`<p style="padding:20px 4%;color:#666">Start typing to search...</p>`}</div>
    </div>`;
  }

  function AboutPage(){return html`<div class="static-page"><h1>About</h1><div class="static-content"><p>AnimeFlix is a lightweight anime streaming and download index powered by Google Blogger.</p><p>Premium members get access to exclusive episodes, rank badges, and commenting privileges.</p></div></div>`;}

  function TimetablePage(){
    var s=useState([]),all=s[0],setAll=s[1];var s2=useState(true),loading=s2[0],setLoading=s2[1];
    useEffect(function(){fetchByLabel('Ongoing').then(function(posts){var grouped=groupByTitle(posts);grouped.sort(function(a,b){return b.updated>a.updated?1:-1;});setAll(grouped);setLoading(false);});},[]);
    return html`<div class="static-page"><h1>Timetable</h1><p class="static-subtitle">Currently airing, sorted by latest update</p>
      ${loading?html`<div class="slider-track" style="flex-wrap:wrap;padding:0"><${SkeletonCards} count=${6}/></div>`:html`<div class="timetable-grid">${all.map(function(item){var latest=item.episodes[item.episodes.length-1];return html`<a class="timetable-row" href=${'#/title/'+encodeURIComponent(item.slug)} key=${item.slug}><img class="timetable-thumb" src=${item.thumbnail} alt=${item.title}/><div class="timetable-info"><div class="timetable-title">${item.title}</div><div class="timetable-meta">${item.episodes.length} ep · ${formatDate(latest?latest.updated||latest.published:'')}</div></div></a>`;})}</div>`}</div>`;
  }

  function ReleasesPage(){
    var s=useState([]),posts=s[0],setPosts=s[1];var s2=useState(true),loading=s2[0],setLoading=s2[1];
    useEffect(function(){fetchAllPosts().then(function(all){var sorted=all.slice().sort(function(a,b){return b.published>a.published?1:-1;});setPosts(sorted.slice(0,50));setLoading(false);});},[]);
    return html`<div class="static-page"><h1>Latest Releases</h1><p class="static-subtitle">Most recent uploads</p>
      ${loading?html`<div class="slider-track" style="flex-wrap:wrap;padding:0"><${SkeletonCards} count=${6}/></div>`:html`<div class="timetable-grid">${posts.map(function(p){var titleSlug=getBaseName(p.title).replace(/[^a-zA-Z0-9\u0400-\u04FF\u1800-\u18AF]+/g,'-').replace(/^-|-$/g,'').toLowerCase();return html`<a class="timetable-row" href=${'#/title/'+encodeURIComponent(titleSlug)} key=${p.id}><img class="timetable-thumb" src=${p.thumbnail} alt=${p.title}/><div class="timetable-info"><div class="timetable-title">${p.title}</div><div class="timetable-meta">${formatDate(p.published)} · ${p.labels.filter(function(l){return CONFIG.sectionLabels.indexOf(l)!==-1;}).join(', ')}</div></div>${p.video&&html`<span class="release-play">▶</span>`}</a>`;})}</div>`}</div>`;
  }

  function AdminPage(){
    var s1=useState(''),title=s1[0],setTitle=s1[1];var s2=useState(''),videoUrl=s2[0],setVideoUrl=s2[1];
    var s3=useState(''),thumbUrl=s3[0],setThumbUrl=s3[1];var s4=useState([{name:'',url:''}]),links=s4[0],setLinks=s4[1];
    var s5=useState([]),labels=s5[0],setLabels=s5[1];var s6=useState(''),customLabel=s6[0],setCustomLabel=s6[1];
    var s7=useState(''),output=s7[0],setOutput=s7[1];var s8=useState(false),copied=s8[0],setCopied=s8[1];
    var addLink=useCallback(function(){setLinks(links.concat([{name:'',url:''}]));},[links]);
    var removeLink=useCallback(function(i){setLinks(links.filter(function(_,idx){return idx!==i;}));},[links]);
    var updateLink=useCallback(function(i,field,val){setLinks(links.map(function(l,idx){if(idx!==i)return l;var c={name:l.name,url:l.url};c[field]=val;return c;}));},[links]);
    var toggleLabel=useCallback(function(label){if(labels.indexOf(label)!==-1)setLabels(labels.filter(function(l){return l!==label;}));else setLabels(labels.concat([label]));},[labels]);
    var addCustomLabel=useCallback(function(){var l=customLabel.trim();if(l&&labels.indexOf(l)===-1){setLabels(labels.concat([l]));setCustomLabel('');}},[customLabel,labels]);
    var generate=useCallback(function(){
      if(!title.trim()){setOutput('');return;}
      var validLinks=links.filter(function(l){return l.name.trim()&&l.url.trim();});
      var linksStr=validLinks.map(function(l){return'          {\n               "name": "'+l.name.trim()+'",\n              "url": "'+l.url.trim()+'"\n          }';}).join(',\n');
      var jsonBlock='{\n     "data":\n     {\n         "video": "'+videoUrl.trim()+'",\n         "links": [\n'+linksStr+'\n         ]\n     }\n }';
      var contentHtml='<div style="display: none">'+jsonBlock+' </div>';
      if(thumbUrl.trim())contentHtml+='<a href="'+thumbUrl.trim()+'" imageanchor="1" ><img border="0" src="'+thumbUrl.trim()+'" data-original-width="400" data-original-height="566" /></a>';
      setOutput(contentHtml);setCopied(false);
    },[title,videoUrl,thumbUrl,links,labels]);
    var copyOutput=useCallback(function(){if(!output)return;navigator.clipboard.writeText(output).then(function(){setCopied(true);setTimeout(function(){setCopied(false);},2000);});},[output]);
    var resetForm=useCallback(function(){setTitle('');setVideoUrl('');setThumbUrl('');setLinks([{name:'',url:''}]);setLabels([]);setOutput('');setCopied(false);},[]);
    return html`<div class="static-page"><h1>Add Episode</h1><p class="static-subtitle">Generate post HTML for Blogger</p><div class="admin-form">
      <div class="form-group"><label class="form-label">Title *</label><input class="form-input" type="text" placeholder="e.g. DanMachi S2 - 10-р анги" value=${title} onInput=${function(e){setTitle(e.target.value);}}/></div>
      <div class="form-group"><label class="form-label">Video Embed URL</label><input class="form-input" type="text" placeholder="e.g. //ok.ru/videoembed/123456" value=${videoUrl} onInput=${function(e){setVideoUrl(e.target.value);}}/></div>
      <div class="form-group"><label class="form-label">Thumbnail Image URL</label><input class="form-input" type="text" placeholder="https://..." value=${thumbUrl} onInput=${function(e){setThumbUrl(e.target.value);}}/>${thumbUrl&&html`<img class="admin-thumb-preview" src=${thumbUrl} alt="Preview"/>`}</div>
      <div class="form-group"><label class="form-label">Download Links</label>${links.map(function(lnk,i){return html`<div class="admin-link-row" key=${i}><input class="form-input form-input-sm" type="text" placeholder="Name" value=${lnk.name} onInput=${function(e){updateLink(i,'name',e.target.value);}}/><input class="form-input" type="text" placeholder="URL" value=${lnk.url} onInput=${function(e){updateLink(i,'url',e.target.value);}}/>${links.length>1&&html`<button class="btn-remove" onClick=${function(){removeLink(i);}}>✕</button>`}</div>`;})}<button class="btn-small" onClick=${addLink} style="margin-top:6px">+ Add link</button></div>
      <div class="form-group"><label class="form-label">Labels</label><div class="admin-labels">${CONFIG.sectionLabels.concat([CONFIG.premiumLabel]).map(function(l){var active=labels.indexOf(l)!==-1;return html`<button class=${'label-chip'+(active?' active':'')} onClick=${function(){toggleLabel(l);}}>${l}</button>`;})}</div><div class="admin-custom-label"><input class="form-input form-input-sm" type="text" placeholder="Custom label..." value=${customLabel} onInput=${function(e){setCustomLabel(e.target.value);}} onKeyDown=${function(e){if(e.key==='Enter')addCustomLabel();}}/><button class="btn-small" onClick=${addCustomLabel}>Add</button></div>${labels.length>0&&html`<div class="admin-labels" style="margin-top:8px">${labels.map(function(l){return html`<span class="label-chip active" key=${l}>${l} <span class="label-x" onClick=${function(){toggleLabel(l);}}>✕</span></span>`;})}</div>`}</div>
      <div class="admin-actions"><button class="btn-generate" onClick=${generate}>Generate</button><button class="btn-small" onClick=${resetForm}>Reset</button></div>
      ${output&&html`<div class="form-group"><label class="form-label">Title: ${title} · Labels: ${labels.join(', ')||'(none)'}</label><div class="admin-output-wrap"><pre class="admin-output">${output}</pre><button class=${'btn-copy'+(copied?' copied':'')} onClick=${copyOutput}>${copied?'Copied!':'Copy HTML'}</button></div></div>`}
    </div></div>`;
  }

  // ─── Navbar with user dropdown ────────────────────────────────
  function Navbar(props) {
    var route = props.route;
    var auth = useAuth();
    var s=useState(false),menuOpen=s[0],setMenuOpen=s[1];
    var s2=useState(false),userMenu=s2[0],setUserMenu=s2[1];
    var subData = getSubData(auth.doc);

    var links = [
      { href:'#/', label:'Home' },
      { href:'#/about', label:'About' },
      { href:'#/timetable', label:'Timetable' },
      { href:'#/releases', label:'Releases' },
    ];

    // Close user menu on outside click
    useEffect(function(){
      if(!userMenu) return;
      var fn=function(e){if(!e.target.closest('.user-dropdown'))setUserMenu(false);};
      document.addEventListener('click',fn);
      return function(){document.removeEventListener('click',fn);};
    },[userMenu]);

    return html`<header class="header">
      <a href="#/" class="logo">Anime<span>Flix</span></a>
      <nav class="nav-links ${menuOpen?'open':''}">
        ${links.map(function(lnk){
          var active=route===lnk.href.slice(1)||(lnk.href==='#/'&&route==='/');
          return html`<a href=${lnk.href} class=${'nav-link'+(active?' active':'')} onClick=${function(){setMenuOpen(false);}}>${lnk.label}</a>`;
        })}
        <a href="#/search" class=${'nav-link nav-search-link'+(route.indexOf('/search')===0?' active':'')} onClick=${function(){setMenuOpen(false);}}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </a>
      </nav>

      <div class="user-dropdown">
        ${auth.user ? html`
          <button class="user-btn" onClick=${function(e){e.stopPropagation();setUserMenu(!userMenu);}}>
            <img class="user-avatar" src=${auth.user.photoURL||''} alt=""/>
            <span class="user-name">${auth.user.displayName||'User'}</span>
            ${subData.rank.name!=='Free'&&html`<span class="rank-icon-sm">${subData.rank.icon}</span>`}
          </button>
          ${userMenu&&html`<div class="user-menu">
            <a href="#/profile" class="user-menu-item" onClick=${function(){setUserMenu(false);}}>View Profile</a>
            <a href="#/subscribe" class="user-menu-item" onClick=${function(){setUserMenu(false);}}>Subscription</a>
            <button class="user-menu-item" onClick=${function(){signOut();setUserMenu(false);}}>Sign out</button>
          </div>`}
        ` : html`
          <a href="#/signin" class="nav-link signin-link">Sign in</a>
        `}
      </div>

      <button class="menu-toggle" onClick=${function(){setMenuOpen(!menuOpen);}} aria-label="Toggle menu">
        <span></span><span></span><span></span>
      </button>
    </header>`;
  }

  // ─── App ──────────────────────────────────────────────────────
  function App() {
    var route = useRouter();
    var handleCardClick = useCallback(function(item){ navigate('/title/'+encodeURIComponent(item.slug)); },[]);
    var page;
    if(route==='/'||route==='') page=html`<main>${CONFIG.sections.map(function(sec){return html`<${Section} key=${sec.label} config=${sec} onCardClick=${handleCardClick}/>`})}</main>`;
    else if(route==='/about') page=html`<${AboutPage}/>`;
    else if(route==='/timetable') page=html`<${TimetablePage}/>`;
    else if(route==='/releases') page=html`<${ReleasesPage}/>`;
    else if(route==='/profile') page=html`<${ProfilePage}/>`;
    else if(route==='/subscribe') page=html`<${SubscribePage}/>`;
    else if(route==='/signin') page=html`<${SignInPage}/>`;
    else if(route==='/admin') page=html`<${AdminPage}/>`;
    else if(route.indexOf('/search')===0){var sq=decodeURIComponent(route.replace('/search/','').replace('/search',''));page=html`<${SearchPage} query=${sq}/>`;}
    else if(route.indexOf('/title/')===0){var titleSlug=decodeURIComponent(route.replace('/title/',''));page=html`<${DetailPage} slug=${titleSlug}/>`;}
    else page=html`<div class="static-page"><h1>404</h1><p>Page not found.</p><a href="#/">← Home</a></div>`;
    return html`<div class="app"><${Navbar} route=${route}/>${page}<footer class="footer">Powered by Blogger · Built with Preact</footer></div>`;
  }

  render(html`<${App}/>`, document.getElementById('root'));

  var ld={'@context':'https://schema.org','@type':'WebSite',name:'AnimeFlix',url:window.location.origin,potentialAction:{'@type':'SearchAction',target:window.location.origin+'#/search/{search_term_string}','query-input':'required name=search_term_string'}};
  var sc=document.createElement('script');sc.type='application/ld+json';sc.textContent=JSON.stringify(ld);document.head.appendChild(sc);
})();
