// Chat Buddy: the window.
// Copyright (C) 2026 Sid Choudhuri (m0nde). GNU GPL v3 or later: see LICENSE.

const $ = id => document.getElementById(id);
let cfg = {};
let running = false;
let c64Ok = null;

const HELP = `Chat Buddy — the C64 talking face that chats through ChatGPT

usage:  Setup   your Ultimate's IP, your OpenAI key
        Start   loads the face on the C64 and starts listening

on the C64:
  type        ask a question, RETURN to send
  F1          mic mode on/off: just talk (needs a microphone)
  F3          music mode on/off: the face listens along and comments

in the app:
  Live view          the C64's screen, from the Ultimate's video stream
                     (wired Ethernet, UDP port 11000)
  Save screenshot…   saves what the live view shows
  Help > Check for Updates…`;

function show(view) {
  for (const v of ['setup', 'main', 'help', 'discord']) $(v).hidden = v !== view;
}

function setStatus(el, ok, label) {
  el.classList.toggle('ok', ok === true);
  el.classList.toggle('bad', ok === false);
  if (label) el.textContent = label;
}

function stepState(el, text, kind) {
  el.textContent = text;
  el.className = `state ${kind}`;
}

function setupStates() {
  stepState($('c64-state'), cfg.host ? (c64Ok === false ? 'not answering' : c64Ok ? 'connected' : 'not tested') : 'needed',
    cfg.host ? (c64Ok === false ? 'bad-t' : c64Ok ? 'ok-t' : 'miss-t') : 'miss-t');
  stepState($('ai-state'), cfg.hasKey ? 'saved' : 'needed', cfg.hasKey ? 'ok-t' : 'miss-t');
  stepState($('rom-state'), cfg.chargen ? 'found' : 'not set', cfg.chargen ? 'ok-t' : 'dim');
  $('rom-path').textContent = cfg.chargen || '';
  // highlight the first step still to do
  const todo = !cfg.host || c64Ok === false ? 'step-c64' : !cfg.hasKey ? 'step-ai' : null;
  for (const id of ['step-c64', 'step-ai', 'step-face', 'step-rom']) $(id).classList.toggle('now', id === todo);
  $('btn-done').disabled = !(cfg.host && cfg.hasKey);
}

function topStatus() {
  setStatus($('st-c64'), running ? c64Ok : (cfg.host ? null : false), 'C64');
  setStatus($('st-ai'), cfg.hasKey ? true : false, 'OpenAI');
  $('st-discord').hidden = !cfg.discord?.enabled;
  $('host-label').textContent = cfg.host || '';
}

async function refresh() {
  cfg = await window.buddy.settings();
  $('version').textContent = cfg.version;
  $('host').value = cfg.host || '';
  $('load-face').checked = cfg.loadFace !== false;
  $('live-on').checked = cfg.live !== false;
  $('heroku-app').value = cfg.discord?.app || 'lexi-persimmons';
  $('discord-on').checked = Boolean(cfg.discord?.enabled);
  setStatus($('discord-state'), cfg.hasDiscordUrl ? true : null, cfg.hasDiscordUrl ? 'Database address saved' : 'No database address yet');
  setupStates();
  topStatus();
}

// ---------- setup ----------

async function testHost() {
  const host = $('host').value.trim();
  if (!host) return;
  await window.buddy.saveSettings({ host });
  stepState($('c64-state'), 'testing…', 'dim');
  const r = await window.buddy.testUltimate(host);
  c64Ok = r.ok;
  await refresh();
  if (!r.ok) stepState($('c64-state'), r.detail || 'not answering', 'bad-t');
}

$('btn-test').onclick = testHost;
$('host').addEventListener('keydown', e => { if (e.key === 'Enter') testHost(); });
$('host').addEventListener('change', () => { c64Ok = null; });

async function saveKey() {
  const key = $('key').value.trim();
  if (!key) return;
  await window.buddy.saveKey(key);
  $('key').value = '';
  await refresh();
}
$('btn-key').onclick = saveKey;
$('key').addEventListener('keydown', e => { if (e.key === 'Enter') saveKey(); });

$('load-face').onchange = () => window.buddy.saveSettings({ loadFace: $('load-face').checked });

$('btn-find').onclick = async () => {
  stepState($('rom-state'), 'looking…', 'dim');
  const f = await window.buddy.findChargen();
  if (f) { await window.buddy.saveSettings({ chargen: f }); await refresh(); }
  else stepState($('rom-state'), 'not found: is VICE installed? Or use Choose file…', 'miss-t');
};
$('btn-pick').onclick = async () => {
  const f = await window.buddy.pickChargen();
  if (f?.error) return stepState($('rom-state'), f.error, 'bad-t');
  if (f) { await window.buddy.saveSettings({ chargen: f }); await refresh(); }
};

