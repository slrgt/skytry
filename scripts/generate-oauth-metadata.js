#!/usr/bin/env node
/**
 * Generate oauth/client-metadata.json with your GitHub Pages base URL.
 * Run before pushing so Bluesky can verify your app when users sign in.
 *
 *   GITHUB_PAGES_BASE=https://yourusername.github.io/skytry node scripts/generate-oauth-metadata.js
 *
 * Or: node scripts/generate-oauth-metadata.js https://yourusername.github.io/skytry
 */
const fs = require('fs');
const path = require('path');

const base = process.env.GITHUB_PAGES_BASE || process.argv[2];
if (!base || !base.startsWith('https://')) {
  console.error('Usage: GITHUB_PAGES_BASE=https://yourusername.github.io/skytry node scripts/generate-oauth-metadata.js');
  console.error('   Or: node scripts/generate-oauth-metadata.js https://yourusername.github.io/skytry');
  process.exit(1);
}

const normalizedBase = base.replace(/\/$/, '');
const metadata = {
  client_id: normalizedBase + '/oauth/client-metadata.json',
  client_name: 'Skytry',
  client_uri: normalizedBase + '/',
  application_type: 'web',
  redirect_uris: [normalizedBase + '/'],
  scope: 'atproto transition:generic',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
  dpop_bound_access_tokens: true,
};

const outPath = path.join(__dirname, '..', 'oauth', 'client-metadata.json');
fs.writeFileSync(outPath, JSON.stringify(metadata, null, 2) + '\n', 'utf8');
console.log('Wrote', outPath, 'with base', normalizedBase);
