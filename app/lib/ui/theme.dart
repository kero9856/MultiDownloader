import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

/// Colours used by the redesigned screens (dark = the reference design, light = same layout).
class Pal {
  final Color bg, card, cardAlt, border, text, sub, primary, accent, chipSel, chipSelText, ok, danger, navBg, navPill;
  const Pal._({
    required this.bg, required this.card, required this.cardAlt, required this.border, required this.text, required this.sub,
    required this.primary, required this.accent, required this.chipSel, required this.chipSelText, required this.ok,
    required this.danger, required this.navBg, required this.navPill,
  });

  static const dark = Pal._(
    bg: Color(0xFF111418), card: Color(0xFF1A1E25), cardAlt: Color(0xFF242A34), border: Color(0xFF2F3541),
    text: Color(0xFFF1F3F6), sub: Color(0xFF9AA3B2), primary: Color(0xFF3D8BFF), accent: Color(0xFF5B5FE0),
    chipSel: Color(0xFFBFE0FF), chipSelText: Color(0xFF0B1B2E), ok: Color(0xFF2CC6A8), danger: Color(0xFFFF6B6B),
    navBg: Color(0xFF181C22), navPill: Color(0xFF2A3A55),
  );

  static const light = Pal._(
    bg: Color(0xFFF4F6FA), card: Color(0xFFFFFFFF), cardAlt: Color(0xFFE9EDF4), border: Color(0xFFD5DAE3),
    text: Color(0xFF14181F), sub: Color(0xFF5E6877), primary: Color(0xFF1F6FEB), accent: Color(0xFF4F54D6),
    chipSel: Color(0xFFCFE6FF), chipSelText: Color(0xFF0B1B2E), ok: Color(0xFF14A58A), danger: Color(0xFFD93A3A),
    navBg: Color(0xFFFFFFFF), navPill: Color(0xFFD6E6FF),
  );

  static Pal of(BuildContext c) => Theme.of(c).brightness == Brightness.dark ? dark : light;
}

ThemeData buildTheme(Brightness b) {
  final p = b == Brightness.dark ? Pal.dark : Pal.light;
  final scheme = ColorScheme.fromSeed(seedColor: p.primary, brightness: b).copyWith(primary: p.primary, error: p.danger);
  return ThemeData(
    useMaterial3: true,
    brightness: b,
    colorScheme: scheme,
    scaffoldBackgroundColor: p.bg,
    canvasColor: p.bg,
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: p.navBg,
      surfaceTintColor: Colors.transparent,
      indicatorColor: p.navPill,
      height: 72,
    ),
    bottomSheetTheme: BottomSheetThemeData(backgroundColor: p.card, surfaceTintColor: Colors.transparent),
  );
}

/// A site shown as a round icon (home screen) or a small badge (history thumbnails).
class Site {
  final String name;
  final Color color;
  final IconData? icon;
  final String? letter;
  final Gradient? gradient;
  const Site(this.name, this.color, {this.icon, this.letter, this.gradient});
}

const _yt = Site('YouTube', Color(0xFFE62117), icon: Icons.play_arrow_rounded);
const _fb = Site('Facebook', Color(0xFF1877F2), letter: 'f');
const _tt = Site('TikTok', Color(0xFF000000), icon: Icons.music_note_rounded);
const _x = Site('X (Twitter)', Color(0xFF000000), letter: 'X');
const _ig = Site('Instagram', Color(0xFFD62976), icon: Icons.camera_alt_outlined,
    gradient: LinearGradient(begin: Alignment.bottomLeft, end: Alignment.topRight,
        colors: [Color(0xFFFEDA75), Color(0xFFFA7E1E), Color(0xFFD62976), Color(0xFF962FBF), Color(0xFF4F5BD5)]));
const _ok = Site('OK.ru', Color(0xFFEE8208), letter: 'OK');

Site? siteByName(String name) {
  switch (name) {
    case 'YouTube': return _yt;
    case 'Facebook': return _fb;
    case 'TikTok': return _tt;
    case 'X (Twitter)': return _x;
    case 'Instagram': return _ig;
    case 'OK.ru': return _ok;
  }
  return null;
}

Site? siteOfUrl(String url) {
  final h = (Uri.tryParse(url)?.host ?? '').toLowerCase();
  if (h.contains('youtube') || h.contains('youtu.be')) return _yt;
  if (h.contains('facebook') || h.contains('fb.watch') || h.contains('fb.com')) return _fb;
  if (h.contains('tiktok')) return _tt;
  if (h.contains('instagram')) return _ig;
  if (h == 'x.com' || h.endsWith('.x.com') || h.contains('twitter') || h.contains('twimg')) return _x;
  if (h.contains('ok.ru')) return _ok;
  return null;
}

