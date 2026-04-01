// components/Exam/Exam.jsx
import React, { useState } from 'react';
import { useExam } from '../../hooks/useExam';
import { ProgressBar, Spinner, Modal } from '../UI';
import './Exam.css';

const LANG_OPTIONS = [
  { value: 'both', label: 'EN + हि' },
  { value: 'en',   label: 'EN' },
  { value: 'hi',   label: 'हिंदी' },
];

// ── QuestionDot ───────────────────────────────────────────────
function QuestionDot({ index, current, answered, marked, onClick }) {
  let cls = 'qdot';
  if (index === current) cls += ' cur';
  else if (marked)       cls += ' marked';
  else if (answered)     cls += ' ans';
  return <button className={cls} onClick={onClick}>{index + 1}</button>;
}

// ── OptionItem ────────────────────────────────────────────────
function OptionItem({ letter, textEn, textHi, lang, state, onClick, disabled }) {
  const stateClass = state === 'selected' ? 'sel'
    : state === 'correct' ? 'correct'
    : state === 'wrong'   ? 'wrong'
    : '';
  return (
    <button className={`opt ${stateClass}`} onClick={onClick} disabled={disabled}>
      <span className="opt-letter">{letter}</span>
      <span className="opt-text">
        {(lang === 'en' || lang === 'both') && <span>{textEn}</span>}
        {lang === 'both' && textHi && textHi !== textEn && (
          <span className="opt-hi hi">{textHi}</span>
        )}
        {lang === 'hi' && <span className={textHi ? 'hi' : ''}>{textHi || textEn}</span>}
      </span>
    </button>
  );
}

