// Chat Buddy
// Copyright (C) 2026 Sid Choudhuri (m0nde). GNU GPL v3 or later: see LICENSE.
//
// The Chat Buddy app: a window to set up and run the C64 talking face (chat.py / discord_bridge.py)
// without the terminal. The Python side is bundled as the "engine" (engine.py built with
// PyInstaller), so nothing else needs installing. The OpenAI key (and Lexi's database address,
// for the owner's Discord bridge) are encrypted with the system keychain via safeStorage.

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, safeStorage, shell, systemPreferences } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const updates = require('./update-main');
const live = require('./liveview-main');

const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const ICON = path.join(__dirname, 'ui', 'icon-256.png');
const SETTINGS = () => path.join(app.getPath('userData'), 'settings.json');
const SECRETS = () => path.join(app.getPath('userData'), 'secrets.json');
const DEFAULTS = { host: '', chargen: '', loadFace: true, live: true, setupDone: false, discord: { enabled: false, app: 'lexi-persimmons' } };

let win = null;
let engine = null; // the running "run" process
let screenWatch = null; // the live view's fallback (engine "watch")

// ---------- settings and secrets ----------

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const settings = () => ({ ...DEFAULTS, ...readJson(SETTINGS(), {}), discord: { ...DEFAULTS.discord, ...(readJson(SETTINGS(), {}).discord || {}) } });
const saveSettings = s => fs.writeFileSync(SETTINGS(), JSON.stringify({ ...settings(), ...s }, null, 2));

function setSecret(name, value) {
  const all = readJson(SECRETS(), {});
  if (!value) delete all[name];
  else all[name] = safeStorage.isEncryptionAvailable()
    ? { enc: safeStorage.encryptString(value).toString('base64') }
    : { plain: value };
  fs.writeFileSync(SECRETS(), JSON.stringify(all), { mode: 0o600 });
}

function getSecret(name) {
  const v = readJson(SECRETS(), {})[name];
  if (!v) return '';
  try { return v.enc ? safeStorage.decryptString(Buffer.from(v.enc, 'base64')) : v.plain || ''; } catch { return ''; }
}

// ---------- the engine ----------

// PATH with Homebrew's folders on a Mac (apps started from Finder don't get them)
const env = (extra = {}) => ({
  ...process.env,
  PATH: MAC ? `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` : process.env.PATH,
  PYTHONUNBUFFERED: '1',
  ...extra,
});

function engineCommand(args) {
  if (app.isPackaged) {
    const exe = path.join(process.resourcesPath, 'engine', WIN ? 'chat-buddy-engine.exe' : 'chat-buddy-engine');
    return [exe, args];
  }
  return [WIN ? 'python' : 'python3', [path.join(__dirname, '..', 'engine.py'), ...args]];
}

const prgPath = () => (app.isPackaged ? path.join(process.resourcesPath, 'talking_face.prg') : path.join(__dirname, '..', 'talking_face.prg'));

// Run the engine for one answer ("test", "snapshot"): resolves with its result line.
function engineOnce(args, timeout = 30000) {
  return new Promise(resolve => {
    const [cmd, a] = engineCommand(args);
    let result = null;
    let buf = '';
    const p = spawn(cmd, a, { env: env(), windowsHide: true });
    const timer = setTimeout(() => p.kill(), timeout);
    p.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try { const ev = JSON.parse(line); if (ev.type === 'result') result = ev; } catch { /* not ours */ }
      }
    });
    p.on('error', e => { clearTimeout(timer); resolve({ ok: false, detail: `The engine didn't start: ${e.message}` }); });
    p.on('close', () => { clearTimeout(timer); resolve(result || { ok: false, detail: 'No answer from the engine.' }); });
  });
}

const send = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };

function startEngine() {
  if (engine) return { ok: true };
  const s = settings();
  const key = getSecret('openai');
  const discordUrl = s.discord.enabled ? getSecret('discordUrl') : '';
  const cfgFile = path.join(app.getPath('temp'), `chat-buddy-${process.pid}.json`);
  fs.writeFileSync(cfgFile, JSON.stringify({ host: s.host, prg: prgPath(), loadFace: s.loadFace, chargen: s.chargen, discordUrl }), { mode: 0o600 });
  const [cmd, args] = engineCommand(['run', '--config', cfgFile]);
  const p = spawn(cmd, args, { env: env(key ? { OPENAI_API_KEY: key } : {}), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  engine = p;
  let buf = '';
  p.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      try { send('engine:event', JSON.parse(line)); } catch { if (line.trim()) send('engine:event', { type: 'log', level: 'info', text: line }); }
    }
  });
  p.stderr.on('data', d => String(d).split('\n').filter(l => l.trim()).forEach(text => send('engine:event', { type: 'log', level: 'error', text })));
  p.on('error', e => send('engine:event', { type: 'log', level: 'error', text: `The engine didn't start: ${e.message}` }));
  p.on('close', () => {
    if (engine === p) engine = null;
    fs.rm(cfgFile, { force: true }, () => {});
    send('engine:running', false);
  });
  // the config file has the database address in it: remove it as soon as the engine has read it
  setTimeout(() => fs.rm(cfgFile, { force: true }, () => {}), 5000);
  send('engine:running', true);
  return { ok: true };
}

