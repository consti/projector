'use strict';
const { spawn } = require('child_process');
const fs = require('fs');

const CANDIDATES = ['/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp'];
const MAX_ITEMS = 500;

function binPath() {
  for (const c of CANDIDATES) if (fs.existsSync(c)) return c;
  return 'yt-dlp';
}

function run(args, timeout = 90000) {
  return new Promise((resolve, reject) => {
    const p = spawn(binPath(), args, {
      env: { ...process.env, PATH: '/opt/homebrew/bin:' + process.env.PATH },
    });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('yt-dlp timed out')); }, timeout);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().split('\n').slice(-3).join(' ') || 'yt-dlp exited ' + code));
    });
  });
}

exports.available = async function () {
  try { return (await run(['--version'], 8000)).trim(); } catch { return null; }
};

const watchUrl = (id) => 'https://www.youtube.com/watch?v=' + id;

function isVideo(e) {
  if (!e) return false;
  if (e._type === 'playlist' || e.ie_key === 'YoutubeTab') return false;
  return !!(e.id || e.url);
}

function toItem(e, fallbackUrl) {
  const id = e.id;
  let url = e.webpage_url || e.url || (id ? watchUrl(id) : fallbackUrl);
  // flat playlists sometimes give a bare id in `url`
  if (url && !/^https?:\/\//.test(url)) url = watchUrl(url);
  return {
    kind: 'youtube',
    id: id || url,
    title: e.title || id || 'Untitled',
    url,
    duration: Number(e.duration) || 0,
    uploader: e.uploader || e.channel || null,
    thumbnail: e.thumbnail || (e.thumbnails && e.thumbnails[e.thumbnails.length - 1]?.url) || null,
    unavailable: e.availability && e.availability !== 'public' && e.availability !== 'unlisted'
      ? e.availability : null,
  };
}

// Walk a flat-playlist tree, gathering videos and any nested playlists
// (a channel URL comes back as tabs: Videos / Shorts / Live).
function walk(node, videos, nested) {
  if (!node) return;
  if (Array.isArray(node.entries)) {
    for (const e of node.entries) {
      if (e && (e._type === 'playlist' || e.ie_key === 'YoutubeTab') && !Array.isArray(e.entries)) {
        nested.push(e);
      } else if (Array.isArray(e?.entries)) {
        walk(e, videos, nested);
      } else if (isVideo(e)) {
        videos.push(e);
      }
    }
    return;
  }
  if (isVideo(node)) videos.push(node);
}

async function probeRaw(url, timeout) {
  return JSON.parse(await run([
    '-J', '--flat-playlist', '--no-warnings', '--ignore-errors',
    '--playlist-end', String(MAX_ITEMS), url,
  ], timeout));
}

// Enumerate a URL: single video, playlist, or channel.
exports.probe = async function (url) {
  const j = await probeRaw(url, 180000);
  const videos = [], nested = [];
  walk(j, videos, nested);

  // channel root: follow its tabs until we find videos
  if (!videos.length && nested.length) {
    for (const n of nested.slice(0, 3)) {
      const nurl = n.webpage_url || n.url;
      if (!nurl) continue;
      try {
        const sub = await probeRaw(nurl, 180000);
        const sv = [], sn = [];
        walk(sub, sv, sn);
        videos.push(...sv);
        if (videos.length) break;
      } catch { /* try the next tab */ }
    }
  }

  const seen = new Set();
  const items = [];
  for (const v of videos) {
    const it = toItem(v, url);
    if (it.unavailable) continue;
    const key = it.id || it.url;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(it);
    if (items.length >= MAX_ITEMS) break;
  }

  const isList = j._type === 'playlist' || items.length > 1;
  return {
    playlist: isList ? (j.title || j.playlist_title || 'Playlist') : null,
    truncated: videos.length >= MAX_ITEMS,
    items,
  };
};

// Direct playable URLs. Split video+audio when possible (higher quality ceiling).
// A second, small video-only copy fetched in the same call. The control
// window's preview is a few hundred pixels wide, so pulling a second 1080p
// stream for it just to shrink it steals bandwidth from the projector.
const PREVIEW = ',bv*[height<=480][vcodec^=avc1][protocol^=http]';

exports.resolve = async function (url, maxHeight) {
  const h = maxHeight || 1080;
  const selectors = [
    'bv*[height<=' + h + '][vcodec^=avc1][protocol^=http]+ba[acodec^=mp4a][protocol^=http]' + PREVIEW,
    'bv*[height<=' + h + '][vcodec^=avc1][protocol^=http]+ba[acodec^=mp4a][protocol^=http]',
    'bv*[height<=' + h + '][ext=mp4][protocol^=http]+ba[ext=m4a][protocol^=http]',
    'b[height<=' + h + '][ext=mp4][protocol^=http]',
    'b[height<=' + h + '][protocol^=http]',
    'b',
  ];
  let lastErr;
  for (const f of selectors) {
    try {
      const out = await run([
        '-f', f, '--no-warnings', '--no-playlist',
        '--print', '%(title)s', '--print', '%(duration)s', '--print', '%(height)s',
        '--print', 'urls', url,
      ]);
      const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
      const urls = lines.filter((l) => /^https?:\/\//.test(l));
      const meta = lines.filter((l) => !/^https?:\/\//.test(l));
      if (!urls.length) throw new Error('no urls returned');
      // with the preview selector the print order is video, audio, preview
      const wantsPreview = f.includes(PREVIEW);
      return {
        videoUrl: urls[0],
        audioUrl: urls[1] || null,
        previewUrl: wantsPreview && urls.length > 2 ? urls[2] : null,
        title: meta[0] || 'YouTube video',
        duration: Number(meta[1]) || 0,
        height: Number(meta[2]) || 0,
        selector: f,
        expires: Date.now() + 3 * 3600 * 1000,
      };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('could not resolve stream');
};
