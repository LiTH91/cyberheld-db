const path = require('path');
const fs = require('fs-extra');

describe('DatabaseService (checksum/storage)', () => {
  let DatabaseService;
  let svc;

  beforeAll(() => {
    jest.resetModules();
    jest.mock('better-sqlite3');
    jest.mock('electron', () => ({ app: { getPath: () => require('path').join(__dirname, '.tmp-app') } }));
    DatabaseService = require('../electron/services/DatabaseService').DatabaseService;
  });

  beforeEach(async () => {
    fs.removeSync(path.join(__dirname, '.tmp-app'));
    svc = new DatabaseService();
    await svc.initialize();
  });

  afterEach(async () => {
    await svc.close();
  });

  test('updateCommentScreenshot stores checksum and clears on delete', async () => {
    // insert minimal post/comment
    const db = svc.db;
    db.prepare(`INSERT INTO posts (id, url, title, timestamp_captured, metadata, filename) VALUES (?,?,?,?,?,?)`).run(
      'post-1', 'http://x', 't', Date.now(), '{}', 'f.json'
    );
    db.prepare(`INSERT INTO comments (id, post_id, url, timestamp_captured, metadata, checksum_comment_text) VALUES (?,?,?,?,?,?)`).run(
      'c1', 'post-1', 'http://c', Date.now(), '{}', 'x'
    );

    const imgPath = path.join(__dirname, 'fixtures', 'tiny.png');
    fs.ensureDirSync(path.dirname(imgPath));
    // 1x1 png buffer
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108020000009077053e0000000a49444154789c6360000002000100ffff03000006000557bf2a0000000049454e44ae426082',
      'hex'
    );
    fs.writeFileSync(imgPath, png);

    await svc.updateCommentScreenshot('c1', imgPath);
    const row = db.prepare('SELECT screenshot_path, checksum_screenshot FROM comments WHERE id = ?').get('c1');
    expect(row.screenshot_path).toBe(imgPath);
    expect(row.checksum_screenshot).toHaveLength(64);

    await svc.clearCommentScreenshot('c1');
    const row2 = db.prepare('SELECT screenshot_path, checksum_screenshot FROM comments WHERE id = ?').get('c1');
    expect(row2.screenshot_path).toBeNull();
    expect(row2.checksum_screenshot).toBeNull();
  });
});


