const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const crypto = require('crypto');
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

      // Kontext erweitern ("See more" / "Weitere Kommentare" etc.)
      await this.expandAndPositionForContext(page, numericId, snippetText);

      // Richte Header oben und Kommentar darunter im selben Viewport aus (bevorzugt)
      const aligned = await this.alignHeaderAndCommentInViewport(page, numericId, snippetText);

      // Ausgabepfad vorbereiten
      const userData = app.getPath('userData');
      const dir = path.join(userData, 'screenshots', postId);
      fs.ensureDirSync(dir);
      const filePath = path.join(dir, `${sanitize(commentId)}.png`);

      // Nach Ausrichtung: Header+Kommentar Region berechnen
      const regionCss = await this.computeHeaderCommentViewport(page, numericId, snippetText);
      const currentVp = page.viewport();
      const maxViewport = 12000; // großzügiger Grenzwert für hohe Kommentare

      if (regionCss && regionCss.height > 0) {
        if (regionCss.height <= maxViewport) {
          await page.setViewport({
            width: currentVp?.width || 1366,
            height: Math.max(1200, Math.min(regionCss.height, maxViewport)),
            deviceScaleFactor: currentVp?.deviceScaleFactor || 1,
          });
          // Scrolle Container so, dass der Bereich beginnt
          await this.scrollContainerTo(page, numericId, snippetText, regionCss.top);
          await page.waitForTimeout(randInt(250, 700));
          await page.screenshot({ path: filePath });
          return filePath;
        }

        // Region höher als Viewport: Fullpage aufnehmen und exakt zuschneiden (Header→Kommentar)
        const okCrop = await this.captureRegionFromFull(page, regionCss.top, regionCss.height, filePath);
        if (okCrop) return filePath;
      }

      // Fallback: Vollseiten-Screenshot vom Seitenanfang
      try {
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'auto' }));
        await page.waitForTimeout(randInt(300, 800));
        await page.screenshot({ path: filePath, fullPage: true });
        return filePath;
      } catch {}
      // Letzter Fallback: normales Viewport-Bild
      await page.screenshot({ path: filePath });
      return filePath;
    } finally {
      await page.close().catch(() => {});
    }
  }

  async takeLikesScreenshot(commentUrl, postId, commentId, snippetText, options = {}) {
    if (!this.browser) throw new Error('Browser nicht initialisiert.');
    const page = await this.browser.newPage();
    // Set a stable viewport for modal capture
    await page.setViewport({ width: 1366, height: 900, deviceScaleFactor: 1 });
    // Relay page console to main terminal for debugging
    try {
      page.on('console', (msg) => {
        try { console.log('[likes][console]', msg.type(), msg.text()); } catch {}
      });
    } catch {}
    try {
      await page.setUserAgent(pick(this.userAgents));
      await page.setExtraHTTPHeaders({ 'accept-language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7' });
      try { await page.emulateTimezone('Europe/Berlin'); } catch {}

      await page.goto(commentUrl, { waitUntil: 'networkidle2', timeout: 60_000 });
      await this.acceptCookieBanner(page);
      await page.waitForTimeout(600);

      // Focus the target comment to make its actions visible
      const numericId = this.extractNumericCommentId(commentUrl);
      if (numericId) {
        const ok = await this.scrollToComment(page, numericId);
        if (!ok && snippetText && snippetText.length >= 6) {
          await this.searchAndFocusBySnippet(page, snippetText);
        }
        await page.waitForTimeout(500);
      }

      // Try to open the likes dialog from within the nearest container
      const opened = await this.openLikesDialogForComment(page, numericId, snippetText);
      if (!opened) throw new Error('Likes-Dialog nicht gefunden/öffnen fehlgeschlagen.');

      // Find scrollable container inside dialog
      let container = await this.findDialogScrollable(page);
      // One-time probe to refine the actual inner scrollable element. We will **not** switch afterwards so
      // that before/after scrollTop and slices always refer to the same element.
      try {
        const refined = await this.findDialogScrollableByProbe(page);
        if (refined) {
          container = refined;
          console.log('[likes] probe selected initial container');
        }
      } catch {}
      if (!container) throw new Error('Scroll-Container im Likes-Dialog nicht gefunden.');
      const mainContainer = container; // pin for the rest of the function

      // Try to detect inner transform container that actually holds the items (virtual list)
      let targetContainer = mainContainer;
      try {
        const inner = await page.evaluateHandle((outer) => {
          // Heuristic: direct child having transform style and taller scrollHeight
          const candidates = Array.from(outer.querySelectorAll(':scope > div'));
          let best = null; let bestScore = -1;
          for (const el of candidates) {
            const dh = el.scrollHeight - el.clientHeight;
            const hasTransform = (el.style.transform || '').includes('translate');
            const score = (hasTransform ? 5000 : 0) + Math.max(0, dh);
            if (score > bestScore) { bestScore = score; best = el; }
          }
          return best || null;
        }, mainContainer);
        if (inner) {
          targetContainer = inner.asElement() || mainContainer;
          console.log('[likes] detected innerContainer');
        }
      } catch {
        targetContainer = mainContainer;
      }

      // Phase 1: Preload entire list by scrolling to bottom until scrollHeight stabilizes
      try {
        let stable = 0;
        let lastH = -1;
        const startMs = Date.now();
        const maxMs = 15000; // 15s preload cap
        for (let i = 0; i < 200; i++) {
          const h = await page.evaluate((el) => el.scrollHeight, mainContainer);
          console.log('[likes] preload', i, 'scrollHeight=', h);
          if (h === lastH) stable++; else stable = 0;
          lastH = h;
          if (stable >= 3) break; // considered fully loaded
          if (Date.now() - startMs > maxMs) { console.log('[likes] preload timeout'); break; }
          const delta = Math.max(300, Math.floor(box.height * 0.8));
          await page.evaluate((el, dy) => { el.scrollTop = el.scrollTop + dy; }, mainContainer, delta);
          await page.waitForTimeout(300);
        }
        // return to top for capture
        await page.evaluate((el) => el.scrollTo(0, 0), mainContainer);
        await page.waitForTimeout(200);
      } catch {}

      // Ensure container can receive focus and wheel events
      try { await page.evaluate((el) => { try { el.tabIndex = -1; el.focus(); } catch {} }, mainContainer); } catch {}

      // Measure geometry
      const box = await mainContainer.boundingBox();
      if (!box) throw new Error('BoundingBox für Likes-Container fehlgeschlagen.');

      // Prefer explicit list/feed element within dialog for scrolling
      let listEl = null;
      try {
        const h = await page.$('div[role="dialog"] [role="list"], div[role="dialog"] [role="feed"]');
        if (h) listEl = h;
      } catch {}
      const scrollEl = listEl || mainContainer;
      const shotEl = listEl || mainContainer;

      // Stitching approach: capture the list/feed (or scroll container) itself after each scroll step
      const buffers = [];
      const overlapPx = 60;
      const addCounterOverlay = !!options.addCounterOverlay;
      const secondBottomPass = !!options.secondBottomPass;
      const seenKeys = new Set();

      // Ensure focus so PageDown/ArrowDown affect the list
      try { await page.evaluate((el)=>{ el.tabIndex = -1; el.focus(); }, scrollEl); } catch {}

      // Prepare CDP client for precise wheel events
      let cdp = null;
      try { cdp = await page.target().createCDPSession(); } catch {}

      // Try to find an inner element that moves via CSS transform (virtualized lists)
      let innerTransformEl = null;
      try {
        const h = await page.evaluateHandle((outer) => {
          const candidates = Array.from(outer.querySelectorAll(':scope > div, :scope > * > div'));
          for (const n of candidates) {
            const t = getComputedStyle(n).transform;
            if (t && t !== 'none') return n;
          }
          return null;
        }, scrollEl);
        innerTransformEl = h?.asElement() || null;
      } catch {}

      let guard = 0;
      let lastHash = '';
      let repeats = 0;
      while (guard++ < 200) {
        // capture current view
        const buf = await shotEl.screenshot({ type: 'png' });
        const hash = crypto.createHash('sha1').update(buf).digest('hex');
        const scrollTopNow = await page.evaluate((el)=>el.scrollTop, scrollEl);
        const transformY = innerTransformEl ? await page.evaluate((el)=>{
          const t = getComputedStyle(el).transform;
          if (!t || t === 'none') return 0;
          const parts = t.includes('matrix3d') ? t.replace('matrix3d(','').replace(')','').split(',') : t.replace('matrix(','').replace(')','').split(',');
          const idx = parts.length > 6 ? 13 : 5;
          const val = parseFloat(parts[idx]);
          return isNaN(val) ? 0 : val;
        }, innerTransformEl) : 0;
        console.log('[likes] slice', buffers.length, 'scrollTop=', scrollTopNow, 'transformY=', transformY, 'hash=', hash);
        if (hash !== lastHash) buffers.push(buf); else console.log('[likes] skipped duplicate slice');
        if (hash === lastHash) repeats++; else repeats = 0;
        lastHash = hash;

        // collect visible identity keys (best effort)
        try {
          const keys = await page.evaluate((el) => {
            const out = [];
            const rows = Array.from(el.querySelectorAll('[role="listitem"], [role="article"], a[role="link"], a[href*="profile" i]'));
            for (const r of rows) {
              const link = r.querySelector('a[href]');
              const href = (link && link.getAttribute('href')) || '';
              let name = '';
              // Try common name containers
              const nameNode = r.querySelector('strong, span, a[role="link"], a[href*="profile" i]');
              if (nameNode) name = (nameNode.textContent || '').trim();
              if (!name) name = (r.textContent || '').trim().split('\n')[0];
              const key = (href + '|' + name).toLowerCase().slice(0, 300);
              if (key && key.length > 1) out.push(key);
            }
            return out;
          }, scrollEl);
          for (const k of (keys || [])) { seenKeys.add(k); }
        } catch {}

        // advance
        const before = await page.evaluate((el)=>({ top: el.scrollTop, client: el.clientHeight, scroll: el.scrollHeight }), scrollEl);
        const step = Math.max(300, Math.floor(before.client * 0.85));
        // primary: CDP wheel at container center
        const bb = await scrollEl.boundingBox();
        if (cdp && bb) {
          try {
            await cdp.send('Input.dispatchMouseWheelEvent', {
              x: Math.round(bb.x + bb.width/2),
              y: Math.round(bb.y + Math.min(bb.height-5, 200)),
              deltaY: Math.max(1000, Math.floor(bb.height*1.3)),
              pointerType: 'mouse'
            });
          } catch {}
        } else {
          await page.evaluate((el, dy)=>{ el.scrollTop = Math.min(el.scrollTop + dy, el.scrollHeight); }, scrollEl, step);
        }
        await page.waitForTimeout(120);
        let after = await page.evaluate((el)=>({ top: el.scrollTop, client: el.clientHeight, scroll: el.scrollHeight }), scrollEl);

        if (Math.abs(after.top - before.top) < 2) {
          // wheel fallback
          if (bb) {
            await page.mouse.move(Math.round(bb.x + bb.width/2), Math.round(bb.y + Math.min(bb.height-5, 200)));
            await page.mouse.wheel({ deltaY: Math.max(900, Math.floor(bb.height*1.5)) });
            await page.waitForTimeout(120);
            after = await page.evaluate((el)=>({ top: el.scrollTop, client: el.clientHeight, scroll: el.scrollHeight }), scrollEl);
          }
        }
        if (Math.abs(after.top - before.top) < 2) {
          await page.evaluate((el)=>{ try { el.dispatchEvent(new WheelEvent('wheel', { deltaY: 1200, bubbles: true })); } catch {} }, scrollEl);
          await page.waitForTimeout(100);
          after = await page.evaluate((el)=>({ top: el.scrollTop, client: el.clientHeight, scroll: el.scrollHeight }), scrollEl);
        }
        if (Math.abs(after.top - before.top) < 2) {
          try { await page.keyboard.press('PageDown'); } catch {}
          await page.waitForTimeout(100);
          try { await page.keyboard.down('ArrowDown'); await page.waitForTimeout(80); await page.keyboard.up('ArrowDown'); } catch {}
          after = await page.evaluate((el)=>({ top: el.scrollTop, client: el.clientHeight, scroll: el.scrollHeight }), scrollEl);
        }
        console.log('[likes] progress', { beforeTop: before.top, afterTop: after.top });

        const atEnd = after.top + after.client >= after.scroll - 2;
        if (atEnd) break;
        if (repeats >= 3) { console.log('[likes] repeated identical slices – stop'); break; }
      }

      // Optional: perform a "second bottom pass" to encourage lazy names loading near the end
      if (secondBottomPass) {
        try {
          console.log('[likes] second-bottom-pass begin');
          for (let j = 0; j < 3; j++) {
            // Jump to bottom
            await page.evaluate((el) => { el.scrollTop = el.scrollHeight; }, scrollEl);
            await page.waitForTimeout(250);
            // Nudge up slightly then back down to trigger additional loads
            await page.evaluate((el) => { el.scrollTop = Math.max(0, el.scrollTop - Math.floor(el.clientHeight * 0.5)); }, scrollEl);
            await page.waitForTimeout(300);
            await page.evaluate((el) => { el.scrollTop = el.scrollHeight; }, scrollEl);
            await page.waitForTimeout(300);

            // Capture one more slice if new
            const buf = await shotEl.screenshot({ type: 'png' });
            const hash = crypto.createHash('sha1').update(buf).digest('hex');
            if (hash !== lastHash) {
              buffers.push(buf);
              lastHash = hash;
              console.log('[likes] second-bottom-pass captured extra slice');
            } else {
              console.log('[likes] second-bottom-pass duplicate slice skipped');
            }

            // collect keys again
            try {
              const keys = await page.evaluate((el) => {
                const out = [];
                const rows = Array.from(el.querySelectorAll('[role="listitem"], [role="article"], a[role="link"], a[href*="profile" i]'));
                for (const r of rows) {
                  const link = r.querySelector('a[href]');
                  const href = (link && link.getAttribute('href')) || '';
                  let name = '';
                  const nameNode = r.querySelector('strong, span, a[role="link"], a[href*="profile" i]');
                  if (nameNode) name = (nameNode.textContent || '').trim();
                  if (!name) name = (r.textContent || '').trim().split('\n')[0];
                  const key = (href + '|' + name).toLowerCase().slice(0, 300);
                  if (key && key.length > 1) out.push(key);
                }
                return out;
              }, scrollEl);
              for (const k of (keys || [])) { seenKeys.add(k); }
            } catch {}
          }
          console.log('[likes] second-bottom-pass end');
        } catch {}
      }

      if (!buffers.length) throw new Error('Keine Slices aufgenommen.');

      // Stitch vertically into final image
      const userData = app.getPath('userData');
      const dir = path.join(userData, 'screenshots_likes', postId);
      fs.ensureDirSync(dir);
      const filePath = path.join(dir, `${sanitize(commentId)}.png`);
      const overlayText = addCounterOverlay ? `Namen gesichtet: ${seenKeys.size}` : null;
      const ok = await this.stitchVertical(buffers, filePath, overlapPx, overlayText);
      if (!ok) throw new Error('Stitching fehlgeschlagen.');
      return filePath;
    } finally {
      await page.close().catch(() => {});
    }
  }

  async openLikesDialogForComment(page, numericId, snippetText) {
    try {
      const handle = numericId ? await this.findCommentContainer(page, numericId) : (snippetText ? await this.findContainerBySnippet(page, snippetText) : null);
      const opened = await page.evaluate(async (el) => {
        const scope = el || document;
        const debug = { stage: 'scan', tried: 0, matched: 0 };
        // Common selectors/texts for likes link/button
        const texts = ['likes', 'gefällt', 'gef 4llt', 'reaktionen', 'reactions', 'people who reacted', 'personen die reagiert', 'personen reagiert'];

        function collectCandidates(root) {
          const arr = [];
          const nodes = root.querySelectorAll('a,button,div[role="button"],span[role="button"],div[aria-label],span[aria-label]');
          nodes.forEach((n) => arr.push(n));
          return arr;
        }

        const near = collectCandidates(scope);
        const global = collectCandidates(document);
        const all = [...near, ...global];
        debug.tried = all.length;

        // Score candidates: prefer ones with matching text/aria or href, and closest to comment container
        const centerY = (el ? (el.getBoundingClientRect().top + el.getBoundingClientRect().bottom) / 2 : (window.innerHeight/2));
        let best = null; let bestScore = -1;
        for (const cand of all) {
          const text = ((cand.innerText || '') + ' ' + (cand.getAttribute('aria-label') || '')).toLowerCase();
          const href = (cand.getAttribute('href') || '').toLowerCase();
          const rect = cand.getBoundingClientRect();
          const distance = Math.abs(((rect.top + rect.bottom) / 2) - centerY);
          let score = 0;
          if (texts.some(x => text.includes(x))) score += 6;
          if (/reaction|ufi|browser|profile\/browser/.test(href)) score += 4;
          if (/\d/.test(text)) score += 1; // numbers often part of likes count
          // clickable heuristic
          if (cand.tagName === 'A' || cand.tagName === 'BUTTON' || cand.getAttribute('role') === 'button') score += 2;
          // closer is better
          score += Math.max(0, 3 - Math.min(3, Math.round(distance / 200)));
          if (score > bestScore) { bestScore = score; best = cand; }
        }
        debug.matched = bestScore;
        if (best) {
          try {
            best.scrollIntoView({ block: 'center' });
            // simulate robust click
            const ev1 = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window });
            const ev2 = new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window });
            best.dispatchEvent(ev1);
            best.dispatchEvent(ev2);
            best.click();
            return { ok: true, debug };
          } catch {
            return { ok: false, debug };
          }
        }
        return { ok: false, debug };
      }, handle);
      try { if (handle) await handle.dispose(); } catch {}
      if (!opened || (opened && opened.ok === false)) {
        console.log('[likes] open failed', opened?.debug || opened);
        return false;
      }
      console.log('[likes] open ok', opened?.debug || opened);
      // wait for dialog; also check for profile browser overlays
      await page.waitForSelector('div[role="dialog"], [data-pagelet*="root" i] div[role="dialog"], div[aria-modal="true"]', { timeout: 5000 });
      // if dialog didn't appear, try keyboard open on focused element (sometimes opens reactions)
      const hasDlg = await page.$('div[role="dialog"], div[aria-modal="true"]');
      if (!hasDlg) {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        await page.waitForSelector('div[role="dialog"], div[aria-modal="true"]', { timeout: 4000 });
      }
      await page.waitForTimeout(400);
      return true;
    } catch {
      return false;
    }
  }

  async findDialogScrollable(page) {
    try {
      const dlg = await page.$('div[role="dialog"]');
      if (!dlg) return null;
      // search inside dialog for first overflowing element
      const scrollable = await page.evaluateHandle((dialog) => {
        let best = null; let bestScore = -1;
        const els = dialog.querySelectorAll('*');
        for (const n of els) {
          const cs = getComputedStyle(n);
          const overflowY = cs.overflowY;
          const dh = n.scrollHeight - n.clientHeight;
          const isRoleList = n.getAttribute('role') === 'list' || n.getAttribute('role') === 'feed';
          if ((/(auto|scroll)/.test(overflowY) || isRoleList) && dh > 10) {
            const score = dh + (isRoleList ? 500 : 0);
            if (score > bestScore) { bestScore = score; best = n; }
          }
        }
        return best;
      }, dlg);
      try { await dlg.dispose(); } catch {}
      return scrollable.asElement();
    } catch {
      return null;
    }
  }

  async findDialogScrollableByProbe(page) {
    try {
      const dlg = await page.$('div[role="dialog"]');
      if (!dlg) return null;
      const indexes = await page.evaluate((dialog) => {
        const nodes = Array.from(dialog.querySelectorAll('*'));
        let bestIdx = -1; let bestScore = -1;
        nodes.forEach((n, idx) => {
          const cs = getComputedStyle(n);
          const hasOverflow = /auto|scroll/.test(cs.overflowY);
          const dh = n.scrollHeight - n.clientHeight;
          const isRoleList = n.getAttribute('role') === 'list' || n.getAttribute('role') === 'feed';
          const score = (hasOverflow ? 1000 : 0) + (isRoleList ? 500 : 0) + Math.max(0, dh);
          if (dh > 10 && score > bestScore) { bestScore = score; bestIdx = idx; }
        });
        return { bestIdx };
      }, dlg);
      if (indexes && indexes.bestIdx >= 0) {
        const all = await page.$$('div[role="dialog"] *');
        try { await dlg.dispose(); } catch {}
        return all[indexes.bestIdx] || null;
      }
      try { await dlg.dispose(); } catch {}
      return null;
    } catch {
      return null;
    }
  }

  async stitchVertical(buffers, outPath, overlapPx = 0, overlayText = null) {
    try {
      const page = await this.browser.newPage();
      try {
        await page.setContent('<html><head><meta charset="utf-8"/></head><body style="margin:0;padding:0;background:#fff"></body></html>');
        const dataUrls = buffers.map(b => `data:image/png;base64,${b.toString('base64')}`);
        const stitched = await page.evaluate(async (srcs, overlap, textOverlay) => {
          function load(src) {
            return new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () => resolve(img);
              img.onerror = reject;
              img.src = src;
            });
          }
          const imgs = [];
          for (const s of srcs) { imgs.push(await load(s)); }
          const width = Math.max(...imgs.map(i => i.width));
          const totalHeight = imgs.reduce((acc, img, idx) => acc + (idx === 0 ? img.height : Math.max(0, img.height - overlap)), 0);
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = totalHeight;
          const ctx = canvas.getContext('2d');
          let y = 0;
          for (let i = 0; i < imgs.length; i++) {
            const img = imgs[i];
            if (i === 0) {
              ctx.drawImage(img, 0, 0);
              y += img.height;
            } else {
              const sy = Math.min(overlap, img.height - 1);
              const sh = img.height - sy;
              ctx.drawImage(img, 0, sy, img.width, sh, 0, y - overlap, img.width, sh);
              y += sh;
            }
          }
          if (textOverlay && typeof textOverlay === 'string' && textOverlay.length > 0) {
            ctx.save();
            const paddingX = 10, paddingY = 6;
            ctx.font = '16px sans-serif';
            const metrics = ctx.measureText(textOverlay);
            const bw = Math.ceil(metrics.width + paddingX * 2);
            const bh = 28;
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fillRect(8, 8, bw, bh);
            ctx.strokeStyle = 'rgba(0,0,0,0.15)';
            ctx.strokeRect(8, 8, bw, bh);
            ctx.fillStyle = '#111';
            ctx.fillText(textOverlay, 8 + paddingX, 8 + bh - Math.floor((bh - 16) / 2) - 6);
            ctx.restore();
          }
          return canvas.toDataURL('image/png');
        }, dataUrls, overlapPx, overlayText);

        // Write the stitched image
        const base64 = stitched.split(',')[1];
        const buf = Buffer.from(base64, 'base64');
        fs.writeFileSync(outPath, buf);
        return true;
      } finally {
        try { await page.close(); } catch {}
      }
    } catch {
      return false;
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

  async computeHeaderCommentViewport(page, numericId, snippetText) {
    try {
      const result = await page.evaluate((id, snippet) => {
        function findCommentEl(commentId, text) {
          let el = null;
          if (commentId) {
            el = document.querySelector(`div[data-commentid="${commentId}"]`);
            if (!el) {
              const link = document.querySelector(`a[href*="comment_id=${commentId}"]`);
              if (link) el = link.closest('div[data-commentid]') || link.closest('article') || link.closest('li') || link.closest('div');
            }
          }
          if (!el && text) {
            const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let node;
            const needle = text.trim().toLowerCase().slice(0, 30);
            while ((node = walk.nextNode())) {
              const val = (node.nodeValue || '').trim().toLowerCase();
              if (val && needle && val.includes(needle)) {
                const cand = node.parentElement;
                el = cand.closest('div[data-commentid]') || cand.closest('article') || cand.closest('li') || cand.closest('div');
                break;
              }
            }
          }
          return el;
        }

        const commentEl = findCommentEl(id, snippet);
        if (!commentEl) return null;

        // Ermittle Post-Header bzw. Post-Container
        let postEl = commentEl.closest('article') || document.querySelector('article') || document.querySelector('div[role="article"]');
        let headerEl = null;
        if (postEl) {
          headerEl = postEl.querySelector('header') || postEl.querySelector('[role="heading"]') || postEl.querySelector('h1,h2,h3');
        }

        const commentRect = commentEl.getBoundingClientRect();
        const hdrRectBase = (headerEl || postEl)?.getBoundingClientRect();
        const headerRect = hdrRectBase || { top: 0, bottom: 0, left: 0, right: document.documentElement.clientWidth };

        const docWidth = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
        const topY = Math.max(0, Math.min(headerRect.top, commentRect.top) + window.scrollY - 40);
        const bottomY = Math.max(headerRect.bottom, commentRect.bottom) + window.scrollY + 40;
        const height = Math.ceil(bottomY - topY);
        return { top: topY, height, width: docWidth };
      }, numericId, snippetText);
      return result;
    } catch {
      return null;
    }
  }

  async computeRegionInScrollableContainer(page, numericId, snippetText) {
    try {
      return await page.evaluate((id, snippet) => {
        function findCommentEl(commentId, text) {
          let el = null;
          if (commentId) {
            el = document.querySelector(`div[data-commentid="${commentId}"]`);
            if (!el) {
              const link = document.querySelector(`a[href*="comment_id=${commentId}"]`);
              if (link) el = link.closest('div[data-commentid]') || link.closest('article') || link.closest('li') || link.closest('div');
            }
          }
          if (!el && text) {
            const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let node;
            const needle = text.trim().toLowerCase().slice(0, 30);
            while ((node = walk.nextNode())) {
              const val = (node.nodeValue || '').trim().toLowerCase();
              if (val && needle && val.includes(needle)) {
                const cand = node.parentElement;
                el = cand.closest('div[data-commentid]') || cand.closest('article') || cand.closest('li') || cand.closest('div');
                break;
              }
            }
          }
          return el;
        }

        const commentEl = findCommentEl(id, snippet);
        if (!commentEl) return null;

        // finde den tatsächlichen Scroll-Container (der erste ancestor mit overflow-y: auto/scroll)
        function findScrollContainer(el) {
          let n = el.parentElement;
          while (n && n !== document.body) {
            const cs = getComputedStyle(n);
            if (/(auto|scroll)/.test(cs.overflowY)) return n;
            n = n.parentElement;
          }
          return document.scrollingElement || document.documentElement;
        }
        const scrollEl = findScrollContainer(commentEl);

        // Post-Header innerhalb desselben Posts/Artikels
        let postEl = commentEl.closest('article') || document.querySelector('article') || document.querySelector('div[role="article"]');
        let headerEl = postEl ? (postEl.querySelector('header') || postEl.querySelector('[role="heading"]') || postEl.querySelector('h1,h2,h3')) : null;

        // Bounding-Rects relativ zur Seite
        const commentRect = commentEl.getBoundingClientRect();
        const hdrRectBase = (headerEl || postEl)?.getBoundingClientRect();
        const headerRect = hdrRectBase || { top: 0, bottom: 0 };

        // Zielbereich: von Header-Top bis Kommentar-Bottom
        const start = Math.max(0, Math.min(headerRect.top, commentRect.top) + window.scrollY - 20);
        const end = Math.max(headerRect.bottom, commentRect.bottom) + window.scrollY + 20;
        const heightNeeded = Math.ceil(end - start);

        // Starte Scrollposition so, dass der Start des Bereichs oben im Container liegt
        let startScrollTop = start;
        if (scrollEl !== document.scrollingElement && scrollEl !== document.documentElement) {
          // Transformiere Seiten-Y in Container-Y
          const cRect = scrollEl.getBoundingClientRect();
          const containerTopGlobal = cRect.top + window.scrollY;
          startScrollTop = Math.max(0, start - containerTopGlobal + scrollEl.scrollTop);
        }

        return { startScrollTop, heightNeeded };
      }, numericId, snippetText);
    } catch {
      return null;
    }
  }

  async scrollContainerTo(page, numericId, snippetText, targetTop) {
    try {
      await page.evaluate((id, snippet, top) => {
        function findCommentEl(commentId, text) {
          let el = null;
          if (commentId) {
            el = document.querySelector(`div[data-commentid="${commentId}"]`);
            if (!el) {
              const link = document.querySelector(`a[href*="comment_id=${commentId}"]`);
              if (link) el = link.closest('div[data-commentid]') || link.closest('article') || link.closest('li') || link.closest('div');
            }
          }
          if (!el && text) {
            const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let node;
            const needle = text.trim().toLowerCase().slice(0, 30);
            while ((node = walk.nextNode())) {
              const val = (node.nodeValue || '').trim().toLowerCase();
              if (val && needle && val.includes(needle)) {
                const cand = node.parentElement;
                el = cand.closest('div[data-commentid]') || cand.closest('article') || cand.closest('li') || cand.closest('div');
                break;
              }
            }
          }
          return el;
        }
        const commentEl = findCommentEl(id, snippet);
        if (!commentEl) return;
        function findScrollContainer(el) {
          let n = el.parentElement;
          while (n && n !== document.body) {
            const cs = getComputedStyle(n);
            if (/(auto|scroll)/.test(cs.overflowY)) return n;
            n = n.parentElement;
          }
          return document.scrollingElement || document.documentElement;
        }
        const scrollEl = findScrollContainer(commentEl);
        if (scrollEl === document.scrollingElement || scrollEl === document.documentElement) {
          window.scrollTo({ top, behavior: 'auto' });
        } else {
          scrollEl.scrollTo({ top, behavior: 'auto' });
        }
      }, numericId, snippetText, Math.max(0, Math.floor(targetTop || 0)));
      await page.waitForTimeout(randInt(200, 600));
    } catch {}
  }

  async alignHeaderAndCommentInViewport(page, numericId, snippetText) {
    try {
      const data = await page.evaluate((id, snippet) => {
        function findCommentEl(commentId, text) {
          let el = null;
          if (commentId) {
            el = document.querySelector(`div[data-commentid="${commentId}"]`);
            if (!el) {
              const link = document.querySelector(`a[href*="comment_id=${commentId}"]`);
              if (link) el = link.closest('div[data-commentid]') || link.closest('article') || link.closest('li') || link.closest('div');
            }
          }
          if (!el && text) {
            const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let node;
            const needle = text.trim().toLowerCase().slice(0, 30);
            while ((node = walk.nextNode())) {
              const val = (node.nodeValue || '').trim().toLowerCase();
              if (val && needle && val.includes(needle)) {
                const cand = node.parentElement;
                el = cand.closest('div[data-commentid]') || cand.closest('article') || cand.closest('li') || cand.closest('div');
                break;
              }
            }
          }
          return el;
        }

        const commentEl = findCommentEl(id, snippet);
        if (!commentEl) return null;

        // Scrollcontainer ermitteln
        function findScrollContainer(el) {
          let n = el.parentElement;
          while (n && n !== document.body) {
            const cs = getComputedStyle(n);
            if (/(auto|scroll)/.test(cs.overflowY)) return n;
            n = n.parentElement;
          }
          return document.scrollingElement || document.documentElement;
        }
        const scrollEl = findScrollContainer(commentEl);

        // Post und Header lokalisieren
        const postEl = commentEl.closest('article') || document.querySelector('article') || document.querySelector('div[role="article"]');
        const headerEl = postEl ? (postEl.querySelector('header') || postEl.querySelector('[role="heading"]') || postEl.querySelector('h1,h2,h3')) : null;
        const headerRect = (headerEl || postEl)?.getBoundingClientRect();
        const commentRect = commentEl.getBoundingClientRect();
        if (!headerRect) return null;

        const viewportH = window.innerHeight || document.documentElement.clientHeight || 900;
        // Ziel: Header im oberen Drittel (10% von oben), Kommentar unterhalb sichtbar
        const headerTargetY = Math.max(0, Math.round(viewportH * 0.1));
        const deltaToTop = (headerRect.top - headerTargetY);

        function performScroll(scrollNode, dy) {
          if (scrollNode === document.scrollingElement || scrollNode === document.documentElement) {
            window.scrollBy({ top: dy, behavior: 'auto' });
          } else {
            scrollNode.scrollTop += dy;
          }
        }

        // Grob-Scroll: Header auf Zielposition bringen
        performScroll(scrollEl, Math.round(deltaToTop));
        // Nach dem Scroll neue Positionen messen
        const headerRect2 = (headerEl || postEl)?.getBoundingClientRect();
        const commentRect2 = commentEl.getBoundingClientRect();

        // Wenn Kommentar nicht sichtbar, feinanpassen: so scrollen, dass Kommentar-Bottom im Viewport ist
        const commentBottom = commentRect2.bottom;
        const overBottom = commentBottom - (window.innerHeight || 900) + 20; // 20px Puffer
        if (overBottom > 0) {
          performScroll(scrollEl, Math.round(overBottom));
        }

        // Ergebnis prüfen
        const finalHeader = (headerEl || postEl)?.getBoundingClientRect();
        const finalComment = commentEl.getBoundingClientRect();
        const headerOk = finalHeader.top >= 0 && finalHeader.top <= Math.round((window.innerHeight || 900) * 0.2);
        const commentOk = finalComment.top >= finalHeader.bottom - 10 && finalComment.bottom <= (window.innerHeight || 900) + 5;
        return { ok: headerOk && commentOk };
      }, numericId, snippetText);
      return data || { ok: false };
    } catch {
      return { ok: false };
    }
  }

  async computeTopToCommentRegion(page, numericId, snippetText) {
    try {
      const result = await page.evaluate((id, snippet) => {
        function findCommentEl(commentId, text) {
          let el = null;
          if (commentId) {
            el = document.querySelector(`div[data-commentid="${commentId}"]`);
            if (!el) {
              const link = document.querySelector(`a[href*="comment_id=${commentId}"]`);
              if (link) el = link.closest('div[data-commentid]') || link.closest('article') || link.closest('li') || link.closest('div');
            }
          }
          if (!el && text) {
            const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let node;
            const needle = text.trim().toLowerCase().slice(0, 30);
            while ((node = walk.nextNode())) {
              const val = (node.nodeValue || '').trim().toLowerCase();
              if (val && needle && val.includes(needle)) {
                const cand = node.parentElement;
                el = cand.closest('div[data-commentid]') || cand.closest('article') || cand.closest('li') || cand.closest('div');
                break;
              }
            }
          }
          return el;
        }

        const commentEl = findCommentEl(id, snippet);
        if (!commentEl) return null;
        const rect = commentEl.getBoundingClientRect();
        const bottomY = rect.bottom + window.scrollY + 40; // etwas Rand
        const widthCss = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
        return { heightCss: Math.ceil(Math.max(200, bottomY)), widthCss };
      }, numericId, snippetText);
      return result;
    } catch {
      return null;
    }
  }

  async captureTopToCommentScreenshotFromFull(page, targetHeightCss, outPath) {
    try {
      // Erzeuge FullPage-Screenshot in Memory
      const vp = page.viewport();
      const fullBuf = await page.screenshot({ type: 'png', fullPage: true });
      const fullB64 = fullBuf.toString('base64');

      // Skaliere CSS-Höhe in Bildpixel
      const scale = (fullBuf && vp?.width) ? (await (async () => {
        // full image width in px is unknown here; derive by loading into a temp page and reading naturalWidth
        const p = await page.browser().newPage();
        try {
          await p.setContent('<html><head><meta charset="utf-8"/></head><body style="margin:0;padding:0;background:#fff"></body></html>');
          await p.addStyleTag({ content: 'html,body{margin:0;padding:0;}' });
          await p.evaluate((src) => {
            const img = document.createElement('img');
            img.id = 'img';
            img.src = src;
            img.style.display = 'block';
            document.body.appendChild(img);
          }, `data:image/png;base64,${fullB64}`);
          await p.waitForSelector('#img');
          const dims = await p.evaluate(() => {
            const img = document.getElementById('img');
            return { w: img.naturalWidth, h: img.naturalHeight };
          });
          const cssWidth = vp?.width || 1366;
          const s = Math.max(1, Math.round((dims.w / cssWidth) * 1000) / 1000);
          // Setze exakte Viewport-Größe für Cropping
          const targetPxHeight = Math.min(dims.h, Math.max(200, Math.floor(targetHeightCss * s)));
          const maxCrop = 16000; // Schutzlimit je nach Chrome-Restriktionen
          const cropHeight = Math.min(targetPxHeight, maxCrop);
          await p.setViewport({ width: dims.w, height: cropHeight, deviceScaleFactor: 1 });
          // Stelle sicher, dass Bild ohne Skalierung angezeigt wird
          await p.evaluate(() => {
            const img = document.getElementById('img');
            img.style.width = 'auto';
            img.style.height = 'auto';
          });
          await p.waitForTimeout(100);
          await p.screenshot({ path: outPath, type: 'png' });
          return true;
        } catch {
          return false;
        } finally {
          try { await p.close(); } catch {}
        }
      })()) : 1;
      return !!scale; // true wenn oben erfolgreich
    } catch {
      return false;
    }
  }

  async captureRegionFromFull(page, regionTopCss, regionHeightCss, outPath) {
    try {
      const vp = page.viewport();
      const fullBuf = await page.screenshot({ type: 'png', fullPage: true });
      const fullB64 = fullBuf.toString('base64');
      const p = await page.browser().newPage();
      try {
        await p.setContent('<html><head><meta charset="utf-8"/></head><body style="margin:0;padding:0;background:#fff"></body></html>');
        await p.addStyleTag({ content: 'html,body{margin:0;padding:0;}' });
        await p.evaluate((src) => {
          const img = document.createElement('img');
          img.id = 'img';
          img.src = src;
          img.style.display = 'block';
          document.body.appendChild(img);
        }, `data:image/png;base64,${fullB64}`);
        await p.waitForSelector('#img');
        const dims = await p.evaluate(() => {
          const img = document.getElementById('img');
          return { w: img.naturalWidth, h: img.naturalHeight };
        });
        const cssWidth = vp?.width || 1366;
        const scale = Math.max(1, Math.round((dims.w / cssWidth) * 1000) / 1000);
        const targetPxTop = Math.max(0, Math.floor(regionTopCss * scale));
        const targetPxHeight = Math.min(dims.h, Math.max(200, Math.floor(regionHeightCss * scale)));
        const maxCrop = 20000;
        const cropHeight = Math.min(targetPxHeight, maxCrop);
        await p.setViewport({ width: dims.w, height: cropHeight, deviceScaleFactor: 1 });
        await p.evaluate((y) => window.scrollTo(0, y), targetPxTop);
        await p.waitForTimeout(50);
        await p.screenshot({ path: outPath, type: 'png' });
        return true;
      } catch {
        return false;
      } finally {
        try { await p.close(); } catch {}
      }
    } catch {
      return false;
    }
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



