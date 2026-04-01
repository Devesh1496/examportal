// pdfProcessor.js — Downloads PDFs, renders as images, sends to Gemini for Q extraction
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const { GoogleAuth } = require('google-auth-library');

let authCache = null;
async function getVertexToken() {
  if (!authCache) {
    authCache = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
  }
  return await authCache.getAccessToken();
}

function getApiModel() {
  if (process.env.VERTEX_PROJECT_ID) return process.env.VERTEX_MODEL || 'google/gemini-2.0-flash-001';
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  return process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
}

function getApiUrl() {
  if (process.env.VERTEX_PROJECT_ID) {
    const project = process.env.VERTEX_PROJECT_ID;
    const location = process.env.VERTEX_LOCATION || 'us-central1';
    return `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${project}/locations/${location}/endpoints/openapi/chat/completions`;
  }
  if (process.env.GEMINI_API_KEY) return 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  return 'https://openrouter.ai/api/v1/chat/completions';
}

async function getApiHeaders() {
  if (process.env.VERTEX_PROJECT_ID) {
    const token = await getVertexToken();
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }
  if (process.env.GEMINI_API_KEY) {
    return {
      'Authorization': `Bearer ${process.env.GEMINI_API_KEY}`,
      'Content-Type': 'application/json',
    };
  }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('Neither VERTEX_PROJECT_ID, GEMINI_API_KEY, nor OPENROUTER_API_KEY is set in .env');
  return {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:3000',
    'X-Title': 'ExamPortal',
  };
}

