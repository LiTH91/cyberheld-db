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
  // queue controls
  startBatchScreenshots: (request) => ipcRenderer.invoke('screenshot:start-batch', request),
  pauseBatch: () => ipcRenderer.invoke('screenshot:pause'),
  resumeBatch: () => ipcRenderer.invoke('screenshot:resume'),
  cancelBatch: () => ipcRenderer.invoke('screenshot:cancel'),
  getBatchStatus: () => ipcRenderer.invoke('screenshot:status'),

  // File operations
  selectJsonFile: () =>
    ipcRenderer.invoke(IPC_CHANNELS.SELECT_JSON_FILE),
    
  openScreenshot: (screenshotPath) =>
    ipcRenderer.invoke(IPC_CHANNELS.OPEN_SCREENSHOT, screenshotPath),
  readScreenshotDataUrl: (screenshotPath) => ipcRenderer.invoke('screenshot:read-dataurl', screenshotPath),

  // Export
  exportJson: (postId, filePath, commentIds) => ipcRenderer.invoke('export:json', { postId, filePath, commentIds }),
  exportPdf: (postId, filePath, commentIds) => ipcRenderer.invoke('export:pdf', { postId, filePath, commentIds }),

  // Auth helpers
  facebookLogin: () => ipcRenderer.invoke('auth:facebook-login'),
  clearCookies: () => ipcRenderer.invoke('auth:cookies-clear'),
  getSettingsStatus: () => ipcRenderer.invoke('settings:get-status'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // Delete screenshots
  deleteScreenshot: (commentId) => ipcRenderer.invoke('screenshot:delete', { commentId }),
  deleteScreenshotsBatch: (commentIds) => ipcRenderer.invoke('screenshot:delete-batch', { commentIds }),

  // AI analysis
  analyzeComments: (commentIds, lawText, batchSize) => ipcRenderer.invoke('ai:analyze-comments', { commentIds, lawText, batchSize }),

  // Likes screenshots
  takeLikesScreenshot: (request) => ipcRenderer.invoke('likes:take', request),
});
