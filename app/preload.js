// Chat Buddy
// Copyright (C) 2026 Sid Choudhuri (m0nde). GNU GPL v3 or later: see LICENSE.
//
// What the window may ask of the app (main.js answers).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  settings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: s => ipcRenderer.invoke('settings:set', s),
  saveKey: key => ipcRenderer.invoke('key:set', key),
  saveDiscordUrl: url => ipcRenderer.invoke('discord:set', url),
  herokuUrl: app => ipcRenderer.invoke('discord:heroku', app),
  testUltimate: host => ipcRenderer.invoke('u64:test', host),
  findChargen: () => ipcRenderer.invoke('chargen:find'),
  pickChargen: () => ipcRenderer.invoke('chargen:pick'),
  start: () => ipcRenderer.invoke('engine:start'),
  stop: () => ipcRenderer.invoke('engine:stop'),
  snapshot: () => ipcRenderer.invoke('engine:snapshot'),
  openExternal: url => ipcRenderer.invoke('open-external', url),
  on: (channel, fn) => {
    if (['engine:event', 'engine:running', 'menu:discord'].includes(channel)) ipcRenderer.on(channel, (e, d) => fn(d));
  },
});
