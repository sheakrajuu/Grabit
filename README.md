# Grabit

Grabit is a local-first visual library for saving links, images, videos, notes, and webpage media into an Inbox or named sections. The existing vanilla HTML/CSS/JavaScript interface is split into focused files; a small Node server serves the app and safely fetches public webpages for previews.

## Project structure

- `library.html` — application shell and module entry point.
- `css/styles.css` — responsive layout, Pinterest-style grids, dialogs, and light/dark themes.
- `js/app.js` — library UI, card actions, import flow, editing, and import/export.
- `js/importer.js` — client-side API request for webpage previews.
- `js/share.js` — one-time library share links and legacy compressed-link imports.
- `js/storage.js` — IndexedDB persistence and legacy-data migration.
- `js/video-transcoder.js` — opt-in local video conversion using FFmpeg WebAssembly.
- `js/utils.js` — shared URL, DOM, and thumbnail helpers.
- `server.js` — static-file server and webpage-preview API.
- `server/share-store.js` — in-memory share storage consumed after successful import.
- `server/extractor.js` — bounded HTML extraction with public-address and redirect checks.
- `server/playlist.js` — bounded yt-dlp resolution, streaming downloads, and public video-list discovery.
- `THIRD-PARTY-NOTICES.txt` and `licenses/COPYING.GPLv2` — video converter license notices.
- `server/public-proxy.js` — public-address-only network proxy for yt-dlp requests and redirects.
- `requirements.txt` — Python dependency used by server-side video-list discovery.
- `test/extractor.test.js` — extractor and network-address tests.
- `icons/git.svg` — app favicon; matching PNGs are used for installable app icons.
- `icons/sun.svg` and `icons/moon.svg` — Lucide theme icons (ISC license), bundled for offline use.
- `render.yaml` — Render Node Web Service configuration.

## Run locally

Install Node.js 20 or newer and Python 3, install the Python requirements, then run:

```sh
python -m pip install -r requirements.txt
npm start
```

Open `http://localhost:3000/`. Use the same browser profile and origin to retain the same IndexedDB library. Run automated tests with `npm test`.

## Deploy on Render

Create a Render Web Service from this repository using the included `render.yaml` Blueprint. The service starts with `npm start`, listens on Render's `PORT`, and binds to `0.0.0.0` when a deployment port is provided. If configuring the service manually, set the start command to `npm start` and ensure the app is allowed to bind to `0.0.0.0`.

## Saving webpage media

Choose **Add → Save links** and paste a webpage, direct media, or public social-media post URL. **Preview media** automatically distinguishes direct image/video URLs and extracts both real page images and videos; choose **Images only** or **Videos only** to filter. Video poster metadata is used only as a thumbnail, not saved as an image.

For a public webpage, Grabit shows media extracted from the static page first, then checks eligible pages for a video list in the background. This is best-effort across yt-dlp's supported public extractors, not restricted to one provider. You can cancel that background lookup and save the page media already found. If the provider exposes a browser-compatible stream, Grabit displays it in the native player; if previewing finds no videos, choose **Find and play video** / **Find videos** to try resolving the page directly. When yt-dlp exposes a list, Grabit shows it in batches of 10, with previous/next controls in the gallery and Download view. XHamster/XHOfficial creator lists keep their provider-specific URL normalization, but other URLs use the same general discovery path.

In the **Download** view, paste a public webpage or video URL (or enter it and select **Find media**). Grabit shows full-size images and playable videos instead of thumbnail-only results. Pixiv artwork pages use Pixiv artwork metadata instead of unrelated page images; Pixiv CDN images are displayed and downloaded through Grabit with the required Pixiv referrer. Pixiv Ugoira animations are converted to browser-playable MP4 locally in the browser, using device resources. Responsive image sizes and supported video qualities are ordered from largest to smallest; choose a listed video quality before downloading when the provider exposes alternatives. Use **All media**, **Images**, or **Videos** to filter results. When yt-dlp exposes a list, use the page controls to browse batches of 10. A saved video can also offer a download action. Grabit does not keep a permanent server copy of downloaded media. Provider embeds remain a fallback where supported. Video resolution and list discovery require yt-dlp on the server and public provider access; login-only, DRM-protected, and provider-blocked videos cannot be played or fetched.

