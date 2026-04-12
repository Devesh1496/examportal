// components/Home/Home.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../utils/api';
import { supabase } from '../../supabaseClient';
import { processPaperClientSide, processPaperFromFile } from '../../utils/pdfProcessor';
import { Spinner, StatusBadge, EmptyState, StatCard, Input, Modal } from '../UI';
import { usePaperStatus } from '../../hooks/usePolling';
import './Home.css';

// ── AddPaperModal ─────────────────────────────────────────────
function AddPaperModal({ open, onClose, onAdded }) {
  const [mode, setMode] = useState('url');       // 'url' | 'file'
  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [done, setDone] = useState(false);

  const resetState = () => {
    setUrl(''); setFile(null); setTitle('');
    setError(''); setStatus(''); setDone(false);
  };

  const switchMode = (m) => { if (!loading) { setMode(m); resetState(); } };

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
        setError('Please select a PDF file');
        return;
      }
      if (f.size > 50 * 1024 * 1024) {
        setError('File too large (max 50 MB)');
        return;
      }
      setFile(f);
      setError('');
      // Auto-fill title from filename if empty
      if (!title.trim()) {
        setTitle(f.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' '));
      }
    }
  };

  // Extraction progress state
  const [progress, setProgress] = useState(null); // { chunk, totalChunks, questionsExtracted, totalQuestions }

  const handleStatus = useCallback((msg) => {
    setStatus(msg);
    // If msg looks like the progress template, parse it
    const m = msg.match(/Extracting chunk (\d+)\/(\d+) — (\d+)\/(\d+) questions done/);
    if (m) {
      setProgress({ chunk: +m[1], totalChunks: +m[2], questionsExtracted: +m[3], totalQuestions: +m[4] });
    } else {
      // If extraction finished or started, reset progress when done
      if (msg.includes('Extracted') && msg.includes('questions') && msg.includes('!')) {
        setProgress(null);
      }
    }
  }, []);

  const handleAdd = async () => {
    if (mode === 'url' && !url.trim()) return setError('Please enter a PDF URL');
    if (mode === 'file' && !file) return setError('Please select a PDF file');

    setLoading(true); setError(''); setStatus('Starting…'); setDone(false); setProgress(null);
    try {
      let paperTitle;
      let extracted;

      if (mode === 'url') {
        paperTitle = title.trim() || extractTitleFromUrl(url.trim());
        extracted = await processPaperClientSide(url.trim(), paperTitle, handleStatus);
      } else {
        paperTitle = title.trim() || file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
        extracted = await processPaperFromFile(file, paperTitle, handleStatus);
      }

      // Save to backend
      setStatus('Saving to database…');
      await api.savePaper(
        {
          title: extracted.paper_info?.title || paperTitle,
          source_url: mode === 'url' ? url.trim() : `upload://${file.name}`,
          pdf_url: mode === 'url' ? url.trim() : `upload://${file.name}`,
          website: 'manual',
          metadata: {
            max_marks: extracted.paper_info?.max_marks,
            duration: extracted.paper_info?.duration,
            negative_marking: extracted.paper_info?.negative_marking,
          },
        },
        extracted.questions,
        extracted.passages || []
      );

      setDone(true);
      setProgress(null);
      setStatus(`Done! ${extracted.questions.length} questions extracted.`);
      onAdded();
    } catch (e) {
      console.error('Processing error:', e);
      setError(e.message);
      setStatus('');
    } finally {
      setLoading(false);
    }
  };

  const hasInput = mode === 'url' ? !!url.trim() : !!file;

  return (
    <Modal open={open} onClose={onClose} title="Add Question Paper" width={560}>
      <div className="add-modal">
        {/* Mode toggle */}
        <div className="add-modal-tabs">
          <button
            className={`add-tab ${mode === 'url' ? 'active' : ''}`}
            onClick={() => switchMode('url')}
            disabled={loading}
          >
            Link / URL
          </button>
          <button
            className={`add-tab ${mode === 'file' ? 'active' : ''}`}
            onClick={() => switchMode('file')}
            disabled={loading}
          >
            Upload PDF
          </button>
        </div>

        {mode === 'url' ? (
          <>
            <div className="add-modal-hint">
              Paste a <strong>PDF URL</strong> from any exam website.
              Questions will be extracted using AI.
            </div>
            <Input
              label="PDF URL"
              value={url}
              onChange={setUrl}
              placeholder="https://rssb.rajasthan.gov.in/storage/questionpaper/..."
            />
          </>
        ) : (
          <>
            <div className="add-modal-hint">
              Upload a <strong>PDF file</strong> from your device.
              Max 50 MB. Questions will be extracted using AI.
            </div>
            <div className="add-file-area">
              <input
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleFileChange}
                id="pdf-upload"
                className="add-file-input"
                disabled={loading}
              />
              <label htmlFor="pdf-upload" className="add-file-label">
                {file ? (
                  <div className="add-file-selected">
                    <span className="add-file-icon">PDF</span>
                    <div>
                      <div className="add-file-name">{file.name}</div>
                      <div className="add-file-size">{(file.size / 1024 / 1024).toFixed(1)} MB</div>
                    </div>
                  </div>
                ) : (
                  <div className="add-file-empty">
                    <span className="add-file-upload-icon">+</span>
                    <span>Click to select PDF or drag & drop</span>
                  </div>
                )}
              </label>
            </div>
          </>
        )}

        <Input
          label="Title (optional)"
          value={title}
          onChange={setTitle}
          placeholder="e.g. RSSB Junior Engineer 2024"
        />

        {error && (
          <div className="add-modal-error">
            {error}
            {(error.toLowerCase().includes('download') || error.toLowerCase().includes('retrieve') || error.toLowerCase().includes('cors')) && mode === 'url' && url.trim() && (
              <div className="add-modal-error-help">
                <strong>This site blocks automated downloads.</strong> You can still add it in 2 steps:
                <div className="add-modal-error-steps">
                  <a
                    className="btn btn-ghost btn-sm"
                    href={url.trim()}
                    target="_blank"
                    rel="noopener noreferrer"
                    download
                  >
                    1. Download PDF ↓
                  </a>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => { switchMode('file'); }}
                  >
                    2. Upload it →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {progress && (
          <div className="add-modal-progress-bar-wrap">
            <div className="add-modal-progress-bar">
              <div
                className="add-modal-progress-fill"
                style={{ width: `${(progress.questionsExtracted / progress.totalQuestions) * 100}%` }}
              />
            </div>
            <div className="add-modal-progress-text">
              {progress.questionsExtracted} / {progress.totalQuestions} questions extracted — Chunk {progress.chunk} / {progress.totalChunks}
            </div>
          </div>
        )}
        {status && !error && (
          <div className="add-modal-status" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {loading && !progress && <Spinner size={14} />}
            {status}
          </div>
        )}
        <div className="add-modal-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn btn-primary" onClick={done ? onClose : handleAdd} disabled={loading || !hasInput}>
            {loading ? 'Processing…' : done ? 'Done' : 'Extract Questions'}
          </button>
        </div>
      </div>
    </Modal>
  );
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

// ── PaperCard ─────────────────────────────────────────────────
function PaperCard({ paper, onStartQuiz, onViewPaper, onDelete, isAdmin }) {
  const meta = (typeof paper.metadata === 'string' ? JSON.parse(paper.metadata) : paper.metadata) || {};
  // Poll if processing
  const { status, totalQ } = usePaperStatus(
    paper.status === 'processing' ? paper.id : null,
    () => {}
  );
  const liveStatus = status || paper.status;
  const liveTotal = totalQ || paper.total_q;

  return (
    <div className={`paper-card fade-up ${liveStatus}`}>
      <div className="paper-card-top">
        <div className="paper-card-icon">📄</div>
        <div className="paper-card-info">
          <div className="paper-card-title">{paper.title}</div>
          <div className="paper-card-meta">
            <span>{paper.website?.toUpperCase()}</span>
            <span>·</span>
            <span>{new Date(paper.date_found).toLocaleDateString('en-IN')}</span>
            {liveTotal > 0 && <><span>·</span><span>{liveTotal} Questions</span></>}
          </div>
        </div>
        <StatusBadge status={liveStatus} />
      </div>

      {liveStatus === 'processing' && (
        <div className="paper-card-progress">
          <div className="paper-card-progress-bar">
            <div className="paper-card-progress-fill animated" />
          </div>
          <span>Extracting questions with AI…</span>
        </div>
      )}

      <div className="paper-card-actions">
        <button
          className="btn btn-primary"
          disabled={liveStatus !== 'ready'}
          onClick={() => onStartQuiz(paper)}
        >
          ▶ Start Quiz
        </button>
        <button
          className="btn btn-ghost"
          disabled={liveStatus !== 'ready'}
          onClick={() => onViewPaper(paper)}
        >
          ⎙ View Paper
        </button>
        {isAdmin && (
          <button className="btn btn-ghost" onClick={() => onDelete(paper.id)} title="Delete">🗑</button>
        )}
      </div>
    </div>
  );
}

// ── Extract base exam name from title ────────────────────────
function extractExamName(title = '') {
  return title
    .replace(/\b(19|20)\d{2}\b/g, '')           // remove years
    .replace(/\b(RSSB|RPSC|RSSC|UPSC|SSC|RAS|IAS|NTA)\b/gi, '') // remove org prefixes
    .replace(/[-–_|]/g, ' ')                     // remove separators
    .replace(/\b(v\d+|fixed|new|old|set [a-z])\b/gi, '') // remove version tags
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());     // Title Case
}

// ── Home ──────────────────────────────────────────────────────
export default function Home({ onStartQuiz, onViewPaper, isAdmin, embedded = false }) {
  const [papers, setPapers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [scraping, setScraping] = useState(false);
  const [activeChip, setActiveChip] = useState('All');

  // Listen for external "open-add-paper" event (triggered from app topbar)
  useEffect(() => {
    const handler = () => setShowAdd(true);
    window.addEventListener('open-add-paper', handler);
    return () => window.removeEventListener('open-add-paper', handler);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [papersRes, statsRes] = await Promise.all([api.getPapers({ limit: 50 }), api.getStats()]);
      setPapers(papersRes.papers || []);
      setStats(statsRes);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Refresh every 5s if any paper is processing
  useEffect(() => {
    const hasProcessing = papers.some(p => p.status === 'processing');
    if (!hasProcessing) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [papers, load]);

  const handleScrapeAll = async () => {
    setScraping(true);
    try {
      await api.scrapeAll();
      setTimeout(load, 3000);
    } catch (e) {
      alert(e.message);
    } finally {
      setTimeout(() => setScraping(false), 3000);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleDelete = async (id) => {
    if (!isAdmin) return;
    if (!window.confirm('Delete this paper and all its questions?')) return;
    await api.deletePaper(id);
    setPapers(prev => prev.filter(p => p.id !== id));
  };

  const filtered = papers.filter(p =>
    !search || p.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className={`home fade-in${embedded ? ' home-embedded' : ''}`}>
      {/* ── Header (only shown when NOT embedded in App tabs) ── */}
      {!embedded && (
        <div className="home-header">
          <div className="home-logo">
            <div className="home-logo-icon">K</div>
            <div>
              <div className="home-logo-title">Kinetic Academy</div>
              <div className="home-logo-sub">Premium AI Exam Portal</div>
            </div>
          </div>
          <div className="home-header-actions">
            {isAdmin && (
              <>
                <button className="btn btn-ghost" onClick={handleScrapeAll} disabled={scraping}>
                  {scraping ? <><Spinner size={13}/> Scanning…</> : '🔄 Scan Websites'}
                </button>
                <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
                  + Add Paper
                </button>
              </>
            )}
            <button className="btn btn-ghost-danger" onClick={handleLogout} title="Logout">
              Logout
            </button>
          </div>
        </div>
      )}

      {/* ── Stats ── */}
      {stats && (
        <div className="home-stats">
          <StatCard label="Total Papers" value={stats.totalPapers} />
          <StatCard label="Ready" value={stats.readyPapers} accent="var(--green)" />
          <StatCard label="Processing" value={stats.processingPapers} accent="var(--amber)" />
          <StatCard label="Questions" value={(stats.totalQuestions || 0).toLocaleString()} accent="var(--accent-lt)" />
          <StatCard label="Attempts" value={stats.totalAttempts} />
          {stats.totalCandidates > 0 && <StatCard label="Candidates" value={stats.totalCandidates} accent="var(--accent-lt)" />}
        </div>
      )}

      {/* ── Search + list ── */}
      <div className="home-list-header">
        <div className="home-list-title">Question Papers</div>
        <Input value={search} onChange={setSearch} placeholder="Search papers…" />
      </div>

      {loading ? (
        <div className="home-loading"><Spinner size={28}/><span>Loading papers…</span></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="📚"
          title="No papers yet"
          subtitle="Add a question paper URL or scan exam websites to get started."
          action={
            <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
              + Add your first paper
            </button>
          }
        />
      ) : (
        <div className="home-papers">
          {filtered.map(p => (
            <PaperCard
              key={p.id}
              paper={p}
              onStartQuiz={onStartQuiz}
              onViewPaper={onViewPaper}
              onDelete={handleDelete}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}

      <AddPaperModal
        open={showAdd}
        onClose={() => { setShowAdd(false); load(); }}
        onAdded={() => { setTimeout(load, 2000); }}
      />
    </div>
  );
}

