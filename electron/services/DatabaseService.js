const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { app } = require('electron');

class DatabaseService {
  constructor() {
    this.db = null;
    const userDataPath = app.getPath('userData');
    const dataDir = path.join(userDataPath, 'data');
    fs.ensureDirSync(dataDir);
    this.dbPath = path.join(dataDir, 'cyberheld.db');
  }

  async initialize() {
    this.db = new Database(this.dbPath);
    
    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');
    
    this.createTables();
    this.addMissingColumns();
  }

  createTables() {
    if (!this.db) throw new Error('Database not initialized');

    // Posts table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        timestamp_captured INTEGER NOT NULL,
        metadata TEXT NOT NULL,
        checksum_post TEXT,
        filename TEXT NOT NULL
      )
    `);

    // Comments table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL,
        url TEXT NOT NULL,
        timestamp_captured INTEGER NOT NULL,
        screenshot_path TEXT,
        metadata TEXT NOT NULL,
        checksum_screenshot TEXT,
        checksum_comment_text TEXT,
        -- AI analysis fields (nullable by default)
        is_negative INTEGER DEFAULT 0,
        confidence_score REAL,
        reasoning TEXT,
        ai_model TEXT,
        ai_analyzed_at INTEGER,
        FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE
      )
    `);

    // Create indexes for better performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments (post_id);
      CREATE INDEX IF NOT EXISTS idx_comments_url ON comments (url);
      CREATE INDEX IF NOT EXISTS idx_posts_filename ON posts (filename);
    `);
  }

  addMissingColumns() {
    if (!this.db) return;
    try {
      const cols = this.db.prepare('PRAGMA table_info(comments)').all();
      const names = new Set(cols.map((c) => c.name));
      if (!names.has('last_error')) {
        this.db.exec('ALTER TABLE comments ADD COLUMN last_error TEXT');
      }
      if (!names.has('last_attempt_at')) {
        this.db.exec('ALTER TABLE comments ADD COLUMN last_attempt_at INTEGER');
      }
      // AI analysis related columns
      if (!names.has('is_negative')) {
        this.db.exec('ALTER TABLE comments ADD COLUMN is_negative INTEGER DEFAULT 0');
      }
      if (!names.has('confidence_score')) {
        this.db.exec('ALTER TABLE comments ADD COLUMN confidence_score REAL');
      }
      if (!names.has('reasoning')) {
        this.db.exec('ALTER TABLE comments ADD COLUMN reasoning TEXT');
      }
      if (!names.has('ai_model')) {
        this.db.exec('ALTER TABLE comments ADD COLUMN ai_model TEXT');
      }
      if (!names.has('ai_analyzed_at')) {
        this.db.exec('ALTER TABLE comments ADD COLUMN ai_analyzed_at INTEGER');
      }
    } catch {}
  }

  async importJsonFile(filePath) {
    if (!this.db) throw new Error('Database not initialized');
    
    const db = this.db;

    try {
      // Read and parse JSON file
      const jsonContent = await fs.readFile(filePath, 'utf-8');
      const facebookComments = JSON.parse(jsonContent);
      
      if (!Array.isArray(facebookComments) || facebookComments.length === 0) {
        throw new Error('Invalid JSON format: Expected array of Facebook comments');
      }

      const filename = path.basename(filePath);
      const timestamp = Date.now();

      // Extract post information from first comment
      const firstComment = facebookComments[0];
      const postId = this.extractPostId(firstComment.facebookUrl);
      const postTitle = firstComment.postTitle || 'Untitled Post';

      // Check if post already exists
      const existingPost = this.db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
      if (existingPost) {
        throw new Error(`Post ${postId} already exists in database`);
      }

      // Begin transaction
      const transaction = db.transaction(() => {
        // Insert post
        const insertPost = db.prepare(`
          INSERT INTO posts (id, url, title, timestamp_captured, metadata, filename)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        const postMetadata = {
          originalUrl: firstComment.facebookUrl,
          inputUrl: firstComment.inputUrl,
          pageAdLibrary: firstComment.pageAdLibrary,
          totalComments: facebookComments.length
        };

        insertPost.run(
          postId,
          firstComment.facebookUrl,
          postTitle,
          timestamp,
          JSON.stringify(postMetadata),
          filename
        );

        // Insert comments
        const insertComment = db.prepare(`
          INSERT INTO comments (id, post_id, url, timestamp_captured, metadata, checksum_comment_text)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        let commentsImported = 0;
        for (const comment of facebookComments) {
          const commentMetadata = {
            text: comment.text,
            date: comment.date,
            profileName: comment.profileName,
            profileId: comment.profileId,
            profilePicture: comment.profilePicture,
            profileUrl: comment.profileUrl,
            likesCount: comment.likesCount,
            commentsCount: comment.commentsCount,
            threadingDepth: comment.threadingDepth,
            attachments: comment.attachments,
            feedbackId: comment.feedbackId,
            facebookId: comment.facebookId
          };

          const textChecksum = crypto
            .createHash('sha256')
            .update(comment.text || '')
            .digest('hex');

          insertComment.run(
            comment.id,
            postId,
            comment.commentUrl,
            timestamp,
            JSON.stringify(commentMetadata),
            textChecksum
          );

          commentsImported++;
        }

        return commentsImported;
      });

      const commentsImported = transaction();

      return {
        success: true,
        postId,
        commentsImported
      };

    } catch (error) {
      console.error('Error importing JSON file:', error);
      throw error;
    }
  }

  async getPosts() {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      SELECT 
        p.*,
        COUNT(c.id) as comment_count
      FROM posts p
      LEFT JOIN comments c ON p.id = c.post_id
      GROUP BY p.id
      ORDER BY p.timestamp_captured DESC
    `);

    return stmt.all();
  }

  async getComments(postId) {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      SELECT * FROM comments 
      WHERE post_id = ? 
      ORDER BY timestamp_captured ASC
    `);

    return stmt.all(postId);
  }

  async updateCommentScreenshot(commentId, screenshotPath) {
    if (!this.db) throw new Error('Database not initialized');
    let checksum = null;
    try {
      const buf = fs.readFileSync(screenshotPath);
      checksum = crypto.createHash('sha256').update(buf).digest('hex');
    } catch {}
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE comments SET screenshot_path = ?, checksum_screenshot = ?, last_error = NULL, last_attempt_at = ? WHERE id = ?
    `);
    stmt.run(screenshotPath, checksum, now, commentId);
  }

  async recordCommentError(commentId, message) {
    if (!this.db) throw new Error('Database not initialized');
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE comments SET last_error = ?, last_attempt_at = ? WHERE id = ?
    `);
    stmt.run(String(message || ''), now, commentId);
  }

  async getCommentById(commentId) {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare('SELECT * FROM comments WHERE id = ?');
    return stmt.get(commentId);
  }

  async updateCommentAiAnalysis(commentId, isNegative, confidenceScore, reasoning, meta = {}) {
    if (!this.db) throw new Error('Database not initialized');
    const now = Date.now();
    const model = meta.model || meta.ai_model || null;
    const stmt = this.db.prepare(`
      UPDATE comments
      SET is_negative = ?, confidence_score = ?, reasoning = ?, ai_model = ?, ai_analyzed_at = ?
      WHERE id = ?
    `);
    stmt.run(isNegative ? 1 : 0, typeof confidenceScore === 'number' ? confidenceScore : null, reasoning || null, model, now, commentId);
  }

  async clearCommentScreenshot(commentId) {
    if (!this.db) throw new Error('Database not initialized');
    // Fetch current path
    const row = await this.getCommentById(commentId);
    if (row && row.screenshot_path) {
      try { fs.unlinkSync(row.screenshot_path); } catch {}
    }
    const stmt = this.db.prepare('UPDATE comments SET screenshot_path = NULL, checksum_screenshot = NULL WHERE id = ?');
    stmt.run(commentId);
  }

  extractPostId(facebookUrl) {
    // Extract post ID from Facebook URL
    const match = facebookUrl.match(/posts\/([^/?]+)/);
    if (match) {
      return match[1];
    }
    
    // Fallback: use hash of URL
    return crypto.createHash('md5').update(facebookUrl).digest('hex');
  }

  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = { DatabaseService };