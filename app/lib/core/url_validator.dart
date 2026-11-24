// Port of validateUrl() from original/yt-grab/src/youtube.js.
// IP literals are checked (isPrivateIp). The DNS-based check for hostnames resolving to private IPs is NOT ported yet.
import 'dart:io';
import 'config.dart';

class BadUrlException implements Exception {
  final String message;
  BadUrlException(this.message);
  @override
  String toString() => message;
}

/// Loopback / private / link-local / CGNAT literals (port of isPrivateIp()). Hostnames are not resolved here.
bool isPrivateIp(String host) {
  final a = InternetAddress.tryParse(host);
  if (a == null) return false;
  if (a.isLoopback || a.isLinkLocal || a.isMulticast) return true;
  final b = a.rawAddress;
  if (a.type == InternetAddressType.IPv4) {
    return b[0] == 0 || b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168) ||
        (b[0] == 100 && b[1] >= 64 && b[1] <= 127) || (b[0] == 169 && b[1] == 254);
  }
  if (b.every((x) => x == 0)) return true; // ::
  if ((b[0] & 0xfe) == 0xfc) return true; // fc00::/7
  final mapped = b.sublist(0, 10).every((x) => x == 0) && b[10] == 0xff && b[11] == 0xff; // ::ffff:a.b.c.d
  return mapped && isPrivateIp('${b[12]}.${b[13]}.${b[14]}.${b[15]}');
}

const _mirrors = {'fxtwitter.com', 'vxtwitter.com', 'fixupx.com', 'fixvx.com', 'twittpr.com'};

String validateUrl(String raw) {
  Uri? u = Uri.tryParse(raw.trim());
  if (u == null || !u.hasScheme || u.host.isEmpty) {
    throw BadUrlException('That doesn’t look like a valid URL.');
  }
  if (u.scheme != 'http' && u.scheme != 'https') {
    throw BadUrlException('Use a link that starts with http:// or https://');
  }
  final host = u.host.toLowerCase();
  if (AppConfig.restrictSites &&
      !AppConfig.allowedDomains.any((d) => host == d || host.endsWith('.$d'))) {
    throw BadUrlException('This site isn’t enabled.');
  }
  if (host == 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || isPrivateIp(host)) {
    throw BadUrlException('Links to local or private network addresses aren’t allowed.');
  }
  var out = u.replace(userInfo: '');
  final okEmbed = RegExp(r'^/videoembed/(\d+)').firstMatch(out.path);
  if (RegExp(r'^(?:www\.|m\.)?ok\.ru$').hasMatch(host) && okEmbed != null) {
    out = out.replace(path: '/video/${okEmbed.group(1)}');
  }
  if (_mirrors.contains(host.replaceFirst(RegExp(r'^www\.'), ''))) {
    out = out.replace(host: 'x.com');
  }
  return out.toString();
}
