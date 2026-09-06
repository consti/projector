'use strict';
// The phone side of "people push the effects": a small HTTPS + WebSocket
// server on the LAN that serves the remote page (src/remote) and relays the
// pose packets the phone sends back. Browsers only open a camera on a secure
// origin, so a self-signed certificate is generated with the system openssl on
// first use and kept next to the session file.
//
// No dependencies: the WebSocket framing is the handful of lines RFC 6455
// needs for small text messages, which is all this carries.

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { EventEmitter } = require('events');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// A tiny network-first service worker so the remote installs to the home screen
// and launches even before the LAN reconnects. It never caches the models/wasm.
const SERVICE_WORKER = `const C='pj-shell-v5';
const SHELL=['/','/remote/tw.css','/remote/remote.mjs','/shared/pose.mjs','/manifest.webmanifest'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(SHELL).catch(()=>{})))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.map(k=>k!==C&&caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);
if(e.request.method!=='GET'||u.pathname==='/ws'||u.pathname.startsWith('/models')||u.pathname==='/info.json')return;
e.respondWith(fetch(e.request).then(r=>{if(r&&r.ok&&u.origin===location.origin){const cl=r.clone();caches.open(C).then(c=>c.put(e.request,cl))}return r}).catch(()=>caches.match(e.request).then(m=>m||caches.match('/'))))});`;
const MAX_FRAME = 256 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.tflite': 'application/octet-stream',
  '.map': 'application/json', '.ico': 'image/x-icon',
};

/** LAN addresses worth showing, Wi-Fi/Ethernet first, link-local and virtual last. */
function lanAddresses() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifs)) {
    for (const a of list || []) {
      if (a.internal || a.family !== 'IPv4') continue;
      if (a.address.startsWith('169.254.')) continue;
      const rank = /^en\d/.test(name) ? 0 : /^(bridge|vmnet|utun|docker|veth)/.test(name) ? 2 : 1;
      out.push({ name, address: a.address, rank });
    }
  }
  out.sort((x, y) => x.rank - y.rank || x.name.localeCompare(y.name));
  return out.map((x) => x.address);
}

function ensureCert(dir) {
  const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
  if (fs.existsSync(key) && fs.existsSync(cert)) {
    return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
  }
  fs.mkdirSync(dir, { recursive: true });
  const san = ['DNS:localhost', 'DNS:projector.local', 'IP:127.0.0.1', ...lanAddresses().map((a) => 'IP:' + a)].join(',');
  const base = ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3650',
    '-keyout', key, '-out', cert, '-subj', '/CN=Projector/O=Projector remote'];
  const candidates = ['/usr/bin/openssl', 'openssl', '/opt/homebrew/bin/openssl', '/usr/local/bin/openssl'];
  let lastErr = null;
  for (const bin of candidates) {
    for (const args of [[...base, '-addext', 'subjectAltName=' + san], base]) {
      try {
        execFileSync(bin, args, { stdio: 'ignore', timeout: 20000 });
        return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
      } catch (e) { lastErr = e; }
    }
  }
  throw new Error('could not create a certificate (openssl missing?): ' + (lastErr && lastErr.message));
}

class RemoteServer extends EventEmitter {
  /**
   * @param {object} o { root: src dir, assets: assets dir, certDir, port }
   */
  constructor(o) {
    super();
    this.root = o.root;
    this.assets = o.assets;
    this.certDir = o.certDir;
    this.port = o.port || 9223;
    this.server = null;
    this.secure = false;
    this.clients = new Map();       // id -> { socket, ip, ua, name, buf, frags, fragOp, alive }
    this.nextId = 1;
    this.error = null;
  }

  get running() { return !!this.server; }

  urls() {
    const scheme = this.secure ? 'https' : 'http';
    return lanAddresses().map((a) => `${scheme}://${a}:${this.port}`);
  }

