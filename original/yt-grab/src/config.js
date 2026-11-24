// Central configuration + small shared constants.
const path = require('path');

module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  MAX_CONCURRENT_JOBS: Number(process.env.MAX_CONCURRENT_JOBS) || 5,
  // Downloads live here and are NEVER deleted automatically. Interrupted downloads resume from this folder.
  DOWNLOAD_DIR: process.env.DOWNLOAD_DIR ? path.resolve(process.env.DOWNLOAD_DIR) : path.join(__dirname, '..', 'downloads'),
  // Finished videos stay ONLY in DOWNLOAD_DIR (the program's own downloads folder); the browser saves nothing.
  SAVE_TO_BROWSER: false,
  // Speed. Number of pieces fetched in parallel for videos that are split into pieces (YouTube, HLS/DASH). Try 8-16.
  CONCURRENT_FRAGMENTS: Math.min(Math.max(Number(process.env.CONCURRENT_FRAGMENTS) || 16, 1), 32),
  // Speed settings, changeable from the page ("Download speed" box). mode: normal | fast | max.
  // 'max' uses aria2c (many connections per file) when it is installed, otherwise 32 pieces in parallel.
  speed: { mode: process.env.USE_ARIA2 === 'true' ? 'max' : 'fast', limitMBps: Number(process.env.LIMIT_MBPS) || 0 }, // limitMBps 0 = no limit
  aria2Available: false, // detected at startup
  // If a download saves no new data for this many seconds, it is stopped and resumed automatically (0 = off).
  STALL_SECONDS: process.env.STALL_SECONDS !== undefined ? Number(process.env.STALL_SECONDS) || 0 : 45,
  // How long a finished/failed job stays in server memory (files on disk are not touched).
  JOB_TTL_MS: 15 * 60 * 1000,
  // Keep yt-dlp up to date automatically (at startup and once a day). Set AUTO_UPDATE_YTDLP=false to turn it off.
  AUTO_UPDATE_YTDLP: process.env.AUTO_UPDATE_YTDLP !== 'false',
  // 'stable' (default) or 'nightly' (gets YouTube fixes sooner).
  YTDLP_CHANNEL: process.env.YTDLP_CHANNEL || 'stable',
  // Use the login of a browser installed on this computer (firefox, chrome, edge, brave...). Helps with Instagram and other login-only videos.
  COOKIES_FROM_BROWSER: process.env.COOKIES_FROM_BROWSER || null,
  COOKIES_FILE: process.env.COOKIES_FILE ? path.resolve(process.env.COOKIES_FILE) : null,
  // Set RESTRICT_SITES=true to accept ONLY the domains below (recommended if you host this publicly).
  RESTRICT_SITES: process.env.RESTRICT_SITES === 'true',
  // Sites supported by the downloader when RESTRICT_SITES is on. Subdomains (www., m., vm., ...) are matched automatically.
  // To add another site that yt-dlp supports, just add its domain here AND in public/app.js.
  ALLOWED_DOMAINS: [
    'youtube.com', 'youtu.be',
    'facebook.com', 'fb.watch',
    'tiktok.com',
    'twitter.com', 'x.com', 'twimg.com',
  ],
  // Rotated per request to look like ordinary browser traffic.
  USER_AGENTS: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Edg/123.0.0.0 Safari/537.36',
  ],
};