class SiteIcon extends StatelessWidget {
  final Site site;
  final double size;
  final bool round;
  const SiteIcon(this.site, {super.key, this.size = 44, this.round = true});
  @override
  Widget build(BuildContext context) => Container(
        width: size, height: size, alignment: Alignment.center,
        decoration: BoxDecoration(
          color: site.gradient == null ? site.color : null,
          gradient: site.gradient,
          shape: round ? BoxShape.circle : BoxShape.rectangle,
          borderRadius: round ? null : BorderRadius.circular(size * 0.28),
        ),
        child: site.icon != null
            ? Icon(site.icon, color: Colors.white, size: size * 0.6)
            : Text(site.letter ?? '', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: size * 0.42)),
      );
}

/// Rounded thumbnail with an optional caption at the bottom and an optional site badge.
class MediaThumb extends StatelessWidget {
  final String? url;
  final double size;
  final bool audio;
  final bool subtitle;
  final String? caption;
  final Site? badge;
  final double? height;
  const MediaThumb({super.key, this.url, this.size = 72, this.audio = false, this.subtitle = false, this.caption, this.badge, this.height});

  @override
  Widget build(BuildContext context) {
    final p = Pal.of(context);
    final h = height ?? size;
    final hasImage = url != null && url!.isNotEmpty && !audio;
    final placeholder = Container(
      color: p.cardAlt, alignment: Alignment.center,
      child: Icon(audio ? Icons.music_note_rounded : subtitle ? Icons.subtitles_outlined : Icons.movie_outlined, color: p.sub, size: size * 0.45),
    );
    return SizedBox(
      width: size, height: h,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(14),
        child: Stack(fit: StackFit.expand, children: [
          hasImage ? Image.network(url!, fit: BoxFit.cover, errorBuilder: (_, __, ___) => placeholder) : placeholder,
          if (caption != null)
            Positioned(left: 0, right: 0, bottom: 0, child: Container(
              padding: const EdgeInsets.fromLTRB(4, 12, 4, 5),
              decoration: const BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter,
                  colors: [Color(0x00000000), Color(0xB3000000)])),
              child: Text(caption!, textAlign: TextAlign.center, maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600)),
            )),
          if (badge != null)
            Positioned(left: 4, bottom: 4, child: DecoratedBox(
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(8), border: Border.all(color: Colors.white, width: 1.5)),
              child: SiteIcon(badge!, size: 22, round: false),
            )),
        ]),
      ),
    );
  }
}

/// Round dark button used for play / share / pause.
class RoundBtn extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback? onTap;
  final double size;
  const RoundBtn({super.key, required this.icon, required this.tooltip, required this.onTap, this.size = 40});
  @override
  Widget build(BuildContext context) {
    final p = Pal.of(context);
    return Tooltip(
      message: tooltip,
      child: Material(
        color: p.cardAlt, shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(), onTap: onTap,
          child: SizedBox(width: size, height: size,
              child: Icon(icon, size: size * 0.52, color: onTap == null ? p.sub.withOpacity(0.4) : p.text)),
        ),
      ),
    );
  }
}

/// Rounded card used by every list item.
class AppCard extends StatelessWidget {
  final Widget child;
  final EdgeInsets padding;
  final VoidCallback? onLongPress;
  const AppCard({super.key, required this.child, this.padding = const EdgeInsets.all(12), this.onLongPress});
  @override
  Widget build(BuildContext context) {
    final p = Pal.of(context);
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(color: p.card, borderRadius: BorderRadius.circular(22)),
      child: Material(
        color: Colors.transparent,
        child: InkWell(borderRadius: BorderRadius.circular(22), onLongPress: onLongPress, child: Padding(padding: padding, child: child)),
      ),
    );
  }
}

Future<void> shareFile(BuildContext context, String path) async {
  final msg = ScaffoldMessenger.of(context);
  try {
    await Share.shareXFiles([XFile(path)]);
  } catch (e) {
    msg.showSnackBar(SnackBar(content: Text('Could not share: $e')));
  }
}

String fileExt(String name) {
  final i = name.lastIndexOf('.');
  return i < 0 || i == name.length - 1 ? '' : name.substring(i + 1).toUpperCase();
}

String fmtEta(int s) {
  if (s <= 0) return '';
  final m = s ~/ 60, r = s % 60;
  return m > 0 ? '${m}m ${r}s left' : '${r}s left';
}