  info() {
    return {
      running: this.running, port: this.port, secure: this.secure, urls: this.urls(),
      error: this.error, models: this.hasModels(),
      clients: [...this.clients.entries()].map(([id, c]) => ({ id, ip: c.ip, ua: c.ua, name: c.name, tracking: !!c.tracking })),
    };
  }

  hasModels() {
    try { return fs.existsSync(path.join(this.assets, 'mediapipe', 'vision_bundle.mjs')); } catch { return false; }
  }

  start() {
    if (this.server) return Promise.resolve(this.info());
    if (this.starting) return this.starting;      // a concurrent start() is already binding the port
    this.error = null;
    const handler = (req, res) => this._http(req, res);
    let srv;
    try {
      const tls = ensureCert(this.certDir);
      srv = https.createServer({ key: tls.key, cert: tls.cert }, handler);
      this.secure = true;
    } catch (e) {
      // no openssl: still serve, but the phone will refuse to open its camera
      console.log('[remote]', e.message, '- falling back to plain http');
      this.error = 'No certificate: served over http, so phones will not allow camera access. ' + e.message;
      srv = http.createServer(handler);
      this.secure = false;
    }
    srv.on('upgrade', (req, socket) => this._upgrade(req, socket));
    srv.on('error', (e) => {
      this.error = e.code === 'EADDRINUSE' ? `Port ${this.port} is in use` : e.message;
      console.log('[remote] server error', e.message);
      this.server = null;
      this.starting = null;
      this.emit('change');
    });
    this.starting = new Promise((resolve) => {
      srv.listen(this.port, '0.0.0.0', () => {
        this.server = srv;
        this.starting = null;
        console.log('[remote] listening on', this.urls().join(' '));
        this.emit('change');
        resolve(this.info());
      });
    });
    return this.starting;
  }

  stop() {
    if (!this.server) return;
    for (const c of this.clients.values()) { try { c.socket.destroy(); } catch {} }
    this.clients.clear();
    try { this.server.close(); } catch {}
    this.server = null;
    this.emit('change');
  }

