// hooks/useExam.js — All exam state: timer, answers, scoring, navigation
import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../utils/api';

export function useExam(paper, questions) {
  const [currentQ, setCurrentQ]   = useState(0);
  const [answers, setAnswers]      = useState({});   // { qIndex: optionIndex }
  const [marked, setMarked]        = useState({});   // { qIndex: bool }
  const [timeLeft, setTimeLeft]    = useState(0);
  const [submitted, setSubmitted]  = useState(false);
  const [result, setResult]        = useState(null);
  const timerRef = useRef(null);

  // Init timer when paper loads
  useEffect(() => {
    if (!paper) return;
    const meta = paper.metadata || {};
    // Parse duration like "3 Hours", "2 Hours", "90 minutes"
    const dur = (meta.duration || '3 Hours').toLowerCase();
    const hrs   = parseFloat(dur.match(/(\d+\.?\d*)\s*h/)?.[1] || 0);
    const mins  = parseFloat(dur.match(/(\d+\.?\d*)\s*m/)?.[1] || 0);
    const secs  = Math.round((hrs * 60 + mins) * 60) || 3 * 3600;
    setTimeLeft(secs);
  }, [paper]);

  // Countdown
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

  const goTo = useCallback((idx) => setCurrentQ(idx), []);
  const next = useCallback(() => setCurrentQ(i => Math.min(i + 1, questions.length - 1)), [questions]);
  const prev = useCallback(() => setCurrentQ(i => Math.max(i - 1, 0)), []);

  const handleSubmit = useCallback(async () => {
    if (submitted) return;
    clearInterval(timerRef.current);
    setSubmitted(true);

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
    const timeTaken = timeLeft > 0
      ? (Math.round((meta.max_marks || 200) / marksPerQ) * marksPerQ) - timeLeft
      : 0;

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

    const res = { correct, wrong, skipped, score, maxScore, marksPerQ, negFraction, sections, timeTaken };
    setResult(res);

    // Save to backend
    try {
      await api.saveAttempt({
        paper_id: paper?.id,
        answers,
        score: parseFloat(score.toFixed(2)),
        correct, wrong, skipped,
        time_taken: timeTaken,
      });
    } catch {}

    return res;
  }, [submitted, answers, questions, paper, timeLeft]);

  const progress = questions.length > 0
    ? Math.round(((currentQ + 1) / questions.length) * 100)
    : 0;

  const answeredCount = Object.keys(answers).length;
  const markedCount   = Object.values(marked).filter(Boolean).length;

  return {
    currentQ, answers, marked, timeLeft, submitted, result,
    formatTime, selectAnswer, toggleMark, goTo, next, prev, handleSubmit,
    progress, answeredCount, markedCount,
  };
}
