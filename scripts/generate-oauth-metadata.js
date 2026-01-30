#!/usr/bin/env node
/**
 * Generate oauth/client-metadata.json with the app's base URL.
 * Used by the GitHub Actions workflow (which sets GITHUB_PAGES_BASE from the repo).
 * For local or custom deploy: set env GITHUB_PAGES_BASE to your site URL, or pass it as the first argument.
 */
const fs = require('fs');
const path = require('path');

const base = process.env.GITHUB_PAGES_BASE || process.argv[2];
if (!base || !base.startsWith('https://')) {
  console.error('Set GITHUB_PAGES_BASE to your site base URL (e.g. https://owner.github.io/repo) or pass it as the first argument.');
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
console.log('Wrote', outPath);
