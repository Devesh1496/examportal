// hooks/useExam.js — All exam state: timer, answers, scoring, navigation, pause/resume
import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../utils/api';

// Storage key for paused quiz state
function storageKey(paper) {
  if (!paper) return null;
  return paper.id ? `exam_state_${paper.id}` : `exam_state_${paper.title}`;
}

// noSave=true → subject quiz mode (unlimited attempts, no tracking)
export function useExam(paper, questions, { noSave = false } = {}) {
  const [currentQ, setCurrentQ]     = useState(0);
  const [answers, setAnswers]       = useState({});   // { qIndex: optionIndex }
  const [marked, setMarked]         = useState({});   // { qIndex: bool }
  const [revealed, setRevealed]     = useState({});   // { qIndex: bool } — answer revealed
  const [timeLeft, setTimeLeft]     = useState(0);
  const [submitted, setSubmitted]   = useState(false);
  const [result, setResult]         = useState(null);
  const [resumed, setResumed]       = useState(false); // was this session resumed?
  const timerRef = useRef(null);
  const qStartRef = useRef(Date.now());    // when current question was entered
  const qTimesRef = useRef({});            // { qIndex: totalMs }

  // ── Init timer (or restore from saved state) ──
  useEffect(() => {
    if (!paper) return;
    const key = storageKey(paper);
    if (key) {
      try {
        const saved = JSON.parse(localStorage.getItem(key));
        if (saved && saved.savedAt && !submitted) {
          setAnswers(saved.answers || {});
          setMarked(saved.marked || {});
          setRevealed(saved.revealed || {});
          setCurrentQ(saved.currentQ || 0);
          setTimeLeft(saved.timeLeft || 0);
          qTimesRef.current = saved.qTimes || {};
          setResumed(true);
          return; // skip default timer init
        }
      } catch {}
    }

    const meta = paper.metadata || {};
    const dur = (meta.duration || '3 Hours').toLowerCase();
    const hrs   = parseFloat(dur.match(/(\d+\.?\d*)\s*h/)?.[1] || 0);
    const mins  = parseFloat(dur.match(/(\d+\.?\d*)\s*m/)?.[1] || 0);
    const secs  = Math.round((hrs * 60 + mins) * 60) || 3 * 3600;
    setTimeLeft(secs);
  }, [paper]);

  // ── Countdown ──
  useEffect(() => {
    if (submitted || timeLeft <= 0) return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timerRef.current); handleSubmit(); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [submitted, timeLeft > 0]);

  // ── Auto-save to localStorage on state change ──
  useEffect(() => {
    if (submitted || !paper) return;
    const key = storageKey(paper);
    if (!key) return;
    const state = {
      answers, marked, revealed, currentQ, timeLeft,
      qTimes: qTimesRef.current,
      savedAt: Date.now(),
    };
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
  }, [answers, marked, revealed, currentQ, timeLeft, submitted, paper]);

  // ── Track time per question ──
  const recordQTime = useCallback((fromIdx) => {
    const elapsed = Date.now() - qStartRef.current;
    qTimesRef.current[fromIdx] = (qTimesRef.current[fromIdx] || 0) + elapsed;
    qStartRef.current = Date.now();
  }, []);

  const formatTime = useCallback((secs) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }, []);

  const selectAnswer = useCallback((qIdx, optIdx) => {
    if (submitted) return;
    setAnswers(prev => ({ ...prev, [qIdx]: optIdx }));
  }, [submitted]);

  const toggleMark = useCallback((qIdx) => {
    setMarked(prev => ({ ...prev, [qIdx]: !prev[qIdx] }));
  }, []);

  const revealAnswer = useCallback((qIdx) => {
    setRevealed(prev => ({ ...prev, [qIdx]: true }));
  }, []);

  const goTo = useCallback((idx) => {
    setCurrentQ(prev => { recordQTime(prev); return idx; });
  }, [recordQTime]);
  const next = useCallback(() => {
    setCurrentQ(prev => { recordQTime(prev); return Math.min(prev + 1, questions.length - 1); });
  }, [questions, recordQTime]);
  const prev = useCallback(() => {
    setCurrentQ(prev => { recordQTime(prev); return Math.max(prev - 1, 0); });
  }, [recordQTime]);

  const handleSubmit = useCallback(async () => {
    if (submitted) return;
    recordQTime(currentQ); // record time for last question
    clearInterval(timerRef.current);
    setSubmitted(true);

    // Clear saved state
    const key = storageKey(paper);
    if (key) try { localStorage.removeItem(key); } catch {}

    // Calculate score
    const meta = paper?.metadata || {};
    const negStr = (meta.negative_marking || '1/3');
    const [num, den] = negStr.split('/').map(Number);
    const negFraction = den ? num / den : 1 / 3;
    const marksPerQ = paper?.total_q > 0 ? (meta.max_marks || 200) / (paper.total_q || 160) : 1.25;

    let correct = 0, wrong = 0, skipped = 0;
    questions.forEach((q, i) => {
      if (answers[i] === undefined || answers[i] === null) skipped++;
      else if (q.answer !== null && answers[i] === q.answer) correct++;
      else if (q.answer !== null) wrong++;
      else skipped++; // answer unknown
    });

    const score = Math.max(0, (correct - wrong * negFraction) * marksPerQ);
    const maxScore = meta.max_marks || questions.length * marksPerQ;

    // Total time taken
    const initSecs = (() => {
      const dur = (meta.duration || '3 Hours').toLowerCase();
      const hrs = parseFloat(dur.match(/(\d+\.?\d*)\s*h/)?.[1] || 0);
      const mins = parseFloat(dur.match(/(\d+\.?\d*)\s*m/)?.[1] || 0);
      return Math.round((hrs * 60 + mins) * 60) || 3 * 3600;
    })();
    const timeTaken = Math.max(0, initSecs - timeLeft);

    // Section breakdown
    const sections = {};
    questions.forEach((q, i) => {
      const sec = q.section || 'General';
      if (!sections[sec]) sections[sec] = { correct: 0, wrong: 0, skip: 0, total: 0 };
      sections[sec].total++;
      if (answers[i] === undefined) sections[sec].skip++;
      else if (q.answer !== null && answers[i] === q.answer) sections[sec].correct++;
      else sections[sec].wrong++;
    });

    const revealedCount = Object.keys(revealed).length;
    const qTimes = { ...qTimesRef.current };

    const res = { correct, wrong, skipped, score, maxScore, marksPerQ, negFraction, sections, timeTaken, revealedCount, qTimes };
    setResult(res);

    // Save to backend (skip for subject quiz / noSave mode)
    if (!noSave && paper?.id) {
      try {
        await api.saveAttempt({
          paper_id: paper.id,
          answers,
          score: parseFloat(score.toFixed(2)),
          correct, wrong, skipped,
          time_taken: timeTaken,
        });
      } catch {}
    }

    return res;
  }, [submitted, answers, questions, paper, timeLeft, revealed, currentQ, recordQTime]);

  // ── Reset (reattempt) ──
  const reset = useCallback(() => {
    setAnswers({});
    setMarked({});
    setRevealed({});
    setCurrentQ(0);
    setSubmitted(false);
    setResult(null);
    setResumed(false);
    qTimesRef.current = {};
    qStartRef.current = Date.now();

    // Re-init timer
    const meta = paper?.metadata || {};
    const dur = (meta.duration || '3 Hours').toLowerCase();
    const hrs = parseFloat(dur.match(/(\d+\.?\d*)\s*h/)?.[1] || 0);
    const mins = parseFloat(dur.match(/(\d+\.?\d*)\s*m/)?.[1] || 0);
    const secs = Math.round((hrs * 60 + mins) * 60) || 3 * 3600;
    setTimeLeft(secs);

    // Clear saved state
    const key = storageKey(paper);
    if (key) try { localStorage.removeItem(key); } catch {}
  }, [paper]);

  // ── Check if there's a paused session ──
  const hasSavedState = useCallback(() => {
    const key = storageKey(paper);
    if (!key) return false;
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      return !!(saved && saved.answers && Object.keys(saved.answers).length > 0);
    } catch { return false; }
  }, [paper]);

  const clearSavedState = useCallback(() => {
    const key = storageKey(paper);
    if (key) try { localStorage.removeItem(key); } catch {}
  }, [paper]);

  const progress = questions.length > 0
    ? Math.round(((currentQ + 1) / questions.length) * 100)
    : 0;

  const answeredCount = Object.keys(answers).length;
  const markedCount   = Object.values(marked).filter(Boolean).length;

  return {
    currentQ, answers, marked, revealed, timeLeft, submitted, result, resumed,
    formatTime, selectAnswer, toggleMark, revealAnswer, goTo, next, prev, handleSubmit,
    progress, answeredCount, markedCount, reset, hasSavedState, clearSavedState,
  };
}