// ── QuestionCard ──────────────────────────────────────────────
function QuestionCard({ q, qIndex, answers, lang, reviewing, onSelect, section }) {
  const chosen = answers[qIndex];
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

  const optEn = q.options_en || [];
  const optHi = q.options_hi || [];

  const getState = (i) => {
    if (!reviewing) return chosen === i ? 'selected' : '';
    if (i === q.answer) return 'correct';
    if (chosen === i && chosen !== q.answer) return 'wrong';
    return '';
  };

  return (
    <div className="q-card fade-up">
      {/* meta row */}
      <div className="q-meta">
        <span className="q-num">Q{q.q_number || qIndex + 1}</span>
        <span className="q-sec-badge">{section}</span>
        <span className="q-marks">+1.25 / −0.42</span>
      </div>

      {/* passage */}
      {q.has_passage === 1 && (q.passage_en || q.passage_hi) && (
        <div className="q-passage">
          <div className="q-passage-label">📖 Read the passage</div>
          {(lang === 'en' || lang === 'both') && q.passage_en && (
            <p>{q.passage_en}</p>
          )}
          {(lang === 'hi' || lang === 'both') && q.passage_hi && q.passage_hi !== q.passage_en && (
            <p className="hi">{q.passage_hi}</p>
          )}
        </div>
      )}

      {/* question text */}
      <div className="q-text">
        {(lang === 'en' || lang === 'both') && q.en && <div>{q.en}</div>}
        {lang === 'both' && q.hi && q.hi !== q.en && (
          <div className="q-text-hi hi">{q.hi}</div>
        )}
        {lang === 'hi' && <div className={q.hi ? 'hi' : ''}>{q.hi || q.en}</div>}
        {q.image_base64 && (
          <div className="q-image" style={{ marginTop: '16px' }}>
            <img src={q.image_base64} alt={`Graphic for Q${q.q_number || qIndex + 1}`} style={{ maxWidth: '100%', maxHeight: '600px', borderRadius: '4px', border: '1px solid var(--border)' }} />
          </div>
        )}
      </div>

      {/* options */}
      <div className="q-options">
        {optEn.map((opt, i) => (
          <OptionItem
            key={i}
            letter={LETTERS[i]}
            textEn={opt}
            textHi={optHi[i]}
            lang={lang}
            state={getState(i)}
            onClick={() => onSelect(qIndex, i)}
            disabled={reviewing}
          />
        ))}
      </div>

      {/* review note */}
      {reviewing && chosen !== undefined && chosen !== q.answer && q.answer !== null && (
        <div className="q-correct-note">
          ✓ Correct answer: <strong>{LETTERS[q.answer]}. {optEn[q.answer]}</strong>
          {optHi[q.answer] && optHi[q.answer] !== optEn[q.answer] && (
            <span className="hi"> / {optHi[q.answer]}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── ConfirmModal ──────────────────────────────────────────────
function ConfirmModal({ open, answered, total, onConfirm, onCancel }) {
  const skipped = total - answered;
  return (
    <Modal open={open} onClose={onCancel} title="Submit Exam?" width={400}>
      <div className="confirm-modal">
        <div className="confirm-stats">
          <div><span className="c-green">{answered}</span> Answered</div>
          <div><span className="c-amber">{skipped}</span> Skipped</div>
        </div>
        {skipped > 0 && (
          <div className="confirm-warn">
            ⚠ You have {skipped} unanswered questions. Submit anyway?
          </div>
        )}
        <div className="confirm-actions">
          <button className="btn btn-ghost" onClick={onCancel}>Keep Attempting</button>
          <button className="btn btn-success" onClick={onConfirm}>Submit & See Score</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Exam (main) ───────────────────────────────────────────────
export default function Exam({ paper, questions, onFinish, onBack }) {
  const [lang, setLang] = useState('both');
  const [showConfirm, setShowConfirm] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const exam = useExam(paper, questions);
  const { currentQ, answers, marked, timeLeft, submitted, result,
          formatTime, selectAnswer, toggleMark, goTo, next, prev,
          handleSubmit, progress, answeredCount } = exam;

  const q = questions[currentQ];
  if (!q) return null;

  const doSubmit = async () => {
    setShowConfirm(false);
    await handleSubmit();
  };

  const timePct = timeLeft / (3 * 3600) * 100;
  const timerWarn = timeLeft < 600;

  return (
    <div className="exam">
      {/* ── TOP BAR ── */}
      <div className="exam-topbar">
        <button className="btn btn-ghost exam-back" onClick={onBack}>← Exit</button>
        <div className="exam-title-wrap">
          <div className="exam-title">{paper.title}</div>
          <div className="exam-subtitle">Q{currentQ + 1} of {questions.length}</div>
        </div>
        <div className="exam-topbar-right">
          {/* lang toggle */}
          <div className="lang-toggle">
            {LANG_OPTIONS.map(o => (
              <button
                key={o.value}
                className={`lt-btn${lang === o.value ? ' active' : ''}${o.value === 'hi' ? ' hi' : ''}`}
                onClick={() => setLang(o.value)}
              >{o.label}</button>
            ))}
          </div>
          {/* timer */}
          <div className={`exam-timer${timerWarn ? ' warn' : ''}`}>
            {timerWarn && <span className="timer-pulse"/>}
            {formatTime(timeLeft)}
          </div>
        </div>
      </div>

      {/* progress bar */}
      <div className="exam-progress">
        <ProgressBar value={progress} />
      </div>

      <div className="exam-body">
        {/* ── SIDEBAR: question nav dots ── */}
        <div className="exam-sidebar">
          <div className="sidebar-legend">
            <span className="leg ans"/>Answered
            <span className="leg marked"/>Marked
            <span className="leg cur"/>Current
          </div>
          <div className="sidebar-dots">
            {questions.map((_, i) => (
              <QuestionDot
                key={i}
                index={i}
                current={currentQ}
                answered={answers[i] !== undefined}
                marked={!!marked[i]}
                onClick={() => goTo(i)}
              />
            ))}
          </div>
          <div className="sidebar-summary">
            <div><span style={{color:'var(--green)'}}>{answeredCount}</span> / {questions.length} answered</div>
          </div>
        </div>

        {/* ── MAIN: question ── */}
        <div className="exam-main">
          <QuestionCard
            q={q}
            qIndex={currentQ}
            answers={answers}
            lang={lang}
            reviewing={reviewing}
            onSelect={selectAnswer}
            section={q.section || 'General'}
          />

          {/* nav buttons */}
          <div className="exam-nav">
            <button className="btn btn-ghost" onClick={prev} disabled={currentQ === 0}>← Prev</button>
            <button
              className={`btn ${marked[currentQ] ? 'btn-amber' : 'btn-ghost'}`}
              onClick={() => toggleMark(currentQ)}
            >
              {marked[currentQ] ? '★ Marked' : '☆ Mark'}
            </button>
            {currentQ < questions.length - 1
              ? <button className="btn btn-primary" onClick={next} style={{marginLeft:'auto'}}>Next →</button>
              : <button className="btn btn-success" onClick={() => setShowConfirm(true)} style={{marginLeft:'auto'}}>Submit ✓</button>
            }
          </div>
        </div>
      </div>

      <ConfirmModal
        open={showConfirm}
        answered={answeredCount}
        total={questions.length}
        onConfirm={doSubmit}
        onCancel={() => setShowConfirm(false)}
      />

      {/* Results overlay when submitted */}
      {submitted && result && (
        <ResultsOverlay
          result={result}
          paper={paper}
          questions={questions}
          answers={answers}
          onReview={() => setReviewing(true)}
          onBack={onBack}
          lang={lang}
          reviewing={reviewing}
        />
      )}
    </div>
  );
}

// ── Results Overlay ───────────────────────────────────────────
function ResultsOverlay({ result, paper, questions, answers, onReview, onBack, lang, reviewing }) {
  const [tab, setTab] = useState('score'); // 'score' | 'review'
  const pct = Math.round(result.correct / questions.filter(q => q.answer !== null).length * 100) || 0;
  const grade = pct >= 90 ? { label: 'Outstanding! 🏆', color: '#f59e0b' }
    : pct >= 75 ? { label: 'Excellent! 🌟', color: 'var(--green)' }
    : pct >= 60 ? { label: 'Good Work! 👏', color: 'var(--accent-lt)' }
    : pct >= 45 ? { label: 'Keep Practising 📚', color: 'var(--text2)' }
    : { label: 'Need More Effort 💪', color: 'var(--red)' };

  const secEntries = Object.entries(result.sections || {});

  return (
    <div className="results-overlay fade-in">
      <div className="results-panel fade-up">
        <div className="results-tabs">
          <button className={`rtab${tab==='score'?' active':''}`} onClick={() => setTab('score')}>Score</button>
          <button className={`rtab${tab==='review'?' active':''}`} onClick={() => setTab('review')}>Review Answers</button>
        </div>

        {tab === 'score' && (
          <>
            {/* Score ring */}
            <div className="results-hero">
              <svg className="score-ring" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="50" fill="none" stroke="var(--bg3)" strokeWidth="10"/>
                <circle cx="60" cy="60" r="50" fill="none" stroke={grade.color}
                  strokeWidth="10" strokeLinecap="round"
                  strokeDasharray={`${pct * 3.14} 314`}
                  transform="rotate(-90 60 60)" style={{transition:'stroke-dasharray 1s ease'}}/>
                <text x="60" y="55" textAnchor="middle" fill="white" fontSize="22" fontWeight="700" fontFamily="Syne">{result.score.toFixed(1)}</text>
                <text x="60" y="72" textAnchor="middle" fill="var(--text3)" fontSize="10">/ {result.maxScore}</text>
              </svg>
              <div>
                <div className="results-grade" style={{color: grade.color}}>{grade.label}</div>
                <div className="results-pct">{pct}% accuracy</div>
                <div className="results-time">⏱ {Math.floor((result.timeTaken||0)/60)}m {(result.timeTaken||0)%60}s</div>
              </div>
            </div>

            {/* Stats */}
            <div className="results-stats">
              <div className="rs-card green"><div className="rs-num">{result.correct}</div><div className="rs-lbl">Correct</div></div>
              <div className="rs-card red"><div className="rs-num">{result.wrong}</div><div className="rs-lbl">Wrong</div></div>
              <div className="rs-card amber"><div className="rs-num">{result.skipped}</div><div className="rs-lbl">Skipped</div></div>
              <div className="rs-card accent"><div className="rs-num">{result.score.toFixed(1)}</div><div className="rs-lbl">Score</div></div>
            </div>

            {/* Section breakdown */}
            {secEntries.length > 0 && (
              <div className="results-sections">
                <div className="rs-sec-title">Section Performance</div>
                {secEntries.map(([sec, data]) => {
                  const p = data.total > 0 ? Math.round(data.correct / data.total * 100) : 0;
                  return (
                    <div key={sec} className="rs-sec-row">
                      <div className="rs-sec-name">{sec}</div>
                      <div className="rs-sec-bar">
                        <div className="rs-sec-fill" style={{width:`${p}%`, background: p>=60?'var(--green)':'var(--amber)'}}/>
                      </div>
                      <div className="rs-sec-pct">{p}%</div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="results-actions">
              <button className="btn btn-ghost" onClick={onBack}>← Back to Papers</button>
              <button className="btn btn-primary" onClick={() => setTab('review')}>Review Answers →</button>
            </div>
          </>
        )}

        {tab === 'review' && (
          <div className="review-list">
            {questions.map((q, i) => {
              const chosen = answers[i];
              const isCorrect = chosen === q.answer;
              const isSkipped = chosen === undefined;
              const statusCls = isSkipped ? 'skip' : isCorrect ? 'correct' : 'wrong';
              const statusLabel = isSkipped ? '⊘ Skipped' : isCorrect ? '✓ Correct' : '✗ Wrong';
              const LETTERS = ['A','B','C','D','E','F'];
              const optEn = q.options_en || [];
              const optHi = q.options_hi || [];
              return (
                <div key={i} className={`review-item ${statusCls}`}>
                  <div className="review-item-header">
                    <span className={`review-status ${statusCls}`}>{statusLabel}</span>
                    <span className="review-sec">{q.section}</span>
                  </div>
                  <div className="review-qtext">
                    {(lang==='en'||lang==='both') && q.en && <div>{q.en}</div>}
                    {lang==='both' && q.hi && q.hi!==q.en && <div className="hi review-hi">{q.hi}</div>}
                    {lang==='hi' && <div className={q.hi?'hi':''}>{q.hi||q.en}</div>}
                  </div>
                  <div className="review-opts">
                    {optEn.map((opt,j) => {
                      const isAns = j === q.answer;
                      const isChosen = j === chosen;
                      const cls = isAns ? 'correct' : isChosen ? 'wrong' : '';
                      return (
                        <div key={j} className={`review-opt ${cls}`}>
                          <span className="review-opt-letter">{LETTERS[j]}</span>
                          <span>{opt}{optHi[j] && optHi[j]!==opt && lang!=='en' ? <span className="hi"> / {optHi[j]}</span> : null}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <div style={{padding:'1rem',textAlign:'center'}}>
              <button className="btn btn-ghost" onClick={onBack}>← Back to Papers</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
