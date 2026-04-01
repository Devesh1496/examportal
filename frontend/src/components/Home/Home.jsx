// components/Home/Home.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../utils/api';
import { processPaperClientSide } from '../../utils/pdfProcessor';
import { Spinner, StatusBadge, EmptyState, StatCard, Input, Modal } from '../UI';
import { usePaperStatus } from '../../hooks/usePolling';
import './Home.css';

// ── AddPaperModal ─────────────────────────────────────────────
function AddPaperModal({ open, onClose, onAdded }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [done, setDone] = useState(false);

  const handleAdd = async () => {
    if (!url.trim()) return setError('Please enter a PDF URL');



    setLoading(true); setError(''); setStatus('Starting…'); setDone(false);
    try {
      const paperTitle = title.trim() || extractTitleFromUrl(url.trim());

      // Client-side processing via AI
      const extracted = await processPaperClientSide(url.trim(), paperTitle, setStatus);

      // Save to backend
      setStatus('Saving to database…');
      await api.savePaper(
        {
          title: extracted.paper_info?.title || paperTitle,
          source_url: url.trim(),
          pdf_url: url.trim(),
          website: 'manual',
          metadata: {
            max_marks: extracted.paper_info?.max_marks,
            duration: extracted.paper_info?.duration,
            negative_marking: extracted.paper_info?.negative_marking,
          },
        },
        extracted.questions
      );

      setDone(true);
      setStatus(`✅ Done! ${extracted.questions.length} questions extracted.`);
      onAdded();
    } catch (e) {
      console.error('Processing error:', e);
      setError(e.message);
      setStatus('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Question Paper" width={520}>
      <div className="add-modal">
        <div className="add-modal-hint">
          Paste a <strong>PDF URL</strong>. 
          Questions will be extracted using AI directly in your browser — no API key needed.
        </div>
        <Input
          label="URL"
          value={url}
          onChange={setUrl}
          placeholder="https://rssb.rajasthan.gov.in/storage/questionpaper/..."
        />
        <Input
          label="Title (optional)"
          value={title}
          onChange={setTitle}
          placeholder="e.g. RSSB Junior Engineer 2024"
        />
        {error && <div className="add-modal-error">⚠ {error}</div>}
        {status && !error && (
          <div className="add-modal-status" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {loading && <Spinner size={14} />}
            {status}
          </div>
        )}
        <div className="add-modal-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn btn-primary" onClick={done ? onClose : handleAdd} disabled={loading || !url}>
            {loading ? <>Processing…</> : done ? '✅ Done' : '🚀 Extract Questions'}
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
function PaperCard({ paper, onStartQuiz, onDelete }) {
  const meta = paper.metadata ? JSON.parse(paper.metadata) : {};
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
            {meta.max_marks && <><span>·</span><span>{meta.max_marks} Marks</span></>}
            {meta.duration && <><span>·</span><span>{meta.duration}</span></>}
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
          {liveStatus === 'ready' ? '▶ Start Quiz' : liveStatus === 'processing' ? 'Processing…' : 'Unavailable'}
        </button>
        <button className="btn btn-ghost" onClick={() => onDelete(paper.id)}>🗑 Delete</button>
      </div>
    </div>
  );
}

// ── Home ──────────────────────────────────────────────────────
export default function Home({ onStartQuiz }) {
  const [papers, setPapers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [scraping, setScraping] = useState(false);

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

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this paper and all its questions?')) return;
    await api.deletePaper(id);
    setPapers(prev => prev.filter(p => p.id !== id));
  };

  const filtered = papers.filter(p =>
    !search || p.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="home fade-in">
      {/* ── Header ── */}
      <div className="home-header">
        <div className="home-logo">
          <span className="home-logo-icon">⚡</span>
          <div>
            <div className="home-logo-title">ExamPortal</div>
            <div className="home-logo-sub">AI-Powered Quiz Generator</div>
          </div>
        </div>
        <div className="home-header-actions">
          <button className="btn btn-ghost" onClick={handleScrapeAll} disabled={scraping}>
            {scraping ? <><Spinner size={13}/> Scanning…</> : '🔄 Scan Websites'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            + Add Paper
          </button>
        </div>
      </div>

      {/* ── Stats ── */}
      {stats && (
        <div className="home-stats">
          <StatCard label="Total Papers" value={stats.totalPapers} />
          <StatCard label="Ready" value={stats.readyPapers} accent="var(--green)" />
          <StatCard label="Processing" value={stats.processingPapers} accent="var(--amber)" />
          <StatCard label="Questions" value={(stats.totalQuestions || 0).toLocaleString()} accent="var(--accent-lt)" />
          <StatCard label="Attempts" value={stats.totalAttempts} />
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
              onDelete={handleDelete}
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
