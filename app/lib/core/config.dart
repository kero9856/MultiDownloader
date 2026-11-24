// Port of original/yt-grab/src/config.js (only what makes sense on-device).
class AppConfig {
  static const int maxConcurrentJobs = 3;
  static const int concurrentFragments = 16; // original default
  static const int stallSeconds = 45;
  static const int jobTtlMinutes = 15;
  static const int infoCacheMinutes = 10; // original caches video info for 10 minutes (stream URLs expire)

  /// Original ALLOWED_DOMAINS (used only when restrictSites is true).
  static const bool restrictSites = false;
  static const List<String> allowedDomains = [
    'youtube.com', 'youtu.be', 'facebook.com', 'fb.watch',
    'tiktok.com', 'twitter.com', 'x.com', 'twimg.com',
  ];

  /// Sites shown in the original sidebar (public/index.html).
  static const List<String> sidebarSites = [
    'YouTube', 'Facebook', 'TikTok', 'X (Twitter)', 'Instagram', 'OK.ru',
  ];

  static const List<String> userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
  ];
}
