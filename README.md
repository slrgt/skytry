# Skytry

A minimalist PWA for reading and collecting posts on the [AT Protocol](https://atproto.com): Bluesky feeds and [standard.site](https://standard.site)–style long-form blogs (e.g. [pckt.blog](https://pckt.blog)).

- **Feed** — Sign in with Bluesky (OAuth, no app passwords) and browse your timeline.
- **Blogs** — Add standard.site publications by URL (e.g. `pckt.blog`), then open and read their document list.
- **Saved** — Save posts from Feed to revisit later (stored locally).
- **Settings** — Sign in/out.

Designed to look like a simple iOS app: dark theme, safe areas, bottom tab bar, standalone PWA.

## Host on GitHub Pages

Anyone can fork or clone this repo and deploy without putting usernames or URLs in the code. The GitHub Actions workflow generates OAuth client metadata from the repo URL automatically.

1. Push this repo to GitHub (or fork it).

2. **Settings → Pages** → under “Build and deployment”, **Source** → **GitHub Actions**.

3. Push to `main` (or run the workflow from the Actions tab). The workflow builds the site and generates `oauth/client-metadata.json` from your repo’s URL (`https://<owner>.github.io/<repo>/`), then deploys. No manual config.

4. Open your Pages URL and use **Sign in with Bluesky**. You’ll be sent to Bluesky’s OAuth page to authorize; no app password needed.

If you previously used “Deploy from a branch”, switch to **GitHub Actions** so the workflow can generate the metadata. If sign-in still fails, the app will show a short message; ensure Pages is set to GitHub Actions and the workflow has run once.

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
