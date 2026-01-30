# SkyTry

A PWA to **browse the AT Protocol** (Bluesky) and turn posts into **wiki articles**. Works offline with optional Bluesky sync.

## Features

- **Browse AT Protocol** - View posts from the Bluesky feed (your timeline when logged in, or “What’s Hot” when not)
- **Make wiki article** - One click to create a wiki article from any post (title + content + source link)
- **100% Local First** - Works offline; articles and collections stored locally
- **Optional Bluesky Sync** - Sync your wiki across devices via Bluesky PDS
- **Add to collection** - Save images from posts into your collections
- **Wikipedia-like editing** - Create and edit articles with rich formatting

## How It Works

### Local Mode (Default)

By default, SkyTry stores all articles in your browser's local storage. This means:
- ✅ Works completely offline
- ✅ No internet connection needed
- ✅ Fast and private
- ✅ Data stays in your browser

### Bluesky PDS Mode (Optional)

You can optionally connect to Bluesky PDS to sync your wiki:
- ✅ Sync across devices
- ✅ Backup in the cloud
- ✅ Still works offline (syncs when online)
- ✅ Uses Bluesky's decentralized infrastructure

## Getting Started

1. **Open `index.html`** in your web browser (or deploy to a static host)
2. **Go to Browse** to see posts from the AT Protocol
3. **Click “Make wiki article”** on any post to create an article from it
4. **Optionally connect Bluesky** in the sidebar for cloud sync

## Creating Articles

1. **Highlight any text** on a page
2. Click the **"Create Article"** button that appears
3. Fill in the title and content
4. Click **"Save Article"**

## Editing Articles

- Click the **"Edit"** button next to any article title
- Or use the **"Edit"** button in the header navigation

## Linking Between Articles

Use double square brackets to create links:
- `[[Article Name]]` - Creates a link to an article
- `[[Article Name|Display Text]]` - Creates a link with custom display text

## Formatting

- **Bold**: `**text**` or `'''text'''`
- *Italic*: `*text*` or `''text''`
- `Code`: Use backticks
- Headers: `# H1`, `## H2`, `### H3`
- External links: `[Text](https://example.com)`

## Connecting to Bluesky PDS

1. Go to **Bluesky Settings** → **App Passwords**
2. Create a new app password
3. Click **"Connect Bluesky"** in the sidebar
4. Enter your Bluesky handle (e.g., `username.bsky.social`)
5. Enter the app password
6. Click **"Connect"**

Your articles will now sync to Bluesky PDS and be available across devices!

## File Structure

```
skytry/
├── index.html      # Main HTML file
├── app.js          # Wiki application logic
├── storage.js      # Storage abstraction (localStorage + Bluesky PDS)
├── style.css       # Styling
└── README.md       # This file
```

## Technical Details

### Local Storage (IndexedDB)

- Stores articles in browser's IndexedDB
- No size limits (unlike localStorage)
- Persists across browser sessions
- Works completely offline

### Bluesky PDS Integration

- Uses Bluesky's AT Protocol
- Stores articles as repository records
- Syncs automatically when online
- Falls back to local storage if sync fails

## Privacy

- **Local Mode**: All data stays in your browser, never leaves your device
- **Bluesky Mode**: Data is stored on Bluesky's PDS (your personal data server)
- No tracking, no analytics, no external services (unless you enable Bluesky sync)

## Browser Support

Works in all modern browsers that support:
- IndexedDB
- ES6+ JavaScript
- Fetch API

## License

Feel free to use this for your own wiki!