// Live view fallback: the screen drawn from screen memory by the engine ("watch").
function startScreenWatch() {
  const s = settings();
  if (screenWatch) return { ok: true };
  if (!s.chargen) return { ok: false, error: 'Drawing from screen memory needs the C64 character ROM: add it in Setup (step 4).' };
  const [cmd, args] = engineCommand(['watch', '--host', s.host, '--chargen', s.chargen]);
  const p = spawn(cmd, args, { env: env(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  screenWatch = p;
  let buf = '';
  p.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      try { const ev = JSON.parse(line); if (ev.type === 'frame' || ev.type === 'result') send('screen:frame', ev); } catch { /* not ours */ }
    }
  });
  p.on('close', () => { if (screenWatch === p) screenWatch = null; });
  return { ok: true };
}

function stopScreenWatch() {
  const p = screenWatch;
  screenWatch = null;
  if (p) { try { p.stdin.end(); } catch { /* gone */ } setTimeout(() => { if (p.exitCode === null) p.kill(); }, 1500); }
}

function stopEngine() {
  live.stop();
  stopScreenWatch();
  const p = engine;
  if (!p) return;
  try { p.stdin.end(); } catch { /* already gone */ }
  setTimeout(() => { if (!p.killed && p.exitCode === null) p.kill(); }, 2000);
}

// ---------- finding the C64 character ROM (from VICE) ----------

function chargenRoots() {
  const home = os.homedir();
  if (MAC) return ['/Applications', path.join(home, 'Applications'), path.join(home, 'Downloads'), '/opt/homebrew/share', '/usr/local/share'];
  if (WIN) return ['C:\\Program Files', 'C:\\Program Files (x86)', path.join(home, 'Downloads'), path.join(home, 'Desktop'), path.join(home, 'Documents'), 'C:\\'];
  return ['/usr/share', '/usr/lib', '/usr/local/share', path.join(home, 'Downloads')];
}

function findChargen() {
  const found = [];
  const walk = (dir, depth) => {
    if (depth < 0 || found.length) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && /^chargen/i.test(e.name) && /c64$/i.test(path.basename(dir))) {
        try { if (fs.statSync(full).size === 4096) { found.push(full); return; } } catch { /* skip */ }
      } else if (e.isDirectory() && !e.name.startsWith('.')) walk(full, depth - 1);
    }
  };
  for (const root of chargenRoots()) {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) if (e.isDirectory() && /vice/i.test(e.name)) walk(path.join(root, e.name), 7);
    if (found.length) break;
  }
  return found[0] || '';
}

// ---------- IPC ----------

ipcMain.handle('settings:get', () => {
  const s = settings();
  return { ...s, hasKey: Boolean(getSecret('openai')), hasDiscordUrl: Boolean(getSecret('discordUrl')), version: app.getVersion(), running: Boolean(engine) };
});
ipcMain.handle('settings:set', (e, s) => { saveSettings(s); return true; });
ipcMain.handle('key:set', (e, key) => { setSecret('openai', String(key || '').trim()); return true; });
ipcMain.handle('discord:set', (e, url) => { setSecret('discordUrl', String(url || '').trim()); return true; });
ipcMain.handle('discord:heroku', (e, herokuApp) => new Promise(resolve => {
  execFile(WIN ? 'heroku.cmd' : 'heroku', ['config:get', 'DATABASE_URL', '-a', herokuApp], { env: env(), timeout: 30000, windowsHide: true, shell: WIN }, (err, out) => {
    const url = String(out || '').trim();
    if (err || !url) return resolve({ ok: false, detail: err ? 'The Heroku CLI didn\'t answer. Is it installed, and are you logged in (heroku login)?' : `${herokuApp} has no DATABASE_URL.` });
    setSecret('discordUrl', url);
    resolve({ ok: true });
  });
}));
ipcMain.handle('u64:test', (e, host) => engineOnce(['test', '--host', host], 15000));
ipcMain.handle('chargen:find', () => findChargen());
ipcMain.handle('chargen:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose the C64 character ROM (chargen, 4096 bytes)', properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return '';
  const f = r.filePaths[0];
  try { if (fs.statSync(f).size !== 4096) return { error: 'That file isn\'t 4096 bytes, so it isn\'t a C64 character ROM.' }; } catch { return ''; }
  return f;
});
// ---------- microphone permission ----------
// macOS (and Windows' privacy settings) only let the app - and the engine it starts - hear the
// microphone once the system has asked and the user said yes. Without that, the mic gives silence.
function micStatus() {
  if (!MAC && !WIN) return 'granted';
  try { return systemPreferences.getMediaAccessStatus('microphone'); } catch { return 'unknown'; }
}

