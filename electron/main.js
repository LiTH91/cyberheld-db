const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { DatabaseService } = require('./services/DatabaseService');
const { BrowserService } = require('./services/BrowserService');
const { SettingsService } = require('./services/SettingsService');
const { LoggerService } = require('./services/LoggerService');
const { AuditService } = require('./services/AuditService');

// Fix Windows GPU crashes by disabling hardware acceleration
// Must be called before app.whenReady()
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

const IPC_CHANNELS = {
  GET_POSTS: 'db:get-posts',
  GET_COMMENTS: 'db:get-comments',
  IMPORT_JSON: 'db:import-json',
  TAKE_SCREENSHOT: 'screenshot:take',
  TAKE_SCREENSHOTS_BATCH: 'screenshot:take-batch',
  SELECT_JSON_FILE: 'file:select-json',
  OPEN_SCREENSHOT: 'file:open-screenshot',
};

const PROGRESS_CHANNEL = 'screenshot:progress';

class CyberheldApp {
  constructor() {
    this.mainWindow = null;
    this.dbService = new DatabaseService();
    this.browserService = new BrowserService();
    this.settingsService = new SettingsService();
    this.logger = new LoggerService();
    this.audit = new AuditService();
    this.currentJob = null; // { total, completed, failed, paused, cancelled }
    this.setupApp();
    this.setupIPC();
  }

