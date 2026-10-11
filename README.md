# Grabit

Grabit is a local-first visual library for saving links, images, videos, notes, and webpage media into an Inbox or named sections. The existing vanilla HTML/CSS/JavaScript interface is split into focused files; a small, dependency-free Node server serves the app and safely fetches public webpages for previews.

## Project structure

- `library.html` — application shell and module entry point.
- `css/styles.css` — responsive layout, Pinterest-style grids, dialogs, and light/dark themes.
- `js/app.js` — library UI, card actions, import flow, editing, and import/export.
- `js/importer.js` — client-side API request for webpage previews.
- `js/storage.js` — IndexedDB persistence and legacy-data migration.
- `js/utils.js` — shared URL, DOM, and thumbnail helpers.
- `server.js` — static-file server and webpage-preview API.
- `server/extractor.js` — bounded HTML extraction with public-address and redirect checks.
- `test/extractor.test.js` — extractor and network-address tests.
- `icons/git.svg` — app favicon; matching PNGs are used for installable app icons.
- `render.yaml` — Render Node Web Service configuration.

## Run locally

Install Node.js 20 or newer, then run:

```sh
npm start
```

Open `http://localhost:3000/`. Use the same browser profile and origin to retain the same IndexedDB library. Run automated tests with `npm test`.

## Deploy on Render

Create a Render Web Service from this repository using the included `render.yaml` Blueprint. The service starts with `npm start`, listens on Render's `PORT`, and binds to `0.0.0.0` when a deployment port is provided. If configuring the service manually, set the start command to `npm start` and ensure the app is allowed to bind to `0.0.0.0`.

## Saving webpage media

Choose **Add → Save URL(s)** and paste a webpage, direct media, or public social-media post URL. **Detect and preview media** automatically distinguishes direct image/video URLs and extracts both real page images and videos; choose **Images only** or **Videos only** to filter. Video poster metadata is used only as a thumbnail, not saved as an image. Public Instagram posts/reels, Facebook posts/videos, Pinterest pins, TikTok videos, YouTube, Vimeo, and X/Twitter posts can also be saved through provider embeds when static media extraction is unavailable and the provider permits embedding. The preview uses a Pinterest-style media grid; choose which media to save, or explicitly hide media so it remains hidden on future previews of that page in this browser.

Choose Inbox or a section in the save form for URLs, notes, image uploads, and extracted media. Dragging images into the app opens the same save form so you can choose their destination. Pasting multiple URLs saves them together as one browsable sequence: each URL gets its own page, with **Next URL** and **Previous URL** controls. The first selected image is the gallery cover. Video poster images are used as thumbnails when the page provides one; otherwise Grabit displays a generic video thumbnail. Notes are text-only cards and do not have thumbnails.

Opening a saved item navigates to a full-viewport page instead of a floating dialog. Each URL's media appears in a Pinterest-style masonry grid. Select a tile to view it full-screen, then move left/right with the arrow buttons, keyboard, or a horizontal touch swipe. The page URL records the current saved item, source URL, selected media, and scroll position, so reloading or sharing that browser URL restores the viewing position while the item remains in the local library. Use **‹ Library** to return to the library.

Use **Download** to enter a public URL and find media exposed by the page. Responsive image candidates use the largest declared `srcset` size; candidates with known pixel dimensions are listed first. Download each exposed file directly from the results. Downloads started there or from saved media are recorded in the browser-local history. Files are streamed by the Node server without an app-imposed file-size cap and protected against private-network destinations. This is best-effort: Grabit cannot determine quality variants hidden behind scripts, login sessions, streaming manifests, or provider APIs, and an embed-only result is not downloadable.

Opening a saved item uses a full-viewport page. Direct video files play in Grabit's native HTML5 video player. Public social post embeds open inside Grabit's viewer, with the post image used as a thumbnail when the provider exposes one. A media item's hide control lets you hide it; hidden-media choices can be restored from the viewer.

Extraction covers up to 500 unique media URLs from at most 6 MB of static HTML per page. It does not execute JavaScript. JavaScript-rendered galleries, authenticated/private pages, streaming manifests, and some platform embeds will not be fully extractable. Extraction is best-effort and depends on source markup and media availability. Grabit does not bypass access controls, paywalls, or DRM.

## Library and privacy

Grabit stores records, sections, custom thumbnails, hidden-media choices, and uploaded image data in IndexedDB in the current browser profile. App updates do not delete or recreate this database; the service worker only replaces Grabit's versioned app-shell cache, and it does not cache or clear user media. Existing tabs check for updates while open, apply a waiting update automatically, and reload after open dialogs or selected files are no longer at risk. Browser storage itself can still be cleared by the user, browser settings, or device storage pressure, so keep a JSON export backup. Grabit does not have accounts, cloud sync, remote database storage, or server-side user libraries. Hidden media will not sync between devices or browser profiles. The extraction server temporarily fetches the page HTML to make a preview; it does not store the page or media. Rate limiting and request size/time limits are applied to the preview endpoint.

