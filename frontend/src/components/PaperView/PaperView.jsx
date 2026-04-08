// components/PaperView/PaperView.jsx
import React, { useState, useEffect } from 'react';
import { api } from '../../utils/api';
import { Spinner, Modal } from '../UI';
import './PaperView.css';

export default function PaperView({ paperId, initialPaper, onBack, onStartQuiz, onJumpToQuestion = null, isQuizActive = false, isAdmin = false }) {
  const [paper, setPaper] = useState(initialPaper);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(!initialPaper || !questions.length);
  const [error, setError] = useState('');
  const [showAnswerKey, setShowAnswerKey] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await api.getQuestions(paperId);
        setQuestions(data.questions || []);
        if (!paper) {
            const papers = await api.getPapers({ limit: 100 });
            const p = papers.papers.find(x => x.id === paperId);
            setPaper(p);
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [paperId, paper]);

  if (loading) return <div className="pv-loading"><Spinner size={32} /><span>Preparing full paper view…</span></div>;
  if (error) return <div className="pv-error">⚠ {error} <button onClick={onBack}>Go Back</button></div>;

  return (
    <div className="pv fade-in">
      <div className="pv-header">
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        <div className="pv-title-wrap">
          <h1 className="pv-title">{paper?.title}</h1>
          <p className="pv-meta">Full Paper View • {questions.length} Questions</p>
        </div>
        <div className="pv-actions">
           {isQuizActive
             ? <button className="btn btn-primary" onClick={() => onStartQuiz(paper)}>← Back to Quiz</button>
             : <button className="btn btn-primary" onClick={() => onStartQuiz(paper)}>▶ Start Quiz Mode</button>
           }
           {isAdmin && !isQuizActive && (
             <button className="btn btn-ghost" onClick={() => setShowAnswerKey(true)}>🔑 Answer Key</button>
           )}
           <button className="btn btn-ghost" onClick={() => window.print()}>⎙ Print</button>
        </div>
      </div>

      <div className="pv-content">
        <div className="pv-sheet">
          {questions.map((q, idx) => {
            const optEn = q.options_en || [];
            const optHi = q.options_hi || [];
            const LETTERS = ['A','B','C','D','E','F'];
            const passage = q.passage_en || q.passage_hi;

            return (
              <div key={q.id} className="pv-question" id={`pv-q-${idx}`}>
                <div className="pv-q-header">
                  <span className="pv-q-num">Q{idx + 1}</span>
                  {q.section && q.section !== 'General' && <span className="pv-q-sec">{q.section}</span>}
                  {isQuizActive && onJumpToQuestion && (
                    <button className="btn btn-ghost btn-sm pv-jump-btn" onClick={() => onJumpToQuestion(idx)}>
                      → Go to Quiz
                    </button>
                  )}
                </div>

                {passage && (
                  <div className="pv-q-passage">
                    <div className="pv-q-passage-label">READ THE PASSAGE:</div>
                    <div>{q.passage_en}</div>
                    {q.passage_hi && q.passage_hi !== q.passage_en && (
                      <div style={{ marginTop: '1rem', fontFamily: 'var(--font-hi, inherit)' }}>{q.passage_hi}</div>
                    )}
                  </div>
                )}

                <div className="pv-q-text">
                  {q.en && <div>{q.en}</div>}
                  {q.hi && q.hi !== q.en && <div style={{ marginTop: '0.5rem', fontSize: '0.9em', color: 'var(--text2)' }}>{q.hi}</div>}
                </div>

                {q.image_base64 && (
                  <div style={{ margin: '1rem 0' }}>
                    <img src={q.image_base64} alt={`Q${idx + 1}`} style={{ maxWidth: '100%', maxHeight: '500px', borderRadius: '8px', border: '1px solid var(--bg4)' }} />
                  </div>
                )}

                <div className="pv-options">
                  {optEn.map((opt, i) => (
                    <div key={i} className="pv-opt">
                      <span className="pv-opt-letter">{LETTERS[i]}</span>
                      <span className="pv-opt-txt">
                        {opt}
                        {optHi[i] && optHi[i] !== opt && <span style={{ color: 'var(--text3)', marginLeft: '0.5rem' }}>/ {optHi[i]}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="pv-footer">
            <div className="pv-footer-line">End of Question Paper</div>
            <div className="pv-footer-sub">ExamPortal • AI-Powered Quiz</div>
          </div>
        </div>
      </div>

      {/* Answer Key Modal */}
      {showAnswerKey && (
        <AnswerKeyModal
          paperId={paperId}
          questions={questions}
          onClose={() => setShowAnswerKey(false)}
          onSaved={() => {
            setShowAnswerKey(false);
            // Reload questions to get updated answers
            api.getQuestions(paperId).then(data => setQuestions(data.questions || []));
          }}
        />
      )}
    </div>
  );
}

// ── Answer Key Modal ──────────────────────────────────────────
function AnswerKeyModal({ paperId, questions, onClose, onSaved }) {
  const LETTERS = ['A','B','C','D','E','F'];
  const [answers, setAnswers] = useState(() => {
    const initial = {};
    questions.forEach(q => {
      initial[q.q_number] = q.answer;
    });
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [mode, setMode] = useState('grid'); // 'grid' | 'bulk' | 'pdf'
  const [pdfFile, setPdfFile] = useState(null);
  const [extracting, setExtracting] = useState(false);

  const handleChange = (qNum, val) => {
    setAnswers(prev => ({ ...prev, [qNum]: val }));
  };

  const parseBulkText = () => {
    // Parse formats like: 1-C, 2-A, 3-B or 1.C 2.A 3.B or 1)C 2)A
    const parsed = {};
    const lines = bulkText.replace(/,/g, '\n').split('\n');
    for (const line of lines) {
      const match = line.trim().match(/^(\d+)\s*[.\-)\]:\s]+\s*([A-Ea-e])/);
      if (match) {
        const qNum = parseInt(match[1]);
        const letter = match[2].toUpperCase();
        parsed[qNum] = letter.charCodeAt(0) - 65; // A=0, B=1, ...
      }
    }
    if (Object.keys(parsed).length > 0) {
      setAnswers(prev => ({ ...prev, ...parsed }));
      setMode('grid');
      setSuccess(`Parsed ${Object.keys(parsed).length} answers`);
    } else {
      setError('Could not parse any answers. Use format: 1-C, 2-A, 3-B');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      // Only send non-null answers
      const toSend = {};
      for (const [qNum, ans] of Object.entries(answers)) {
        if (ans !== null && ans !== undefined && ans !== '') {
          toSend[qNum] = parseInt(ans);
        }
      }
      const result = await api.uploadAnswerKey(paperId, toSend);
      setSuccess(result.message || `Updated ${result.updated} answers`);
      setTimeout(onSaved, 1500);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePdfExtract = async () => {
    if (!pdfFile) return setError('Please select a PDF file');
    setExtracting(true);
    setError('');
    setSuccess('');
    try {
      const result = await api.extractAnswerKeyPdf(paperId, pdfFile);
      if (result.answers) {
        // Convert string keys to numbers and merge
        const parsed = {};
        for (const [qNum, ans] of Object.entries(result.answers)) {
          parsed[parseInt(qNum)] = parseInt(ans);
        }
        setAnswers(prev => ({ ...prev, ...parsed }));
        setMode('grid');
        setSuccess(`Extracted ${result.total} answers from PDF`);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setExtracting(false);
    }
  };

  // Count changes from AI answers
  const changes = questions.filter(q => {
    const newAns = answers[q.q_number];
    return newAns !== null && newAns !== undefined && newAns !== q.answer;
  }).length;

  return (
    <Modal open={true} onClose={onClose} title="🔑 Upload Answer Key" width={700}>
      <div className="ak-modal">
        <div className="ak-tabs">
          <button className={`ak-tab${mode==='grid'?' active':''}`} onClick={() => setMode('grid')}>Grid Entry</button>
          <button className={`ak-tab${mode==='bulk'?' active':''}`} onClick={() => setMode('bulk')}>Paste Text</button>
          <button className={`ak-tab${mode==='pdf'?' active':''}`} onClick={() => setMode('pdf')}>Extract from PDF</button>
        </div>

        {mode === 'bulk' && (
          <div className="ak-bulk">
            <textarea
              className="ak-textarea"
              placeholder="Paste answer key here, e.g.:\n1-C\n2-A\n3-B\n4-D\n...\n\nOr: 1-C, 2-A, 3-B, 4-D"
              value={bulkText}
              onChange={e => setBulkText(e.target.value)}
              rows={10}
            />
            <button className="btn btn-primary" onClick={parseBulkText}>Parse Answers</button>
          </div>
        )}

        {mode === 'pdf' && (
          <div className="ak-bulk">
            <p style={{ margin: '0 0 12px', color: '#666', fontSize: 14 }}>
              Upload the answer key PDF and AI will extract all answers automatically.
            </p>
            <input
              type="file"
              accept=".pdf"
              onChange={e => setPdfFile(e.target.files[0])}
              style={{ marginBottom: 12 }}
            />
            <button
              className="btn btn-primary"
              onClick={handlePdfExtract}
              disabled={extracting || !pdfFile}
            >
              {extracting ? 'Extracting answers…' : 'Extract Answers from PDF'}
            </button>
          </div>
        )}

        {mode === 'grid' && (
          <div className="ak-grid">
            {questions.map(q => {
              const optCount = (q.options_en || []).length || 4;
              const current = answers[q.q_number];
              const aiAnswer = q.answer;
              const changed = current !== null && current !== undefined && current !== aiAnswer;
              return (
                <div key={q.q_number} className={`ak-row${changed ? ' changed' : ''}`}>
                  <span className="ak-qnum">Q{q.q_number}</span>
                  <div className="ak-opts">
                    {Array.from({ length: optCount }, (_, i) => (
                      <button
                        key={i}
                        className={`ak-opt${current === i ? ' selected' : ''}${aiAnswer === i && current !== i ? ' was-ai' : ''}`}
                        onClick={() => handleChange(q.q_number, current === i ? null : i)}
                      >
                        {LETTERS[i]}
                      </button>
                    ))}
                  </div>
                  {changed && <span className="ak-change-badge">changed</span>}
                </div>
              );
            })}
          </div>
        )}

        {error && <div className="ak-error">⚠ {error}</div>}
        {success && <div className="ak-success">✓ {success}</div>}

        <div className="ak-footer">
          <div className="ak-summary">
            {changes > 0 ? `${changes} answer${changes > 1 ? 's' : ''} changed from AI` : 'No changes'}
          </div>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Answer Key'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
