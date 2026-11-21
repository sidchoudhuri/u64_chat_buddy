// Chat Buddy (the live view from Viz)
// Copyright (C) 2026 Sid Choudhuri (m0nde). GNU GPL v3 or later: see LICENSE.
//
// Live view: the Ultimate 64's own video stream (Ultimate docs, "Data Streams"), received here
// and passed to the window. Chat Buddy asks the Ultimate (REST
// PUT /v1/streams/video:start?ip=<this computer>:<port>) to send the VIC's picture over UDP:
// each datagram is a 12-byte header (sequence, frame, line - bit 15 set on a frame's last
// packet - pixels per line 384, lines per packet 4, bits per pixel 4, encoding 0, all little
// endian) and 4 lines of 384 pixels, 4-bit VIC colours two to a byte, low nibble first.
// PAL frames are 384 x 272, NTSC 384 x 240.

const dgram = require('dgram');
const http = require('http');

const PORT = 11000;            // the Ultimate's default video port
const W = 384, LINE_BYTES = W / 2, MAX_LINES = 272;
const SEND_EVERY_MS = 40;      // to the window at up to 25 frames a second

let sock = null, ultimate = null, send = () => {}, timer = null, lastSent = 0, gotPacket = false;
let frame = Buffer.alloc(LINE_BYTES * MAX_LINES), height = 0;

// the address this computer uses to reach the Ultimate (so the Ultimate knows where to send)
function localAddressFor(ip) {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    s.on('error', e => { s.close(); reject(e); });
    s.connect(PORT, ip, () => { const a = s.address().address; s.close(); resolve(a); });
  });
}

// "192.168.1.64" or "192.168.1.64:8080" (Chat Buddy lets you type a port)
const hostOnly = ip => String(ip).replace(/:\d+$/, '');
const httpPort = ip => Number((String(ip).match(/:(\d+)$/) || [])[1]) || 80;

function rest(ip, path) {
  return new Promise(resolve => {
    const req = http.request({ host: hostOnly(ip), port: httpPort(ip), path, method: 'PUT', timeout: 4000 }, res => { res.resume(); resolve(res.statusCode === 200); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end();
  });
}

function onPacket(msg) {
  if (msg.length < 12 + 4 * LINE_BYTES) return;
  const lineWord = msg.readUInt16LE(4), perLine = msg.readUInt16LE(6), lines = msg[8], bpp = msg[9], enc = msg.readUInt16LE(10);
  if (perLine !== W || bpp !== 4 || enc !== 0) return;          // a format this doesn't know
  gotPacket = true;
  const line = lineWord & 0x7fff;
  for (let i = 0; i < lines; i++) {
    const y = line + i;
    if (y < MAX_LINES) msg.copy(frame, y * LINE_BYTES, 12 + i * LINE_BYTES, 12 + (i + 1) * LINE_BYTES);
  }
  height = Math.max(height, Math.min(MAX_LINES, line + lines));
  if (lineWord & 0x8000) {                                       // the frame's last packet
    const now = Date.now();
    if (now - lastSent >= SEND_EVERY_MS) {
      lastSent = now;
      send('live:frame', { w: W, h: height, data: Buffer.from(frame.subarray(0, LINE_BYTES * height)) });
    }
    height = 0;
  }
}

async function start(ip, sendFn) {
  await stop();
  send = sendFn;
  ip = String(ip || '').trim();
  if (!ip) return { ok: false, error: 'Type the Ultimate\'s IP address first.' };
  let me;
  try { me = await localAddressFor(hostOnly(ip)); } catch (e) { return { ok: false, error: `Can't reach ${ip} from this computer.` }; }
  sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const bound = await new Promise(resolve => {
    sock.once('error', () => resolve(false));
    sock.bind(PORT, () => resolve(true));
  });
  if (!bound) { sock.close(); sock = null; return { ok: false, error: `UDP port ${PORT} is in use by another program (Viz\'s live view, or another stream viewer?).` }; }
  sock.on('message', onPacket);
  sock.on('error', () => {});
  ultimate = ip; gotPacket = false;
  const ok = await rest(ip, `/v1/streams/video:start?ip=${encodeURIComponent(`${me}:${PORT}`)}`);
  if (!ok) { await stop(); return { ok: false, error: 'The Ultimate didn\'t start its video stream (an Ultimate 64 board is needed, with firmware 3.11 or later).' }; }
  send('live:status', { state: 'waiting', to: `${me}:${PORT}` });
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (sock && !gotPacket) send('live:status', { state: 'nothing',
      message: 'No picture arrived. The Ultimate streams over wired Ethernet only, and your firewall must let Chat Buddy receive on UDP port 11000.' });
  }, 3000);
  return { ok: true, to: `${me}:${PORT}` };
}

async function stop() {
  clearTimeout(timer);
  const ip = ultimate, s = sock;
  sock = null; ultimate = null;
  if (s) { try { s.close(); } catch (e) { /* closed already */ } }
  if (ip) await rest(ip, '/v1/streams/video:stop');
}

module.exports = { start, stop };
