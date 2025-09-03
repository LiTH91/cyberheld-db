const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { app, safeStorage } = require('electron');

const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteerExtra.use(StealthPlugin());

class BrowserService {
  constructor() {
    this.browser = null;
    const userData = app.getPath('userData');
    this.profilePath = path.join(userData, 'browser-profile');
    this.cookiesPath = path.join(userData, 'cookies.bin');
    fs.ensureDirSync(this.profilePath);

    this.slowMode = process.env.STEALTH_SLOW === '1';
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    ];
    this.lastExecutablePath = null;
  }

  async initBrowser(headless = false) {
    if (this.browser) return;

    const executablePath = this.resolveBrowserExecutable();
    this.lastExecutablePath = executablePath;
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

    await this.loadCookies();
  }

  resolveBrowserExecutable(overridePath) {
    if (overridePath && fs.existsSync(overridePath)) {
      return overridePath;
    }
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

  async takeScreenshot(commentUrl, postId, commentId, snippetText) {
    if (!this.browser) throw new Error('Browser nicht initialisiert.');
    const page = await this.browser.newPage();
    // Randomisiere Viewport
    const width = randInt(1280, 1920);
    const height = randInt(720, 1080);
    await page.setViewport({ width, height, deviceScaleFactor: pick([1, 1, 1, 2]) });
    try {
      await page.setUserAgent(pick(this.userAgents));
      await page.setExtraHTTPHeaders({ 'accept-language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7' });
      try { await page.emulateTimezone('Europe/Berlin'); } catch {}

      await page.goto(commentUrl, { waitUntil: 'networkidle2', timeout: 60_000 });
      await this.acceptCookieBanner(page);
      await this.humanizePage(page);
      await page.waitForTimeout(this.slowMode ? randInt(3000, 7000) : randInt(1200, 2500));

      // Versuche zum Kommentar zu scrollen/ankern
      const numericId = this.extractNumericCommentId(commentUrl);
      if (numericId) {
        const ok = await this.scrollToComment(page, numericId);
        if (!ok && snippetText && snippetText.length >= 6) {
          // Fallback: Suche nach Text-Snippet
          await this.searchAndFocusBySnippet(page, snippetText);
        }
        await page.waitForTimeout(randInt(600, 1500));
      }

      // Kontext erweitern ("See more" / "Weitere Kommentare" etc.) und Kommentar mit Offset positionieren
      await this.expandAndPositionForContext(page, numericId, snippetText);

      // Viewport-Screenshot (Kommentar im Fokus mit Kontext darüber/darunter)
      const userData = app.getPath('userData');
      const dir = path.join(userData, 'screenshots', postId);
      fs.ensureDirSync(dir);
      const filePath = path.join(dir, `${sanitize(commentId)}.png`);

      // Erhöhe die Viewport-Höhe für mehr Kontext im Screenshot
      const currentVp = page.viewport();
      const tallHeight = Math.min(Math.max((currentVp?.height || 900) * 2, 1600), 2600);
      await page.setViewport({ width: currentVp?.width || 1366, height: tallHeight, deviceScaleFactor: currentVp?.deviceScaleFactor || 1 });

      await page.waitForTimeout(randInt(400, 1000));
      await page.screenshot({ path: filePath });
      return filePath;
    } finally {
      await page.close().catch(() => {});
    }
  }

  async humanizePage(page) {
    try {
      // Maus bewegen
      const moves = randInt(2, 5);
      for (let i = 0; i < moves; i++) {
        await page.mouse.move(randInt(0, page.viewport().width), randInt(0, page.viewport().height), { steps: randInt(2, 6) });
        await page.waitForTimeout(randInt(200, 800));
      }
      // Scrollen in mehreren Schritten
      const steps = randInt(2, 5);
      for (let s = 0; s < steps; s++) {
        await page.evaluate((dy) => window.scrollBy(0, dy), randInt(200, 600));
        await page.waitForTimeout(randInt(300, 1200));
      }
      // kurze Idle
      await page.waitForTimeout(randInt(500, 1500));
    } catch {}
  }

  extractNumericCommentId(urlStr) {
    try {
      const u = new URL(urlStr);
      const id = u.searchParams.get('comment_id');
      if (id && /\d{5,}/.test(id)) return id;
      // fallback: try to parse digits in URL
      const m = urlStr.match(/comment_id=(\d{5,})/);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }

  async scrollToComment(page, numericId) {
    try {
      const found = await page.evaluate((id) => {
        const target =
          document.querySelector(`div[data-commentid="${id}"]`) ||
          document.querySelector(`a[href*="comment_id=${id}"]`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return true;
        }
        return false;
      }, numericId);
      return !!found;
    } catch {
      return false;
    }
  }

  async findCommentContainer(page, numericId) {
    try {
      // Prefer explicit comment container
      let handle = await page.$(`div[data-commentid="${numericId}"]`);
      if (handle) return handle;

      const link = await page.$(`a[href*="comment_id=${numericId}"]`);
      if (link) {
        // Climb to a reasonable container
        const container = await link.evaluateHandle((el) => {
          return (
            el.closest('div[data-commentid]') ||
            el.closest('div[role="article"]') ||
            el.closest('li') ||
            el.closest('div')
          );
        });
        try { await link.dispose(); } catch {}
        return container;
      }
      return null;
    } catch {
      return null;
    }
  }

  async searchAndFocusBySnippet(page, text) {
    try {
      await page.evaluate((t) => {
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node; let target;
        const needle = t.trim().toLowerCase();
        while ((node = walk.nextNode())) {
          const val = (node.nodeValue || '').trim().toLowerCase();
          if (val && needle && val.includes(needle.slice(0, Math.min(needle.length, 30)))) {
            target = node.parentElement;
            break;
          }
        }
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, text);
      await page.waitForTimeout(randInt(500, 1200));
    } catch {}
  }

  async findContainerBySnippet(page, text) {
    try {
      const handle = await page.evaluateHandle((t) => {
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node; let el = null;
        const needle = t.trim().toLowerCase();
        while ((node = walk.nextNode())) {
          const val = (node.nodeValue || '').trim().toLowerCase();
          if (!val) continue;
          if (needle && val.includes(needle.slice(0, Math.min(needle.length, 30)))) {
            const cand = node.parentElement;
            el = cand.closest('div[data-commentid]') || cand.closest('article') || cand.closest('li') || cand.closest('div');
            break;
          }
        }
        return el;
      }, text);
      return handle;
    } catch {
      return null;
    }
  }

  async expandAndPositionForContext(page, numericId, snippetText) {
    // Versuche Container zu greifen (ID bevorzugt, sonst Snippet)
    let handle = null;
    if (numericId) handle = await this.findCommentContainer(page, numericId);
    if (!handle && snippetText) handle = await this.findContainerBySnippet(page, snippetText);
    if (!handle) return;

    try {
      // Innerhalb des nächstgrößeren Containers Buttons zum Aufklappen klicken
      const clicked = await page.evaluate((el) => {
        const scope = el.closest('article') || el;
        const texts = [
          'see more', 'view more', 'view replies', 'previous comments',
          'mehr anzeigen', 'weitere kommentare', 'vorherige kommentare', 'antworten anzeigen', 'weitere antworten'
        ];
        let count = 0;
        const btns = Array.from(scope.querySelectorAll('button,a'));
        for (const b of btns) {
          const t = (b.innerText || '').toLowerCase();
          if (texts.some((x) => t.includes(x))) {
            try { b.click(); count++; } catch {}
          }
          if (count >= 5) break; // begrenzen
        }
        return count;
      }, handle);
      // kurze Wartezeit nach Aufklappen
      if (clicked) await page.waitForTimeout(randInt(600, 1500));

      // Kommentar im oberen Drittel positionieren
      await page.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const targetY = Math.max(0, rect.top + window.scrollY - Math.round(window.innerHeight * 0.25));
        window.scrollTo({ top: targetY, behavior: 'smooth' });
      }, handle);
      await page.waitForTimeout(randInt(600, 1200));
    } catch {}
    try { await handle.dispose(); } catch {}
  }

  async loginToFacebook() {
    if (!this.browser) await this.initBrowser(false);
    const page = await this.browser.newPage();
    try {
      await page.setViewport({ width: 1366, height: 850 });
      await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await this.acceptCookieBanner(page);

      // Warte bis Login erkennbar (Cookie c_user vorhanden)
      const maxMs = 5 * 60 * 1000; // 5 Minuten
      const start = Date.now();
      while (Date.now() - start < maxMs) {
        const hasCookie = await this.hasCookieNamed(page, 'c_user');
        if (hasCookie) {
          await this.saveCookies();
          return true;
        }
        await page.waitForTimeout(2000);
      }
      throw new Error('Login nicht abgeschlossen (Timeout).');
    } finally {
      await page.close().catch(() => {});
    }
  }

  async hasCookieNamed(page, name) {
    const client = await page.target().createCDPSession();
    const all = await client.send('Network.getAllCookies');
    return (all.cookies || []).some((c) => c.name === name);
  }

  async acceptCookieBanner(page) {
    try {
      // Versuche typische Facebook-Cookie-Buttons zu klicken (mehrsprachig)
      const texts = [
        'Allow essential cookies only',
        'Nur erforderliche Cookies erlauben',
        'Nur essenzielle Cookies erlauben',
        'Erforderliche Cookies erlauben',
        'Nur notwendige Cookies zulassen',
        'Allow all essential cookies',
      ];

      // Erst per bekannte Selektoren
      const selectors = [
        'button[title*="essential"]',
        'button[data-cookiebanner] button',
        'button[aria-label*="essential"]',
      ];
      for (const sel of selectors) {
        const el = await page.$(sel);
        if (el) {
          await el.click({ delay: 50 });
          await page.waitForTimeout(500);
          return;
        }
      }

      // Fallback: Buttons nach Text durchsuchen
      await page.evaluate((textsIn) => {
        const btns = Array.from(document.querySelectorAll('button'));
        for (const b of btns) {
          const t = (b.innerText || '').trim();
          if (textsIn.some((x) => t.toLowerCase().includes(x.toLowerCase()))) {
            b.click();
            break;
          }
        }
      }, texts);
      await page.waitForTimeout(500);
    } catch {}
  }

  async saveCookies() {
    if (!this.browser) return;
    const page = await this.browser.newPage();
    try {
      const client = await page.target().createCDPSession();
      const cookies = (await client.send('Network.getAllCookies')).cookies || [];
      const json = JSON.stringify(cookies);
      let buffer;
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        buffer = safeStorage.encryptString(json);
      } else {
        buffer = Buffer.from(json, 'utf-8');
      }
      fs.writeFileSync(this.cookiesPath, buffer);
    } finally {
      await page.close().catch(() => {});
    }
  }

  async loadCookies() {
    try {
      if (!fs.existsSync(this.cookiesPath) || !this.browser) return;
      const raw = fs.readFileSync(this.cookiesPath);
      let json;
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        try {
          json = safeStorage.decryptString(raw);
        } catch {
          json = raw.toString('utf-8');
        }
      } else {
        json = raw.toString('utf-8');
      }
      const cookies = JSON.parse(json);
      const page = await this.browser.newPage();
      // Setzte Cookies im Kontext
      if (Array.isArray(cookies) && cookies.length) {
        await page.setCookie(...cookies);
      }
      await page.close();
    } catch {}
  }

  async clearCookies() {
    try { fs.unlinkSync(this.cookiesPath); } catch {}
  }

  async getStatus() {
    return {
      cookieSaved: fs.existsSync(this.cookiesPath),
      lastExecutablePath: this.lastExecutablePath,
    };
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

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

module.exports = { BrowserService };


