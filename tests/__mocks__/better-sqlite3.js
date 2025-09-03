class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.trim().toUpperCase();
  }
  run(...args) {
    const s = this.sql;
    if (s.startsWith('INSERT INTO POSTS')) {
      const [id, url, title, ts, metadata, filename] = args;
      this.db.posts.push({ id, url, title, timestamp_captured: ts, metadata, filename });
      return { changes: 1 };
    }
    if (s.startsWith('INSERT INTO COMMENTS')) {
      const [id, post_id, url, ts, metadata, checksum_comment_text] = args;
      this.db.comments.push({ id, post_id, url, timestamp_captured: ts, metadata, checksum_comment_text, screenshot_path: null, checksum_screenshot: null, last_error: null, last_attempt_at: null });
      return { changes: 1 };
    }
    if (s.startsWith('UPDATE COMMENTS SET SCREENSHOT_PATH = ?, CHECKSUM_SCREENSHOT = ?, LAST_ERROR = NULL, LAST_ATTEMPT_AT = ? WHERE ID = ?')) {
      const [path, checksum, lastAttempt, id] = args;
      const c = this.db.comments.find(x => x.id === id);
      if (c) { c.screenshot_path = path; c.checksum_screenshot = checksum; c.last_error = null; c.last_attempt_at = lastAttempt; }
      return { changes: c ? 1 : 0 };
    }
    if (s.startsWith('UPDATE COMMENTS SET SCREENSHOT_PATH = NULL, CHECKSUM_SCREENSHOT = NULL WHERE ID = ?')) {
      const [id] = args;
      const c = this.db.comments.find(x => x.id === id);
      if (c) { c.screenshot_path = null; c.checksum_screenshot = null; }
      return { changes: c ? 1 : 0 };
    }
    return { changes: 0 };
  }
  get(...args) {
    const s = this.sql;
    if (s.startsWith('SELECT * FROM COMMENTS WHERE ID = ?')) {
      const [id] = args;
      return this.db.comments.find(x => x.id === id) || null;
    }
    if (s.startsWith('SELECT SCREENSHOT_PATH, CHECKSUM_SCREENSHOT FROM COMMENTS WHERE ID = ?')) {
      const [id] = args;
      const c = this.db.comments.find(x => x.id === id);
      return c ? { screenshot_path: c.screenshot_path, checksum_screenshot: c.checksum_screenshot } : null;
    }
    return null;
  }
  all(..._args) {
    const s = this.sql;
    if (s.startsWith('PRAGMA TABLE_INFO(COMMENTS)')) {
      // return columns present
      return [
        { name: 'id' },
        { name: 'post_id' },
        { name: 'url' },
        { name: 'timestamp_captured' },
        { name: 'metadata' },
        { name: 'screenshot_path' },
        { name: 'checksum_screenshot' },
        { name: 'checksum_comment_text' },
        { name: 'last_error' },
        { name: 'last_attempt_at' }
      ];
    }
    return [];
  }
}

class FakeDatabase {
  constructor(_dbPath) {
    this.posts = [];
    this.comments = [];
  }
  pragma(_p) { /* no-op */ }
  exec(_sql) { /* no-op for DDL */ }
  prepare(sql) { return new FakeStatement(this, sql); }
  transaction(fn) {
    return (...args) => fn(...args);
  }
  close() { /* no-op */ }
}

module.exports = FakeDatabase;


