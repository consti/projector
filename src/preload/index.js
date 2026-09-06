'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (ch) => (fn) => {
  const h = (_e, ...a) => fn(...a);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.off(ch, h);
};

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  patchState: (p) => ipcRenderer.invoke('state:patch', p),
  setProject: (p) => ipcRenderer.invoke('project:set', p),
  onState: on('state'),
  onDisplays: on('displays'),
  onIdentify: on('identify'),
  onMenu: on('menu'),

  fxInteract: (pts) => ipcRenderer.invoke('fx:interact', pts),
  fxAudio: (pkt) => ipcRenderer.invoke('fx:audio', pkt),
  onFxAudio: on('fx:audio'),
  fxAction: (layerId, name, arg) => ipcRenderer.invoke('fx:action', layerId, name, arg),
  onFxInteract: on('fx:interact'),
  onFxAction: on('fx:action'),

  remoteStart: () => ipcRenderer.invoke('remote:start'),
  remoteStop: () => ipcRenderer.invoke('remote:stop'),
  remoteSend: (id, msg) => ipcRenderer.invoke('remote:send', id, msg),
  remoteInfo: () => ipcRenderer.invoke('remote:info'),
  reportStageRect: (rect) => ipcRenderer.invoke('remote:stageRect', rect),
  onRemoteMsg: on('remote:msg'),

  charactersList: () => ipcRenderer.invoke('characters:list'),
  charactersDraw: (req) => ipcRenderer.invoke('characters:draw', req),
  charactersWardrobe: (hero, model) => ipcRenderer.invoke('characters:wardrobe', hero, model),
  charactersBase: () => ipcRenderer.invoke('characters:base'),
  charactersSave: (rec) => ipcRenderer.invoke('characters:save', rec),
  charactersUpdate: (id, patch) => ipcRenderer.invoke('characters:update', id, patch),
  charactersRemove: (id) => ipcRenderer.invoke('characters:remove', id),

  aiStatus: () => ipcRenderer.invoke('ai:status'),
  aiSpend: () => ipcRenderer.invoke('ai:spend'),
  onAiSpend: on('ai:spend'),
  aiModels: (force) => ipcRenderer.invoke('ai:models', force),
  aiRespond: (req) => ipcRenderer.invoke('ai:respond', req),
  aiImage: (req) => ipcRenderer.invoke('ai:image', req),

  displays: () => ipcRenderer.invoke('displays:get'),
  setOutput: (role, cfg) => ipcRenderer.invoke('outputs:set', role, cfg),
  syncOutputs: () => ipcRenderer.invoke('outputs:sync'),
  identifyOutputs: () => ipcRenderer.invoke('outputs:identify'),
  closeAllOutputs: () => ipcRenderer.invoke('outputs:closeAll'),

  cmd: (c, a) => ipcRenderer.invoke('transport:cmd', c, a),
  report: (info) => ipcRenderer.invoke('transport:report', info),
  ended: () => ipcRenderer.invoke('transport:ended'),

  addFiles: () => ipcRenderer.invoke('playlist:addFiles'),
  addPaths: (p) => ipcRenderer.invoke('playlist:addPaths', p),
  addUrl: (u) => ipcRenderer.invoke('playlist:addUrl', u),
  setPlaylist: (items, index) => ipcRenderer.invoke('playlist:set', items, index),
  ytdlpAvailable: () => ipcRenderer.invoke('ytdlp:available'),

  library: () => ipcRenderer.invoke('library:list'),
  libraryAdd: (urls, opts) => ipcRenderer.invoke('library:add', urls, opts),
  libraryUpdate: (id, patch) => ipcRenderer.invoke('library:update', id, patch),
  libraryRemove: (id) => ipcRenderer.invoke('library:remove', id),
  libraryRetry: (id) => ipcRenderer.invoke('library:retry', id),
  libraryCancel: (id) => ipcRenderer.invoke('library:cancel', id),
  libraryDetectCrop: (ids) => ipcRenderer.invoke('library:detectCrop', ids),
  libraryClearCrop: (ids) => ipcRenderer.invoke('library:clearCrop', ids),
  libraryReveal: (id) => ipcRenderer.invoke('library:reveal', id),
  libraryExport: () => ipcRenderer.invoke('library:export'),
  libraryImport: () => ipcRenderer.invoke('library:import'),
  libraryDiscover: (seedIds, exclude, limit) => ipcRenderer.invoke('library:discover', seedIds, exclude, limit),
  libraryPlay: (ids, opts) => ipcRenderer.invoke('library:play', ids, opts),
  libraryKeep: (id) => ipcRenderer.invoke('library:keep', id),
  playlistKeep: (index) => ipcRenderer.invoke('playlist:keep', index),
  onLibrary: on('library'),
  onLibraryProgress: on('library:progress'),
  onLibraryToast: on('library:toast'),

  playlistsList: () => ipcRenderer.invoke('playlists:list'),
  playlistsSave: (name) => ipcRenderer.invoke('playlists:save', name),
  playlistsLoad: (name) => ipcRenderer.invoke('playlists:load', name),
  playlistsDelete: (name) => ipcRenderer.invoke('playlists:delete', name),
  setAutoDiscover: (on) => ipcRenderer.invoke('playlist:autoDiscover', on),

  mappings: () => ipcRenderer.invoke('mappings:list'),
  saveMapping: (name) => ipcRenderer.invoke('mappings:save', name),
  loadMapping: (name) => ipcRenderer.invoke('mappings:load', name),
  deleteMapping: (name) => ipcRenderer.invoke('mappings:delete', name),
  revealMappings: () => ipcRenderer.invoke('mappings:reveal'),
  swapOutputs: () => ipcRenderer.invoke('outputs:swap'),

  saveProject: (asNew) => ipcRenderer.invoke('project:save', asNew),
  openProject: () => ipcRenderer.invoke('project:open'),

  captureOutput: (role) => ipcRenderer.invoke('capture:output', role),
  saveCapture: (dataUrl, name) => ipcRenderer.invoke('capture:save', dataUrl, name),
  mediaAccess: (kind) => ipcRenderer.invoke('media:access', kind),
  reveal: (p) => ipcRenderer.invoke('app:reveal', p),
  debugWindows: () => ipcRenderer.invoke('debug:windows'),
  reloadAll: () => ipcRenderer.invoke('app:reload'),

  pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch { return null; } },
});
