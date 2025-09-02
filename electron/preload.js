const { contextBridge, ipcRenderer } = require('electron');

const IPC_CHANNELS = {
  GET_POSTS: 'db:get-posts',
  GET_COMMENTS: 'db:get-comments',
  IMPORT_JSON: 'db:import-json',
  TAKE_SCREENSHOT: 'screenshot:take',
  TAKE_SCREENSHOTS_BATCH: 'screenshot:take-batch',
  SELECT_JSON_FILE: 'file:select-json',
  OPEN_SCREENSHOT: 'file:open-screenshot',
};

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Database operations
  importJson: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.IMPORT_JSON, request),
    
  getPosts: () =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_POSTS),
    
  getComments: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_COMMENTS, request),

  // Screenshot operations
  takeScreenshot: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAKE_SCREENSHOT, request),
    
  takeScreenshotsBatch: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAKE_SCREENSHOTS_BATCH, request),

  // File operations
  selectJsonFile: () =>
    ipcRenderer.invoke(IPC_CHANNELS.SELECT_JSON_FILE),
    
  openScreenshot: (screenshotPath) =>
    ipcRenderer.invoke(IPC_CHANNELS.OPEN_SCREENSHOT, screenshotPath),
});