async function askForMic() {
  if (MAC && micStatus() === 'not-determined') {
    try { await systemPreferences.askForMediaAccess('microphone'); } catch { /* answered below */ }
  }
  return micStatus();
}

ipcMain.handle('mic:status', () => micStatus());
ipcMain.handle('mic:ask', () => askForMic());
ipcMain.handle('mic:settings', () => shell.openExternal(MAC
  ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
  : 'ms-settings:privacy-microphone'));

ipcMain.handle('engine:start', async () => {
  const mic = await askForMic();   // the "Chat Buddy would like to access the microphone" prompt, the first time
  return { ...startEngine(), mic };
});
ipcMain.handle('engine:stop', () => { stopEngine(); return true; });
ipcMain.handle('engine:snapshot', async () => {
  const s = settings();
  if (!s.chargen) return { ok: false, detail: 'Screenshots need the C64 character ROM: add it in Setup.' };
  const r = await dialog.showSaveDialog(win, { title: 'Save screenshot', defaultPath: path.join(app.getPath('pictures'), 'chat-buddy.png'), filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  const res = await engineOnce(['snapshot', '--host', s.host, '--chargen', s.chargen, '--out', r.filePath]);
  if (res.ok) res.image = 'data:image/png;base64,' + fs.readFileSync(r.filePath).toString('base64');
  return res;
});
ipcMain.handle('live:start', () => live.start(settings().host, send));
ipcMain.handle('live:stop', () => live.stop());
ipcMain.handle('screen:start', () => startScreenWatch());
ipcMain.handle('screen:stop', () => { stopScreenWatch(); return true; });
ipcMain.handle('save-png', async (e, dataUrl) => {
  if (!/^data:image\/png;base64,/.test(String(dataUrl))) return { ok: false, detail: 'No picture to save.' };
  const r = await dialog.showSaveDialog(win, { title: 'Save screenshot', defaultPath: path.join(app.getPath('pictures'), 'chat-buddy.png'), filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(r.filePath, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
  return { ok: true, detail: r.filePath };
});
ipcMain.handle('open-external', (e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });

// ---------- window, menu, About ----------

const ABOUT = 'Copyright (C) 2026 Sid Choudhuri (m0nde)\n\n'
  + 'The C64 talking face that chats through ChatGPT, on your Ultimate 64 or C64 Ultimate.\n\n'
  + 'Free software under the GNU GPL version 3 or later, with no warranty. See the LICENSE file.';

function showAbout() {
  dialog.showMessageBox(win, { type: 'info', icon: nativeImage.createFromPath(ICON), title: 'About Chat Buddy',
    message: `Chat Buddy ${app.getVersion()}`, detail: ABOUT, buttons: ['OK'] });
}

function buildMenu() {
  const about = { label: 'About Chat Buddy', click: showAbout };
  const updateItem = { label: 'Check for Updates…', click: () => updates.check() };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(MAC ? [{ label: app.name, submenu: [about, updateItem, { type: 'separator' }, { role: 'services' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : [{ role: 'fileMenu' }]),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help', submenu: [
      ...(MAC ? [] : [about, updateItem]),
      { label: 'Chat Buddy on GitHub', click: () => shell.openExternal('https://github.com/sidchoudhuri/u64_chat_buddy') },
      { label: 'Releases', click: () => shell.openExternal('https://github.com/sidchoudhuri/chat-buddy-releases/releases') },
    ] },
  ]));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 760, minWidth: 820, minHeight: 560, title: 'Chat Buddy', backgroundColor: '#0d0b0c', icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  if (app.isPackaged) setTimeout(() => updates.check({ quiet: true }), 4000);   // says something only if there's a new version
});

app.on('before-quit', stopEngine);
app.on('window-all-closed', () => { stopEngine(); app.quit(); });