Choose Inbox or a section in the save form for URLs, notes, image and video uploads, and extracted media. Selecting or dropping multiple photos saves them together as one photo gallery; multiple videos are saved as individual items. Dragging images or videos into the app opens the same save form so you can choose their destination. Pasting multiple URLs saves them together as one browsable sequence: each URL gets its own page, with **Next URL** and **Previous URL** controls. The first selected image is the gallery cover. Video poster images are used as thumbnails when the page provides one; otherwise Grabit displays a generic video thumbnail. Notes are text-only cards and do not have thumbnails.

Opening a saved item navigates to a full-viewport page instead of a floating dialog. Each URL's media appears in a Pinterest-style masonry grid. Select a tile to view it full-screen, then move left/right with the arrow buttons, keyboard, or a horizontal touch swipe. The page URL records the current saved item, source URL, selected media, and scroll position, so reloading or sharing that browser URL restores the viewing position while the item remains in the local library. Use **‹ Library** to return to the library.

Use **Download** to enter a public URL and find its media. Grabit checks static page media and tries yt-dlp discovery for URLs supported by its extractors. Use the video controls to watch a browser-compatible stream or choose **Download with Grabit** to stream it. Discovered video lists load in batches of 10, up to 500 results per URL. Responsive image candidates use the largest declared `srcset` size; candidates with known pixel dimensions are listed first. Downloads started there or from saved media are recorded in the browser-local history. This is best-effort: provider extractor coverage and public stream availability vary; login-only, DRM-protected, and provider-blocked videos cannot be fetched.

Opening a saved item uses a full-viewport page. Direct video files play in Grabit's native HTML5 video player. Public social post embeds open inside Grabit's viewer, with the post image used as a thumbnail when the provider exposes one. A media item's hide control lets you hide it; hidden-media choices can be restored from the viewer.

Static extraction covers up to 500 unique media URLs from at most 6 MB of HTML per page. It does not execute JavaScript. yt-dlp discovery can try public URLs recognized by its extractors and lists at most the first 500 results, shown 10 at a time. A website is not guaranteed to have a supported extractor, and JavaScript-rendered galleries, authenticated/private pages, streaming manifests, or some platform embeds may not expose a list or browser-playable stream. Extraction is best-effort and depends on source markup and provider availability. Grabit does not bypass access controls, paywalls, or DRM.

## Library and privacy

Grabit stores records, sections, custom thumbnails, hidden-media choices, and uploaded image and video data in IndexedDB in the current browser profile. Videos can be up to 100 MB each; available total storage depends on the browser and device. The library displays up to 60 cards per page so large collections do not create an oversized page; search still includes the full library. Long previews, imports, media additions, and bulk actions show progress and can be cancelled. Recent item deletions and bulk changes can be undone for a short time. App updates do not delete or recreate this database; the service worker only replaces Grabit's versioned app-shell cache, and it does not cache or clear user media. Existing tabs check for updates while open, apply a waiting update automatically, and reload after open dialogs or selected files are no longer at risk. Browser storage itself can still be cleared by the user, browser settings, or device storage pressure, so keep a JSON export backup. Grabit does not have accounts, cloud sync, persistent remote storage, or server-side user libraries. Hidden media will not sync between devices or browser profiles. The extraction server temporarily fetches page metadata and media URLs to make a preview; it does not store the page or media. yt-dlp runs without browser cookies. Its provider requests, including redirects, are routed through a proxy that rejects private-network destinations. It inspects supported public video URLs for playback metadata and fetches video bytes only when a user explicitly starts a download. Rate limiting and request size/time limits apply.

