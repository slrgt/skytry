# Skytry

A minimalist PWA for reading and collecting posts on the [AT Protocol](https://atproto.com): Bluesky feeds and [standard.site](https://standard.site)–style long-form blogs (e.g. [pckt.blog](https://pckt.blog)).

- **Feed** — Sign in with Bluesky (OAuth, no app passwords) and browse your timeline.
- **Blogs** — Add standard.site publications by URL (e.g. `pckt.blog`), then open and read their document list.
- **Saved** — Save posts from Feed to revisit later (stored locally).
- **Settings** — Sign in/out.

Designed to look like a simple iOS app: dark theme, safe areas, bottom tab bar, standalone PWA.

## Host on GitHub Pages

1. **Generate OAuth client metadata** (required for sign-in to work)  
   Bluesky’s OAuth server loads your app’s metadata from a URL. That file must contain your real site URL. From the repo root, run:

   ```bash
   GITHUB_PAGES_BASE=https://YOUR_USERNAME.github.io/skytry node scripts/generate-oauth-metadata.js
   ```

   Replace `YOUR_USERNAME` and `skytry` with your GitHub username and repo name. This overwrites `oauth/client-metadata.json` with the correct `client_id` and `redirect_uris`.

2. Push this repo to GitHub (including the updated `oauth/client-metadata.json`).

3. **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main`, folder: **/ (root)** → Save.

4. Open `https://<username>.github.io/skytry/` and use **Sign in with Bluesky**. You’ll be sent to Bluesky’s OAuth page to authorize; no app password needed.

   If sign-in does nothing or fails, the app will show a message: run the script above with your real site URL, commit the new `oauth/client-metadata.json`, and push again.

## Local development

On `http://127.0.0.1:<port>` or `http://localhost:<port>`, the app uses the OAuth “loopback” client (no client-metadata file). Refresh tokens are short-lived. For full OAuth behavior, use a tunnel (e.g. ngrok) and set `oauth/client-metadata.json` to that URL.

## Signing in (Bluesky)

Sign-in uses [OAuth for AT Protocol](https://docs.bsky.app/blog/oauth-atproto): you click **Sign in with Bluesky**, get redirected to Bluesky (or your PDS), sign in there, and are sent back to Skytry. No app password or handle/password form in the app.

## Tech

- Static PWA: HTML, CSS, vanilla JS (ES modules).
- OAuth: [@atproto/oauth-client-browser](https://www.npmjs.com/package/@atproto/oauth-client-browser) (PKCE, DPoP), [@atproto/api](https://www.npmjs.com/package/@atproto/api) `Agent` for feed.
- standard.site: `/.well-known/site.standard.publication` → AT-URI → DID → PDS (plc.directory) → `com.atproto.repo.listRecords` for documents.

## License

MIT.
