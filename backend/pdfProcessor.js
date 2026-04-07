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
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
  if (process.env.VERTEX_PROJECT_ID) return process.env.VERTEX_MODEL || 'google/gemini-2.0-flash-001';
  return 'gemini-2.5-flash';
}

// Check if the model is a Gemma model (uses native Gemini generateContent API)
function isGemmaModel(model) {
  return model && model.startsWith('gemma-');
}

function getApiUrl() {
  if (process.env.GEMINI_API_KEY) {
    const model = getApiModel();
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  }
  if (process.env.OPENROUTER_API_KEY) return 'https://openrouter.ai/api/v1/chat/completions';
  if (process.env.VERTEX_PROJECT_ID) {
    const project = process.env.VERTEX_PROJECT_ID;
    const location = process.env.VERTEX_LOCATION || 'us-central1';
    return `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${project}/locations/${location}/endpoints/openapi/chat/completions`;
  }
  return 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
}

async function getApiHeaders() {
  if (process.env.GEMINI_API_KEY) {
    return { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:3000',
      'X-Title': 'ExamPortal',
    };
  }
  if (process.env.VERTEX_PROJECT_ID) {
    const token = await getVertexToken();
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }
  throw new Error('Neither GEMINI_API_KEY, OPENROUTER_API_KEY, nor VERTEX_PROJECT_ID is set in .env');
}

async function callAI(parts, maxTokens = 16000) {
  const url = getApiUrl();
  const headers = await getApiHeaders();
  const model = getApiModel();
  const useNative = url.includes(':generateContent');

  let reqBody;
  if (useNative) {
    const nativeParts = parts.map(p => {
      if (p.text) return { text: p.text };
      if (p.inlineData) return { inlineData: p.inlineData };
      if (p.image_url) {
        const dataUrl = p.image_url.url;
        const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
        if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
      }
      return null;
    }).filter(Boolean);

    reqBody = {
      contents: [{ role: 'user', parts: nativeParts }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: Math.min(maxTokens, 8192),
        responseMimeType: 'application/json',
      },
    };
  } else {
    const content = parts.map(p => {
      if (p.text) return { type: 'text', text: p.text };
      if (p.inlineData) return { type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } };
      if (p.image_url) return p;
      return null;
    }).filter(Boolean);

    reqBody = {
      model,
      messages: [{ role: 'user', content }],
      temperature: 0.1,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    };
  }

  const timeoutMs = useNative ? 240_000 : 300_000;
  const res = await axios.post(url, reqBody, { headers, timeout: timeoutMs });
  const data = res.data;

  if (useNative) {
    const parts2 = data?.candidates?.[0]?.content?.parts || [];
    const text = parts2.filter(p => !p.thought).map(p => p.text).filter(Boolean).join('');
    if (text) return text;
  } else {
    if (data?.choices?.[0]?.message?.content) return data.choices[0].message.content;
  }

  console.log('[API] Unexpected response shape:', JSON.stringify(data).slice(0, 300));
  throw new Error('Unexpected API response format');
}

// ─── CANONICAL SECTION NAMES & NORMALIZATION ────────────────
const CANONICAL_SECTIONS = [
  'India GK', 'Rajasthan GK', 'Reasoning', 'Hindi Grammar', 'English Grammar',
  'Mathematics', 'Computer', 'Constitution', 'Science', 'Current Affairs',
  'Rajasthan Current Affairs', 'World Geography', 'Women and Child Crime',
  'New Criminal Laws', 'Educational Scenario', 'Local Self-Government',
  'Animal Husbandry', 'History', 'Geography', 'Economy',
];

