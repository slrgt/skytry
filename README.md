# Skytry

A minimalist PWA for reading and collecting posts on the [AT Protocol](https://atproto.com): Bluesky feeds and [standard.site](https://standard.site)–style long-form blogs (e.g. [pckt.blog](https://pckt.blog)).

- **Feed** — Sign in with your Bluesky account (handle + App Password) and browse your timeline.
- **Blogs** — Add standard.site publications by URL (e.g. `pckt.blog`), then open and read their document list.
- **Saved** — Save posts from Feed or Blogs to revisit later (stored locally).
- **Settings** — Sign in/out, optional PDS URL.

Designed to look and feel like a simple iOS app: dark theme, safe areas, bottom tab bar, standalone PWA.

## Host on GitHub Pages

1. Push this repo to GitHub.
2. **Settings → Pages** → Source: **Deploy from a branch**.
3. Branch: `main` (or your default), folder: **/ (root)**.
4. Save. The site will be at `https://<username>.github.io/<repo>/`.

If the repo name is `skytry`, open: `https://<username>.github.io/skytry/`.

## Signing in (Bluesky)

1. In Skytry, open **Settings** or the **Feed** tab and tap **Sign in**.
2. Use your **handle** (e.g. `you.bsky.social`) and an **App Password**.
3. Create an App Password in Bluesky: **Settings → App passwords → Add app password**. Do not use your main account password.

If sign-in fails from the browser (e.g. CORS), you may need to use a CORS proxy or self-host with a small backend that forwards `createSession` and `refreshSession` to your PDS.

## Tech

- Static PWA: HTML, CSS, vanilla JS.
- AT Protocol: `createSession` / `refreshSession` (PDS), `getTimeline` (via PDS), `listRecords` for `site.standard.document`.
- standard.site: `/.well-known/site.standard.publication` → AT-URI → DID → PDS (via plc.directory) → `com.atproto.repo.listRecords` for documents.

## License

MIT.