  // ------------------------------------------------------------- http ----
  _http(req, res) {
    const u = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(u.pathname);
    if (rel === '/info.json') {
      res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
      res.end(JSON.stringify({ models: this.hasModels(), secure: this.secure }));
      return;
    }
    // --- PWA: manifest, service worker, home-screen icons ---
    if (rel === '/manifest.webmanifest') {
      res.writeHead(200, { 'content-type': 'application/manifest+json', 'cache-control': 'no-cache' });
      res.end(JSON.stringify({
        name: 'Projector Remote', short_name: 'Projector', start_url: '/', scope: '/',
        display: 'standalone', orientation: 'any', background_color: '#06070b', theme_color: '#07080c',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      }));
      return;
    }
    if (rel === '/sw.js') {
      res.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-cache', 'service-worker-allowed': '/' });
      res.end(SERVICE_WORKER);
      return;
    }
    if (/^\/icon(-\d+)?\.png$/.test(rel)) {
      const icon = path.join(this.assets, '..', 'build', 'icon-1024.png');
      fs.stat(icon, (err, st) => {
        if (err) { res.writeHead(404); res.end('no icon'); return; }
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': st.size, 'cache-control': 'public, max-age=86400' });
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(icon).pipe(res);
      });
      return;
    }
    let base;
    if (rel === '/' || rel === '/index.html') { base = path.join(this.root, 'remote'); rel = '/index.html'; }
    else if (rel.startsWith('/remote/')) { base = path.join(this.root, 'remote'); rel = rel.slice('/remote'.length); }
    else if (rel.startsWith('/shared/')) { base = path.join(this.root, 'shared'); rel = rel.slice('/shared'.length); }
    else if (rel.startsWith('/models/')) { base = path.join(this.assets, 'mediapipe'); rel = rel.slice('/models'.length); }
    else { res.writeHead(404); res.end('not found'); return; }
    const file = path.normalize(path.join(base, rel));
    if (!file.startsWith(base)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      // the big wasm and model files may be cached; the page itself must not be
      const cache = /\.(wasm|task|tflite)$/.test(file) ? 'public, max-age=604800' : 'no-cache';
      res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'cache-control': cache });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file).pipe(res);
    });
  }

  // -------------------------------------------------------- websocket ----
  _upgrade(req, socket) {
    const key = req.headers['sec-websocket-key'];
    if (!key || !/websocket/i.test(req.headers.upgrade || '')) { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    socket.setNoDelay(true);

    const id = this.nextId++;
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const c = { socket, ip, ua: shortUA(req.headers['user-agent'] || ''), name: '', buf: Buffer.alloc(0), frags: [], fragOp: 0, alive: true, tracking: false };
    this.clients.set(id, c);
    socket.on('data', (d) => this._data(id, c, d));
    const gone = () => {
      if (!this.clients.has(id)) return;
      this.clients.delete(id);
      this.emit('close', id);
      this.emit('change');
    };
    socket.on('close', gone);
    socket.on('error', gone);
    socket.on('end', gone);
    this.emit('open', id, { ip: c.ip, ua: c.ua });
    this.emit('change');
  }

  _data(id, c, d) {
    c.buf = c.buf.length ? Buffer.concat([c.buf, d]) : d;
    for (;;) {
      const b = c.buf;
      if (b.length < 2) return;
      const fin = !!(b[0] & 0x80), op = b[0] & 0x0f, masked = !!(b[1] & 0x80);
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(MAX_FRAME)) { c.socket.destroy(); return; }
        len = Number(big); off = 10;
      }
      if (len > MAX_FRAME) { c.socket.destroy(); return; }
      const mask = masked ? b.subarray(off, off + 4) : null;
      if (masked) off += 4;
      if (b.length < off + len) return;
      const payload = Buffer.from(b.subarray(off, off + len));
      c.buf = b.subarray(off + len);
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];

      if (op === 0x8) { this._sendRaw(c, 0x8, payload.subarray(0, 2)); c.socket.end(); return; }
      if (op === 0x9) { this._sendRaw(c, 0xA, payload); continue; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x2 || op === 0x0) {
        if (op !== 0x0) c.fragOp = op;
        c.frags.push(payload);
        if (!fin) continue;
        const whole = c.frags.length === 1 ? c.frags[0] : Buffer.concat(c.frags);
        c.frags = [];
        if (c.fragOp === 0x1) this._text(id, c, whole.toString('utf8'));
      }
    }
  }

  _text(id, c, s) {
    let msg;
    try { msg = JSON.parse(s); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') { c.name = String(msg.name || '').slice(0, 40); this.emit('change'); }
    if (msg.t === 'pose') { const was = c.tracking; c.tracking = true; c.lastPose = Date.now(); if (!was) this.emit('change'); }
    if (msg.t === 'ping') { this.send(id, { t: 'pong', ts: msg.ts }); return; }
    this.emit('message', id, msg);
  }

  _sendRaw(c, op, payload) {
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    try { c.socket.write(Buffer.concat([head, payload])); } catch {}
  }

  /** Send a JSON message to one client, or to all when id is null. */
  send(id, msg) {
    const payload = Buffer.from(JSON.stringify(msg), 'utf8');
    if (id == null) { for (const c of this.clients.values()) this._sendRaw(c, 0x1, payload); return true; }
    const c = this.clients.get(id);
    if (!c) return false;
    this._sendRaw(c, 0x1, payload);
    return true;
  }

  /** Drop the tracking flag of phones that have gone quiet. */
  sweep() {
    const now = Date.now();
    let changed = false;
    for (const c of this.clients.values()) {
      if (c.tracking && now - (c.lastPose || 0) > 2500) { c.tracking = false; changed = true; }
    }
    if (changed) this.emit('change');
  }
}

function shortUA(ua) {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Browser';
}

module.exports = { RemoteServer, lanAddresses };