Locally uploaded images are resized and compressed before browser storage. Uploaded videos (up to 100 MB each) are stored as binary media in this browser's IndexedDB, without an automatic server upload; Base64 conversion happens only when creating an export or share payload. If a local video is unsupported by the browser, choose **Convert on this device** to create an H.264/AAC MP4 copy while preserving the original. Conversion runs in a WebAssembly worker in the browser; the converter download is about 31 MB the first time, and conversion can use substantial memory, storage, CPU, and battery. It cannot guarantee playback for damaged, DRM-protected, or unsupported inputs, and browser/device support still varies. External media stays at its source URL and may expire or be blocked by the source. Browser storage can be cleared or evicted; use **Export library** regularly and store the resulting JSON backup somewhere safe. Backups contain uploaded media and external media references rather than downloaded copies of external media.

The FFmpeg WebAssembly binary is included as two files under `vendor/ffmpeg/core/` so each can be uploaded through GitHub’s web interface; the server joins them when serving the converter. Keep both parts together. `node_modules/` is excluded from GitHub; install dependencies from `package-lock.json` with `npm install` rather than uploading that directory. The bundled `@ffmpeg/core` is GPL-2.0-or-later; see [THIRD-PARTY-NOTICES.txt](./THIRD-PARTY-NOTICES.txt) and [licenses/COPYING.GPLv2](./licenses/COPYING.GPLv2). Review applicable GPL source and distribution obligations before redistributing Grabit.

To share your full library, open **Export library → Create encrypted one-time link**. To share one saved item, open its card menu and choose **Share item…**. To share multiple selected items, choose **Select**, select at least two cards, then choose **Share contents**. Links are compact; the browser encrypts the selected data with AES-256-GCM before upload, and the share API stores ciphertext only. The decryption key is carried in the URL fragment, which browsers do not send in HTTP requests. The server can still observe connection metadata (such as IP address, time, and ciphertext size), and anyone with the complete link can decrypt its contents. This protects content from the share API/storage, not from a server operator able to replace the JavaScript app delivered before encryption. Links remain available until the first successful import; cancelling or a failed import does not consume them. A server restart may invalidate an unused link. After import, content is saved in the recipient’s browser storage; external media remains a source URL and can still disappear at the source. Encrypted share payloads are limited to 79 MiB before encryption (the server allows 80 MiB for ciphertext). Older server-backed links do not contain a decryption key and cannot be opened; create a new link. JSON backups include uploaded media data but are unencrypted and should be stored securely. To restore a JSON export, choose it under **Import… → JSON backup**, review the valid item and section counts, then confirm. Unsupported entries are reported and skipped. Existing content is kept; duplicate records are skipped rather than overwritten. Backups larger than 30 MB are rejected.

## Current functionality

- IndexedDB persistence, one-time migration from the older `lib1` local-storage format, and JSON export/restore.
- On-device, opt-in video conversion for broader browser playback; the original upload remains local and unchanged.
- Inbox as the unified view of non-archived items unless hidden there; hidden items appear only in their assigned sections (and Archived when archived). Favorites, Recently added, Archived, and named sections remain separate views.
- Add bookmarks, direct image/video links, public social-media posts, notes, uploaded images, webpage-extracted image/video groups, and yt-dlp-discovered public video lists supported by its extractors.
- Responsive Pinterest-style card and gallery grids, thumbnail fallbacks, custom thumbnail URLs, image/video viewers, and browser-native video playback.
- Card-level three-dot menu for section movement, Inbox visibility, gallery-to-PDF export (including images found across saved link groups), single-item sharing, edit, favorite, archive/restore, and delete. Opening a card is read-only; editing is available only from the menu.
- Persistent hidden-media selections for a page, plus hide/unhide controls in gallery and playlist viewers.
- Server-streamed downloads for publicly accessible direct media files without an app-imposed size cap, with a browser-local Download history.
- Gallery PDF export lets you select images; each image gets an uncropped, custom-proportions page rather than A4. Multi-link groups can collect public images from every saved link into one PDF. JPEG and PNG only, up to 200 images, 25 MB each, and 80 MB total source data.
- One-time library share links that are consumed after successful import, with JSON export backups.
- Share an individual saved item or multiple selected items without sharing the rest of the library; tags are not part of the library.
- Search, type filtering, sorting, sections, URL duplicate handling, and multi-select organization tools.
- Light and dark themes; the theme choice is remembered in the current browser.
- Installable progressive web app shell with offline access to the app interface and local library, where supported by the browser. Downloads and page extraction still require a connection.

