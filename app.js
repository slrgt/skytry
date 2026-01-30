(function () {
  'use strict';

  const PLC_DIRECTORY = 'https://plc.directory';
  const STORAGE_KEYS = { saved: 'skytry_saved', blogs: 'skytry_blogs' };
  const PDS = 'https://bsky.social';

  let blueskyClient = null;
  let feedCursor = null;
  let currentBlogDid = null;
  let currentBlogPub = null;

  function getAppBase() {
    const origin = window.location.origin;
    const path = window.location.pathname.replace(/\/index\.html$/i, '').replace(/\/?$/, '') || '';
    return origin + path;
  }

  function _oauthBaseUrl() {
    return getAppBase();
  }
  function _oauthClientId() {
    return _oauthBaseUrl() + '/oauth/client-metadata.json';
  }
  function _oauthRedirectUri() {
    const base = _oauthBaseUrl();
    return base.endsWith('/') ? base : base + '/';
  }

  async function _sha256Bytes(data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return new Uint8Array(hash);
  }
  function _base64urlEncode(bytes) {
    const bin = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
    let binary = '';
    for (let i = 0; i < bin.length; i++) binary += String.fromCharCode(bin[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function _pkceChallenge(verifier) {
    const hash = await _sha256Bytes(verifier);
    return _base64urlEncode(hash);
  }
  async function _generateDpopKeypair() {
    return await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
  }
  async function _exportKeyJwk(key) {
    const jwk = await crypto.subtle.exportKey('jwk', key);
    delete jwk.key_ops;
    delete jwk.ext;
    return jwk;
  }
  async function _importPrivateKeyJwk(jwk) {
    return await crypto.subtle.importKey(
      'jwk',
      { ...jwk, key_ops: ['sign'] },
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign']
    );
  }
  async function _signJwtEs256(header, payload, privateKey) {
    const enc = (obj) => _base64urlEncode(JSON.stringify(obj));
    const headerB64 = enc(header);
    const payloadB64 = enc(payload);
    const message = new TextEncoder().encode(headerB64 + '.' + payloadB64);
    const sig = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      message
    );
    return headerB64 + '.' + payloadB64 + '.' + _base64urlEncode(new Uint8Array(sig));
  }
  async function _buildDpopProof(htm, htu, nonce, privateKey, publicKeyJwk, accessTokenHash) {
    if (!publicKeyJwk || !publicKeyJwk.crv) throw new Error('DPoP requires public key JWK');
    const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: publicKeyJwk };
    const payload = {
      jti: crypto.randomUUID(),
      htm,
      htu,
      iat: Math.floor(Date.now() / 1000),
      ...(nonce ? { nonce } : {}),
      ...(accessTokenHash ? { ath: accessTokenHash } : {}),
    };
    return await _signJwtEs256(header, payload, privateKey);
  }

  async function startBlueskyOAuth() {
    const clientId = _oauthClientId();
    const redirectUri = _oauthRedirectUri();
    const pdsUrl = PDS;
    const resResource = await fetch(pdsUrl.replace(/\/$/, '') + '/.well-known/oauth-protected-resource');
    if (!resResource.ok) throw new Error('Could not get PDS metadata');
    const resourceMeta = await resResource.json();
    const authServerUrl = resourceMeta.authorization_servers?.[0] || pdsUrl;
    const resAuth = await fetch(authServerUrl.replace(/\/$/, '') + '/.well-known/oauth-authorization-server');
    if (!resAuth.ok) throw new Error('Could not get OAuth server metadata');
    const authMeta = await resAuth.json();
    const parEndpoint = authMeta.pushed_authorization_request_endpoint;
    const authEndpoint = authMeta.authorization_endpoint;
    const tokenEndpoint = authMeta.token_endpoint;
    const issuer = authMeta.issuer;

    const stateArr = new Uint8Array(28);
    crypto.getRandomValues(stateArr);
    const state = Array.from(stateArr, (b) => ('0' + b.toString(16)).slice(-2)).join('');
    const verifierArr = new Uint8Array(32);
    crypto.getRandomValues(verifierArr);
    const codeVerifier = _base64urlEncode(verifierArr);
    const codeChallenge = await _pkceChallenge(codeVerifier);

    const keypair = await _generateDpopKeypair();
    const privateJwk = await _exportKeyJwk(keypair.privateKey);
    const publicJwk = await _exportKeyJwk(keypair.publicKey);

    const scope = 'atproto transition:generic';
    let parBody = new URLSearchParams({
      response_type: 'code',
      code_challenge_method: 'S256',
      scope,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      state,
    });
    let parRes = await fetch(parEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: parBody.toString(),
    });
    let dpopNonce = parRes.headers.get('dpop-nonce') || parRes.headers.get('DPoP-Nonce');
    if (parRes.status === 401 && dpopNonce) {
      const privateKey = await _importPrivateKeyJwk(privateJwk);
      const dpopProof = await _buildDpopProof('POST', parEndpoint, dpopNonce, privateKey, publicJwk);
      parRes = await fetch(parEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', DPoP: dpopProof },
        body: parBody.toString(),
      });
    }
    if (!parRes.ok) {
      const err = await parRes.json().catch(() => ({}));
      throw new Error(err.error_description || err.error || 'PAR failed');
    }
    const parData = await parRes.json();
    const requestUri = parData.request_uri;
    if (!requestUri) throw new Error('No request_uri from PAR');

    sessionStorage.setItem('skytry-oauth-state', state);
    sessionStorage.setItem('skytry-oauth-code-verifier', codeVerifier);
    sessionStorage.setItem('skytry-oauth-token-endpoint', tokenEndpoint);
    sessionStorage.setItem('skytry-oauth-issuer', issuer);
    sessionStorage.setItem('skytry-oauth-dpop-nonce', parRes.headers.get('dpop-nonce') || parRes.headers.get('DPoP-Nonce') || '');
    sessionStorage.setItem('skytry-oauth-dpop-private-jwk', JSON.stringify(privateJwk));
    sessionStorage.setItem('skytry-oauth-dpop-public-jwk', JSON.stringify(publicJwk));

    const redirectUrl = authEndpoint + '?client_id=' + encodeURIComponent(clientId) + '&request_uri=' + encodeURIComponent(requestUri);
    window.location.href = redirectUrl;
  }

  async function handleOAuthCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const storedState = sessionStorage.getItem('skytry-oauth-state');
    const codeVerifier = sessionStorage.getItem('skytry-oauth-code-verifier');
    const tokenEndpoint = sessionStorage.getItem('skytry-oauth-token-endpoint');
    const dpopNonce = sessionStorage.getItem('skytry-oauth-dpop-nonce');
    const privateJwk = sessionStorage.getItem('skytry-oauth-dpop-private-jwk');

    if (code || state) {
      window.history.replaceState({}, document.title, window.location.pathname + (window.location.pathname.endsWith('/') ? '' : '/') || '/');
    }
    if (!code || !state || state !== storedState || !codeVerifier || !tokenEndpoint || !privateJwk) return false;

    const clientId = _oauthClientId();
    const redirectUri = _oauthRedirectUri();
    const privateKey = await _importPrivateKeyJwk(JSON.parse(privateJwk));
    const publicJwk = JSON.parse(sessionStorage.getItem('skytry-oauth-dpop-public-jwk') || '{}');
    const dpopProof = await _buildDpopProof('POST', tokenEndpoint, dpopNonce || undefined, privateKey, publicJwk);

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    });
    const tokenRes = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', DPoP: dpopProof },
      body: tokenBody.toString(),
    });
    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}));
      throw new Error(err.error_description || err.error || 'Token exchange failed');
    }
    const data = await tokenRes.json();
    const accessToken = data.access_token;
    const refreshToken = data.refresh_token;
    const sub = data.sub;
    if (!accessToken || !refreshToken || !sub) throw new Error('Invalid token response');

    localStorage.setItem('skytry-oauth-dpop-private-jwk', privateJwk);
    localStorage.setItem('skytry-oauth-dpop-public-jwk', sessionStorage.getItem('skytry-oauth-dpop-public-jwk'));
    blueskyClient = {
      did: sub,
      handle: null,
      accessJwt: accessToken,
      refreshJwt: refreshToken,
      tokenTimestamp: Date.now(),
    };
    localStorage.setItem('bluesky-session', JSON.stringify({
      handle: blueskyClient.handle,
      did: blueskyClient.did,
      refreshJwt: blueskyClient.refreshJwt,
      oauth: true,
    }));
    sessionStorage.removeItem('skytry-oauth-state');
    sessionStorage.removeItem('skytry-oauth-code-verifier');
    sessionStorage.removeItem('skytry-oauth-token-endpoint');
    sessionStorage.removeItem('skytry-oauth-issuer');
    sessionStorage.removeItem('skytry-oauth-dpop-nonce');
    sessionStorage.removeItem('skytry-oauth-dpop-private-jwk');
    sessionStorage.removeItem('skytry-oauth-dpop-public-jwk');
    return true;
  }

  async function _oauthRefresh() {
    const session = JSON.parse(localStorage.getItem('bluesky-session') || '{}');
    const tokenEndpoint = PDS + '/oauth/token';
    const clientId = _oauthClientId();
    const privateJwk = localStorage.getItem('skytry-oauth-dpop-private-jwk');
    const publicJwk = localStorage.getItem('skytry-oauth-dpop-public-jwk');
    if (!session.refreshJwt || !privateJwk || !publicJwk) throw new Error('OAuth session incomplete');
    const privateKey = await _importPrivateKeyJwk(JSON.parse(privateJwk));
    const publicKeyJwk = JSON.parse(publicJwk);
    let nonce = localStorage.getItem('skytry-dpop-nonce') || '';
    let dpopProof = await _buildDpopProof('POST', tokenEndpoint, nonce || undefined, privateKey, publicKeyJwk);
    let res = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', DPoP: dpopProof },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshJwt, client_id: clientId }).toString(),
    });
    if (res.status === 401) {
      nonce = res.headers.get('dpop-nonce') || res.headers.get('DPoP-Nonce') || '';
      if (nonce) {
        localStorage.setItem('skytry-dpop-nonce', nonce);
        dpopProof = await _buildDpopProof('POST', tokenEndpoint, nonce, privateKey, publicKeyJwk);
        res = await fetch(tokenEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', DPoP: dpopProof },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshJwt, client_id: clientId }).toString(),
        });
      }
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error_description || err.error || 'Token refresh failed');
    }
    const data = await res.json();
    const newNonce = res.headers.get('dpop-nonce') || res.headers.get('DPoP-Nonce');
    if (newNonce) localStorage.setItem('skytry-dpop-nonce', newNonce);
    blueskyClient = {
      did: session.did,
      handle: session.handle,
      accessJwt: data.access_token,
      refreshJwt: data.refresh_token,
      tokenTimestamp: Date.now(),
    };
    session.refreshJwt = data.refresh_token;
    localStorage.setItem('bluesky-session', JSON.stringify(session));
  }

  async function ensureValidToken() {
    if (!blueskyClient?.refreshJwt) return;
    const age = Date.now() - (blueskyClient.tokenTimestamp || 0);
    if (age < 4 * 60 * 1000) return;
    await _oauthRefresh();
  }

  async function _pdsFetch(url, options = {}) {
    if (!blueskyClient?.accessJwt) throw new Error('Not connected');
    await ensureValidToken();
    const privateJwk = localStorage.getItem('skytry-oauth-dpop-private-jwk');
    const publicJwk = localStorage.getItem('skytry-oauth-dpop-public-jwk');
    if (!privateJwk || !publicJwk) throw new Error('OAuth DPoP key missing');
    const privateKey = await _importPrivateKeyJwk(JSON.parse(privateJwk));
    const publicKeyJwk = JSON.parse(publicJwk);
    const accessToken = blueskyClient.accessJwt;
    const accessTokenHash = _base64urlEncode(await _sha256Bytes(accessToken));
    let nonce = localStorage.getItem('skytry-dpop-nonce') || '';
    const method = (options.method || 'GET').toUpperCase();
    const htu = url.split('#')[0];
    let dpopProof = await _buildDpopProof(method, htu, nonce || undefined, privateKey, publicKeyJwk, accessTokenHash);
    let headers = { ...options.headers, Authorization: 'DPoP ' + accessToken, DPoP: dpopProof };
    let res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      const newNonce = res.headers.get('dpop-nonce') || res.headers.get('DPoP-Nonce');
      if (newNonce) {
        localStorage.setItem('skytry-dpop-nonce', newNonce);
        dpopProof = await _buildDpopProof(method, htu, newNonce, privateKey, publicKeyJwk, accessTokenHash);
        headers = { ...options.headers, Authorization: 'DPoP ' + accessToken, DPoP: dpopProof };
        res = await fetch(url, { ...options, headers });
      }
    }
    return res;
  }

  async function loadBlueskyConnection() {
    try {
      const saved = localStorage.getItem('bluesky-session');
      if (!saved) return;
      const session = JSON.parse(saved);
      if (!session.refreshJwt || !session.oauth) return;
      if (!localStorage.getItem('skytry-oauth-dpop-private-jwk')) return;
      await _oauthRefresh();
    } catch (_) {
      blueskyClient = null;
    }
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
  const base = opts.base != null ? opts.base : baseOrHost;
  const url = path ? `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : '/' + path}` : base;
  const headers = { Accept: 'application/json', ...opts.headers };
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

function renderDoc(doc, baseUrl) {
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
};

function renderFeed(append) {
  const list = dom.feedList;
  if (!append) list.innerHTML = '';
  const q = new URLSearchParams({ limit: '30' });
  if (feedCursor) q.set('cursor', feedCursor);
  _pdsFetch(PDS + '/xrpc/app.bsky.feed.getTimeline?' + q.toString())
    .then((res) => res.json())
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
      dom.feedError.textContent = err.message || err.body || 'Failed to load feed';
      show(dom.feedError);
      dom.feedMore.classList.add('hidden');
    });
}