// Map common AI-generated names to canonical names
const SECTION_MAP = {
  'reasoning & aptitude': 'Reasoning', 'reasoning & quantitative aptitude': 'Reasoning',
  'reasoning, mathematics & computer': 'Reasoning', 'logical reasoning': 'Reasoning',
  'hindi language': 'Hindi Grammar', 'hindi': 'Hindi Grammar',
  'english language': 'English Grammar', 'english': 'English Grammar',
  'general science': 'Science', 'physics': 'Science', 'chemistry': 'Science', 'biology': 'Science',
  'biology (continued)': 'Science',
  'general knowledge': 'India GK', 'gk': 'India GK',
  'general knowledge & current affairs': 'Current Affairs',
  'general knowledge & science': 'Science',
  'constitution & polity': 'Constitution', 'polity': 'Constitution',
  'computer knowledge': 'Computer', 'computer & it': 'Computer', 'basic computer': 'Computer',
  'world gk': 'World Geography',
  'education': 'Educational Scenario',
  'rajasthan gk & current affairs': 'Rajasthan GK',
  'math': 'Mathematics', 'maths': 'Mathematics', 'quantitative aptitude': 'Mathematics',
  'current affairs & gk': 'Current Affairs',
  'animal husbandry & veterinary': 'Animal Husbandry',
  'panchayati raj': 'Local Self-Government',
  'new criminal laws & acts': 'New Criminal Laws',
  'women & child crime': 'Women and Child Crime',
  'general': 'India GK',
};