## Known limitations

- This is a browser-local library, not a multi-user cloud service. Data is isolated per browser/profile and is not recoverable from the server.
- The HTML extractor parses static markup; it cannot run page scripts. Up to 500 media URLs are returned; larger pages report when the cap was reached. yt-dlp discovery is attempted for public webpage URLs but only works for providers and URL types its installed extractors recognize; it returns up to 500 results per page, 10 at a time. Metadata resolution can fail or return no browser-playable format even when a provider page can play video in its own website.
- Thumbnail fallback graphics are shown if no thumbnail/poster can be extracted or a remote thumbnail fails. Grabit does not extract video frames. Provider embeds depend on the platform, account status, region, and its current embed policy.
- "Social media" is not a single interoperable format. The extractor can only read public static HTML; yt-dlp support also depends on its available provider extractor and public stream access. Login-required, private, dynamically rendered, DRM-protected, and restricted posts cannot reliably be fetched. Pixiv R-18 posts that require sign-in or age confirmation cannot be previewed by Grabit's server; Grabit does not use Pixiv account cookies or bypass age gates. Provider embeds for supported public social post URLs are subject to each platform's embed policy, regional availability, and account state. Grabit does not bypass platform protections.
- Not every URL is a downloadable file. The downloader accepts publicly accessible direct media responses and rejects HTML pages and private-network destinations. Browser-local downloads and server-side fetching cannot access a user's logged-in cookies, and Grabit cannot download video data that a social provider exposes only through an embed or protected stream.
- External media may be inaccessible due to hotlink protection, CORS, expiration, content negotiation, or provider restrictions.
- There is no social-platform API integration, background job queue, object storage, PostgreSQL database, ZIP download, or server-side media storage.
- In-memory rate limiting applies per server process. It is suitable for a small initial deployment, not distributed or high-volume abuse protection.

## Render deployment

The included `render.yaml` configures Grabit as a Render **Node Web Service**. Connect the repository to Render and create or sync the service from the Blueprint. Its build creates a project-local Python virtual environment, installs yt-dlp from `requirements.txt` into that environment, and configures Grabit to use that same interpreter before starting `npm start`. This matching interpreter matters: installing yt-dlp into a different system Python will not make it available to the Node server. If the service was configured manually rather than from the Blueprint, set its build command to `npm install && python3 -m venv .venv && .venv/bin/python -m pip install --disable-pip-version-check -r requirements.txt` and add the environment variable `PYTHON=.venv/bin/python`. After changing the Blueprint or build settings, deploy the latest code and check the Render build/deploy logs for successful yt-dlp installation and startup. The server listens on Render's assigned `PORT` and binds to `0.0.0.0` for deployment. The `/api/health` endpoint is used for health checks; a healthy response confirms the service responds but does not by itself prove a particular provider will expose playable video. GitHub Actions runs the Node test suite on pushes and pull requests; a manually triggered health check can use the service's `/api/health` URL.

To have GitHub Actions ping the deployed service every seven minutes, add a repository Actions variable named `GRABIT_HEALTH_URL` with the service's public base URL (for example, `https://your-service.onrender.com`, without `/api/health`). The scheduled workflow requests `${GRABIT_HEALTH_URL}/api/health`; it runs only on the repository's default branch. GitHub cron jobs are best-effort and can be delayed or skipped, so this does not guarantee that a sleeping Render instance stays awake. Use a Render plan with the required availability if continuous uptime matters.

The app can be installed as a PWA on supported browsers; it is not a packaged native Android or iOS application. Render instance sleep behavior depends on the selected Render plan. Scheduled GitHub requests are best-effort and should not be treated as an uptime solution; choose a plan with the availability behavior the deployment needs.

The service serves the app and performs page previews, but it does not persist user-library data. Each user's library remains in their browser's IndexedDB. Keep the same HTTPS domain to preserve access to the same browser-local library. Deployment itself has not been run or verified from this workspace.
