const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { DatabaseService } = require('./services/DatabaseService');
const { BrowserService } = require('./services/BrowserService');

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

class CyberheldApp {
  constructor() {
    this.mainWindow = null;
    this.dbService = new DatabaseService();
    this.browserService = new BrowserService();
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
        return result;
      } catch (error) {
        console.error('Error importing JSON:', error);
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
        const filePath = await this.browserService.takeScreenshot(req.commentUrl, req.postId, req.commentId || req.id || req.comment_id || req);
        // Update DB
        await this.dbService.updateCommentScreenshot(req.commentId || req.id, filePath);
        return { success: true, screenshotPath: filePath };
      } catch (error) {
        return { success: false, error: error?.message || String(error) };
      }
    });

    // Batch screenshots
    ipcMain.handle(IPC_CHANNELS.TAKE_SCREENSHOTS_BATCH, async (_evt, req) => {
      const results = { success: true, completed: 0, failed: 0, errors: [] };
      for (const c of req.comments) {
        try {
          const filePath = await this.browserService.takeScreenshot(c.url, req.postId, c.id);
          await this.dbService.updateCommentScreenshot(c.id, filePath);
          results.completed += 1;
          // kleine Pause
          await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
        } catch (e) {
          results.failed += 1;
          results.errors.push({ commentId: c.id, error: e?.message || String(e) });
        }
      }
      return results;
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
  }
}

new CyberheldApp();