async function callAI(parts, maxTokens = 16000) {
  const url = getApiUrl();
  const headers = await getApiHeaders();

  // Convert parts to OpenAI format content
  const content = parts.map(p => {
    if (p.text) return { type: 'text', text: p.text };
    if (p.inlineData) {
      return {
        type: 'image_url',
        image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` }
      };
    }
    if (p.image_url) return p;
    return null;
  }).filter(Boolean);

  const reqBody = {
    model: getApiModel(),
    messages: [{ role: 'user', content }],
    temperature: 0.1,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
  };

  let data;
  let retries = 0;
  const MAX_RETRIES = 3;

  while (retries <= MAX_RETRIES) {
    try {
      const res = await axios.post(url, reqBody, { headers, timeout: 180000 });
      data = res.data;
      break;
    } catch (err) {
      if (err.response?.status === 429 && retries < MAX_RETRIES) {
        retries++;
        console.warn(`[API] 429 Rate Limit Hit. Retrying ${retries}/${MAX_RETRIES} in ${retries * 20} seconds...`);
        await new Promise(r => setTimeout(r, retries * 20000));
        continue;
      }
      console.error('[API] Request failed with status code:', err.response?.status);
      console.error('[API] Error data:', JSON.stringify(err.response?.data, null, 2) || err.message);
      throw err;
    }
  }

  if (data?.choices?.[0]?.message?.content) {
    return data.choices[0].message.content;
  }

  console.log('[API] Unexpected response shape:', JSON.stringify(data).slice(0, 300));
  throw new Error('Unexpected API response format');
}

const PDFS_DIR = path.join(__dirname, 'data', 'pdfs');
if (!fs.existsSync(PDFS_DIR)) fs.mkdirSync(PDFS_DIR, { recursive: true });

// ─── DOWNLOAD PDF ────────────────────────────────────────────
async function downloadPdf(url) {
  console.log(`[PDF] Downloading: ${url}`);
  const filename = `${uuidv4()}.pdf`;
  const filepath = path.join(PDFS_DIR, filename);

  const https = require('https');
  const crypto = require('crypto');
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 30000,
    headers: { 'User-Agent': 'Mozilla/5.0' },
    httpsAgent: new https.Agent({
      secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT
    })
  });

  fs.writeFileSync(filepath, res.data);
  console.log(`[PDF] Saved to ${filepath} (${res.data.byteLength} bytes)`);
  return filepath;
}

// ─── CONVERT PDF PAGES TO BASE64 IMAGES ─────────────────────
async function pdfToImages(pdfPath) {
  try {
    const { execSync } = require('child_process');
    const outDir = pdfPath.replace('.pdf', '_pages');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

    try {
      // Use JPEG compression to restrict payload sizes sent to AI
      execSync(`pdftoppm -r 100 -jpeg -jpegopt quality=70 "${pdfPath}" "${outDir}/page"`, { stdio: 'pipe' });
      const files = fs.readdirSync(outDir).filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg')).sort();
      return files.map(f => ({
        type: 'image',
        data: fs.readFileSync(path.join(outDir, f)).toString('base64'),
        mediaType: 'image/jpeg',
      }));
    } catch {
      // pdftoppm not available — send PDF directly as inline data
      console.log('[PDF] pdftoppm not found, sending PDF as base64 directly');
      const pdfData = fs.readFileSync(pdfPath).toString('base64');
      return [{ type: 'pdf', data: pdfData, mediaType: 'application/pdf' }];
    }
  } catch (err) {
    console.error('[PDF] Image conversion error:', err.message);
    throw err;
  }
}

// ─── BUILD PARTS WITH PAGES ───────────────────────────────────
function buildPartsWithPages(pages, promptText) {
  const parts = [];
  parts.push({ type: 'text', text: promptText });
  for (const page of pages) {
    parts.push({
      type: 'image_url',
      image_url: { url: `data:${page.mediaType};base64,${page.data}` },
    });
  }
  return parts;
}

// ─── PASS 0: METADATA EXTRACTION ─────────────────────────────
async function getPaperMetadata(pages) {
  console.log('[API] Pass 0: Analyzing paper to count total questions & options...');
  const promptText = `Analyze this entire exam paper carefully.
Return JSON ONLY with this exact structure — no markdown, no explanation:
{ "total_questions": 0, "options_per_question": 4, "sections": [{"name": "Section Name", "start": 1, "end": 30}] }

Count the total number of questions in the entire paper.
Count how many answer options/circles each question has. Include ALL options — if there is an option (E) for "Question not attempted" / "अनुत्तरित प्रश्न", count it too (e.g. A B C D E = 5 options, not 4).
Identify 5-8 broad sections/subjects in the paper with their question ranges. Use broad categories like: Reasoning, Mathematics, General Knowledge, Hindi Language, Computer, English Language, Science. Do NOT create too many fine-grained sections.`;

  const parts = buildPartsWithPages(pages, promptText);
  try {
    const raw = await callAI(parts, 4000);
    let meta = parseResponse(raw);
    // If full parse failed, extract key fields from partial/truncated JSON
    if (!meta) {
      const tqMatch = raw.match(/"total_questions"\s*:\s*(\d+)/);
      const opMatch = raw.match(/"options_per_question"\s*:\s*(\d+)/);
      if (tqMatch) {
        meta = {
          total_questions: parseInt(tqMatch[1]),
          options_per_question: opMatch ? parseInt(opMatch[1]) : 4,
          sections: []
        };
        // Try to extract complete section entries from truncated JSON
        const sectionRegex = /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"start"\s*:\s*(\d+)\s*,\s*"end"\s*:\s*(\d+)\s*\}/g;
        let m;
        while ((m = sectionRegex.exec(raw)) !== null) {
          meta.sections.push({ name: m[1], start: parseInt(m[2]), end: parseInt(m[3]) });
        }
      }
    }
    if (meta && meta.total_questions) {
      console.log(`[API] Pass 0 Done: ${meta.total_questions} questions, ${meta.options_per_question || 4} options`);
      if (meta.sections?.length) {
        console.log(`[API] Pass 0 Sections: ${meta.sections.map(s => `${s.name} (Q${s.start}-Q${s.end})`).join(', ')}`);
      }
      return meta;
    }
  } catch (err) {
    console.error('[API] Pass 0 Error:', err.message);
  }
  return { total_questions: 100, options_per_question: 4, sections: [] }; // fallback
}

// ─── BUILD EXTRACTION PROMPT ─────────────────────────────────
function buildExtractionPrompt(paperTitle, optCount, startQ, endQ, sections) {
  const optionsArrEn = Array.from({ length: optCount }, (_, i) => `${String.fromCharCode(65 + i)} option text`);
  const optionsArrHi = Array.from({ length: optCount }, (_, i) => `${String.fromCharCode(65 + i)} विकल्प`);

  // Build section hint for this chunk
  let sectionHint = '';
  if (sections?.length) {
    const relevant = sections.filter(s => s.end >= startQ && s.start <= endQ);
    if (relevant.length) {
      sectionHint = `\nSECTION MAPPING (use these section names for each question based on its number):\n${sections.map(s => `- Q${s.start}-Q${s.end}: "${s.name}"`).join('\n')}\n`;
    } else {
      sectionHint = `\nSECTION MAPPING:\n${sections.map(s => `- Q${s.start}-Q${s.end}: "${s.name}"`).join('\n')}\n`;
    }
  }

  return `You are an expert at extracting exam questions from scanned question papers.

This exam paper is titled: "${paperTitle}"

YOUR TASK: Extract ONLY questions numbered ${startQ} to ${endQ} from the provided pages.
${sectionHint}
STRICT RULES — VIOLATIONS ARE NOT ACCEPTABLE:
1. COPY TEXT EXACTLY AS PRINTED. Do not rephrase, summarize, translate, or improve anything.
2. DO NOT HALLUCINATE. Only extract questions that are physically visible in the provided images.
3. DO NOT generate or invent any question. If a question number is not visible, skip it entirely.
4. Extract ONLY questions in the range ${startQ} to ${endQ}. Ignore all others.
5. SKIP instruction pages, cover pages, and any non-question content. Only extract actual numbered exam questions.
6. For bilingual papers (Hindi + English), extract both languages exactly as printed.
7. If only Hindi is printed, set "en" to null. If only English, set "hi" to null.
8. answer is 0-indexed (0=A, 1=B, 2=C, 3=D, 4=E). If no answer key, set null.
9. If a question has an image/diagram/graph/figure, set has_image=true, page_num = 1-indexed page number. For image_box, provide [ymin,xmin,ymax,xmax] in 0-1000 normalized coords covering the ENTIRE question region including the question text, the diagram/figure, AND all option figures. If the options are also images/figures (not text), set options_en and options_hi to ["(A)", "(B)", "(C)", "(D)"${optCount === 5 ? ', "Question not attempted"' : ''}] as placeholders — the cropped image will show the actual option figures.
10. Passages/reading comprehension: extract the FULL passage text in "passages" array and reference via passage_id. Use UNIQUE passage IDs like "p_q${startQ}_1", "p_q${startQ}_2" etc. Every question that follows a passage MUST have its passage_id set.
11. Return ONLY a valid JSON object. No markdown fences, no explanation, no preamble.
12. IMPORTANT — "en" and "hi" fields must contain ONLY the question stem text, NOT the options. Options go ONLY in options_en/options_hi arrays.
13. EVERY question MUST have EXACTLY ${optCount} options. If the paper has an option like (E) "Question not attempted" / "अनुत्तरित प्रश्न", include it as the last option in EVERY question. Never drop or omit any option.
14. For "section" field: ${sections?.length ? 'Use the SECTION MAPPING above to assign the correct section name based on question number.' : 'Infer the section/subject from the question content (e.g. Mathematics, Reasoning, General Knowledge, Hindi, English, Computer, Science, etc.). Do NOT default to "General".'}

Return this exact JSON structure:
{
  ${startQ === 1 ? `"paper_info": {
    "title": "exact title from paper",
    "total_questions": number,
    "max_marks": number,
    "duration": "e.g. 3 Hours",
    "negative_marking": "e.g. 1/3 or null"
  },` : ''}
  "passages": [
    {
      "id": "p_q${startQ}_1",
      "en": "Full English passage text or null",
      "hi": "Full Hindi passage text or null"
    }
  ],
  "questions": [
    {
      "number": ${startQ},
      "en": "Question stem text ONLY (no options), or null",
      "hi": "Question stem text ONLY (no options), or null",
      "options_en": ["option A text", "option B text", "option C text", "option D text"${optCount === 5 ? ', "Question not attempted"' : ''}],
      "options_hi": ["विकल्प A", "विकल्प B", "विकल्प C", "विकल्प D"${optCount === 5 ? ', "अनुत्तरित प्रश्न"' : ''}],
      "answer": null,
      "section": "section name from mapping or inferred",
      "passage_id": "p_q${startQ}_1 or null",
      "type": "mcq",
      "has_image": false,
      "image_box": null,
      "page_num": null
    }
  ]
}`;
}

// ─── PROCESS IMAGES (CROPPING) ───────────────────────────────
async function processExtractedImages(parsed, pages) {
  if (!parsed || !parsed.questions) return parsed;
  for (const q of parsed.questions) {
    if (q.has_image && Array.isArray(q.image_box) && q.page_num) {
      try {
        const pageIndex = q.page_num - 1;
        if (pages[pageIndex] && pages[pageIndex].mediaType !== 'application/pdf') {
          const imgBuffer = Buffer.from(pages[pageIndex].data, 'base64');
          const metadata = await sharp(imgBuffer).metadata();
          const [ymin, xmin, ymax, xmax] = q.image_box;

          const left = Math.floor((xmin / 1000) * metadata.width);
          const top = Math.floor((ymin / 1000) * metadata.height);
          const width = Math.floor(((xmax - xmin) / 1000) * metadata.width);
          const height = Math.floor(((ymax - ymin) / 1000) * metadata.height);

          const pad = 15;
          const cLeft = Math.max(0, left - pad);
          const cTop = Math.max(0, top - pad);
          const cWidth = Math.min(metadata.width - cLeft, width + pad * 2);
          const cHeight = Math.min(metadata.height - cTop, height + pad * 2);

          if (cWidth > 0 && cHeight > 0) {
            const cropped = await sharp(imgBuffer)
              .extract({ left: cLeft, top: cTop, width: cWidth, height: cHeight })
              .jpeg({ quality: 90 })
              .toBuffer();
            q.image_base64 = `data:image/jpeg;base64,${cropped.toString('base64')}`;
          }
        }
      } catch (e) {
        console.error('[API] Failed to crop image for Q' + q.number, e.message);
      }
    }
  }
  return parsed;
}

// ─── ESTIMATE PAGE RANGE FOR A QUESTION RANGE ────────────────
function estimatePageRange(pages, totalQuestions, startQ, endQ) {
  // Approximate which pages contain questions startQ..endQ
  // Questions are distributed roughly evenly across pages (skip first instruction page)
  const contentPages = pages.length - 1; // page 0 is usually instructions
  const qPerPage = totalQuestions / contentPages;
  const startPage = Math.max(0, Math.floor((startQ - 1) / qPerPage)); // 0-indexed
  const endPage = Math.min(pages.length - 1, Math.ceil(endQ / qPerPage) + 1);
  // Always include a 1-page buffer on each side to avoid missing questions
  return pages.slice(Math.max(0, startPage - 1), endPage + 1);
}

// ─── INDEX-BASED BATCH PROCESSING ────────────────────────────
async function extractByIndex(pages, paperTitle, totalQuestions, optCount, chunkSize, sections) {
  console.log(`[API] Processing ${totalQuestions} questions in chunks of ${chunkSize}`);
  const allQuestions = [];
  let paperInfo = null;
  const passages = [];

  const batches = [];
  for (let start = 1; start <= totalQuestions; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, totalQuestions);
    batches.push({ start, end });
  }

  const results = [];

  for (let i = 0; i < batches.length; i++) {
    const job = batches[i];
    console.log(`[API] Running chunk Q${job.start}-Q${job.end} (${i + 1}/${batches.length})...`);

    const promptText = buildExtractionPrompt(paperTitle, optCount, job.start, job.end, sections);
    const parts = buildPartsWithPages(pages, promptText);

    try {
      const raw = await callAI(parts, 16000);
      const parsed = parseResponse(raw);
      if (parsed) {
        const withImages = await processExtractedImages(parsed, pages);
        results.push({ ...withImages, start: job.start });
        console.log(`[API] Chunk Q${job.start}-Q${job.end} done: ${parsed.questions?.length || 0} questions extracted`);
      } else {
        console.warn(`[API] Chunk Q${job.start}-Q${job.end}: parse failed, skipping`);
        results.push({ start: job.start });
      }
    } catch (err) {
      console.error(`[API] Chunk Q${job.start}-Q${job.end} error:`, err.message);
      results.push({ start: job.start });
    }

    // Backoff between chunks to avoid rate limits
    if (i < batches.length - 1) await sleep(3000);
  }

  results.sort((a, b) => a.start - b.start);
  for (const res of results) {
    if (res.paper_info && !paperInfo) paperInfo = res.paper_info;
    if (res.passages) passages.push(...res.passages);
    if (res.questions) allQuestions.push(...res.questions);
  }

  // Ensure sequential numbering
  allQuestions.forEach((q, idx) => { q.number = idx + 1; });

  console.log(`[API] Extraction complete: ${allQuestions.length}/${totalQuestions} questions extracted`);
  return { paper_info: paperInfo, passages, questions: allQuestions };
}

// ─── EXTRACT QUESTIONS VIA AI ─────────────────────────────────
async function extractQuestionsWithClaude(pages, paperTitle) {
  console.log(`[API] Extracting questions from ${pages.length} page(s) using ${getApiModel()}...`);

  const meta = await getPaperMetadata(pages);
  const totalQuestions = meta.total_questions || 100;
  const optCount = meta.options_per_question || 4;
  const sections = meta.sections || [];

  console.log(`[API] Will extract ${totalQuestions} questions with ${optCount} options each.`);
  const CHUNK_SIZE = 15; // Reduced from 30 to avoid token truncation

  return await extractByIndex(pages, paperTitle, totalQuestions, optCount, CHUNK_SIZE, sections);
}

// ─── PARSE AI RESPONSE ────────────────────────────────────────
function parseResponse(raw) {
  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    // Try to extract JSON object from response
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { }
    }
    console.error('[API] Failed to parse response. First 150 chars:', raw.slice(0, 150), '... Last 150 chars:', raw.slice(-150));
    return null;
  }
}

// ─── CLEANUP ──────────────────────────────────────────────────
function cleanupFile(filepath) {
  try {
    fs.unlinkSync(filepath);
    const dir = filepath.replace('.pdf', '_pages');
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  } catch { }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── PROCESS CLIENT-SIDE IMAGES ──────────────────────────────
async function processImages(base64Images, paperTitle) {
  const pages = base64Images.map(dataStr => {
    const base64Data = dataStr.includes(',') ? dataStr.split(',')[1] : dataStr;
    return {
      type: 'image',
      data: base64Data,
      mediaType: 'image/jpeg',
    };
  });

  return await extractQuestionsWithClaude(pages, paperTitle);
}

// ─── MAIN PROCESS FUNCTION ────────────────────────────────────
async function processPdf(pdfUrl, paperTitle) {
  let pdfPath = null;
  try {
    pdfPath = await downloadPdf(pdfUrl);
    const pages = await pdfToImages(pdfPath);
    return await extractQuestionsWithClaude(pages, paperTitle);
  } finally {
    if (pdfPath) cleanupFile(pdfPath);
  }
}

module.exports = { processPdf, processImages, downloadPdf, pdfToImages, extractQuestionsWithClaude };