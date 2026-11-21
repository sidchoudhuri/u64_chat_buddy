// Chat Buddy: Check for Updates (the same way as Viz).
// Copyright (C) 2026 Sid Choudhuri (m0nde). GNU GPL v3 or later: see LICENSE.
//
// New versions are on the public releases repo (the Build Chat Buddy action puts them there).
// Chat Buddy looks at the latest release, and if it's newer, downloads it itself and puts it in
// place of this one: on a Mac the .dmg for this Mac is opened out of sight, Chat Buddy quits, a
// small script swaps the new Chat Buddy.app in where this one is and opens it; on Windows the
// installer runs. A file it downloads itself isn't marked as downloaded from the internet, so
// macOS doesn't stop it.

const { app, BrowserWindow, dialog, net, shell } = require('electron');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = 'sidchoudhuri/chat-buddy-releases';
const PAGE = `https://github.com/${REPO}/releases/latest`;
let busy = false;

// "0.2.10" > "0.2.9"
function newer(a, b) {
  const p = v => String(v).replace(/^v/, '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

async function latest() {
  const r = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`,
    { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `ChatBuddy/${app.getVersion()}` } });
  if (!r.ok) throw new Error(r.status === 404 ? 'No releases yet.' : `GitHub answered ${r.status}.`);
  return r.json();
}

// the download for this computer: the .dmg for this Mac's chip, or the Windows installer
function assetFor(rel) {
  const files = rel.assets || [];
  if (process.platform === 'darwin') {
    const arm = process.arch === 'arm64' || app.runningUnderARM64Translation;
    const dmgs = files.filter(f => /\.dmg$/i.test(f.name));
    return dmgs.find(f => /arm64/i.test(f.name) === arm) || null;
  }
  if (process.platform === 'win32') return files.find(f => /\.exe$/i.test(f.name)) || null;
  return null;
}

// a small window with a bar while it downloads
function progressWindow(parent, title) {
  const w = new BrowserWindow({ width: 380, height: 120, parent: parent || undefined, resizable: false, minimizable: false,
    maximizable: false, title, backgroundColor: '#1b1718', show: false, webPreferences: { sandbox: true } });
  w.setMenuBarVisibility(false);
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:20px 22px;background:#1b1718;color:#f2ece6;font:13px -apple-system,Segoe UI,sans-serif">
    <div id="t">${title}</div><div style="margin-top:12px;height:8px;background:#3a3234;border-radius:4px;overflow:hidden">
    <div id="b" style="height:100%;width:0;background:#ffd84a"></div></div><div id="s" style="margin-top:8px;color:#a89e96;font-size:12px"></div></body>`;
  w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  w.once('ready-to-show', () => w.show());
  const set = (done, total) => {
    if (w.isDestroyed()) return;
    const f = total ? done / total : 0;
    w.setProgressBar(f);
    w.webContents.executeJavaScript(`document.getElementById('b').style.width='${(f * 100).toFixed(1)}%';
      document.getElementById('s').textContent='${(done / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB'`).catch(() => {});
  };
  const text = t => { if (!w.isDestroyed()) w.webContents.executeJavaScript(`document.getElementById('t').textContent=${JSON.stringify(t)}`).catch(() => {}); };
  return { set, text, close: () => { if (!w.isDestroyed()) w.close(); } };
}

async function download(asset, to, prog) {
  const r = await net.fetch(asset.browser_download_url, { headers: { 'User-Agent': `ChatBuddy/${app.getVersion()}` } });
  if (!r.ok || !r.body) throw new Error(`The download failed (${r.status}).`);
  const total = Number(r.headers.get('content-length')) || asset.size || 0;
  const out = fs.createWriteStream(to);
  let done = 0, last = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { done: end, value } = await reader.read();
    if (end) break;
    done += value.length;
    if (!out.write(Buffer.from(value))) await new Promise(res => out.once('drain', res));
    if (Date.now() - last > 100) { last = Date.now(); prog.set(done, total); }
  }
  await new Promise((res, rej) => out.end(err => (err ? rej(err) : res())));
  prog.set(done, total);
  if (total && done !== total) throw new Error('The download was cut short.');
}

const run = (cmd, args) => new Promise((res, rej) =>
  execFile(cmd, args, { timeout: 120000 }, (err, out, errOut) => (err ? rej(new Error(String(errOut || err.message).trim())) : res(out))));

// where this Chat Buddy.app is, if it can put a new one there
function thisApp() {
  const bundle = path.resolve(process.execPath, '..', '..', '..');
  if (!/\.app$/.test(bundle) || /AppTranslocation/.test(bundle)) return null;
  try { fs.accessSync(path.dirname(bundle), fs.constants.W_OK); fs.accessSync(bundle, fs.constants.W_OK); } catch (e) { return null; }
  return bundle;
}

// Mac: the new Chat Buddy.app out of the .dmg, then a script that swaps it in once this one has quit
async function installMac(dmg, dir, version) {
  const bundle = thisApp();
  if (!bundle) return false;
  const mnt = path.join(dir, 'mnt');
  fs.mkdirSync(mnt, { recursive: true });
  await run('hdiutil', ['attach', '-nobrowse', '-noautoopen', '-noverify', '-mountpoint', mnt, dmg]);
  const staged = path.join(dir, 'Chat Buddy.app');
  try {
    const src = fs.readdirSync(mnt).find(f => /\.app$/.test(f));
    if (!src) throw new Error('There was no Chat Buddy.app in the download.');
    await run('ditto', [path.join(mnt, src), staged]);
  } finally {
    await run('hdiutil', ['detach', mnt, '-force']).catch(() => {});
  }
  const plist = fs.readFileSync(path.join(staged, 'Contents', 'Info.plist'), 'utf8');
  if (!plist.includes(`<string>${version}</string>`)) throw new Error("The download isn't the expected version.");
  const script = path.join(dir, 'swap.sh');
  fs.writeFileSync(script, [
    '#!/bin/sh',
    `PID=${process.pid}; APP=${JSON.stringify(bundle)}; NEW=${JSON.stringify(staged)}; DIR=${JSON.stringify(dir)}`,
    'while kill -0 "$PID" 2>/dev/null; do sleep 0.3; done',
    'rm -rf "$APP.old"',
    'if mv "$APP" "$APP.old" && ditto "$NEW" "$APP"; then rm -rf "$APP.old"; else rm -rf "$APP"; mv "$APP.old" "$APP"; fi',
    'xattr -cr "$APP" 2>/dev/null',
    'open "$APP"',
    'rm -rf "$DIR"',
    '',
  ].join('\n'));
  spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' }).unref();
  return true;
}

function installWin(exe) {
  spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
  return true;
}

async function update(rel, asset, parent) {
  const version = String(rel.tag_name).replace(/^v/, '');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-buddy-update-'));
  const file = path.join(dir, asset.name);
  const prog = progressWindow(parent, `Downloading Chat Buddy ${version}…`);
  try {
    await download(asset, file, prog);
    prog.text(`Installing Chat Buddy ${version}…`);
    const ok = process.platform === 'darwin' ? await installMac(file, dir, version) : installWin(file);
    prog.close();
    if (!ok) {
      await dialog.showMessageBox(parent, { type: 'info', message: `Chat Buddy ${version} is downloaded`,
        detail: "Chat Buddy can't replace itself where it is (it may not be in Applications, or that folder isn't yours to change). "
          + 'The download opens now: drag Chat Buddy into Applications to replace this one.', buttons: ['OK'] });
      shell.openPath(file);
      return;
    }
    app.quit();
  } catch (e) {
    prog.close();
    fs.rmSync(dir, { recursive: true, force: true });
    const r = await dialog.showMessageBox(parent, { type: 'warning', message: "The update didn't work",
      detail: `${e.message}\n\nYou can download it from the releases page instead.`, buttons: ['Open the releases page', 'Close'] });
    if (r.response === 0) shell.openExternal(PAGE);
  }
}

// quiet: on launch, say nothing unless there's a new version
async function check({ quiet = false } = {}) {
  if (busy) return;
  busy = true;
  const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
  try {
    const rel = await latest();
    const version = String(rel.tag_name || '').replace(/^v/, '');
    if (!version || !newer(version, app.getVersion())) {
      if (!quiet) await dialog.showMessageBox(parent, { type: 'info', message: "You're up to date",
        detail: `Chat Buddy ${app.getVersion()} is the latest version.`, buttons: ['OK'] });
      return;
    }
    const asset = app.isPackaged ? assetFor(rel) : null;
    const notes = String(rel.body || '').trim().slice(0, 1500);
    const r = await dialog.showMessageBox(parent, { type: 'info', message: `Chat Buddy ${version} is available`,
      detail: `You have ${app.getVersion()}.${notes ? `\n\n${notes}` : ''}`,
      buttons: asset ? ['Update now', 'Later'] : ['Open the releases page', 'Later'], defaultId: 0, cancelId: 1 });
    if (r.response !== 0) return;
    if (asset) await update(rel, asset, parent);
    else shell.openExternal(PAGE);
  } catch (e) {
    if (!quiet) await dialog.showMessageBox(parent, { type: 'warning', message: "Couldn't check for updates",
      detail: `${e.message}\n\nCheck the network, or look at ${PAGE}`, buttons: ['OK'] });
  } finally {
    busy = false;
  }
}

module.exports = { check, newer };
