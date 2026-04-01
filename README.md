# ⚡ ExamPortal — AI-Powered Quiz Generator

Automatically scrapes question papers from exam websites (RSSB, RPSC, etc.), 
uses **Claude AI** to extract all questions, and generates interactive bilingual quizzes.

---

## 📁 Project Structure

```
examportal/
├── backend/                  ← Node.js + Express API
│   ├── server.js             ← Main server + all API routes
│   ├── scraper.js            ← Website scraper (RSSB, RPSC, custom URLs)
│   ├── pdfProcessor.js       ← PDF downloader + Claude AI question extractor
│   ├── db.js                 ← SQLite database (papers, questions, attempts)
│   ├── .env.example          ← Copy to .env and add your API key
│   └── package.json
│
└── frontend/                 ← React app
    └── src/
        ├── App.jsx           ← Top-level screen router
        ├── components/
        │   ├── Home/         ← Paper list, add paper, stats dashboard
        │   ├── Exam/         ← Quiz screen, timer, options, review
        │   └── UI/           ← Reusable components (Spinner, Modal, Tag…)
        ├── hooks/
        │   ├── useExam.js    ← Exam state: answers, timer, scoring
        │   └── usePolling.js ← Polls paper processing status
        ├── utils/
        │   └── api.js        ← All API calls in one place
        └── styles/
            └── global.css    ← CSS variables + base styles
```

---

## 🚀 Quick Start

### 1. Get Anthropic API Key
Sign up at https://console.anthropic.com and create an API key.

### 2. Setup Backend

```bash
cd backend

# Install dependencies
npm install

# Install Playwright browser (for JS-heavy sites like RPSC)
npx playwright install chromium

# Create .env file
cp .env.example .env

# Open .env and add your key:
# ANTHROPIC_API_KEY=sk-ant-your-key-here

# Start backend
npm start
# → Running on http://localhost:3001
```

### 3. Setup Frontend

```bash
# In a new terminal
cd frontend

npm install
npm start
# → Opens http://localhost:3000
```

### 4. Optional: Install pdftoppm (better PDF rendering)

```bash
# Ubuntu/Debian
sudo apt-get install poppler-utils

# macOS
brew install poppler

# Windows — download from: https://github.com/oschwartz10612/poppler-windows
```
Without pdftoppm, the app sends the PDF directly to Claude (still works, slightly slower).

---

## 📖 How to Use

### Add a Paper Automatically
1. Click **"+ Add Paper"**
2. Paste any of these:
   - Direct PDF URL: `https://rssb.rajasthan.gov.in/storage/questionpaper/xxx.pdf`
   - Webpage with PDFs: `https://rssb.rajasthan.gov.in/examdashboard`
3. Click **"Extract Questions"**
4. Wait 30–120 seconds (Claude reads all pages)
5. Click **▶ Start Quiz** when status turns green

### Scan Websites Automatically
Click **"🔄 Scan Websites"** to scrape all configured websites for new papers.
This also runs automatically every 6 hours.

### Taking the Quiz
- **Language toggle**: Switch between English / हिंदी / Both
- **Question nav dots**: Jump to any question
- **★ Mark**: Flag questions for review
- **Submit**: See score, section breakdown, and review all answers

---

## ⚙️ Adding More Websites

Edit `backend/scraper.js` and add a new entry to the `WEBSITES` array:

```js
{
  id: 'mysite',
  name: 'My Exam Site',
  baseUrl: 'https://example.com',
  examDashboardUrl: 'https://example.com/papers',
  useBrowser: false,  // true if site uses JavaScript rendering
  parseLinks: async (html, baseUrl) => {
    const $ = cheerio.load(html);
    const links = [];
    $('a[href$=".pdf"]').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;
      links.push({ url: fullUrl, title: text });
    });
    return links;
  },
}
```

---

## 🔌 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/papers` | List all papers |
| GET | `/api/papers/:id` | Get single paper |
| GET | `/api/papers/:id/questions` | Get all questions |
| GET | `/api/papers/:id/status` | Poll processing status |
| DELETE | `/api/papers/:id` | Delete paper + questions |
| POST | `/api/scrape` | Trigger website scrape |
| POST | `/api/scrape/url` | Add paper by URL |
| POST | `/api/attempts` | Save quiz attempt |
| GET | `/api/attempts` | Get attempt history |
| GET | `/api/stats` | Dashboard statistics |
| GET | `/api/health` | Health check |

---

## 🧠 How AI Extraction Works

1. **Download** the PDF from the website
2. **Convert** each page to a PNG image (via `pdftoppm`)
3. **Send** all page images to `claude-opus-4-6` with a structured prompt
4. **Parse** the returned JSON: questions, options, answers, sections, passages
5. **Save** everything to SQLite database
6. For large papers (>8 pages), processes in batches automatically

Claude handles:
- ✅ Bilingual papers (Hindi + English)  
- ✅ Passage-based questions  
- ✅ Matching/matrix questions  
- ✅ Mathematical expressions  
- ✅ Diagram-referenced questions  
- ✅ Mixed section papers (GK, Maths, Hindi, English…)

---

## 🗄️ Database Schema

**papers** — one row per PDF
```
id, title, source_url, pdf_url, website, exam_type,
date_found, status (pending/processing/ready/failed),
total_q, metadata (JSON: max_marks, duration, negative_marking)
```

**questions** — extracted by Claude
```
id, paper_id, q_number, en, hi,
options_en (JSON), options_hi (JSON), answer (0-indexed),
section, has_passage, passage_en, passage_hi, q_type
```

**attempts** — saved quiz results
```
id, paper_id, answers (JSON), score, correct, wrong, skipped,
time_taken, created_at
```

---

## 🔧 Troubleshooting

**"No questions found"** — The PDF might be scanned/image-based without text. 
Make sure `pdftoppm` is installed for best results.

**"Processing" stuck** — Check backend terminal for errors. Usually means:
- Invalid `ANTHROPIC_API_KEY` in `.env`
- PDF URL is blocked / requires authentication
- Claude API rate limit (wait a few minutes)

**CORS error** — Make sure `FRONTEND_URL` in `.env` matches your frontend port.

**Site won't scrape** — Set `useBrowser: true` in the site's config in `scraper.js`.

---

## 📦 Tech Stack

| Layer | Technology |
|-------|-----------|
| AI    | Anthropic Claude (claude-opus-4-6) |
| Backend | Node.js + Express |
| Scraping | Axios + Cheerio + Playwright |
| Database | SQLite (zero setup) |
| Frontend | React 18 |
| Fonts | Syne + DM Sans + Noto Sans Devanagari |
| Scheduling | node-cron |
