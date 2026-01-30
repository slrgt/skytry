# Deploy SkyTry to GitHub Pages

## 1. Create a GitHub repository

1. Go to [github.com/new](https://github.com/new).
2. Set **Repository name** (e.g. `skytry`).
3. Choose **Public**, leave "Add a README" **unchecked**.
4. Click **Create repository**.

## 2. Push this project

In your project folder, run (replace `YOUR_USERNAME` and `YOUR_REPO` with your GitHub username and repo name):

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

## 3. Turn on GitHub Pages (Actions)

1. In the repo on GitHub, go to **Settings** → **Pages**.
2. Under **Source**, choose **GitHub Actions** (not "Deploy from a branch").
3. Save if needed.

The workflow **Deploy to GitHub Pages** (`.github/workflows/deploy-pages.yml`) runs on every push to `main`. It:

- Runs `scripts/generate-oauth-metadata.js` to create `oauth-client-metadata.json` with your repo’s URL (`https://OWNER.github.io/REPO`).
- Uploads the site as a GitHub Pages artifact and deploys it.

After the workflow finishes, the site is at:

**https://YOUR_USERNAME.github.io/YOUR_REPO/**

**Bluesky OAuth:** The build generates `oauth-client-metadata.json` from your repo URL, so `client_id` and `redirect_uris` match your Pages URL. No manual edit needed. The app uses the current origin for OAuth when served over HTTPS.