$('btn-done').onclick = async () => {
  await window.buddy.saveSettings({ host: $('host').value.trim(), setupDone: true });
  await refresh();
  show('main');
};
$('btn-setup').onclick = () => { if (!running) show('setup'); };

// ---------- help, links ----------

$('help-text').textContent = HELP;
$('btn-help').onclick = () => show($('help').hidden ? 'help' : cfg.setupDone ? 'main' : 'setup');
$('btn-help-close').onclick = () => show(cfg.setupDone ? 'main' : 'setup');
document.addEventListener('click', e => {
  const a = e.target.closest('a.ext');
  if (a) { e.preventDefault(); window.buddy.openExternal(a.href); }
});

// ---------- Discord bridge (owner only: Ctrl/Cmd+Shift+D) ----------

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); refresh(); show('discord'); }
});
$('discord-on').onchange = () => window.buddy.saveSettings({ discord: { ...cfg.discord, enabled: $('discord-on').checked } }).then(refresh);
$('btn-heroku').onclick = async () => {
  const app = $('heroku-app').value.trim() || 'lexi-persimmons';
  await window.buddy.saveSettings({ discord: { ...cfg.discord, app } });
  setStatus($('discord-state'), null, 'Asking Heroku…');
  const r = await window.buddy.herokuUrl(app);
  await refresh();
  if (!r.ok) setStatus($('discord-state'), false, r.detail);
};
$('btn-discord-url').onclick = async () => {
  const url = $('discord-url').value.trim();
  if (!url) return;
  await window.buddy.saveDiscordUrl(url);
  $('discord-url').value = '';
  await refresh();
};
$('btn-discord-close').onclick = () => show(cfg.setupDone ? 'main' : 'setup');

// ---------- running ----------

function addMessage(who, text) {
  const box = $('convo');
  if (box.querySelector('p')) box.innerHTML = '';
  const m = document.createElement('div');
  m.className = `msg ${who}`;
  const label = document.createElement('span');
  label.className = 'who';
  label.textContent = who === 'you' ? 'You' : 'C64';
  m.append(label, document.createTextNode(text));
  box.append(m);
  box.scrollTop = box.scrollHeight;
}

function addLog(text) {
  const log = $('log');
  log.textContent = (log.textContent + text + '\n').split('\n').slice(-300).join('\n');
  log.scrollTop = log.scrollHeight;
}

function setRunning(on) {
  running = on;
  $('btn-start').textContent = on ? 'Stop' : 'Start';
  $('btn-start').classList.toggle('primary', !on);
  $('btn-start').classList.toggle('stop', on);
  $('btn-setup').disabled = on;
  if (!on) { c64Ok = null; for (const id of ['m-kbd', 'm-mic', 'm-music', 'm-speak']) $(id).classList.remove('on'); }
  $('foot-msg').textContent = on ? 'Running: type on the C64, or press F1 to talk.' : '';
  if (on) { if (cfg.live !== false) liveStart(); else screenMsg('Live view is off: switch it on above.'); }
  else screenOff('Press Start, then type on the C64 or press F1 to talk.');
  topStatus();
}

window.buddy.on('engine:running', setRunning);
window.buddy.on('engine:event', ev => {
  if (ev.type === 'status') {
    c64Ok = ev.c64;
    $('m-kbd').classList.toggle('on', ev.c64 && !ev.mic);
    $('m-mic').classList.toggle('on', Boolean(ev.mic));
    $('m-music').classList.toggle('on', Boolean(ev.music));
    $('m-speak').classList.toggle('on', Boolean(ev.speaking));
    setStatus($('st-discord'), ev.discord ? true : null, 'Lexi');
    topStatus();
    return;
  }
  if (ev.type !== 'log') return;
  const t = ev.text;
  addLog(t);
  if (t.startsWith('> ')) addMessage('you', t.slice(2));
  else if (t.startsWith('< ')) addMessage('c64', t.slice(2));
  else if (/OPENAI_API_KEY not set/.test(t)) $('foot-msg').textContent = 'No OpenAI key: add it in Setup.';
});

$('btn-start').onclick = async () => {
  if (running) return window.buddy.stop();
  $('log').textContent = '';
  await window.buddy.start();
};

// ---------- the C64's screen: the Ultimate's live video (as in Viz), or drawn from screen memory ----------

// the C64's 16 colours (the same palette as Viz's live view)
const PAL = [[0x00,0x00,0x00],[0xff,0xff,0xff],[0x8c,0x32,0x3d],[0x66,0xbf,0xb3],[0x8e,0x36,0xa1],[0x4a,0xa6,0x48],[0x32,0x2d,0xab],[0xcd,0xd2,0x56],
             [0x8f,0x50,0x1a],[0x53,0x3d,0x01],[0xbd,0x63,0x6e],[0x4e,0x4e,0x4e],[0x76,0x76,0x76],[0x8c,0xe9,0x8b],[0x6b,0x66,0xe4],[0xa3,0xa3,0xa3]];