Locally uploaded images are resized and compressed before browser storage. External media stays at its source URL and may expire or be blocked by the source. Browser storage can be cleared or evicted; use **Export library** regularly and store the resulting JSON backup somewhere safe. Backups contain external media references rather than downloaded copies.

To restore, open **Export library → Restore JSON**, select a Grabit JSON export, review the confirmation, and restore. Existing content is not overwritten; duplicate records are skipped.

## Current functionality

- IndexedDB persistence, one-time migration from the older `lib1` local-storage format, and JSON export/restore.
- All content, Inbox, Favorites, Recently added, Archived, and named sections, with an option to hide section items from All content.
- Add bookmarks, direct image/video links, public social-media posts, notes, uploaded images, and webpage-extracted image/video groups.
- Responsive Pinterest-style card and gallery grids, thumbnail fallbacks, custom thumbnail URLs, image/video viewers, and browser-native video playback.
- Card-level three-dot menu for edit, favorite, archive/restore, and delete. Opening a card is read-only; editing is available only from the menu.
- Persistent hidden-media selections for a page, plus hide/unhide controls in gallery and playlist viewers.
- Server-streamed downloads for publicly accessible direct media files without an app-imposed size cap, with a browser-local Download history.
- Search, type filtering, sorting, sections, URL duplicate handling, and multi-select organization tools.
- Light and dark themes; the theme choice is remembered in the current browser.
- Installable progressive web app shell with offline access to the app interface and local library, where supported by the browser. Downloads and page extraction still require a connection.

## Known limitations

- This is a browser-local library, not a multi-user cloud service. Data is isolated per browser/profile and is not recoverable from the server.
- The extractor parses static markup; it cannot run page scripts. Up to 500 media URLs are returned; larger pages report when the cap was reached.
- Thumbnail fallback graphics are shown if no thumbnail/poster can be extracted or a remote thumbnail fails. Grabit does not extract video frames. Provider embeds depend on the platform, account status, region, and its current embed policy.
- "Social media" is not a single interoperable format. The extractor can only read public static HTML; login-required, private, dynamically rendered, and restricted posts cannot reliably be fetched. Provider embeds for supported public social post URLs are subject to each platform's embed policy, regional availability, and account state. Grabit does not bypass platform protections.
- Not every URL is a downloadable file. The downloader accepts publicly accessible direct media responses and rejects HTML pages and private-network destinations. Browser-local downloads and server-side fetching cannot access a user's logged-in cookies, and Grabit cannot download video data that a social provider exposes only through an embed or protected stream.
- External media may be inaccessible due to hotlink protection, CORS, expiration, content negotiation, or provider restrictions.
- There is no social-platform API integration, background job queue, object storage, PostgreSQL database, ZIP download, or server-side media storage.
- In-memory rate limiting applies per server process. It is suitable for a small initial deployment, not distributed or high-volume abuse protection.

## Render deployment

The included `render.yaml` configures Grabit as a Render **Node Web Service**. Connect the repository to Render and create the service from the Blueprint; Render installs the Node project and starts `npm start`. The server listens on Render's assigned `PORT` and binds to `0.0.0.0` for deployment. The `/api/health` endpoint is used for health checks. GitHub Actions runs the Node test suite on pushes and pull requests; a manually triggered health check can use the service's `/api/health` URL.

To have GitHub Actions ping the deployed service every seven minutes, add a repository Actions variable named `GRABIT_HEALTH_URL` with the service's public base URL (for example, `https://your-service.onrender.com`, without `/api/health`). The scheduled workflow requests `${GRABIT_HEALTH_URL}/api/health`; it runs only on the repository's default branch. GitHub cron jobs are best-effort and can be delayed or skipped, so this does not guarantee that a sleeping Render instance stays awake. Use a Render plan with the required availability if continuous uptime matters.

The app can be installed as a PWA on supported browsers; it is not a packaged native Android or iOS application. Render instance sleep behavior depends on the selected Render plan. Scheduled GitHub requests are best-effort and should not be treated as an uptime solution; choose a plan with the availability behavior the deployment needs.

The service serves the app and performs page previews, but it does not persist user-library data. Each user's library remains in their browser's IndexedDB. Keep the same HTTPS domain to preserve access to the same browser-local library. Deployment itself has not been run or verified from this workspace.
