// db.js — SQLite database setup
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'examportal.db');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new sqlite3.Database(DB_PATH);

function init() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Papers table — one row per PDF found on website
      db.run(`CREATE TABLE IF NOT EXISTS papers (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        source_url  TEXT NOT NULL,
        pdf_url     TEXT NOT NULL,
        website     TEXT NOT NULL,
        exam_type   TEXT,
        date_found  TEXT DEFAULT (datetime('now')),
        status      TEXT DEFAULT 'pending',
        total_q     INTEGER DEFAULT 0,
        metadata    TEXT DEFAULT '{}'
      )`);

      // Questions table — extracted from PDFs via Claude
      db.run(`CREATE TABLE IF NOT EXISTS questions (
        id          TEXT PRIMARY KEY,
        paper_id    TEXT NOT NULL,
        q_number    INTEGER NOT NULL,
        en          TEXT,
        hi          TEXT,
        options_en  TEXT,
        options_hi  TEXT,
        answer      INTEGER,
        section     TEXT,
        has_passage INTEGER DEFAULT 0,
        passage_en  TEXT,
        passage_hi  TEXT,
        q_type      TEXT DEFAULT 'mcq',
        image_base64 TEXT,
        FOREIGN KEY(paper_id) REFERENCES papers(id)
      )`);

      // Attempts table — user quiz attempts
      db.run(`CREATE TABLE IF NOT EXISTS attempts (
        id          TEXT PRIMARY KEY,
        paper_id    TEXT NOT NULL,
        answers     TEXT NOT NULL,
        score       REAL,
        correct     INTEGER,
        wrong       INTEGER,
        skipped     INTEGER,
        time_taken  INTEGER,
        created_at  TEXT DEFAULT (datetime('now'))
      )`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

// Promisified helpers
function run(sql, params = []) {
  return new Promise((res, rej) =>
    db.run(sql, params, function (err) { err ? rej(err) : res(this); })
  );
}
function get(sql, params = []) {
  return new Promise((res, rej) =>
    db.get(sql, params, (err, row) => err ? rej(err) : res(row))
  );
}
function all(sql, params = []) {
  return new Promise((res, rej) =>
    db.all(sql, params, (err, rows) => err ? rej(err) : res(rows))
  );
}

module.exports = { db, init, run, get, all };