const canvas = $('live-canvas'), ctx = canvas.getContext('2d');
let image = null, liveOn = false, memOn = false;

function screenMsg(text, offerFallback = false) {
  $('screen').classList.remove('has-image');
  canvas.hidden = true;
  $('mem-img').hidden = true;
  $('screen-box').hidden = false;
  $('screen-msg').textContent = text;
  $('btn-fallback').hidden = !offerFallback;
}

function showPicture(el) {
  $('screen').classList.add('has-image');
  $('screen-box').hidden = true;
  canvas.hidden = el !== canvas;
  $('mem-img').hidden = el !== $('mem-img');
}

async function liveStart() {
  if (liveOn || memOn) return;
  liveOn = true;
  screenMsg('Asking the Ultimate for its picture…');
  const r = await window.buddy.liveStart();
  if (!r || !r.ok) {
    liveOn = false;
    screenMsg(`${(r && r.error) || "The live view didn't start."}\n\nDraw the screen from the C64's screen memory instead? It's less smooth.`, true);
  }
}

async function screenOff(msg) {
  if (liveOn) { liveOn = false; await window.buddy.liveStop(); }
  if (memOn) { memOn = false; await window.buddy.screenStop(); }
  screenMsg(msg);
}

window.buddy.on('live:status', st => {
  if (!liveOn) return;
  if (st.state === 'waiting') screenMsg('Waiting for the picture…');
  if (st.state === 'nothing') screenMsg(`${st.message}\n\nDraw the screen from the C64's screen memory instead? It's less smooth.`, true);
});

window.buddy.on('live:frame', f => {
  if (!liveOn) return;
  const bytes = new Uint8Array(f.data.buffer || f.data, f.data.byteOffset || 0, f.data.byteLength || f.data.length);
  if (canvas.width !== f.w || canvas.height !== f.h || !image) { canvas.width = f.w; canvas.height = f.h; image = ctx.createImageData(f.w, f.h); }
  const px = image.data;
  for (let i = 0, o = 0; i < bytes.length; i++, o += 8) {
    const lo = PAL[bytes[i] & 15], hi = PAL[bytes[i] >> 4];   // two pixels a byte, low nibble first
    px[o] = lo[0]; px[o + 1] = lo[1]; px[o + 2] = lo[2]; px[o + 3] = 255;
    px[o + 4] = hi[0]; px[o + 5] = hi[1]; px[o + 6] = hi[2]; px[o + 7] = 255;
  }
  ctx.putImageData(image, 0, 0);
  showPicture(canvas);
});

$('btn-fallback').onclick = async () => {
  if (liveOn) { liveOn = false; await window.buddy.liveStop(); }
  const r = await window.buddy.screenStart();
  if (!r.ok) return screenMsg(r.error);
  memOn = true;
  screenMsg('Drawing the screen from memory…');
};

window.buddy.on('screen:frame', ev => {
  if (!memOn) return;
  if (ev.png) { $('mem-img').src = `data:image/png;base64,${ev.png}`; showPicture($('mem-img')); }
  else if (ev.error) screenMsg(ev.error);
  else if (ev.type === 'result' && !ev.ok) { memOn = false; screenMsg(ev.detail); }
});

$('live-on').onchange = async () => {
  const on = $('live-on').checked;
  await window.buddy.saveSettings({ live: on });
  cfg.live = on;
  if (!running) return;
  if (on) liveStart();
  else screenOff('Live view is off: switch it on above.');
};

// Save screenshot: the picture on screen if there is one, otherwise the engine draws one.
$('btn-snap').onclick = async () => {
  let r;
  if (!canvas.hidden) {
    const big = document.createElement('canvas');
    big.width = canvas.width * 2; big.height = canvas.height * 2;
    const bctx = big.getContext('2d');
    bctx.imageSmoothingEnabled = false;
    bctx.drawImage(canvas, 0, 0, big.width, big.height);
    r = await window.buddy.savePng(big.toDataURL('image/png'));
  } else if (!$('mem-img').hidden) {
    r = await window.buddy.savePng($('mem-img').src);
  } else {
    r = await window.buddy.snapshot();
    if (r.ok && r.image && !running) { $('mem-img').src = r.image; showPicture($('mem-img')); }
  }
  if (r.canceled) return;
  $('foot-msg').textContent = r.ok ? `Saved ${r.detail}` : r.detail;
};

// ---------- start ----------

refresh().then(() => show(cfg.setupDone && cfg.host && cfg.hasKey ? 'main' : 'setup'));