  setupApp() {
    app.whenReady().then(() => {
      this.createWindow();
      
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          this.createWindow();
        }
      });
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('before-quit', async () => {
      await this.dbService.close();
    });
  }

  async createWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
      titleBarStyle: 'default',
      show: true,
      backgroundColor: '#ffffff',
    });

    // Initialize services
    await this.dbService.initialize();
    this.logger.info('DB initialized');
    // Load settings and init browser with possible chromePath override later
    const loaded = await this.settingsService.loadSettings();
    await this.browserService.initBrowser(false);

    const isDev = process.env.NODE_ENV === 'development';
    
    if (isDev) {
      // Try different ports that Next.js might use
      const ports = [3000, 3001, 3002];
      let loaded = false;
      
      for (const port of ports) {
        try {
          await this.mainWindow.loadURL(`http://localhost:${port}`);
          console.log(`Successfully connected to Next.js on port ${port}`);
          loaded = true;
          break;
        } catch (error) {
          console.log(`Port ${port} not available, trying next...`);
        }
      }
      
      if (!loaded) {
        console.error('Could not connect to Next.js development server');
        this.mainWindow.loadFile(path.join(__dirname, '../dist/next/index.html'));
      }
      
      this.mainWindow.webContents.openDevTools();
    } else {
      this.mainWindow.loadFile(path.join(__dirname, '../dist/next/index.html'));
    }

    // Ensure we show even if 'ready-to-show' doesn't fire reliably
    const showWindow = () => {
      if (this.mainWindow && !this.mainWindow.isVisible()) {
        this.mainWindow.show();
      }
    };
    this.mainWindow.once('ready-to-show', showWindow);
    this.mainWindow.webContents.once('did-finish-load', showWindow);
    this.mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error('Renderer failed to load:', code, desc, url);
      showWindow();
    });
  }

  setupIPC() {
    // Import JSON file
    ipcMain.handle(IPC_CHANNELS.IMPORT_JSON, async (_, request) => {
      try {
        const result = await this.dbService.importJsonFile(request.filePath);
        this.logger.info('JSON imported', { file: request.filePath, postId: result.postId, comments: result.commentsImported });
        this.audit.write('import_json', { file: request.filePath, postId: result.postId, comments: result.commentsImported });
        return result;
      } catch (error) {
        this.logger.error('Error importing JSON', { error: error?.message || String(error) });
        return {
          success: false,
          postId: '',
          commentsImported: 0,
          error: error.message || 'Unknown error'
        };
      }
    });

    // Take single screenshot
    ipcMain.handle(IPC_CHANNELS.TAKE_SCREENSHOT, async (_evt, req) => {
      try {
        const filePath = await this.browserService.takeScreenshot(req.commentUrl, req.postId, req.commentId || req.id || req.comment_id || req, req.snippet);
        // Update DB
        await this.dbService.updateCommentScreenshot(req.commentId || req.id, filePath);
        this.audit.write('screenshot_single', { id: req.commentId || req.id, postId: req.postId, path: filePath });
        return { success: true, screenshotPath: filePath };
      } catch (error) {
        this.logger.warn('Screenshot single failed', { error: error?.message || String(error), id: req.commentId || req.id });
        return { success: false, error: error?.message || String(error) };
      }
    });

    // Batch screenshots
    ipcMain.handle(IPC_CHANNELS.TAKE_SCREENSHOTS_BATCH, async (_evt, req) => {
      const results = { success: true, completed: 0, failed: 0, errors: [] };
      // Shuffle Reihenfolge
      const shuffled = [...req.comments].sort(() => Math.random() - 0.5);
      // deterministische Backoff-Liste (falls Zufall nicht gewünscht):
      const fixedBackoff = [2000, 5000, 2000, 4000, 3000, 6000];
      let idx = 0;
      for (const c of shuffled) {
        try {
          const filePath = await this.browserService.takeScreenshot(c.url, req.postId, c.id, c.snippet);
          await this.dbService.updateCommentScreenshot(c.id, filePath);
          results.completed += 1;
          // Backoff: random 2-6s oder fixed Sequenz
          const s = await this.settingsService.getSettings();
          const useFixed = !!s.fixedBackoff;
          const minMs = Math.max(1000, (s.minDelaySec ?? 2) * 1000);
          const maxMs = Math.max(minMs + 1, (s.maxDelaySec ?? 6) * 1000);
          if (useFixed) {
            const wait = fixedBackoff[idx % fixedBackoff.length];
            idx++;
            await new Promise(r => setTimeout(r, wait));
          } else {
            const wait = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
            await new Promise(r => setTimeout(r, wait));
          }
        } catch (e) {
          results.failed += 1;
          results.errors.push({ commentId: c.id, error: e?.message || String(e) });
        }
      }
      this.audit.write('screenshot_batch_done', { postId: req.postId, completed: results.completed, failed: results.failed });
      return results;
    });

    // Helper: Trigger Facebook Login (manuell vom Benutzer)
    ipcMain.handle('auth:facebook-login', async () => {
      try {
        const ok = await this.browserService.loginToFacebook();
        this.audit.write('auth_login', { success: ok });
        return { success: ok };
      } catch (e) {
        return { success: false, error: e?.message || String(e) };
      }
    });

    // Helper: Cookies löschen
    ipcMain.handle('auth:cookies-clear', async () => {
      try {
        await this.browserService.clearCookies();
        this.audit.write('auth_cookies_cleared');
        return { success: true };
      } catch (e) {
        return { success: false, error: e?.message || String(e) };
      }
    });

    // Settings: get current status
    ipcMain.handle('settings:get-status', async () => {
      try {
        const st = await this.browserService.getStatus();
        const s = await this.settingsService.getSettings();
        return { success: true, status: { ...st, settings: s } };
      } catch (e) {
        return { success: false, error: e?.message || String(e) };
      }
    });

    ipcMain.handle('settings:save', async (_evt, next) => {
      try {
        const saved = await this.settingsService.saveSettings(next);
        this.audit.write('settings_saved', saved);
        return { success: true, settings: saved };
      } catch (e) {
        return { success: false, error: e?.message || String(e) };
      }
    });

    // Delete single screenshot
    ipcMain.handle('screenshot:delete', async (_evt, { commentId }) => {
      try {
        await this.dbService.clearCommentScreenshot(commentId);
        return { success: true };
      } catch (e) {
        return { success: false, error: e?.message || String(e) };
      }
    });

    // Delete batch screenshots
    ipcMain.handle('screenshot:delete-batch', async (_evt, { commentIds }) => {
      const res = { success: true, completed: 0, failed: 0, errors: [] };
      for (const id of commentIds) {
        try {
          await this.dbService.clearCommentScreenshot(id);
          res.completed += 1;
        } catch (e) {
          res.failed += 1;
          res.errors.push({ commentId: id, error: e?.message || String(e) });
        }
      }
      return res;
    });

    // Get all posts
    ipcMain.handle(IPC_CHANNELS.GET_POSTS, async () => {
      try {
        const posts = await this.dbService.getPosts();
        return { success: true, posts };
      } catch (error) {
        console.error('Error getting posts:', error);
        return {
          success: false,
          posts: [],
          error: error.message || 'Unknown error'
        };
      }
    });

    // Get comments for a post
    ipcMain.handle(IPC_CHANNELS.GET_COMMENTS, async (_, request) => {
      try {
        const comments = await this.dbService.getComments(request.postId);
        return { success: true, comments };
      } catch (error) {
        console.error('Error getting comments:', error);
        return {
          success: false,
          comments: [],
          error: error.message || 'Unknown error'
        };
      }
    });

    // Select JSON file dialog
    ipcMain.handle(IPC_CHANNELS.SELECT_JSON_FILE, async () => {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        properties: ['openFile'],
        filters: [
          { name: 'JSON Files', extensions: ['json'] }
        ]
      });

      if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
      }
      return null;
    });

    // Open screenshot file
    ipcMain.handle(IPC_CHANNELS.OPEN_SCREENSHOT, async (_, screenshotPath) => {
      const { shell } = require('electron');
      await shell.openPath(screenshotPath);
    });

    // Read screenshot as data URL for preview
    ipcMain.handle('screenshot:read-dataurl', async (_evt, screenshotPath) => {
      try {
        const fs = require('fs');
        if (!screenshotPath || !fs.existsSync(screenshotPath)) return null;
        const buf = fs.readFileSync(screenshotPath);
        const b64 = buf.toString('base64');
        return `data:image/png;base64,${b64}`;
      } catch (e) {
        return null;
      }
    });

    // Start batch (async with progress events)
    ipcMain.handle('screenshot:start-batch', async (_evt, req) => {
      this.startBatchJob(req);
      return { success: true };
    });

    ipcMain.handle('screenshot:pause', async () => {
      if (this.currentJob) this.currentJob.paused = true;
      return { success: true };
    });
    ipcMain.handle('screenshot:resume', async () => {
      if (this.currentJob) this.currentJob.paused = false;
      return { success: true };
    });
    ipcMain.handle('screenshot:cancel', async () => {
      if (this.currentJob) this.currentJob.cancelled = true;
      return { success: true };
    });
    ipcMain.handle('screenshot:status', async () => {
      const j = this.currentJob;
      if (!j) return { success: true, job: null };
      return { success: true, job: { total: j.total, completed: j.completed, failed: j.failed, paused: j.paused, cancelled: j.cancelled } };
    });
  }

  async startBatchJob(req) {
    const win = this.mainWindow;
    const s = await this.settingsService.getSettings();
    const fixedBackoff = [2000, 5000, 2000, 4000, 3000, 6000];
    let idx = 0;
    const useFixed = !!s.fixedBackoff;
    const minMs = Math.max(1000, (s.minDelaySec ?? 2) * 1000);
    const maxMs = Math.max(minMs + 1, (s.maxDelaySec ?? 6) * 1000);

    const shuffled = [...req.comments].sort(() => Math.random() - 0.5);
    this.currentJob = { total: shuffled.length, completed: 0, failed: 0, paused: false, cancelled: false };

    const send = (payload) => {
      try { win && win.webContents.send(PROGRESS_CHANNEL, payload); } catch {}
    };

    for (const c of shuffled) {
      if (this.currentJob.cancelled) break;
      while (this.currentJob.paused && !this.currentJob.cancelled) {
        await new Promise(r => setTimeout(r, 300));
      }

      let success = false;
      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const filePath = await this.browserService.takeScreenshot(c.url, req.postId, c.id, c.snippet);
          await this.dbService.updateCommentScreenshot(c.id, filePath);
          success = true;
          break;
        } catch (e) {
          lastError = e;
          // attempt backoff: 1.5s, 3s, 5s
          const attemptWait = [1500, 3000, 5000][attempt - 1] || 3000;
          await new Promise(r => setTimeout(r, attemptWait));
        }
      }

      if (success) {
        this.currentJob.completed += 1;
      } else {
        this.currentJob.failed += 1;
        await this.dbService.recordCommentError(c.id, lastError?.message || String(lastError));
      }
      send({ type: 'progress', completed: this.currentJob.completed, failed: this.currentJob.failed, total: this.currentJob.total, last: { id: c.id, success, error: success ? null : (lastError?.message || String(lastError)) } });

      // Inter-item backoff
      if (this.currentJob.cancelled) break;
      const wait = useFixed ? fixedBackoff[idx++ % fixedBackoff.length] : (Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs);
      await new Promise(r => setTimeout(r, wait));
    }

    send({ type: 'done', completed: this.currentJob.completed, failed: this.currentJob.failed, total: this.currentJob.total, cancelled: this.currentJob.cancelled });
    this.currentJob = null;
  }
}

new CyberheldApp();
