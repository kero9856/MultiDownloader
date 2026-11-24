# YT Grab

Paste a YouTube link, choose a quality (or audio only), and download it. Express backend, `yt-dlp` extraction, `ffmpeg-static` muxing, vanilla JS glassmorphism frontend.

## Setup

Requirements: **Node.js 18+** (and Python is NOT needed; `yt-dlp-exec` downloads a standalone binary on install).

```bash
cd yt-grab
npm install        # installs express, express-rate-limit, yt-dlp-exec, ffmpeg-static
npm start          # http://localhost:3000
```

Dev mode with auto-restart: `npm run dev`.

Optional configuration (environment variables, see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `MAX_CONCURRENT_JOBS` | 3 | Simultaneous downloads |
| `COOKIES_FILE` | none | Netscape `cookies.txt` for videos you're allowed to access that need a signed-in session |

Keep `yt-dlp` current: YouTube changes often. Re-run `npm install yt-dlp-exec@latest` (or `npm update yt-dlp-exec`) if extraction starts failing.

## How it works

```
public/        index.html, styles.css, app.js   (frontend)
server.js                                      Express app, routes, error handler
src/config.js                                  settings, allowed hosts, user-agent pool
src/errors.js                                  yt-dlp stderr → friendly errors
src/youtube.js                                 URL validation, metadata, quality list, format selectors
src/jobs.js                                    download jobs, progress parsing, temp-file cleanup
```

1. `POST /api/info` → title, thumbnail, channel, duration, and video/audio options with size estimates.
2. `POST /api/download` → starts a job; yt-dlp downloads and (for video) merges video+audio with ffmpeg into a temp file.
3. `GET /api/progress/:id` → Server-Sent Events with live percent.
4. `GET /api/file/:id` → streams the finished file with `Content-Disposition: attachment`, then deletes it.

Why a temp file instead of piping straight to the browser? ffmpeg can't write a seekable MP4 to a pipe, so merged 1080p+ downloads need a file. This also makes real progress and a correct `Content-Length` possible.

## Production notes

- Put it behind a reverse proxy (nginx/Caddy) with HTTPS; for SSE disable proxy buffering on `/api/progress/`.
- Add authentication if you expose it publicly. The built-in rate limit (40 req/min/IP) and job cap are only basic protection.
- Make sure the temp directory has enough free space for concurrent jobs.

## Legal

Downloading YouTube content generally violates YouTube's Terms of Service and may infringe copyright. Use this only for content you own, that is public domain or Creative Commons, or that you have explicit permission to download.
