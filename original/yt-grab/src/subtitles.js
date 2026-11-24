// Subtitle download: saves a YouTube (or other site) subtitle file into the program's downloads folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const history = require('./history');
const config = require('./config');
const { AppError, fromYtDlp } = require('./errors');
const { baseFlags, validateUrl, ytdlp } = require('./youtube');

const LANG_RE = /^[A-Za-z0-9_-]{2,30}$/;
const FORMATS = ['srt', 'vtt'];

/** Download one subtitle track. Returns { file, dir }. Nothing of the video itself is downloaded. */
async function downloadSubtitles(rawUrl, lang, auto, format, title) {
  const url = await validateUrl(rawUrl);
  if (!LANG_RE.test(String(lang || ''))) throw new AppError('Unknown subtitle language.', 400, 'BAD_LANG');
  const fmt = FORMATS.includes(format) ? format : 'srt';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ytgrab-sub-'));
  try {
    try {
      await ytdlp(url, {
        ...baseFlags(),
        skipDownload: true,
        writeSubs: !auto,
        writeAutoSubs: !!auto,
        subLangs: lang,
        subFormat: 'vtt/best',
        convertSubs: fmt,
        output: path.join(tmp, 'sub.%(ext)s'),
        retries: 3,
      });
    } catch (e) {
      throw fromYtDlp(e);
    }
    const made = fs.readdirSync(tmp).find((f) => f.toLowerCase().endsWith(`.${fmt}`));
    if (!made) throw new AppError('This subtitle could not be downloaded. Try another language, or try again in a minute.', 404, 'NO_SUBTITLE');

    fs.mkdirSync(config.DOWNLOAD_DIR, { recursive: true });
    const base = String(title || '').replace(/[^\w\s.-]/g, '').trim().slice(0, 80) || 'video';
    let name = `${base} (${lang}).${fmt}`;
    for (let n = 2; fs.existsSync(path.join(config.DOWNLOAD_DIR, name)); n++) name = `${base} (${lang} ${n}).${fmt}`;
    fs.copyFileSync(path.join(tmp, made), path.join(config.DOWNLOAD_DIR, name));
    const dest = path.join(config.DOWNLOAD_DIR, name);
    history.add({ id: `s${crypto.randomBytes(6).toString('hex')}`, type: 'subtitle', title: name, file: name, path: dest, bytes: fs.statSync(dest).size, url });
    return { file: name, dir: config.DOWNLOAD_DIR };
  } finally {
    fs.rm(tmp, { recursive: true, force: true }, () => {});
  }
}

module.exports = { downloadSubtitles };
