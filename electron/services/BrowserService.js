const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { app } = require('electron');

const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteerExtra.use(StealthPlugin());

class BrowserService {
  constructor() {
    this.browser = null;
    const userData = app.getPath('userData');
    this.profilePath = path.join(userData, 'browser-profile');
    fs.ensureDirSync(this.profilePath);
  }

  async initBrowser(headless = false) {
    if (this.browser) return;

    const executablePath = this.resolveBrowserExecutable();
    this.browser = await puppeteerExtra.launch({
      headless,
      executablePath,
      userDataDir: this.profilePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-notifications',
        '--disable-infobars',
        '--window-size=1366,768',
      ],
    });
  }

  resolveBrowserExecutable() {
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
      return process.env.CHROME_PATH;
    }
    const candidates = [];
    if (process.platform === 'win32') {
      candidates.push(
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
      );
    } else if (process.platform === 'darwin') {
      candidates.push(
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
      );
    } else {
      // linux
      candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium');
    }
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    throw new Error('Kein Chrome/Edge gefunden. Setze CHROME_PATH Umgebungsvariable.');
  }

  async takeScreenshot(commentUrl, postId, commentId) {
    if (!this.browser) throw new Error('Browser nicht initialisiert.');
    const page = await this.browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    try {
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );
      await page.goto(commentUrl, { waitUntil: 'networkidle2', timeout: 60_000 });
      await page.waitForTimeout(2_000 + Math.random() * 1000);

      // Einfacher Ansatz Phase 2: FullPage Screenshot
      const userData = app.getPath('userData');
      const dir = path.join(userData, 'screenshots', postId);
      fs.ensureDirSync(dir);
      const filePath = path.join(dir, `${sanitize(commentId)}.png`);
      await page.screenshot({ path: filePath, fullPage: true });
      return filePath;
    } finally {
      await page.close().catch(() => {});
    }
  }

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

function sanitize(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, '_');
}

module.exports = { BrowserService };


