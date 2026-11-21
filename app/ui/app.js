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
  Save screenshot…   a picture of the C64 screen (needs the character ROM)
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
  if (!$('screen').classList.contains('has-image')) {
    $('screen-msg').textContent = on ? 'Running. Type on the C64, or press F1 and talk.' : 'Press Start, then type on the C64 or press F1 to talk.';
  }
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

$('btn-snap').onclick = async () => {
  const r = await window.buddy.snapshot();
  if (r.canceled) return;
  if (!r.ok) { $('foot-msg').textContent = r.detail; return; }
  const s = $('screen');
  s.classList.add('has-image');
  s.innerHTML = '';
  const img = document.createElement('img');
  img.src = r.image;
  img.alt = 'C64 screen';
  s.append(img);
  $('foot-msg').textContent = `Saved ${r.detail}`;
};

// ---------- start ----------

refresh().then(() => show(cfg.setupDone && cfg.host && cfg.hasKey ? 'main' : 'setup'));
