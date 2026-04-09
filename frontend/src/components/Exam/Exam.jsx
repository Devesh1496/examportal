// components/Exam/Exam.jsx
import React, { useState, useEffect } from 'react';
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
function QuestionCard({ q, qIndex, answers, lang, reviewing, onSelect, section, showSource, isRevealed, onReveal }) {
  const chosen = answers[qIndex];
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

  const optEn = q.options_en || [];
  const optHi = q.options_hi || [];

  const getState = (i) => {
    if (reviewing || isRevealed) {
      if (i === q.answer) return 'correct';
      if (chosen === i && chosen !== q.answer) return 'wrong';
      return '';
    }
    return chosen === i ? 'selected' : '';
  };

  return (
    <div className="q-card fade-up">
      {/* meta row */}
      <div className="q-meta">
        <span className="q-num">Q{q.q_number || qIndex + 1}</span>
        <span className="q-sec-badge">{section}</span>
        {showSource && q.paper_title && (
          <span className="q-source-badge">📄 {q.paper_title}</span>
        )}
        <span className="q-marks">+1.25 / −0.42</span>
      </div>

      {/* passage */}
      {q.has_passage && (q.passage_en || q.passage_hi) && (
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

      {/* Show Answer button (only during active quiz, not reviewing) */}
      {!reviewing && q.answer !== null && (
        <div className="q-reveal-wrap">
          {isRevealed ? (
            <div className="q-revealed-note">
              ✓ Answer: <strong>{LETTERS[q.answer]}. {optEn[q.answer]}</strong>
              {optHi[q.answer] && optHi[q.answer] !== optEn[q.answer] && (
                <span className="hi"> / {optHi[q.answer]}</span>
              )}
            </div>
          ) : (
            <button className="btn btn-ghost btn-sm q-reveal-btn" onClick={() => onReveal(qIndex)}>
              👁 Show Answer
            </button>
          )}
        </div>
      )}

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
export default function Exam({ paper, questions, onFinish, onBack, onToggleView, noSave = false, showSource = false, subjectInfo = null, onNextQuiz = null, jumpToQ = null, onJumpHandled = null }) {
  const [lang, setLang] = useState('both');
  const [showConfirm, setShowConfirm] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [showResumeBanner, setShowResumeBanner] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const exam = useExam(paper, questions, { noSave });
  const { currentQ, answers, marked, revealed, timeLeft, submitted, result, resumed,
          formatTime, selectAnswer, toggleMark, revealAnswer, goTo, next, prev,
          handleSubmit, progress, answeredCount, reset } = exam;

  const q = questions[currentQ];
  if (!q) return null;

  const doSubmit = async () => {
    setShowConfirm(false);
    await handleSubmit();
  };

  const doReattempt = () => {
    setReviewing(false);
    reset();
  };

  // Pause & Exit — state is auto-saved to localStorage by useExam
  const handleExit = () => {
    if (!submitted && answeredCount > 0) {
      setShowExitConfirm(true);
    } else {
      onBack();
    }
  };

  // Handle jump-to-question from PaperView
  useEffect(() => {
    if (jumpToQ !== null && jumpToQ >= 0 && jumpToQ < questions.length) {
      goTo(jumpToQ);
      onJumpHandled?.();
    }
  }, [jumpToQ]);

  const timerWarn = timeLeft < 600;

  return (
    <div className="exam">
      {/* ── TOP BAR ── */}
      <div className="exam-topbar">
        <button className="btn btn-ghost exam-back" onClick={handleExit}>⏸ Pause & Exit</button>
        <div className="exam-title-wrap">
          <div className="exam-title">{paper.title}</div>
          <div className="exam-subtitle">Q{currentQ + 1} of {questions.length}</div>
        </div>
        <div className="exam-topbar-right">
          {/* full view toggle */}
          {onToggleView && (
            <button className="btn btn-ghost" onClick={onToggleView} title="See all questions at once">
              ⎙ Full View
            </button>
          )}
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
            {formatTime(timeLeft)}
          </div>
        </div>
      </div>

      {/* progress bar */}
      <div className="exam-progress">
        <ProgressBar value={progress} />
      </div>

      {/* ── MOBILE NAV STRIP ── */}
      <div className="mobile-nav-strip">
        <button className="mobile-nav-toggle" onClick={() => setMobileNavOpen(!mobileNavOpen)}>
          <span className="mobile-nav-icon">☰</span>
          <span>Q{currentQ + 1}/{questions.length}</span>
          <span className="mobile-nav-count">{answeredCount} done</span>
        </button>
        {mobileNavOpen && (
          <div className="mobile-nav-drawer">
            <div className="mobile-nav-legend">
              <span><span className="leg ans"/>Answered</span>
              <span><span className="leg marked"/>Marked</span>
              <span><span className="leg cur"/>Current</span>
            </div>
            <div className="mobile-nav-dots">
              {questions.map((_, i) => (
                <QuestionDot
                  key={i}
                  index={i}
                  current={currentQ}
                  answered={answers[i] !== undefined}
                  marked={!!marked[i]}
                  onClick={() => { goTo(i); setMobileNavOpen(false); }}
                />
              ))}
            </div>
          </div>
        )}
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
            showSource={showSource}
            isRevealed={!!revealed[currentQ]}
            onReveal={revealAnswer}
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
            <button className="btn btn-success" onClick={() => setShowConfirm(true)} style={{marginLeft:'auto'}}>Submit ✓</button>
            {currentQ < questions.length - 1 && (
              <button className="btn btn-primary" onClick={next}>Next →</button>
            )}
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

      {/* Exit/Pause confirmation */}
      <Modal open={showExitConfirm} onClose={() => setShowExitConfirm(false)} title="Pause Quiz?" width={400}>
        <div className="confirm-modal">
          <div className="confirm-stats">
            <div><span className="c-green">{answeredCount}</span> Answered</div>
            <div><span className="c-amber">{questions.length - answeredCount}</span> Remaining</div>
          </div>
          <p style={{fontSize:'14px', color:'var(--text2)', textAlign:'center', margin:'0.5rem 0'}}>
            Your progress is saved. You can resume this quiz later.
          </p>
          <div className="confirm-actions">
            <button className="btn btn-ghost" onClick={() => setShowExitConfirm(false)}>Continue Quiz</button>
            <button className="btn btn-amber" onClick={() => { setShowExitConfirm(false); onBack(); }}>⏸ Pause & Exit</button>
          </div>
        </div>
      </Modal>

      {/* Resumed banner */}
      {resumed && !submitted && showResumeBanner && (
        <div className="exam-resumed-banner">
          ▶ Resumed — your previous progress has been restored
          <button className="btn btn-ghost btn-sm" onClick={() => { reset(); setShowResumeBanner(false); }}>Start Fresh</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowResumeBanner(false)}>✕</button>
        </div>
      )}

      {/* Results overlay when submitted */}
      {submitted && result && (
        <ResultsOverlay
          result={result}
          paper={paper}
          questions={questions}
          answers={answers}
          onReview={() => setReviewing(true)}
          onBack={onBack}
          onReattempt={doReattempt}
          lang={lang}
          reviewing={reviewing}
          subjectInfo={subjectInfo}
          onNextQuiz={onNextQuiz}
        />
      )}
    </div>
  );
}

// ── Results Overlay ───────────────────────────────────────────
function ResultsOverlay({ result, paper, questions, answers, onReview, onBack, onReattempt, lang, reviewing, subjectInfo, onNextQuiz }) {
  const [tab, setTab] = useState('score'); // 'score' | 'analysis' | 'review'
  const totalWithAnswer = questions.filter(q => q.answer !== null).length;
  const pct = totalWithAnswer > 0 ? Math.round(result.correct / totalWithAnswer * 100) : 0;
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
          <button className={`rtab${tab==='analysis'?' active':''}`} onClick={() => setTab('analysis')}>Analysis</button>
          <button className={`rtab${tab==='review'?' active':''}`} onClick={() => setTab('review')}>Review Answers</button>
        </div>

        {tab === 'score' && (
          <>
            {/* Score ring */}
            <div className="results-hero">
              <svg className="score-ring" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="50" fill="none" stroke="var(--bg3)" strokeWidth="8"/>
                <circle cx="60" cy="60" r="50" fill="none" stroke={grade.color}
                  strokeWidth="8" strokeLinecap="round"
                  strokeDasharray={`${pct * 3.14} 314`}
                  transform="rotate(-90 60 60)" style={{transition:'stroke-dasharray 1.2s cubic-bezier(0.16, 1, 0.3, 1)'}}/>
                <text x="60" y="58" textAnchor="middle" fill="var(--text)" fontSize="28" fontWeight="800" fontFamily="var(--font-d)">{result.score.toFixed(1)}</text>
                <text x="60" y="75" textAnchor="middle" fill="var(--text3)" fontSize="10" fontWeight="600" letterSpacing="0.05em">/ {result.maxScore}</text>
              </svg>
              <div>
                <div className="results-grade" style={{color: grade.color}}>{grade.label}</div>
                <div className="results-pct">{pct}% accuracy</div>
                <div className="results-time">⏱ {Math.floor((result.timeTaken||0)/60)}m {(result.timeTaken||0)%60}s</div>
                {result.revealedCount > 0 && (
                  <div className="results-revealed">👁 {result.revealedCount} answer{result.revealedCount > 1 ? 's' : ''} revealed</div>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="results-stats">
              <div className="rs-card green"><div className="rs-num">{result.correct}</div><div className="rs-lbl">Correct</div></div>
              <div className="rs-card red"><div className="rs-num">{result.wrong}</div><div className="rs-lbl">Wrong</div></div>
              <div className="rs-card amber"><div className="rs-num">{result.skipped}</div><div className="rs-lbl">Skipped</div></div>
              <div className="rs-card accent"><div className="rs-num">{result.score.toFixed(1)}</div><div className="rs-lbl">Score</div></div>
            </div>

            {/* Subject quiz: prev/next navigation */}
            {subjectInfo && onNextQuiz && (
              <div className="results-subject-nav">
                <button
                  className="btn btn-ghost rsn-btn"
                  disabled={subjectInfo.quizNum <= 1}
                  onClick={() => onNextQuiz(subjectInfo.subject, subjectInfo.quizNum - 1)}
                >
                  ← Quiz #{subjectInfo.quizNum - 1}
                </button>
                <button
                  className="btn btn-ghost rsn-btn rsn-retry"
                  onClick={onReattempt}
                >
                  🔁 Retry
                </button>
                <button
                  className="btn btn-primary rsn-btn"
                  disabled={subjectInfo.quizNum >= subjectInfo.totalQuizzes}
                  onClick={() => onNextQuiz(subjectInfo.subject, subjectInfo.quizNum + 1)}
                >
                  Quiz #{subjectInfo.quizNum + 1} →
                </button>
              </div>
            )}

            <div className="results-actions">
              <button className="btn btn-ghost" onClick={onBack}>
                {subjectInfo ? '← All Subjects' : '← Back to Papers'}
              </button>
              <button className="btn btn-ghost" onClick={onReattempt}>🔁 Reattempt</button>
              <button className="btn btn-primary" onClick={() => setTab('review')}>Review Answers →</button>
            </div>
          </>
        )}

        {tab === 'analysis' && (
          <AnalysisTab result={result} questions={questions} answers={answers} secEntries={secEntries} />
        )}

        {tab === 'review' && (
          <ReviewQuizUI
            questions={questions}
            answers={answers}
            lang={lang}
            onBack={onBack}
            subjectInfo={subjectInfo}
          />
        )}
      </div>
    </div>
  );
}

// ── Review Quiz UI (navigable like a quiz) ───────────────────
function ReviewQuizUI({ questions, answers, lang, onBack, subjectInfo }) {
  const [reviewQ, setReviewQ] = useState(0);
  const [filter, setFilter] = useState('all'); // 'all' | 'correct' | 'wrong' | 'skipped'
  const LETTERS = ['A','B','C','D','E','F'];

  // Build filtered index map
  const filteredIndices = questions.map((q, i) => {
    const chosen = answers[i];
    const isSkipped = chosen === undefined || chosen === null;
    const isCorrect = !isSkipped && q.answer !== null && chosen === q.answer;
    const isWrong = !isSkipped && q.answer !== null && chosen !== q.answer;
    if (filter === 'correct' && !isCorrect) return null;
    if (filter === 'wrong' && !isWrong) return null;
    if (filter === 'skipped' && !isSkipped) return null;
    return i;
  }).filter(i => i !== null);

  const currentIdx = filteredIndices[reviewQ] ?? filteredIndices[0] ?? 0;
  const q = questions[currentIdx];
  if (!q) return null;

  const chosen = answers[currentIdx];
  const isSkipped = chosen === undefined || chosen === null;
  const isCorrect = !isSkipped && q.answer !== null && chosen === q.answer;
  const statusLabel = isSkipped ? '⊘ Skipped' : isCorrect ? '✓ Correct' : '✗ Wrong';
  const statusCls = isSkipped ? 'skip' : isCorrect ? 'correct' : 'wrong';

  const optEn = q.options_en || [];
  const optHi = q.options_hi || [];

  const getQStatus = (i) => {
    const c = answers[i];
    if (c === undefined || c === null) return 'skip';
    if (questions[i].answer !== null && c === questions[i].answer) return 'correct';
    return 'wrong';
  };

  const counts = { correct: 0, wrong: 0, skipped: 0 };
  questions.forEach((q, i) => {
    const s = getQStatus(i);
    if (s === 'correct') counts.correct++;
    else if (s === 'wrong') counts.wrong++;
    else counts.skipped++;
  });

  return (
    <div className="review-quiz">
      {/* Filter tabs */}
      <div className="review-filters">
        <button className={`rf-btn${filter==='all'?' active':''}`} onClick={() => { setFilter('all'); setReviewQ(0); }}>
          All ({questions.length})
        </button>
        <button className={`rf-btn rf-correct${filter==='correct'?' active':''}`} onClick={() => { setFilter('correct'); setReviewQ(0); }}>
          ✓ {counts.correct}
        </button>
        <button className={`rf-btn rf-wrong${filter==='wrong'?' active':''}`} onClick={() => { setFilter('wrong'); setReviewQ(0); }}>
          ✗ {counts.wrong}
        </button>
        <button className={`rf-btn rf-skip${filter==='skipped'?' active':''}`} onClick={() => { setFilter('skipped'); setReviewQ(0); }}>
          ⊘ {counts.skipped}
        </button>
      </div>

      {/* Question dots navigator */}
      <div className="review-dots-wrap">
        <div className="review-dots">
          {filteredIndices.map((origIdx, fi) => (
            <button
              key={origIdx}
              className={`qdot review-qdot ${getQStatus(origIdx)} ${fi === reviewQ ? 'cur' : ''}`}
              onClick={() => setReviewQ(fi)}
            >
              {origIdx + 1}
            </button>
          ))}
        </div>
      </div>

      {/* Question card */}
      <div className="review-card-wrap">
        <div className={`review-status-banner ${statusCls}`}>
          <span>{statusLabel}</span>
          <span className="review-q-counter">Q{currentIdx + 1} of {questions.length}</span>
        </div>

        <div className="q-card review-q-card">
          <div className="q-meta">
            <span className="q-num">Q{q.q_number || currentIdx + 1}</span>
            <span className="q-sec-badge">{q.section || 'General'}</span>
          </div>

          {q.has_passage && (q.passage_en || q.passage_hi) && (
            <div className="q-passage">
              {(lang === 'en' || lang === 'both') && q.passage_en && <p>{q.passage_en}</p>}
              {(lang === 'hi' || lang === 'both') && q.passage_hi && q.passage_hi !== q.passage_en && <p className="hi">{q.passage_hi}</p>}
            </div>
          )}

          <div className="q-text">
            {(lang === 'en' || lang === 'both') && q.en && <div>{q.en}</div>}
            {lang === 'both' && q.hi && q.hi !== q.en && <div className="q-text-hi hi">{q.hi}</div>}
            {lang === 'hi' && <div className={q.hi ? 'hi' : ''}>{q.hi || q.en}</div>}
          </div>

          <div className="q-options">
            {optEn.map((opt, j) => {
              const isAns = j === q.answer;
              const isChosen = j === chosen;
              const cls = isAns ? 'correct' : (isChosen && !isAns) ? 'wrong' : '';
              return (
                <div key={j} className={`opt review-opt-item ${cls}`}>
                  <span className="opt-letter">{LETTERS[j]}</span>
                  <span className="opt-text">
                    {(lang === 'en' || lang === 'both') && <span>{opt}</span>}
                    {lang === 'both' && optHi[j] && optHi[j] !== opt && <span className="opt-hi hi"> / {optHi[j]}</span>}
                    {lang === 'hi' && <span className={optHi[j] ? 'hi' : ''}>{optHi[j] || opt}</span>}
                  </span>
                  {isAns && <span className="opt-badge correct-badge">✓</span>}
                  {isChosen && !isAns && <span className="opt-badge wrong-badge">✗ Your answer</span>}
                </div>
              );
            })}
          </div>

          {/* Correct answer note if wrong/skipped */}
          {!isCorrect && q.answer !== null && (
            <div className="q-correct-note">
              ✓ Correct: <strong>{LETTERS[q.answer]}. {optEn[q.answer]}</strong>
              {optHi[q.answer] && optHi[q.answer] !== optEn[q.answer] && lang !== 'en' && (
                <span className="hi"> / {optHi[q.answer]}</span>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="review-nav">
          <button className="btn btn-ghost" onClick={() => setReviewQ(Math.max(0, reviewQ - 1))} disabled={reviewQ === 0}>← Prev</button>
          <button className="btn btn-ghost" onClick={onBack}>
            {subjectInfo ? '← All Subjects' : '← Back'}
          </button>
          <button className="btn btn-primary" onClick={() => setReviewQ(Math.min(filteredIndices.length - 1, reviewQ + 1))} disabled={reviewQ >= filteredIndices.length - 1}>Next →</button>
        </div>
      </div>
    </div>
  );
}

// ── Analysis Tab ──────────────────────────────────────────────
function AnalysisTab({ result, questions, answers, secEntries }) {
  // Find strong and weak sections
  const sectionAnalysis = secEntries.map(([sec, data]) => {
    const pct = data.total > 0 ? Math.round(data.correct / data.total * 100) : 0;
    return { sec, ...data, pct };
  }).sort((a, b) => b.pct - a.pct);

  const strong = sectionAnalysis.filter(s => s.pct >= 60);
  const weak = sectionAnalysis.filter(s => s.pct < 50);

  const avgTimePerQ = result.timeTaken > 0 && questions.length > 0
    ? Math.round(result.timeTaken / questions.length)
    : 0;

  return (
    <div className="analysis-tab">
      {/* Overview cards */}
      <div className="analysis-overview">
        <div className="ao-card">
          <div className="ao-label">Time Taken</div>
          <div className="ao-value">{Math.floor((result.timeTaken||0)/60)}m {(result.timeTaken||0)%60}s</div>
        </div>
        <div className="ao-card">
          <div className="ao-label">Avg per Question</div>
          <div className="ao-value">{avgTimePerQ}s</div>
        </div>
        <div className="ao-card">
          <div className="ao-label">Accuracy</div>
          <div className="ao-value">{questions.filter(q=>q.answer!==null).length > 0 ? Math.round(result.correct / questions.filter(q=>q.answer!==null).length * 100) : 0}%</div>
        </div>
        <div className="ao-card">
          <div className="ao-label">Attempt Rate</div>
          <div className="ao-value">{Math.round(((result.correct + result.wrong) / questions.length) * 100)}%</div>
        </div>
      </div>

      {/* Section Performance */}
      {secEntries.length > 0 && (
        <div className="results-sections">
          <div className="rs-sec-title">Section Performance</div>
          {sectionAnalysis.map(({ sec, correct, total, pct }) => (
            <div key={sec} className="rs-sec-row">
              <div className="rs-sec-name">{sec}</div>
              <div className="rs-sec-bar">
                <div className="rs-sec-fill" style={{
                  width: `${pct}%`,
                  background: pct >= 60 ? 'var(--green)' : pct >= 40 ? 'var(--amber)' : 'var(--red)'
                }}/>
              </div>
              <div className="rs-sec-pct">{correct}/{total} ({pct}%)</div>
            </div>
          ))}
        </div>
      )}

      {/* Strong areas */}
      {strong.length > 0 && (
        <div className="analysis-section">
          <div className="analysis-section-title good">💪 Strong Areas</div>
          <div className="analysis-tags">
            {strong.map(s => (
              <span key={s.sec} className="analysis-tag good">{s.sec} ({s.pct}%)</span>
            ))}
          </div>
        </div>
      )}

      {/* Weak areas */}
      {weak.length > 0 && (
        <div className="analysis-section">
          <div className="analysis-section-title weak">📖 Needs Improvement</div>
          <div className="analysis-tags">
            {weak.map(s => (
              <span key={s.sec} className="analysis-tag weak">{s.sec} ({s.pct}%)</span>
            ))}
          </div>
          <div className="analysis-tip">Focus on these subjects in your next practice session.</div>
        </div>
      )}

      {/* Revealed answers note */}
      {result.revealedCount > 0 && (
        <div className="analysis-note">
          👁 You revealed {result.revealedCount} answer{result.revealedCount > 1 ? 's' : ''} during this quiz. Try solving without hints next time!
        </div>
      )}
    </div>
  );
}
