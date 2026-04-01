import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'manipulation-identifier.db');

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS performance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_name TEXT NOT NULL,
    response_time_ms INTEGER,
    success INTEGER NOT NULL DEFAULT 1,
    error_message TEXT,
    tokens_used INTEGER DEFAULT 0,
    tactics_detected_count INTEGER DEFAULT 0,
    analysis_complexity_score REAL DEFAULT 0,
    session_id TEXT,
    page_url TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_url TEXT,
    original_full_text TEXT,
    highlighted_text TEXT,
    model_used TEXT,
    detected_tactic TEXT,
    user_rating TEXT NOT NULL,
    user_comments TEXT,
    response_time_ms INTEGER,
    session_id TEXT,
    feedback_type TEXT DEFAULT 'detection_feedback',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS missing_manipulations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_url TEXT,
    original_full_text TEXT,
    missed_text TEXT,
    suggested_tactic TEXT,
    user_comments TEXT,
    model_used TEXT,
    session_id TEXT,
    reported_from_feedback_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_performance_model ON performance(model_name);
  CREATE INDEX IF NOT EXISTS idx_performance_created ON performance(created_at);
  CREATE INDEX IF NOT EXISTS idx_feedback_tactic ON feedback(detected_tactic);
  CREATE INDEX IF NOT EXISTS idx_feedback_model ON feedback(model_used);
  CREATE INDEX IF NOT EXISTS idx_missing_tactic ON missing_manipulations(suggested_tactic);
`);

// Prepared statements
const insertPerformance = db.prepare(`
  INSERT INTO performance (model_name, response_time_ms, success, error_message, tokens_used, tactics_detected_count, analysis_complexity_score, session_id, page_url)
  VALUES (@model_name, @response_time_ms, @success, @error_message, @tokens_used, @tactics_detected_count, @analysis_complexity_score, @session_id, @page_url)
`);

const insertFeedback = db.prepare(`
  INSERT INTO feedback (page_url, original_full_text, highlighted_text, model_used, detected_tactic, user_rating, user_comments, response_time_ms, session_id, feedback_type)
  VALUES (@page_url, @original_full_text, @highlighted_text, @model_used, @detected_tactic, @user_rating, @user_comments, @response_time_ms, @session_id, @feedback_type)
`);

const insertMissingManipulation = db.prepare(`
  INSERT INTO missing_manipulations (page_url, original_full_text, missed_text, suggested_tactic, user_comments, model_used, session_id, reported_from_feedback_id)
  VALUES (@page_url, @original_full_text, @missed_text, @suggested_tactic, @user_comments, @model_used, @session_id, @reported_from_feedback_id)
`);

export const dbOperations = {
  recordPerformance(data) {
    const result = insertPerformance.run({
      model_name: data.model_name,
      response_time_ms: data.response_time_ms,
      success: data.success ? 1 : 0,
      error_message: data.error_message || null,
      tokens_used: data.tokens_used || 0,
      tactics_detected_count: data.tactics_detected_count || 0,
      analysis_complexity_score: data.analysis_complexity_score || 0,
      session_id: data.session_id || null,
      page_url: data.page_url || null
    });
    return result.lastInsertRowid;
  },

  recordFeedback(data) {
    const result = insertFeedback.run({
      page_url: data.page_url || null,
      original_full_text: data.original_full_text,
      highlighted_text: data.highlighted_text,
      model_used: data.model_used,
      detected_tactic: data.detected_tactic,
      user_rating: data.user_rating,
      user_comments: data.user_comments || null,
      response_time_ms: data.response_time_ms || null,
      session_id: data.session_id || null,
      feedback_type: data.feedback_type || 'detection_feedback'
    });
    return result.lastInsertRowid;
  },

  recordMissingManipulation(data) {
    const result = insertMissingManipulation.run({
      page_url: data.page_url || null,
      original_full_text: data.original_full_text,
      missed_text: data.missed_text,
      suggested_tactic: data.suggested_tactic,
      user_comments: data.user_comments || null,
      model_used: data.model_used,
      session_id: data.session_id || null,
      reported_from_feedback_id: data.reported_from_feedback_id || null
    });
    return result.lastInsertRowid;
  },

  getModelAnalytics() {
    return db.prepare(`
      SELECT
        model_name,
        COUNT(*) as total_requests,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed,
        ROUND(AVG(response_time_ms)) as avg_response_time_ms,
        ROUND(AVG(tokens_used)) as avg_tokens_used,
        ROUND(AVG(tactics_detected_count), 1) as avg_tactics_detected
      FROM performance
      GROUP BY model_name
    `).all();
  },

  getSatisfactionByModel() {
    return db.prepare(`
      SELECT
        model_used,
        user_rating,
        COUNT(*) as count
      FROM feedback
      GROUP BY model_used, user_rating
    `).all();
  },

  getTacticPerformance(model) {
    if (model) {
      return db.prepare(`
        SELECT
          detected_tactic,
          user_rating,
          COUNT(*) as count
        FROM feedback
        WHERE model_used = ?
        GROUP BY detected_tactic, user_rating
      `).all(model);
    }
    return db.prepare(`
      SELECT
        detected_tactic,
        model_used,
        user_rating,
        COUNT(*) as count
      FROM feedback
      GROUP BY detected_tactic, model_used, user_rating
    `).all();
  },

  getMissingPatterns() {
    return db.prepare(`
      SELECT
        suggested_tactic,
        COUNT(*) as report_count,
        model_used
      FROM missing_manipulations
      GROUP BY suggested_tactic, model_used
      ORDER BY report_count DESC
    `).all();
  },

  getRecentPerformance(hours) {
    return db.prepare(`
      SELECT *
      FROM performance
      WHERE created_at >= datetime('now', ? || ' hours')
      ORDER BY created_at DESC
    `).all(`-${hours}`);
  }
};
