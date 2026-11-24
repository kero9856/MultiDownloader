// Turns noisy yt-dlp stderr into friendly, actionable API errors.
class AppError extends Error {
  constructor(message, status = 500, code = 'INTERNAL') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const RULES = [
  [/\bDRM\b/, 403, 'DRM', 'This video is protected by DRM and can’t be downloaded.'],
  [/No video could be found in this (tweet|post)/i, 422, 'NO_POST_VIDEO', 'This post has no video this tool can download. It may only have images, a video embedded from another site, or a video that lives in a quoted post (open that post’s own link instead).'],
  [/(tweet|post)s? (is|are) protected|not authorized to see this (status|post)|NSFW|sensitive content/i, 401, 'LOGIN_REQUIRED', 'This post is protected, marked sensitive, or only visible to signed-in users. Only public posts work, unless the server is started with your browser’s login (COOKIES_FROM_BROWSER).'],
  [/(tweet|post) unavailable|(account|user) (is|has been) suspended|could not find (that |the )?(tweet|post)|(tweet|post) (was )?deleted/i, 404, 'POST_GONE', 'This post was deleted, or its account is suspended or private.'],
  [/Unsupported URL/i, 422, 'UNSUPPORTED', 'No downloadable video was found at this link. The site may not be supported, or its player can’t be read by this tool.'],
  // TikTok (and others) hide "sensitive" / age-gated videos from visitors who are not logged in.
  [/log in for access|may not be comfortable for some audiences|--cookies-from-browser/i, 401, 'LOGIN_REQUIRED', 'This video is only shown to signed-in users (the site marks it as sensitive). Log in to the site in your browser, then start the program with COOKIES_FROM_BROWSER set to that browser (for example firefox or chrome).'],
  [/login required|requires authentication|need to log in|sign in to view/i, 401, 'LOGIN_REQUIRED', 'This video requires you to be signed in on that site. Only public videos work unless a cookies file is configured.'],
  [/confirm your age|age-restricted|age restricted/i, 403, 'AGE_RESTRICTED', 'This video is age-restricted and cannot be downloaded without a signed-in session.'],
  [/private video/i, 403, 'PRIVATE', 'This video is private.'],
  [/members-only|join this channel/i, 403, 'MEMBERS_ONLY', 'This video is for channel members only.'],
  [/not available in your country|blocked it in your country|geo/i, 451, 'GEO_BLOCKED', 'This video is not available in the server’s region.'],
  [/video unavailable|has been removed|no longer available|not available/i, 404, 'UNAVAILABLE', 'This video is unavailable or has been removed.'],
  [/HTTP Error 429|too many requests/i, 429, 'RATE_LIMITED', 'The site is rate limiting this server (too many requests). Wait a few minutes and try again.'],
  [/not a bot/i, 429, 'BOT_CHECK', 'YouTube asked for bot verification. Try again later or configure a cookies file.'],
  // The site itself blocks automated tools: updating yt-dlp won't change that.
  [/Cloudflare anti-bot|anti-bot challenge/i, 403, 'BOT_BLOCKED', 'This site blocks automated downloads (it shows a Cloudflare check), so this tool can’t download from it. If the video is yours, use the site’s own download button or ask the owner for the file.'],
  // 403 is not a network problem: the site refused the media request (outdated yt-dlp, expired link, or blocked client).
  [/HTTP Error 403|403: Forbidden/i, 403, 'FORBIDDEN', 'The site refused the download (HTTP 403). Update yt-dlp, then try again. If the link has a token, copy a fresh link.'],
  [/must be str, bytes or bytearray|Traceback|TypeError|KeyError|AttributeError|IndexError/, 502, 'EXTRACTOR_BROKEN', 'yt-dlp’s extractor for this site crashed. This usually means the site changed or your yt-dlp is out of date: update yt-dlp, then try again.'],
  [/timed out|timeout|ETIMEDOUT|ECONNRESET|Temporary failure|Unable to download webpage/i, 504, 'NETWORK', 'Network problem while contacting the site. Please try again.'],
  [/live event|is live|premiere/i, 400, 'LIVE', 'Live streams and premieres can’t be downloaded until they finish.'],
];

/** The last "ERROR: ..." line yt-dlp printed: the real reason, shown to help diagnose problems. */
function lastErrorLine(text) {
  const lines = text.split(/\r?\n/).filter((l) => /ERROR/.test(l));
  const last = lines[lines.length - 1] || '';
  return last.replace(/^.*?ERROR:\s*/, '').trim().slice(0, 240);
}

function fromYtDlp(err) {
  // Prefer yt-dlp's own stderr: err.message can echo the whole command line (e.g. "--socket-timeout"),
  // which would wrongly match words like "timeout" and mislabel the error as a network problem.
  const text = err.stderr ? String(err.stderr) : `${err.message || ''}`;
  const detail = lastErrorLine(text);
  console.error('[yt-dlp error]', text.slice(0, 800)); // always visible in the server window
  for (const [re, status, code, msg] of RULES) {
    if (re.test(text)) {
      const showDetail = ['NETWORK', 'UNSUPPORTED', 'EXTRACTOR_BROKEN', 'FORBIDDEN', 'DRM'].includes(code) && detail;
      return new AppError(showDetail ? `${msg} (${detail})` : msg, status, code);
    }
  }
  return new AppError(`Could not process this video. Check the link and try again.${detail ? ` (${detail})` : ''}`, 502, 'EXTRACTOR');
}

module.exports = { AppError, fromYtDlp };
