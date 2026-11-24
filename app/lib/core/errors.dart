// Port of original/yt-grab/src/errors.js (friendly messages from yt-dlp stderr).
// Messages are shortened versions of the originals; same rule order, same codes.
class AppError implements Exception {
  final String message;
  final String code;
  AppError(this.message, [this.code = 'INTERNAL']);
  @override
  String toString() => message;
}

class _Rule {
  final RegExp re;
  final String code, msg;
  const _Rule(this.re, this.code, this.msg);
}

final _rules = <_Rule>[
  _Rule(RegExp(r'\bDRM\b'), 'DRM', 'This video is protected by DRM and can’t be downloaded.'),
  _Rule(RegExp(r'No video could be found in this (tweet|post)', caseSensitive: false), 'NO_POST_VIDEO',
      'This post has no video this app can download.'),
  _Rule(RegExp(r'(tweet|post)s? (is|are) protected|not authorized to see this (status|post)|NSFW|sensitive content', caseSensitive: false),
      'LOGIN_REQUIRED', 'This post is protected or marked sensitive and is only visible to signed-in users.'),
  _Rule(RegExp(r'(tweet|post) unavailable|(account|user) (is|has been) suspended|could not find (that |the )?(tweet|post)|(tweet|post) (was )?deleted', caseSensitive: false),
      'POST_GONE', 'This post was deleted, or its account is suspended.'),
  _Rule(RegExp(r'Unsupported URL', caseSensitive: false), 'UNSUPPORTED',
      'No downloadable video was found at this link. The site may not be supported.'),
  // Must come before the generic login rules: yt-dlp's bot message also mentions --cookies-from-browser.
  _Rule(RegExp(r'not a bot', caseSensitive: false), 'BOT_CHECK', 'YouTube asked for bot verification. Try again later.'),
  _Rule(RegExp(r'log in for access|may not be comfortable for some audiences|--cookies-from-browser', caseSensitive: false),
      'LOGIN_REQUIRED', 'This video is only shown to signed-in users (the site marks it as sensitive).'),
  _Rule(RegExp(r'login required|requires authentication|need to log in|sign in to view', caseSensitive: false),
      'LOGIN_REQUIRED', 'This video requires you to be signed in on that site.'),
  _Rule(RegExp(r'confirm your age|age-restricted|age restricted', caseSensitive: false), 'AGE_RESTRICTED',
      'This video is age-restricted and cannot be downloaded without a signed-in session.'),
  _Rule(RegExp(r'private video', caseSensitive: false), 'PRIVATE', 'This video is private.'),
  _Rule(RegExp(r'members-only|join this channel', caseSensitive: false), 'MEMBERS_ONLY', 'This video is for channel members only.'),
  _Rule(RegExp(r'not available in your country|blocked it in your country|geo[- ]?(restrict|block)|uploader has not made this video available in your country', caseSensitive: false), 'GEO_BLOCKED',
      'This video is not available in your region.'),
  _Rule(RegExp(r'video unavailable|has been removed|no longer available|not available', caseSensitive: false), 'UNAVAILABLE',
      'This video is unavailable or has been removed.'),
  _Rule(RegExp(r'HTTP Error 429|too many requests', caseSensitive: false), 'RATE_LIMITED',
      'The site is rate limiting you (too many requests). Wait a few minutes and try again.'),
  _Rule(RegExp(r'Cloudflare anti-bot|anti-bot challenge', caseSensitive: false), 'BOT_BLOCKED',
      'This site blocks automated downloads (Cloudflare check).'),
  _Rule(RegExp(r'HTTP Error 403|403: Forbidden', caseSensitive: false), 'FORBIDDEN',
      'The site refused the download (HTTP 403). Update yt-dlp, then try again.'),
  _Rule(RegExp(r'must be str, bytes or bytearray|Traceback|TypeError|KeyError|AttributeError|IndexError'), 'EXTRACTOR_BROKEN',
      'yt-dlp’s extractor for this site crashed. Update yt-dlp and try again.'),
  _Rule(RegExp(r'timed out|timeout|ETIMEDOUT|ECONNRESET|Temporary failure|Unable to download webpage', caseSensitive: false), 'NETWORK',
      'Network problem while contacting the site. Please try again.'),
  _Rule(RegExp(r'live event|is live|premiere', caseSensitive: false), 'LIVE',
      'Live streams and premieres can’t be downloaded until they finish.'),
];

String lastErrorLine(String text) {
  final lines = text.split(RegExp(r'\r?\n')).where((l) => l.contains('ERROR')).toList();
  final last = lines.isEmpty ? '' : lines.last;
  final out = last.replaceFirst(RegExp(r'^.*?ERROR:\s*'), '').trim();
  return out.length > 240 ? out.substring(0, 240) : out;
}

AppError fromYtDlp(Object err) {
  final text = err.toString();
  final detail = lastErrorLine(text);
  const showDetailFor = {'NETWORK', 'UNSUPPORTED', 'EXTRACTOR_BROKEN', 'FORBIDDEN', 'DRM'};
  for (final r in _rules) {
    if (r.re.hasMatch(text)) {
      return AppError(showDetailFor.contains(r.code) && detail.isNotEmpty ? '${r.msg} ($detail)' : r.msg, r.code);
    }
  }
  return AppError('Could not process this video. Check the link and try again.${detail.isNotEmpty ? ' ($detail)' : ''}', 'EXTRACTOR');
}
