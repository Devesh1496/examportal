// server.js — Main Express API server
require('dotenv').config({ override: true });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');

const db = require('./db');
const { scrapeAll, scrapeCustomUrl } = require('./scraper');
const { processPdf, processImages } = require('./pdfProcessor');
const axios = require('axios');
const https = require('https');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── MIDDLEWARE ───────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, message: 'Too many requests', validate: { xForwardedForHeader: false } }));



// ─── ROUTES: PAPERS ──────────────────────────────────────────

// GET /api/papers — list all papers
app.get('/api/papers', async (req, res) => {
  try {
    const { status, website, search, limit = 20, offset = 0 } = req.query;
    let sql = 'SELECT * FROM papers WHERE 1=1';
    const params = [];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (website) { sql += ' AND website = ?'; params.push(website); }
    if (search) { sql += ' AND (title LIKE ? OR exam_type LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY date_found DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const papers = await db.all(sql, params);
    const total = await db.get('SELECT COUNT(*) as count FROM papers');
    res.json({ papers, total: total.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/papers/:id — single paper with stats
app.get('/api/papers/:id', async (req, res) => {
  try {
    const paper = await db.get('SELECT * FROM papers WHERE id = ?', [req.params.id]);
    if (!paper) return res.status(404).json({ error: 'Paper not found' });
    paper.metadata = JSON.parse(paper.metadata || '{}');
    res.json(paper);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/papers/:id/questions — get all questions for a paper
app.get('/api/papers/:id/questions', async (req, res) => {
  try {
    const paper = await db.get('SELECT * FROM papers WHERE id = ?', [req.params.id]);
    if (!paper) return res.status(404).json({ error: 'Paper not found' });
    if (paper.status !== 'ready') {
      return res.status(400).json({ error: 'Paper not ready yet', status: paper.status });
    }

    const questions = await db.all(
      'SELECT * FROM questions WHERE paper_id = ? ORDER BY q_number ASC',
      [req.params.id]
    );
    // Parse JSON fields
    const parsed = questions.map(q => ({
      ...q,
      options_en: JSON.parse(q.options_en || '[]'),
      options_hi: JSON.parse(q.options_hi || '[]'),
    }));

    res.json({ paper, questions: parsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/papers/:id — delete a paper and its questions
app.delete('/api/papers/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM questions WHERE paper_id = ?', [req.params.id]);
    await db.run('DELETE FROM papers WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ROUTES: PROXY (for frontend CORS) ───────────────────────

// GET /api/proxy/pdf?url=... — proxy PDF downloads for client-side processing
app.get('/api/proxy/pdf', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
      httpsAgent: new https.Agent({
        secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT
      })
    });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'inline');
    res.send(Buffer.from(response.data));
  } catch (err) {
    if (err.response) {
      return res.status(err.response.status).json({ 
        error: `Website returned HTTP ${err.response.status} (${err.response.statusText}) for the PDF.`
      });
    }
    res.status(500).json({ error: `Failed to fetch PDF: ${err.message}` });
  }
});

// POST /api/papers/process-images — process client-side images using OpenRouter
app.post('/api/papers/process-images', async (req, res) => {
  try {
    const { images, title } = req.body;
    if (!images || !images.length) {
      return res.status(400).json({ error: 'Images array is required' });
    }
    
    // Make sure we have the OpenRouter API key
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(500).json({ error: 'OPENROUTER_API_KEY is not configured on the server' });
    }

    console.log(`[API] Received ${images.length} images from client for extraction`);
    const extracted = await processImages(images, title || 'Question Paper');
    
    if (!extracted || !extracted.questions?.length) {
      throw new Error('Failed to extract questions from images');
    }

    res.json(extracted);
  } catch (err) {
    console.error('[API] process-images error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/papers/save — save client-side extracted paper + questions
app.post('/api/papers/save', async (req, res) => {
  try {
    const { paper, questions, passages } = req.body;
    if (!paper || !questions?.length) {
      return res.status(400).json({ error: 'Paper info and questions are required' });
    }

    const paperId = uuidv4();
    const metadata = JSON.stringify(paper.metadata || {});

    await db.run(
      `INSERT INTO papers (id, title, source_url, pdf_url, website, status, total_q, metadata)
       VALUES (?, ?, ?, ?, ?, 'ready', ?, ?)`,
      [paperId, paper.title, paper.source_url, paper.pdf_url, paper.website || 'manual',
       questions.length, metadata]
    );

    for (const q of questions) {
      const qId = uuidv4();
      let passageEn = null;
      let passageHi = null;
      if (q.passage_id && passages) {
        const p = passages.find(p => p.id === q.passage_id);
        if (p) {
          passageEn = p.en || null;
          passageHi = p.hi || null;
        }
      }

      await db.run(
        `INSERT OR REPLACE INTO questions
         (id, paper_id, q_number, en, hi, options_en, options_hi, answer, section, has_passage, passage_en, passage_hi, q_type, image_base64)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          qId, paperId, q.number || 0,
          q.en || null, q.hi || null,
          JSON.stringify(q.options_en || []), JSON.stringify(q.options_hi || []),
          q.answer !== undefined ? q.answer : null,
          q.section || 'General',
          q.passage_id ? 1 : 0,
          passageEn, passageHi,
          q.type || 'mcq',
          q.image_base64 || null
        ]
      );
    }

    res.json({ paperId, message: `Saved ${questions.length} questions` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ROUTES: SCRAPE & PROCESS ─────────────────────────────────

// POST /api/scrape — manually trigger website scrape
app.post('/api/scrape', async (req, res) => {
  try {
    res.json({ message: 'Scrape started in background' });
    // Run in background
    runScrapeJob().catch(console.error);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/scrape/url — scrape a specific URL and process
app.post('/api/scrape/url', async (req, res) => {
  const { url, title } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    // If it's a direct PDF URL
    if (url.match(/\.pdf$/i)) {
      const paperId = uuidv4();
      const paperTitle = title || extractTitleFromUrl(url);
      await db.run(
        `INSERT OR IGNORE INTO papers (id, title, source_url, pdf_url, website, status) VALUES (?, ?, ?, ?, ?, ?)`,
        [paperId, paperTitle, url, url, 'manual', 'processing']
      );
      res.json({ paperId, message: 'Processing started' });
      processAndSave(paperId, url, paperTitle).catch(console.error);
    } else {
      // Scrape the URL for PDF links
      const links = await scrapeCustomUrl(url);
      if (!links.length) return res.status(404).json({ error: 'No PDFs found at this URL' });

      const saved = [];
      for (const link of links.slice(0, 10)) { // max 10 at once
        const paperId = uuidv4();
        const paperTitle = link.title || extractTitleFromUrl(link.url);
        const existing = await db.get('SELECT id FROM papers WHERE pdf_url = ?', [link.url]);
        if (!existing) {
          await db.run(
            `INSERT INTO papers (id, title, source_url, pdf_url, website, status) VALUES (?, ?, ?, ?, ?, ?)`,
            [paperId, paperTitle, url, link.url, 'manual', 'processing']
          );
          saved.push({ paperId, url: link.url, title: paperTitle });
          processAndSave(paperId, link.url, paperTitle).catch(console.error);
        }
      }
      res.json({ message: `Found ${links.length} PDFs, processing ${saved.length} new`, papers: saved });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/papers/:id/status — poll processing status
app.get('/api/papers/:id/status', async (req, res) => {
  try {
    const paper = await db.get('SELECT id, status, total_q, title FROM papers WHERE id = ?', [req.params.id]);
    if (!paper) return res.status(404).json({ error: 'Not found' });
    res.json(paper);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ROUTES: ATTEMPTS ─────────────────────────────────────────

// POST /api/attempts — save a quiz attempt
app.post('/api/attempts', async (req, res) => {
  try {
    const { paper_id, answers, score, correct, wrong, skipped, time_taken } = req.body;
    const id = uuidv4();
    await db.run(
      `INSERT INTO attempts (id, paper_id, answers, score, correct, wrong, skipped, time_taken)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, paper_id, JSON.stringify(answers), score, correct, wrong, skipped, time_taken]
    );
    res.json({ id, message: 'Attempt saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attempts?paper_id=x — get attempts for a paper
app.get('/api/attempts', async (req, res) => {
  try {
    const { paper_id, limit = 10 } = req.query;
    let sql = 'SELECT * FROM attempts';
    const params = [];
    if (paper_id) { sql += ' WHERE paper_id = ?'; params.push(paper_id); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));
    const attempts = await db.all(sql, params);
    res.json(attempts.map(a => ({ ...a, answers: JSON.parse(a.answers) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ROUTES: MISC ─────────────────────────────────────────────

// GET /api/health
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    ai_ready: !!process.env.OPENROUTER_API_KEY,
    time: new Date().toISOString(),
  });
});

// GET /api/stats — dashboard stats
app.get('/api/stats', async (req, res) => {
  try {
    const total = await db.get('SELECT COUNT(*) as c FROM papers');
    const ready = await db.get('SELECT COUNT(*) as c FROM papers WHERE status="ready"');
    const processing = await db.get('SELECT COUNT(*) as c FROM papers WHERE status="processing"');
    const totalQ = await db.get('SELECT SUM(total_q) as c FROM papers');
    const attempts = await db.get('SELECT COUNT(*) as c FROM attempts');
    res.json({
      totalPapers: total.c,
      readyPapers: ready.c,
      processingPapers: processing.c,
      totalQuestions: totalQ.c || 0,
      totalAttempts: attempts.c,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── BACKGROUND JOBS ──────────────────────────────────────────

async function runScrapeJob() {
  console.log('[Cron] Running scrape job...');
  try {
    const links = await scrapeAll();
    for (const link of links) {
      const existing = await db.get('SELECT id FROM papers WHERE pdf_url = ?', [link.url]);
      if (!existing) {
        const paperId = uuidv4();
        const title = link.title || extractTitleFromUrl(link.url);
        await db.run(
          `INSERT INTO papers (id, title, source_url, pdf_url, website, status) VALUES (?, ?, ?, ?, ?, ?)`,
          [paperId, title, link.url, link.url, link.website, 'processing']
        );
        processAndSave(paperId, link.url, title).catch(console.error);
      }
    }
    console.log(`[Cron] Scrape done. ${links.length} PDFs found.`);
  } catch (err) {
    console.error('[Cron] Scrape job error:', err.message);
  }
}

async function processAndSave(paperId, pdfUrl, title) {
  console.log(`[Process] Starting: ${title}`);
  try {
    await db.run('UPDATE papers SET status = ? WHERE id = ?', ['processing', paperId]);
    const extracted = await processPdf(pdfUrl, title);

    if (!extracted || !extracted.questions?.length) {
      await db.run('UPDATE papers SET status = ? WHERE id = ?', ['failed', paperId]);
      return;
    }

    // Save paper info
    const info = extracted.paper_info || {};
    await db.run(
      `UPDATE papers SET status=?, total_q=?, exam_type=?, metadata=? WHERE id=?`,
      ['ready', extracted.questions.length, info.exam_type || null,
        JSON.stringify({ max_marks: info.max_marks, duration: info.duration, negative_marking: info.negative_marking }),
        paperId]
    );

    // Save questions
    for (const q of extracted.questions) {
      const qId = uuidv4();
      const passageEn = q.passage_id
        ? extracted.passages?.find(p => p.id === q.passage_id)?.en || null
        : null;
      const passageHi = q.passage_id
        ? extracted.passages?.find(p => p.id === q.passage_id)?.hi || null
        : null;

      await db.run(
        `INSERT OR REPLACE INTO questions
         (id, paper_id, q_number, en, hi, options_en, options_hi, answer, section, has_passage, passage_en, passage_hi, q_type, image_base64)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          qId, paperId, q.number || 0,
          q.en || null, q.hi || null,
          JSON.stringify(q.options_en || []), JSON.stringify(q.options_hi || []),
          q.answer !== undefined ? q.answer : null,
          q.section || 'General',
          q.passage_id ? 1 : 0,
          passageEn, passageHi,
          q.type || 'mcq',
          q.image_base64 || null
        ]
      );
    }

    console.log(`[Process] Done: "${title}" — ${extracted.questions.length} questions saved`);
  } catch (err) {
    console.error(`[Process] Error for ${paperId}:`, err.message);
    await db.run('UPDATE papers SET status = ? WHERE id = ?', ['failed', paperId]);
  }
}

function extractTitleFromUrl(url) {
  try {
    const parts = url.split('/');
    const filename = parts[parts.length - 1];
    return filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') || 'Question Paper';
  } catch {
    return 'Question Paper';
  }
}

// ─── SCHEDULED SCRAPING (every 6 hours) ──────────────────────
cron.schedule('0 */6 * * *', () => {
  console.log('[Cron] Scheduled scrape triggered');
  runScrapeJob().catch(console.error);
});

// ─── START ────────────────────────────────────────────────────
db.init().then(() => {
  const server = app.listen(PORT, () => {
    console.log(`\n🚀 ExamPortal Backend running on http://localhost:${PORT}`);
    console.log(`📚 API: http://localhost:${PORT}/api`);
    console.log(`🧠 AI Processing: Connects to OpenRouter\n`);
  });
}).catch(console.error);

module.exports = app;
