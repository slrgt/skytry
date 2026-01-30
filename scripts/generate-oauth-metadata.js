#!/usr/bin/env node
/**
 * Generate oauth-client-metadata.json for GitHub Pages deploy.
 * Run in CI with: GITHUB_PAGES_BASE=https://owner.github.io/repo node scripts/generate-oauth-metadata.js
 */
const fs = require('fs');
const path = require('path');

const base = (process.env.GITHUB_PAGES_BASE || 'https://example.github.io/skytry').replace(/\/$/, '');
const clientId = base + '/oauth-client-metadata.json';
const redirectUri = base + '/';

const metadata = {
  client_id: clientId,
  client_name: 'SkyTry',
  client_uri: base + '/',
  application_type: 'web',
  grant_types: ['authorization_code', 'refresh_token'],
  scope: 'atproto repo:site.standard.document repo:com.atproto.repo.record transition:generic',
  response_types: ['code'],
  redirect_uris: [redirectUri],
  token_endpoint_auth_method: 'none',
  dpop_bound_access_tokens: true
};

const outPath = path.join(__dirname, '..', 'oauth-client-metadata.json');
fs.writeFileSync(outPath, JSON.stringify(metadata, null, 2), 'utf8');
console.log('Wrote', outPath, 'with client_id', clientId);