function normalizeSection(section) {
  if (!section) return 'India GK';
  // Already canonical?
  if (CANONICAL_SECTIONS.includes(section)) return section;
  // Exact match in map (case-insensitive)
  const lower = section.toLowerCase().trim();
  if (SECTION_MAP[lower]) return SECTION_MAP[lower];
  // Fuzzy match: find best canonical match by keyword overlap
  for (const [key, val] of Object.entries(SECTION_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  // Last resort: return as-is (will still show in subject quiz)
  console.warn(`[Section] Unknown section name: "${section}" — keeping as-is`);
  return section;
}

const PDFS_DIR = path.join(__dirname, 'data', 'pdfs');
if (!fs.existsSync(PDFS_DIR)) fs.mkdirSync(PDFS_DIR, { recursive: true });

// ─── DOWNLOAD PDF ────────────────────────────────────────────
async function downloadPdf(url) {
  console.log(`[PDF] Requesting URL: ${url}`);
  const filename = `${uuidv4()}.pdf`;
  const filepath = path.join(PDFS_DIR, filename);

  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/pdf,application/xhtml+xml,text/html;q=0.9,*/*;q=0.8'
      }
    });

    const buffer = Buffer.from(res.data);
    const header = buffer.subarray(0, 5).toString();
    console.log(`[PDF] Axios Result: ${buffer.length} bytes, Header: "${header}"`);

    // Verify PDF signature. If not %PDF, it's almost certainly an HTML error page.
    if (header === '%PDF-' || header.includes('%PDF')) {
      fs.writeFileSync(filepath, buffer);
      console.log(`[PDF] Saved via Axios: ${filepath}`);
      return filepath;
    }

    console.warn(`[PDF] Signature mismatch (No %PDF found). Forcing browser download...`);
    return await downloadWithBrowser(url, filepath);
  } catch (err) {
    console.warn(`[PDF] Axios download failed (${err.message}). Retrying with browser...`);
    return await downloadWithBrowser(url, filepath);
  }
}

async function downloadWithBrowser(url, filepath) {
  const { chromium } = require('playwright');
  console.log(`[PDF] Launching browser for: ${url}`);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    // Simulate a real user session
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    const buffer = await response.body();
    const header = buffer.subarray(0, 5).toString();
    console.log(`[PDF] Browser Result: ${buffer.length} bytes, Header: "${header}"`);

    if (header === '%PDF-' || header.includes('%PDF')) {
      fs.writeFileSync(filepath, buffer);
      console.log(`[PDF] Saved via Browser: ${filepath}`);
      return filepath;
    }

    throw new Error(`File is not a valid PDF (Header: "${header}")`);
  } catch (err) {
    console.error(`[PDF] Browser download failed: ${err.message}`);
    throw new Error('Failed to retrieve PDF. The website may be blocking automated access or the link is invalid.');
  } finally {
    await browser.close();
  }
}

// ─── CONVERT PDF PAGES TO BASE64 IMAGES ─────────────────────
async function pdfToImages(pdfPath) {
  try {
    const { execSync } = require('child_process');
    const outDir = path.join(path.dirname(pdfPath), path.basename(pdfPath, path.extname(pdfPath)) + '_pages');

    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    try {
      // Use JPEG compression to restrict payload sizes sent to AI
      execSync(`pdftoppm -r 100 -jpeg -jpegopt quality=70 "${pdfPath}" "${outDir}/page"`, { stdio: 'pipe' });
      const files = fs.readdirSync(outDir).filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg')).sort();
      return files.map(f => ({
        type: 'image',
        data: fs.readFileSync(path.join(outDir, f)).toString('base64'),
        mediaType: 'image/jpeg',
      }));
    } catch (e) {
      console.error('[PDF] pdftoppm failed:', e.message);
      console.error('[PDF] stdout:', e.stdout?.toString()?.slice(0, 500));
      console.error('[PDF] stderr:', e.stderr?.toString()?.slice(0, 500));
      throw e;
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
Identify sections/subjects in the paper with their question ranges. You MUST use ONLY these canonical section names:
"India GK" | "Rajasthan GK" | "Reasoning" | "Hindi Grammar" | "English Grammar" | "Mathematics" | "Computer" | "Constitution" | "Science" | "Current Affairs" | "Rajasthan Current Affairs" | "World Geography" | "Women and Child Crime" | "New Criminal Laws" | "Educational Scenario" | "Local Self-Government" | "Animal Husbandry" | "History" | "Geography" | "Economy"
Do NOT invent new names. Map the paper's sections to the closest canonical name above.`;

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
8. answer is 0-indexed (0=A, 1=B, 2=C, 3=D, 4=E). If the paper has an answer key printed, use it. Otherwise, try to determine the correct answer using your knowledge. If you are NOT confident in the answer, set answer to null — it is better to leave it null than to guess incorrectly.
9. If a question has an image/diagram/graph/figure, set has_image=true, page_num = 1-indexed page number. For image_box, provide [ymin,xmin,ymax,xmax] in 0-1000 normalized coords covering the ENTIRE question region including the question text, the diagram/figure, AND all option figures. If the options are also images/figures (not text), set options_en and options_hi to ["(A)", "(B)", "(C)", "(D)"${optCount === 5 ? ', "Question not attempted"' : ''}] as placeholders — the cropped image will show the actual option figures.
10. Passages/reading comprehension: extract the FULL passage text in "passages" array and reference via passage_id. Use UNIQUE passage IDs like "p_q${startQ}_1", "p_q${startQ}_2" etc. Every question that follows a passage MUST have its passage_id set.
11. Return ONLY a valid JSON object. No markdown fences, no explanation, no preamble.
12. IMPORTANT — "en" and "hi" fields must contain ONLY the question stem text, NOT the options. Options go ONLY in options_en/options_hi arrays.
13. EVERY question MUST have EXACTLY ${optCount} options. If the paper has an option like (E) "Question not attempted" / "अनुत्तरित प्रश्न", include it as the last option in EVERY question. Never drop or omit any option.
14. For "section" field: ${sections?.length ? 'Use the SECTION MAPPING above to assign the correct section name based on question number.' : 'Assign EXACTLY one of these canonical subject names based on the question content — do NOT invent new names:\n    "India GK" | "Rajasthan GK" | "Reasoning" | "Hindi Grammar" | "English Grammar" | "Mathematics" | "Computer" | "Constitution" | "Science" | "Current Affairs" | "Rajasthan Current Affairs" | "World Geography" | "Women and Child Crime" | "New Criminal Laws" | "Educational Scenario" | "Local Self-Government" | "Animal Husbandry" | "History" | "Geography" | "Economy"\n    If a question clearly belongs to Rajasthan (places, kings, forts, rivers, culture, schemes of Rajasthan) use "Rajasthan GK". For central government / Indian history / national topics use "India GK". For logical reasoning / puzzles / number series use "Reasoning". For Hindi grammar / comprehension use "Hindi Grammar". For English grammar / comprehension use "English Grammar". For basic computer knowledge use "Computer". For constitution / polity use "Constitution". For general science / physics / chemistry / biology use "Science". For women & child protection laws use "Women and Child Crime". For panchayati raj / municipal bodies use "Local Self-Government". For animal husbandry / veterinary use "Animal Husbandry". For education policy / pedagogy use "Educational Scenario". Do NOT use "General Knowledge" or "General".'}

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
async function extractByIndex(pages, paperTitle, totalQuestions, optCount, chunkSize, sections, onProgress) {
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
  let totalExtracted = 0;

  // Process each chunk sequentially with rate-limit spacing + retry
  for (let i = 0; i < batches.length; i++) {
    const job = batches[i];
    console.log(`[API] Running chunk ${i + 1}/${batches.length}: Q${job.start}-Q${job.end}...`);

    let success = false;
    for (let attempt = 0; attempt < 3 && !success; attempt++) {
      try {
        const promptText = buildExtractionPrompt(paperTitle, optCount, job.start, job.end, sections);
        const parts = buildPartsWithPages(pages, promptText);
        const raw = await callAI(parts, 16000);
        const parsed = parseResponse(raw);

        if (parsed && parsed.questions?.length > 0) {
          const withImages = await processExtractedImages(parsed, pages);
          console.log(`[API] Chunk Q${job.start}-Q${job.end} done: ${parsed.questions.length} questions extracted`);
          results.push({ ...withImages, start: job.start });
          totalExtracted += parsed.questions.length;
        } else {
          console.warn(`[API] Chunk Q${job.start}-Q${job.end}: got 0 questions`);
          results.push({ start: job.start });
        }
        success = true;
      } catch (err) {
        if (err.message?.includes('429')) {
          const waitMs = 15000 * Math.pow(2, attempt); // 15s, 30s, 60s
          console.error(`[API] Chunk Q${job.start}-Q${job.end} rate-limited (attempt ${attempt + 1}), waiting ${waitMs}ms...`);
          await sleep(waitMs);
        } else {
          console.error(`[API] Chunk Q${job.start}-Q${job.end} failed:`, err.message);
          results.push({ start: job.start });
          success = true; // don't retry non-429 errors
        }
      }
    }
    if (!success) results.push({ start: job.start });

    onProgress?.({ chunk: i + 1, totalChunks: batches.length, questionsExtracted: totalExtracted, totalQuestions });

    // 15s between chunks to stay within rate limits
    if (i < batches.length - 1) {
      console.log(`[API] Waiting 15s before next chunk...`);
      await sleep(15000);
    }
  }

  results.sort((a, b) => a.start - b.start);
  for (const res of results) {
    if (res.paper_info && !paperInfo) paperInfo = res.paper_info;
    if (res.passages) passages.push(...res.passages);
    if (res.questions) allQuestions.push(...res.questions);
  }

  // Preserve original question numbers from the AI — don't renumber
  // Only fix if a question has no number set
  allQuestions.forEach((q, idx) => {
    if (!q.number) q.number = idx + 1;
  });

  // Normalize section names to canonical list
  allQuestions.forEach(q => {
    q.section = normalizeSection(q.section);
  });

  console.log(`[API] Extraction complete: ${allQuestions.length}/${totalQuestions} questions extracted`);
  return { paper_info: paperInfo, passages, questions: allQuestions };
}

// ─── EXTRACT QUESTIONS VIA AI ─────────────────────────────────
async function extractQuestionsWithClaude(pages, paperTitle, onProgress) {
  console.log(`[API] Extracting questions from ${pages.length} page(s) using ${getApiModel()}...`);

  const meta = await getPaperMetadata(pages);
  const totalQuestions = meta.total_questions || 100;
  const optCount = meta.options_per_question || 4;
  // Normalize Pass 0 section names to canonical names
  const sections = (meta.sections || []).map(s => ({ ...s, name: normalizeSection(s.name) }));

  console.log(`[API] Will extract ${totalQuestions} questions with ${optCount} options each.`);
  if (sections.length) console.log(`[API] Sections: ${sections.map(s => `${s.name} (Q${s.start}-Q${s.end})`).join(', ')}`);
  const CHUNK_SIZE = 10; // Small enough for JSON response to fit within token budget

  return await extractByIndex(pages, paperTitle, totalQuestions, optCount, CHUNK_SIZE, sections, onProgress);
}

// ─── PARSE AI RESPONSE ────────────────────────────────────────
function parseResponse(raw) {
  const clean = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    // Try to extract and repair truncated JSON
    let jsonStr = clean;
    // Find the start of the JSON object
    const openIdx = jsonStr.indexOf('{');
    if (openIdx >= 0) jsonStr = jsonStr.slice(openIdx);
    // Reconstruct truncated JSON by closing open braces/brackets
    let fixed = jsonStr.trim();
    // Remove trailing partial key/value pairs and fix
    fixed = fixTruncatedJson(fixed);
    try { return JSON.parse(fixed); } catch {}
    // Last resort: try matching balanced braces
    try { return JSON.parse(bracketMatch(clean)); } catch {}
    console.error('[API] Failed to parse response. First 150 chars:', raw.slice(0, 150), '... Last 150 chars:', raw.slice(-150));
    return null;
  }
}

function fixTruncatedJson(str) {
  // Walk the JSON string and try to close missing brackets/braces
  let inString = false;
  let escape = false;
  let stack = [];

  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') {
      if (stack.length && stack[stack.length - 1] === c) stack.pop();
    }
  }
  // Close remaining open structures
  while (stack.length) str += stack.pop();
  return str;
}

function bracketMatch(str) {
  let balance = 0;
  let result = '';
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '{') balance++;
    if (str[i] === '}') balance--;
    if (balance > 0) result += str[i];
    else if (balance === 0 && str[i] === '{') { result += '{'; balance = 1; }
    if (balance <= 0 && i > 0) break;
  }
  while (balance > 0) { result += '}'; balance--; }
  return result;
}

// ─── CLEANUP ──────────────────────────────────────────────────
function cleanupFile(filepath) {
  try { fs.unlinkSync(filepath); } catch { }
}

function cleanupPagesDir(pdfPath) {
  const dir = pdfPath.replace('.pdf', '_pages');
  try { if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true }); } catch { }
}

// ─── PDF → BASE64 IMAGES (for upload endpoint) ─────────────────
async function pdfToBase64Images(pdfPath) {
  const pages = await pdfToImages(pdfPath);
  return pages.map(p => `data:${p.mediaType};base64,${p.data}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── PROCESS CLIENT-SIDE IMAGES ──────────────────────────────
async function processImages(base64Images, paperTitle, onProgress) {
  const pages = base64Images.map(dataStr => {
    const base64Data = dataStr.includes(',') ? dataStr.split(',')[1] : dataStr;
    return {
      type: 'image',
      data: base64Data,
      mediaType: 'image/jpeg',
    };
  });

  return await extractQuestionsWithClaude(pages, paperTitle, onProgress);
}

// ─── MAIN PROCESS FUNCTION ────────────────────────────────────
async function processPdf(pdfUrl, paperTitle, onProgress) {
  let pdfPath = null;
  try {
    pdfPath = await downloadPdf(pdfUrl);
    const pages = await pdfToImages(pdfPath);
    return await extractQuestionsWithClaude(pages, paperTitle, onProgress);
  } finally {
    if (pdfPath) cleanupFile(pdfPath);
  }
}

module.exports = { processPdf, processImages, downloadPdf, pdfToImages, extractQuestionsWithClaude, pdfToBase64Images, cleanupFile, cleanupPagesDir };