function loadFeed() {
  if (!blueskyClient) {
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
  if (blueskyClient) {
    hide(dom.settingsLoggedOut);
    show(dom.settingsLoggedIn);
    const handle = blueskyClient.handle;
    if (handle) {
      dom.settingsHandle.textContent = '@' + handle;
    } else {
      dom.settingsHandle.textContent = blueskyClient.did || '—';
      _pdsFetch(PDS + '/xrpc/app.bsky.actor.getProfile?actor=' + encodeURIComponent(blueskyClient.did))
        .then((res) => res.json())
        .then((data) => {
          if (data.handle) {
            blueskyClient.handle = data.handle;
            const s = JSON.parse(localStorage.getItem('bluesky-session') || '{}');
            s.handle = data.handle;
            localStorage.setItem('bluesky-session', JSON.stringify(s));
            dom.settingsHandle.textContent = '@' + data.handle;
          }
        })
        .catch(() => {});
    }
  } else {
    show(dom.settingsLoggedOut);
    hide(dom.settingsLoggedIn);
  }
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

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
}

async function doLogin() {
  const btn = document.getElementById('btn-login');
  showLoginError('');
  if (btn) btn.disabled = true;
  try {
    await startBlueskyOAuth();
  } catch (err) {
    if (btn) btn.disabled = false;
    const msg = err?.message || String(err);
    showLoginError(msg.includes('PAR') || msg.includes('redirect') ? 'Sign-in failed. Use the app from its published URL (see README).' : 'Sign-in failed: ' + msg);
  }
}


function doLogout() {
  blueskyClient = null;
  localStorage.removeItem('bluesky-session');
  localStorage.removeItem('skytry-oauth-dpop-private-jwk');
  localStorage.removeItem('skytry-oauth-dpop-public-jwk');
  localStorage.removeItem('skytry-dpop-nonce');
  loadFeed();
  renderSettings();
}

function setupEventListeners() {
  const btnLogin = document.getElementById('btn-login');
  const btnSettingsLogin = document.getElementById('btn-settings-login');
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogin) btnLogin.addEventListener('click', doLogin);
  if (btnSettingsLogin) btnSettingsLogin.addEventListener('click', doLogin);
  if (btnLogout) btnLogout.addEventListener('click', doLogout);

  document.querySelectorAll('.tab-bar-item').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  const btnRefresh = document.getElementById('btn-refresh');
  if (btnRefresh) btnRefresh.addEventListener('click', () => {
    if (document.getElementById('tab-feed').classList.contains('active')) {
      feedCursor = null;
      show(dom.feedLoading);
      renderFeed(false);
    }
  });

  if (dom.feedMore) dom.feedMore.addEventListener('click', () => {
    show(dom.feedLoading);
    renderFeed(true);
  });

  if (dom.btnAddBlog) dom.btnAddBlog.addEventListener('click', addBlogFromUrl);
  if (dom.blogUrl) dom.blogUrl.addEventListener('keydown', (e) => {
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
  if (dom.blogDocsBack) dom.blogDocsBack.addEventListener('click', () => {
    dom.blogDocs.classList.add('hidden');
    dom.blogsList.classList.remove('hidden');
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

async function init() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const state = urlParams.get('state');
  if (code && state) {
    try {
      const ok = await handleOAuthCallback();
      if (ok) {
        window.history.replaceState({}, document.title, window.location.pathname + (window.location.pathname.endsWith('/') ? '' : '/') || '/');
      }
    } catch (err) {
      console.error('OAuth callback failed', err);
      showLoginError('Sign-in callback failed. Try again.');
    }
  }

  await loadBlueskyConnection();

  if (!blueskyClient) {
    try {
      const res = await fetch(getAppBase() + '/oauth/client-metadata.json');
      if (res.ok) {
        const text = await res.text();
        if (text.includes('YOUR_GITHUB_PAGES_BASE')) {
          showLoginError(
            'Sign-in requires deploying with this repo\'s GitHub Actions workflow so Bluesky can load your app metadata. In repo Settings -> Pages, set Source to "GitHub Actions". See README.'
          );
        }
      }
    } catch (_) {}
  }

  loadFeed();
  renderBlogsList();
  renderSavedTab();
  renderSettings();
}

// Run setup and init when DOM is ready (same pattern as wikisky/xoxowiki)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    init();
  });
} else {
  setupEventListeners();
  init();
}
})();
