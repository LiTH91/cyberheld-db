const path = require('path');
const fs = require('fs-extra');
const puppeteerExtra = require('puppeteer-extra');

class ExportService {
  constructor() {}

  async exportJson(filePath, post, comments) {
    const payload = { post, comments };
    await fs.writeJson(filePath, payload, { spaces: 2 });
    return filePath;
  }

  async exportPdf(filePath, post, comments) {
    const html = this.buildHtmlReport(post, comments);
    const executablePath = this.resolveBrowserExecutable();
    const browser = await puppeteerExtra.launch({ headless: true, executablePath });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.pdf({ path: filePath, format: 'A4', printBackground: true, margin: { top: '20mm', bottom: '20mm' } });
      return filePath;
    } finally {
      await browser.close();
    }
  }

  buildHtmlReport(post, comments) {
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rows = comments.map((c) => {
      const meta = JSON.parse(c.metadata);
      let img = '<div style="color:#888;">Kein Screenshot</div>';
      try {
        if (c.screenshot_path && fs.existsSync(c.screenshot_path)) {
          const buf = fs.readFileSync(c.screenshot_path);
          const b64 = buf.toString('base64');
          img = `<img src="data:image/png;base64,${b64}" style="max-width:100%; max-height:500px; border:1px solid #ddd; border-radius:6px;" />`;
        }
      } catch {}
      return `
        <section style="margin: 16px 0; padding:12px; border:1px solid #e5e7eb; border-radius:8px;">
          <div style="font-weight:600; font-size:14px;">${esc(meta.profileName || '')}</div>
          <div style="color:#555; font-size:12px; margin-bottom:8px;">${esc(new Date(meta.date || c.timestamp_captured).toLocaleString('de-DE'))}</div>
          <div style="white-space:pre-wrap; margin-bottom:8px;">${esc(meta.text || '')}</div>
          <div style="font-size:12px; color:#666; margin-bottom:8px;">Likes: ${esc(meta.likesCount || 0)} · Antworten: ${esc(meta.commentsCount || 0)}</div>
          ${img}
        </section>
      `;
    }).join('\n');

    return `<!doctype html>
      <html lang="de">
        <head>
          <meta charset="utf-8" />
          <title>Export - ${esc(post?.title || post?.id || '')}</title>
          <style>
            body { font-family: Arial, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, sans-serif; padding: 16px; color:#111827; }
            h1 { font-size: 20px; margin: 0 0 4px 0; }
            .muted { color:#6b7280; font-size:12px; }
          </style>
        </head>
        <body>
          <h1>${esc(post?.title || 'Post')}</h1>
          <div class="muted">URL: ${esc(post?.url || '')}</div>
          <div class="muted">Kommentare: ${comments.length}</div>
          ${rows}
        </body>
      </html>`;
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
      candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium');
    }
    for (const p of candidates) { if (fs.existsSync(p)) return p; }
    throw new Error('Kein Chrome/Edge für PDF Export gefunden. Setze CHROME_PATH.');
  }
}

module.exports = { ExportService };


