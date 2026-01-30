(function () {
  'use strict';

  const PDS_DEFAULT = 'https://bsky.social';
  const PUBLIC_APPVIEW = 'https://public.api.bsky.app';
  const PLC_DIRECTORY = 'https://plc.directory';
  const STORAGE_KEYS = { session: 'skytry_session', saved: 'skytry_saved', blogs: 'skytry_blogs', pds: 'skytry_pds' };

  let feedCursor = null;
  let currentBlogDid = null;
  let currentBlogPub = null;

  function getPds() {
    return localStorage.getItem(STORAGE_KEYS.pds) || PDS_DEFAULT;
  }

  function setPds(url) {
    if (url) localStorage.setItem(STORAGE_KEYS.pds, url.replace(/\/$/, ''));
    else localStorage.removeItem(STORAGE_KEYS.pds);
  }

  function getSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.session);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function setSession(data) {
    localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(data));
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEYS.session);
  }

  function getSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.saved);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  function setSaved(arr) {
    localStorage.setItem(STORAGE_KEYS.saved, JSON.stringify(arr));
  }

  function toggleSaved(uri, post) {
    const saved = getSaved();
    const i = saved.findIndex((s) => s.uri === uri);
    if (i >= 0) {
      saved.splice(i, 1);
    } else {
      saved.push({ uri, post, savedAt: Date.now() });
    }
    setSaved(saved);
    return i < 0;
  }

  function isSaved(uri) {
    return getSaved().some((s) => s.uri === uri);
  }

  function getBlogs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.blogs);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  function setBlogs(arr) {
    localStorage.setItem(STORAGE_KEYS.blogs, JSON.stringify(arr));
  }

  function addBlog(blog) {
    const blogs = getBlogs();
    if (blogs.some((b) => b.origin === blog.origin)) return;
    blogs.push(blog);
    setBlogs(blogs);
  }

  async function api(baseOrHost, path, opts = {}) {
    const base = opts.base != null ? opts.base : (opts.auth ? getPds() : baseOrHost);
    const url = path ? `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : '/' + path}` : base;
    const headers = { Accept: 'application/json', ...opts.headers };
    if (opts.auth) {
      const s = getSession();
      if (s && s.accessJwt) headers.Authorization = `Bearer ${s.accessJwt}`;
    }
    if (opts.body) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, { method: opts.method || 'GET', headers, body: opts.body });
    if (!res.ok) {
      const err = new Error(res.statusText);
      err.status = res.status;
      err.body = await res.text();
      try {
        err.json = JSON.parse(err.body);
      } catch (_) {}
      throw err;
    }
    return opts.raw ? res.text() : res.json();
  }

  async function createSession(identifier, password) {
    const body = JSON.stringify({ identifier, password });
    const data = await api(getPds(), '/xrpc/com.atproto.server.createSession', {
      method: 'POST',
      body,
      base: getPds(),
    });
    setSession({
      accessJwt: data.accessJwt,
      refreshJwt: data.refreshJwt,
      handle: data.handle,
      did: data.did,
    });
    return data;
  }

  async function refreshSession() {
    const s = getSession();
    if (!s || !s.refreshJwt) return null;
    const data = await api(getPds(), '/xrpc/com.atproto.server.refreshSession', {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.refreshJwt}` },
      base: getPds(),
    });
    setSession({
      ...s,
      accessJwt: data.accessJwt,
      refreshJwt: data.refreshJwt,
    });
    return data;
  }

  async function getTimeline(cursor) {
    const q = new URLSearchParams();
    if (cursor) q.set('cursor', cursor);
    q.set('limit', '30');
    return api(getPds(), `/xrpc/app.bsky.feed.getTimeline?${q}`, { auth: true });
  }

  async function resolveDidToPds(did) {
    if (did.startsWith('did:web:')) {
      const host = did.replace('did:web:', '').replace(/:/g, '/');
      const docUrl = `https://${host}/.well-known/did.json`;
      const res = await fetch(docUrl);
      if (!res.ok) return null;
      const doc = await res.json();
      const svc = (doc.service || []).find((s) => s.type === 'AtprotoPersonalDataServer' || s.id === '#atproto_pds');
      return svc ? (typeof svc.serviceEndpoint === 'string' ? svc.serviceEndpoint : svc.serviceEndpoint?.uri) : null;
    }
    const res = await fetch(`${PLC_DIRECTORY}/${encodeURIComponent(did)}`);
    if (!res.ok) return null;
    const doc = await res.json();
    const svc = (doc.service || []).find((s) => s.type === 'AtprotoPersonalDataServer' || (s.id && s.id.endsWith('atproto_pds')));
    return svc ? (typeof svc.serviceEndpoint === 'string' ? svc.serviceEndpoint : svc.serviceEndpoint?.uri) : null;
  }

  function parseAtUri(atUri) {
    const m = /^at:\/\/([^/]+)\/([^/]+)\/(.+)$/.exec(atUri);
    return m ? { did: m[1], collection: m[2], rkey: m[3] } : null;
  }

  async function fetchPublicationWellKnown(origin) {
    const url = `${origin}/.well-known/site.standard.publication`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return null;
    const atUri = (await res.text()).trim();
    if (!atUri.startsWith('at://')) return null;
    return atUri;
  }

  async function fetchPublicationRecord(pds, atUri) {
    const { did, collection, rkey } = parseAtUri(atUri) || {};
    if (!did || !collection || !rkey) return null;
    const q = new URLSearchParams({ repo: did, collection, rkey });
    const out = await api(pds, `/xrpc/com.atproto.repo.getRecord?${q}`, { base: pds });
    return out.value;
  }

  async function listStandardSiteDocuments(origin) {
    const atUri = await fetchPublicationWellKnown(origin);
    if (!atUri) throw new Error('Not a standard.site publication (no .well-known/site.standard.publication)');
    const { did } = parseAtUri(atUri) || {};
    if (!did) throw new Error('Invalid AT-URI');
    const pds = await resolveDidToPds(did);
    if (!pds) throw new Error('Could not find PDS for this publication');
    const pub = await fetchPublicationRecord(pds, atUri);
    const q = new URLSearchParams({ repo: did, collection: 'site.standard.document', limit: '50' });
    const data = await api(pds, `/xrpc/com.atproto.repo.listRecords?${q}`, { base: pds });
    const baseUrl = (pub && pub.url) ? pub.url.replace(/\/$/, '') : origin;
    return {
      publication: pub,
      atUri,
      origin,
      baseUrl,
      name: (pub && pub.name) || new URL(origin).hostname,
      documents: (data.records || []).map((r) => ({ ...r.value, uri: r.uri, path: r.value?.path })),
    };
  }

  function escapeHtml(s) {
    if (!s) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function linkify(text) {
    if (!text) return '';
    return escapeHtml(text).replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener">$1</a>'
    ).replace(
      /(?:^|\s)@([a-zA-Z0-9.-]+\.(?:[a-zA-Z]{2,}|bsky\.social))/g,
      (_, h) => ` <a href="https://bsky.app/profile/${h}" target="_blank" rel="noopener">@${h}</a>`
    );
  }

  function formatTime(iso) {
    try {
      const d = new Date(iso);
      const now = new Date();
      const diff = (now - d) / 60000;
      if (diff < 1) return 'now';
      if (diff < 60) return `${Math.floor(diff)}m`;
      if (diff < 1440) return `${Math.floor(diff / 60)}h`;
      if (diff < 43200) return `${Math.floor(diff / 1440)}d`;
      return d.toLocaleDateString();
    } catch (_) {
      return '';
    }
  }

  function renderPost(post, opts = {}) {
    const author = post.post?.author;
    const handle = author?.handle || author?.did || 'unknown';
    const name = author?.displayName || handle;
    const uri = post.post?.uri || '';
    const text = post.post?.record?.text || '';
    const createdAt = post.post?.record?.createdAt || '';
    const saved = isSaved(uri);
    const card = document.createElement('article');
    card.className = 'post-card';
    card.dataset.uri = uri;
    card.innerHTML = `
      <div class="post-author"><a href="https://bsky.app/profile/${escapeHtml(handle)}" target="_blank" rel="noopener">${escapeHtml(name)}</a></div>
      <div class="post-time">${escapeHtml(formatTime(createdAt))}</div>
      <div class="post-text">${linkify(text)}</div>
      ${opts.showSave ? `
        <div class="card-actions">
          <button type="button" class="btn secondary save-btn" data-uri="${escapeHtml(uri)}" data-saved="${saved}">${saved ? 'Unsave' : 'Save'}</button>
        </div>
      ` : ''}
    `;
    if (opts.showSave) {
      card.querySelector('.save-btn').addEventListener('click', () => {
        const nowSaved = toggleSaved(uri, post);
        card.querySelector('.save-btn').textContent = nowSaved ? 'Unsave' : 'Save';
        card.querySelector('.save-btn').dataset.saved = nowSaved;
        renderSavedTab();
      });
    }
    return card;
  }

  function renderDoc(doc, baseUrl, opts = {}) {
    const path = doc.path || '';
    const url = path ? `${baseUrl}/${path.replace(/^\//, '')}` : baseUrl;
    const title = doc.title || path || 'Untitled';
    const snippet = (doc.description || '').slice(0, 160);
    const card = document.createElement('article');
    card.className = 'doc-card';
    card.innerHTML = `
      <h3 class="doc-title">${escapeHtml(title)}</h3>
      ${snippet ? `<p class="doc-meta">${escapeHtml(snippet)}</p>` : ''}
      <a href="${escapeHtml(url)}" class="doc-link" target="_blank" rel="noopener">Read →</a>
    `;
    return card;
  }

  function show(el) {
    el.classList.remove('hidden');
  }
  function hide(el) {
    el.classList.add('hidden');
  }

  const dom = {
    feedLoginPrompt: document.getElementById('feed-login-prompt'),
    feedList: document.getElementById('feed-list'),
    feedLoading: document.getElementById('feed-loading'),
    feedError: document.getElementById('feed-error'),
    feedMore: document.getElementById('feed-more'),
    blogsList: document.getElementById('blogs-list'),
    blogUrl: document.getElementById('blog-url'),
    btnAddBlog: document.getElementById('btn-add-blog'),
    blogDocs: document.getElementById('blog-docs'),
    blogDocsBack: document.getElementById('blog-docs-back'),
    blogDocsTitle: document.getElementById('blog-docs-title'),
    blogDocsList: document.getElementById('blog-docs-list'),
    savedList: document.getElementById('saved-list'),
    savedEmpty: document.getElementById('saved-empty'),
    settingsLoggedOut: document.getElementById('settings-logged-out'),
    settingsLoggedIn: document.getElementById('settings-logged-in'),
    settingsHandle: document.getElementById('settings-handle'),
    loginDialog: document.getElementById('login-dialog'),
    loginForm: document.getElementById('login-form'),
    loginError: document.getElementById('login-error'),
    loginIdentifier: document.getElementById('login-identifier'),
    loginPassword: document.getElementById('login-password'),
    pdsUrl: document.getElementById('pds-url'),
  };

  function renderFeed(append) {
    const list = dom.feedList;
    if (!append) list.innerHTML = '';
    getTimeline(feedCursor)
      .then((data) => {
        feedCursor = data.cursor || null;
        const posts = data.feed || [];
        posts.forEach((post) => list.appendChild(renderPost(post, { showSave: true })));
        hide(dom.feedLoading);
        hide(dom.feedError);
        dom.feedMore.classList.toggle('hidden', !feedCursor);
      })
      .catch((err) => {
        hide(dom.feedLoading);
        dom.feedError.textContent = err.json?.message || err.body || err.message || 'Failed to load feed';
        show(dom.feedError);
        dom.feedMore.classList.add('hidden');
      });
  }

  function loadFeed() {
    if (!getSession()) {
      show(dom.feedLoginPrompt);
      hide(dom.feedList);
      hide(dom.feedMore);
      return;
    }
    hide(dom.feedLoginPrompt);
    show(dom.feedList);
    feedCursor = null;
    show(dom.feedLoading);
    renderFeed(false);
  }

  function renderBlogsList() {
    const list = dom.blogsList;
    list.innerHTML = '';
    getBlogs().forEach((blog) => {
      const row = document.createElement('div');
      row.className = 'blog-site';
      row.innerHTML = `
        <div class="blog-site-info">
          <h3>${escapeHtml(blog.name || blog.origin)}</h3>
          <p>${escapeHtml(blog.origin)}</p>
        </div>
        <div class="blog-site-actions">
          <button type="button" class="btn primary open-blog-btn" data-origin="${escapeHtml(blog.origin)}">Open</button>
          <button type="button" class="btn secondary remove-blog-btn" data-origin="${escapeHtml(blog.origin)}">Remove</button>
        </div>
      `;
      row.querySelector('.open-blog-btn').addEventListener('click', () => openBlogDocs(blog));
      row.querySelector('.remove-blog-btn').addEventListener('click', () => {
        setBlogs(getBlogs().filter((b) => b.origin !== blog.origin));
        renderBlogsList();
      });
      list.appendChild(row);
    });
  }

  async function openBlogDocs(blog) {
    currentBlogPub = blog;
    currentBlogDid = blog.atUri ? parseAtUri(blog.atUri)?.did : null;
    dom.blogDocsTitle.textContent = blog.name || blog.origin;
    dom.blogDocsList.innerHTML = '';
    dom.blogsList.classList.add('hidden');
    show(dom.blogDocs);
    dom.blogDocsList.innerHTML = '<div class="loading">Loading posts…</div>';
    try {
      const result = await listStandardSiteDocuments(blog.origin);
      currentBlogPub = { ...blog, ...result };
      dom.blogDocsTitle.textContent = result.name || blog.origin;
      dom.blogDocsList.innerHTML = '';
      (result.documents || []).forEach((doc) => {
        dom.blogDocsList.appendChild(renderDoc(doc, result.baseUrl || blog.origin));
      });
    } catch (e) {
      dom.blogDocsList.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
    }
  }

  async function addBlogFromUrl() {
    const input = dom.blogUrl.value.trim();
    if (!input) return;
    let origin;
    try {
      origin = new URL(input.startsWith('http') ? input : `https://${input}`).origin;
    } catch (_) {
      dom.blogUrl.value = '';
      return;
    }
    dom.blogUrl.value = '';
    dom.btnAddBlog.disabled = true;
    try {
      const result = await listStandardSiteDocuments(origin);
      addBlog({
        origin,
        name: result.name,
        atUri: result.atUri,
        baseUrl: result.baseUrl,
      });
      renderBlogsList();
    } catch (e) {
      alert(e.message || 'Could not add site. Make sure it supports standard.site (e.g. pckt.blog).');
    }
    dom.btnAddBlog.disabled = false;
  }

  function renderSavedTab() {
    const saved = getSaved();
    dom.savedList.innerHTML = '';
    if (saved.length === 0) {
      show(dom.savedEmpty);
      return;
    }
    hide(dom.savedEmpty);
    saved.forEach(({ uri, post }) => {
      if (post) {
        dom.savedList.appendChild(renderPost(post, { showSave: true }));
      } else {
        const card = document.createElement('article');
        card.className = 'post-card';
        card.innerHTML = `<div class="post-text"><a href="https://bsky.app/profile/${uri.split('/')[2]}/post/${uri.split('/').pop()}" target="_blank" rel="noopener">${escapeHtml(uri)}</a></div><div class="card-actions"><button type="button" class="btn secondary save-btn" data-uri="${escapeHtml(uri)}">Unsave</button></div>`;
        card.querySelector('.save-btn').addEventListener('click', () => {
          toggleSaved(uri, {});
          renderSavedTab();
        });
        dom.savedList.appendChild(card);
      }
    });
  }

  function renderSettings() {
    const s = getSession();
    if (s) {
      hide(dom.settingsLoggedOut);
      show(dom.settingsLoggedIn);
      dom.settingsHandle.textContent = s.handle || s.did || '—';
    } else {
      show(dom.settingsLoggedOut);
      hide(dom.settingsLoggedIn);
    }
    dom.pdsUrl.value = getPds() || '';
  }

  function switchTab(tabId) {
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    document.querySelectorAll('.tab-bar-item').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === tabId);
      t.setAttribute('aria-selected', t.dataset.tab === tabId);
    });
    const panel = document.getElementById(`tab-${tabId}`);
    if (panel) panel.classList.add('active');
    if (tabId === 'feed') loadFeed();
    if (tabId === 'saved') renderSavedTab();
    if (tabId === 'settings') renderSettings();
  }

  function openLogin() {
    dom.loginError.textContent = '';
    hide(dom.loginError);
    dom.loginDialog.showModal();
  }

  function closeLogin() {
    dom.loginDialog.close();
  }

  dom.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = dom.loginIdentifier.value.trim();
    const pw = dom.loginPassword.value;
    dom.loginError.textContent = '';
    hide(dom.loginError);
    try {
      await createSession(id, pw);
      closeLogin();
      loadFeed();
      renderSettings();
    } catch (err) {
      dom.loginError.textContent = err.json?.message || err.body || err.message || 'Sign-in failed';
      show(dom.loginError);
    }
  });

  dom.btnCancelLogin.addEventListener('click', closeLogin);
  dom.btnLogin.addEventListener('click', openLogin);
  dom.btnSettingsLogin.addEventListener('click', openLogin);

  document.getElementById('btn-logout').addEventListener('click', () => {
    clearSession();
    loadFeed();
    renderSettings();
  });

  dom.pdsUrl.addEventListener('change', () => {
    const v = dom.pdsUrl.value.trim();
    setPds(v || null);
  });

  document.querySelectorAll('.tab-bar-item').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('btn-refresh').addEventListener('click', () => {
    if (document.getElementById('tab-feed').classList.contains('active')) {
      feedCursor = null;
      show(dom.feedLoading);
      renderFeed(false);
    }
  });

  dom.feedMore.addEventListener('click', () => {
    show(dom.feedLoading);
    renderFeed(true);
  });

  dom.btnAddBlog.addEventListener('click', addBlogFromUrl);
  dom.blogUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addBlogFromUrl();
  });
  document.querySelectorAll('[data-add-blog]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.addBlog || '';
      if (!url) return;
      dom.blogUrl.value = url;
      addBlogFromUrl();
    });
  });
  dom.blogDocsBack.addEventListener('click', () => {
    dom.blogDocs.classList.add('hidden');
    dom.blogsList.classList.remove('hidden');
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  const session = getSession();
  if (session) {
    refreshSession().catch(clearSession);
  }
  loadFeed();
  renderBlogsList();
  renderSavedTab();
  renderSettings();

  window.skytry = { getSession, getSaved, getBlogs, addBlog, switchTab };
})();
