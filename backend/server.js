// server.js — Main Express API server
require('dotenv').config({ override: true });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');

const { supabase } = require('./supabaseClient');
const { scrapeAll, scrapeCustomUrl } = require('./scraper');
const { processPdf, processImages, pdfToBase64Images, cleanupFile, cleanupPagesDir } = require('./pdfProcessor');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const https = require('https');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── MIDDLEWARE ───────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'https://prashnapatra-5165b.web.app',
  'https://prashnapatra-5165b.firebaseapp.com'
].filter(Boolean) }));
app.use(express.json({ limit: '50mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, message: 'Too many requests', validate: { xForwardedForHeader: false } }));

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────

const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });

  req.user = user;
  next();
};

const isAdmin = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Auth required' });
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', req.user.id)
    .single();

  if (profile?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// ─── ROUTES: PAPERS ──────────────────────────────────────────

// GET /api/papers — list all papers
app.get('/api/papers', authenticate, async (req, res) => {
  try {
    const { status, website, search, limit = 20, offset = 0 } = req.query;
    let query = supabase.from('papers').select('*', { count: 'exact' });

    if (status) query = query.eq('status', status);
    if (website) query = query.eq('website', website);
    if (search) query = query.or(`title.ilike.%${search}%,exam_type.ilike.%${search}%`);

    const from = parseInt(offset);
    const to = from + parseInt(limit) - 1;

    const { data, count, error } = await query
      .order('date_found', { ascending: false })
      .range(from, to);

    if (error) throw error;
    res.json({ papers: data, total: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/papers/:id — single paper with stats
app.get('/api/papers/:id', authenticate, async (req, res) => {
  try {
    const { data: paper, error } = await supabase
      .from('papers')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !paper) return res.status(404).json({ error: 'Paper not found' });
    res.json(paper);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/papers/:id/questions — get all questions for a paper
app.get('/api/papers/:id/questions', authenticate, async (req, res) => {
  try {
    const { data: paper, error: pErr } = await supabase
      .from('papers')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (pErr || !paper) return res.status(404).json({ error: 'Paper not found' });
    
    if (paper.status !== 'ready') {
      return res.status(400).json({ error: 'Paper not ready yet', status: paper.status });
    }

    const { data: questions, error: qErr } = await supabase
      .from('questions')
      .select('*')
      .eq('paper_id', req.params.id)
      .order('q_number', { ascending: true });

    if (qErr) throw qErr;
    res.json({ paper, questions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/papers/:id — delete a paper (ADMIN ONLY)
app.delete('/api/papers/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('papers')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ROUTES: PROXY (for frontend CORS) ───────────────────────

// GET /api/proxy/pdf?url=... — proxy PDF downloads for client-side processing (ADMIN ONLY)
app.get('/api/proxy/pdf', authenticate, isAdmin, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  // Try 1: Direct axios download
  try {
    console.log(`[Proxy] Downloading PDF via axios: ${url}`);
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 120000,
      maxContentLength: 100 * 1024 * 1024,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/pdf,application/octet-stream,*/*',
        'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
        'Referer': new URL(url).origin + '/',
      },
      httpsAgent: new https.Agent({
        secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
        rejectUnauthorized: false
      })
    });
    console.log(`[Proxy] axios success: ${response.data.byteLength} bytes`);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'inline');
    return res.send(Buffer.from(response.data));
  } catch (axiosErr) {
    console.log(`[Proxy] axios failed: ${axiosErr.message}, trying Playwright…`);
  }

  // Try 2: Playwright browser download (handles anti-bot, JS redirects, etc.)
  try {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    // Intercept the PDF download
    let pdfBuffer = null;
    page.on('download', async (download) => {
      const path = await download.path();
      if (path) {
        const fs = require('fs');
        pdfBuffer = fs.readFileSync(path);
      }
    });

    // Also intercept network response
    page.on('response', async (resp) => {
      const ct = resp.headers()['content-type'] || '';
      if (ct.includes('pdf') || ct.includes('octet-stream')) {
        try { pdfBuffer = await resp.body(); } catch {}
      }
    });

    await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});

    // Wait a bit for download to complete
    if (!pdfBuffer) await page.waitForTimeout(5000);

    await browser.close();

    if (pdfBuffer && pdfBuffer.length > 100) {
      console.log(`[Proxy] Playwright success: ${pdfBuffer.length} bytes`);
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', 'inline');
      return res.send(pdfBuffer);
    }
    throw new Error('Playwright could not download the PDF');
  } catch (pwErr) {
    console.error(`[Proxy] Playwright also failed: ${pwErr.message}`);
    res.status(500).json({
      error: `Could not download PDF from this website. The server may be blocking automated downloads. Try uploading the PDF file directly instead.`
    });
  }
});

// ─── In-memory job store for async processing ──────────────
const jobs = new Map();

// ─── Multer setup for file uploads ─────────────────────────────
const upload = multer({
  dest: path.join(__dirname, 'data', 'uploads'),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

// POST /api/papers/upload — accept multipart PDF, convert to images server-side
app.post('/api/papers/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'PDF file is required' });

    if (!process.env.OPENROUTER_API_KEY && !process.env.GEMINI_API_KEY && !process.env.VERTEX_PROJECT_ID) {
      return res.status(500).json({ error: 'No AI API key configured on the server' });
    }

    const paperTitle = req.body.title || req.file.originalname.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');

    // Rename multer's random file to have .pdf extension (required for pdftoppm)
    const pdfPath = `${req.file.path}.pdf`;
    fs.renameSync(req.file.path, pdfPath);

    // Convert PDF to base64 images server-side
    const images = await pdfToBase64Images(pdfPath);
    cleanupFile(pdfPath);

    if (!images.length) {
      return res.status(400).json({ error: 'Failed to render PDF pages' });
    }

    const jobId = uuidv4();
    jobs.set(jobId, { status: 'processing', title: paperTitle, startedAt: Date.now() });

    console.log(`[Upload ${jobId}] Started: ${images.length} pages for "${paperTitle}"`);
    res.json({ jobId, status: 'processing' });

    // Process in background with progress tracking
    const onProgress = (p) => {
      const job = jobs.get(jobId);
      if (job) jobs.set(jobId, { ...job, progress: p });
    };
    processImages(images, paperTitle, onProgress)
      .then(extracted => {
        if (!extracted || !extracted.questions?.length) {
          jobs.set(jobId, { status: 'failed', error: 'No questions extracted' });
        } else {
          console.log(`[Upload ${jobId}] Done: ${extracted.questions.length} questions`);
          jobs.set(jobId, { status: 'done', result: extracted });
        }
        cleanupPagesDir(pdfPath);
      })
      .catch(err => {
        console.error(`[Upload ${jobId}] Error: ${err.message}`);
        jobs.set(jobId, { status: 'failed', error: err.message });
        cleanupPagesDir(pdfPath);
      });
  } catch (err) {
    console.error('[API] upload error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/papers/process-images — accept images, start async extraction, return jobId
app.post('/api/papers/process-images', authenticate, async (req, res) => {
  try {
    const { images, title } = req.body;
    if (!images || !images.length) {
      return res.status(400).json({ error: 'Images array is required' });
    }

    if (!process.env.OPENROUTER_API_KEY && !process.env.GEMINI_API_KEY && !process.env.VERTEX_PROJECT_ID) {
      return res.status(500).json({ error: 'No AI API key configured on the server' });
    }

    const jobId = uuidv4();
    const paperTitle = title || 'Question Paper';
    jobs.set(jobId, { status: 'processing', title: paperTitle, startedAt: Date.now() });

    console.log(`[Job ${jobId}] Started: ${images.length} images for "${paperTitle}"`);

    // Respond immediately with jobId
    res.json({ jobId, status: 'processing' });

    // Process in background with progress tracking
    const onProgress = (p) => {
      const job = jobs.get(jobId);
      if (job) jobs.set(jobId, { ...job, progress: p });
    };
    processImages(images, paperTitle, onProgress)
      .then(extracted => {
        if (!extracted || !extracted.questions?.length) {
          jobs.set(jobId, { status: 'failed', error: 'No questions extracted' });
        } else {
          console.log(`[Job ${jobId}] Done: ${extracted.questions.length} questions`);
          jobs.set(jobId, { status: 'done', result: extracted });
        }
      })
      .catch(err => {
        console.error(`[Job ${jobId}] Error: ${err.message}`);
        jobs.set(jobId, { status: 'failed', error: err.message });
      });
  } catch (err) {
    console.error('[API] process-images error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs/:id — poll job status
app.get('/api/jobs/:id', authenticate, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (job.status === 'done') {
    // Return result and clean up
    const result = job.result;
    jobs.delete(req.params.id);
    return res.json({ status: 'done', ...result });
  }

  if (job.status === 'failed') {
    const error = job.error;
    jobs.delete(req.params.id);
    return res.status(500).json({ status: 'failed', error });
  }

  res.json({ status: 'processing', progress: job.progress || null });
});

// POST /api/papers/save — save client-side extracted paper + questions (ADMIN ONLY)
app.post('/api/papers/save', authenticate, isAdmin, async (req, res) => {
  try {
    const { paper, questions, passages } = req.body;
    if (!paper || !questions?.length) {
      return res.status(400).json({ error: 'Paper info and questions are required' });
    }

    const paperId = uuidv4();
    const { error: pErr } = await supabase.from('papers').insert({
      id: paperId,
      title: paper.title,
      source_url: paper.source_url,
      pdf_url: paper.pdf_url,
      website: paper.website || 'manual',
      status: 'ready',
      total_q: questions.length,
      metadata: paper.metadata || {},
      created_by: req.user.id
    });

    if (pErr) throw pErr;

    const questionsData = questions.map(q => {
      let passageEn = null;
      let passageHi = null;
      if (q.passage_id && passages) {
        const p = passages.find(p => p.id === q.passage_id);
        if (p) {
          passageEn = p.en || null;
          passageHi = p.hi || null;
        }
      }
      return {
        id: uuidv4(),
        paper_id: paperId,
        q_number: q.number || 0,
        en: q.en || null,
        hi: q.hi || null,
        options_en: q.options_en || [],
        options_hi: q.options_hi || [],
        answer: q.answer !== undefined ? q.answer : null,
        section: q.section || 'General',
        has_passage: !!q.passage_id,
        passage_en: passageEn,
        passage_hi: passageHi,
        q_type: q.type || 'mcq',
        image_base64: q.image_base64 || null
      };
    });

    const { error: qErr } = await supabase.from('questions').insert(questionsData);
    if (qErr) throw qErr;

    res.json({ paperId, message: `Saved ${questions.length} questions` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ROUTES: SCRAPE & PROCESS ─────────────────────────────────

// POST /api/scrape — manually trigger website scrape (ADMIN ONLY)
app.post('/api/scrape', authenticate, isAdmin, async (req, res) => {
  try {
    res.json({ message: 'Scrape started in background' });
    runScrapeJob().catch(console.error);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/scrape/url — scrape a specific URL and process (ADMIN ONLY)
app.post('/api/scrape/url', authenticate, isAdmin, async (req, res) => {
  const { url, title } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    if (url.match(/\.pdf$/i)) {
      const paperId = uuidv4();
      const paperTitle = title || extractTitleFromUrl(url);
      const { error } = await supabase.from('papers').insert({
        id: paperId,
        title: paperTitle,
        source_url: url,
        pdf_url: url,
        website: 'manual',
        status: 'processing'
      });
      if (error) throw error;
      res.json({ paperId, message: 'Processing started' });
      processAndSave(paperId, url, paperTitle).catch(console.error);
    } else {
      const links = await scrapeCustomUrl(url);
      if (!links.length) return res.status(404).json({ error: 'No PDFs found at this URL' });

      const saved = [];
      for (const link of links.slice(0, 10)) {
        const paperId = uuidv4();
        const paperTitle = link.title || extractTitleFromUrl(link.url);
        const { data: existing } = await supabase.from('papers').select('id').eq('pdf_url', link.url).maybeSingle();
        if (!existing) {
          const { error } = await supabase.from('papers').insert({
            id: paperId,
            title: paperTitle,
            source_url: url,
            pdf_url: link.url,
            website: 'manual',
            status: 'processing'
          });
          if (!error) {
            saved.push({ paperId, url: link.url, title: paperTitle });
            processAndSave(paperId, link.url, paperTitle).catch(console.error);
          }
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
    const { data: paper, error } = await supabase
      .from('papers')
      .select('id, status, total_q, title')
      .eq('id', req.params.id)
      .single();
    if (error || !paper) return res.status(404).json({ error: 'Not found' });
    res.json(paper);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ROUTES: ANSWER KEY ───────────────────────────────────────

// POST /api/papers/:id/answer-key — upload official answer key (ADMIN ONLY)
app.post('/api/papers/:id/answer-key', authenticate, isAdmin, async (req, res) => {
  try {
    const paperId = req.params.id;
    const { answers } = req.body; // { "1": 2, "2": 0, ... } — q_number: 0-indexed answer

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'answers object is required: { q_number: answer_index }' });
    }

    // Verify paper exists
    const { data: paper, error: pErr } = await supabase
      .from('papers')
      .select('id, status')
      .eq('id', paperId)
      .single();
    if (pErr || !paper) return res.status(404).json({ error: 'Paper not found' });

    // Update each question's answer
    let updated = 0;
    for (const [qNum, ansIdx] of Object.entries(answers)) {
      const { error } = await supabase
        .from('questions')
        .update({ answer: ansIdx })
        .eq('paper_id', paperId)
        .eq('q_number', parseInt(qNum));
      if (!error) updated++;
    }

    // Mark answer_key_updated_at on paper metadata
    await supabase
      .from('papers')
      .update({ metadata: supabase.rpc ? paper.metadata : {} })
      .eq('id', paperId);

    // Simple approach: store timestamp in metadata
    const { data: currentPaper } = await supabase
      .from('papers')
      .select('metadata')
      .eq('id', paperId)
      .single();

    const meta = currentPaper?.metadata || {};
    meta.answer_key_updated_at = new Date().toISOString();
    meta.answer_key_updated_by = req.user.id;
    await supabase.from('papers').update({ metadata: meta }).eq('id', paperId);

    console.log(`[AnswerKey] Paper ${paperId}: updated ${updated}/${Object.keys(answers).length} answers`);
    res.json({ updated, total: Object.keys(answers).length, message: `Updated ${updated} answers` });
  } catch (err) {
    console.error('[AnswerKey] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/papers/:id/answers — get current answer key for a paper (ADMIN)
app.get('/api/papers/:id/answers', authenticate, isAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('questions')
      .select('q_number, answer')
      .eq('paper_id', req.params.id)
      .order('q_number', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ROUTES: ATTEMPTS ─────────────────────────────────────────

// POST /api/attempts — save a quiz attempt (REGISTERED USERS)
app.post('/api/attempts', authenticate, async (req, res) => {
  try {
    const { paper_id, answers, score, correct, wrong, skipped, time_taken } = req.body;
    const { data, error } = await supabase.from('attempts').insert({
      id: uuidv4(),
      paper_id,
      user_id: req.user.id,
      answers,
      score,
      correct,
      wrong,
      skipped,
      time_taken
    }).select().single();

    if (error) throw error;
    res.json({ id: data.id, message: 'Attempt saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attempts — get attempts (REGISTERED USERS see own, ADMIN sees all)
app.get('/api/attempts', authenticate, async (req, res) => {
  try {
    const { paper_id, limit = 10 } = req.query;
    
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    let query = supabase.from('attempts').select('*');

    // Candidates only see their own
    if (profile?.role !== 'admin') {
      query = query.eq('user_id', req.user.id);
    }

    if (paper_id) query = query.eq('paper_id', paper_id);
    
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ROUTES: SUBJECT QUIZ ────────────────────────────────────

// GET /api/subjects — list all subjects with question/quiz counts
app.get('/api/subjects', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('get_subject_stats');
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/subjects/:name/quiz/:num — get 20 questions for quiz N of a subject
app.get('/api/subjects/:name/quiz/:num', authenticate, async (req, res) => {
  try {
    const subjectName = decodeURIComponent(req.params.name);
    const quizNum = parseInt(req.params.num) || 1;

    // Get total count for this subject
    const { count } = await supabase
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .eq('section', subjectName);

    const totalQuizzes = Math.ceil((count || 0) / 20);

    const { data: questions, error } = await supabase.rpc('get_subject_quiz', {
      subject_name: subjectName,
      quiz_num: quizNum,
    });
    if (error) throw error;

    res.json({
      subject: subjectName,
      quiz_num: quizNum,
      total_quizzes: totalQuizzes,
      total_questions: count || 0,
      questions: questions || [],
    });
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
    ai_ready: !!(process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || process.env.VERTEX_PROJECT_ID),
    time: new Date().toISOString(),
  });
});

// GET /api/stats — dashboard stats
app.get('/api/stats', authenticate, async (req, res) => {
  try {
    // 1. Get user role
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    const isAdmin = profile?.role === 'admin';

    // 2. Get counts
    const { count: totalPapers } = await supabase.from('papers').select('*', { count: 'exact', head: true });
    const { count: readyPapers } = await supabase.from('papers').select('*', { count: 'exact', head: true }).eq('status', 'ready');
    const { count: processingPapers } = await supabase.from('papers').select('*', { count: 'exact', head: true }).eq('status', 'processing');
    const { count: totalQuestions } = await supabase.from('questions').select('*', { count: 'exact', head: true });
    
    // Personalize attempts
    let attemptsQuery = supabase.from('attempts').select('*', { count: 'exact', head: true });
    if (!isAdmin) {
      attemptsQuery = attemptsQuery.eq('user_id', req.user.id);
    }
    const { count: totalAttempts } = await attemptsQuery;

    // Only admins see total candidate count
    let totalCandidates = 0;
    if (isAdmin) {
      const { count: candCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'candidate');
      totalCandidates = candCount || 0;
    }

    res.json({
      totalPapers: totalPapers || 0,
      readyPapers: readyPapers || 0,
      processingPapers: processingPapers || 0,
      totalQuestions: totalQuestions || 0,
      totalAttempts: totalAttempts || 0,
      totalCandidates: totalCandidates
    });
  } catch (err) {
    console.error('Stats Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── BACKGROUND JOBS ──────────────────────────────────────────

async function runScrapeJob() {
  console.log('[Cron] Running scrape job...');
  try {
    const links = await scrapeAll();
    for (const link of links) {
      const { data: existing } = await supabase.from('papers').select('id').eq('pdf_url', link.url).maybeSingle();
      if (!existing) {
        const paperId = uuidv4();
        const title = link.title || extractTitleFromUrl(link.url);
        const { error } = await supabase.from('papers').insert({
          id: paperId,
          title: title,
          source_url: link.url,
          pdf_url: link.url,
          website: link.website,
          status: 'processing'
        });
        if (!error) processAndSave(paperId, link.url, title).catch(console.error);
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
    await supabase.from('papers').update({ status: 'processing' }).eq('id', paperId);
    const extracted = await processPdf(pdfUrl, title);

    if (!extracted || !extracted.questions?.length) {
      await supabase.from('papers').update({ status: 'failed' }).eq('id', paperId);
      return;
    }

    const info = extracted.paper_info || {};
    await supabase.from('papers').update({
      status: 'ready',
      total_q: extracted.questions.length,
      exam_type: info.exam_type || null,
      metadata: {
        max_marks: info.max_marks,
        duration: info.duration,
        negative_marking: info.negative_marking
      }
    }).eq('id', paperId);

    const questionsData = extracted.questions.map(q => {
      const passageEn = q.passage_id
        ? extracted.passages?.find(p => p.id === q.passage_id)?.en || null
        : null;
      const passageHi = q.passage_id
        ? extracted.passages?.find(p => p.id === q.passage_id)?.hi || null
        : null;

      return {
        id: uuidv4(),
        paper_id: paperId,
        q_number: q.number || 0,
        en: q.en || null,
        hi: q.hi || null,
        options_en: q.options_en || [],
        options_hi: q.options_hi || [],
        answer: q.answer !== undefined ? q.answer : null,
        section: q.section || 'General',
        has_passage: !!q.passage_id,
        passage_en: passageEn,
        passage_hi: passageHi,
        q_type: q.type || 'mcq',
        image_base64: q.image_base64 || null
      };
    });

    const { error: qErr } = await supabase.from('questions').insert(questionsData);
    if (qErr) throw qErr;

    console.log(`[Process] Done: "${title}" — ${extracted.questions.length} questions saved`);
  } catch (err) {
    console.error(`[Process] Error for ${paperId}:`, err.message);
    await supabase.from('papers').update({ status: 'failed' }).eq('id', paperId);
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
// ─── START ────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n🚀 ExamPortal Backend running on http://localhost:${PORT}`);
  console.log(`📚 API: http://localhost:${PORT}/api`);
  console.log(`🧠 AI Processing: Connects to OpenRouter/Gemini\n`);
});

module.exports = app;
