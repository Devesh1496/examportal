// SubjectQuiz.jsx — Browse subjects and launch subject-wise practice quizzes
import React, { useState, useEffect } from 'react';
import { api } from '../../utils/api';
import { Spinner, Modal } from '../UI';
import './SubjectQuiz.css';

// Canonical subject order (matches RajasthanGyan.com structure)
const SUBJECT_ORDER = [
  'India GK',
  'Rajasthan GK',
  'Reasoning',
  'Hindi Grammar',
  'English Grammar',
  'Mathematics',
  'Computer',
  'Constitution',
  'Science',
  'Current Affairs',
  'Rajasthan Current Affairs',
  'World Geography',
  'Women and Child Crime',
  'New Criminal Laws',
  'Educational Scenario',
  'Local Self-Government',
  'Animal Husbandry',
  'History',
  'Geography',
  'Economy',
];

// Icon + accent per canonical subject
const SUBJECT_META = {
  'India GK':               { icon: '🇮🇳', accent: 1 },
  'Rajasthan GK':           { icon: '🏰', accent: 0 },
  'Reasoning':              { icon: '🧩', accent: 3 },
  'Hindi Grammar':          { icon: '🅗', accent: 0 },
  'English Grammar':        { icon: '🅔', accent: 1 },
  'Mathematics':            { icon: '📐', accent: 4 },
  'Computer':               { icon: '💻', accent: 2 },
  'Constitution':           { icon: '⚖️', accent: 3 },
  'Science':                { icon: '🔬', accent: 5 },
  'Current Affairs':        { icon: '📰', accent: 4 },
  'Rajasthan Current Affairs': { icon: '📋', accent: 5 },
  'World Geography':        { icon: '🌍', accent: 2 },
  'Women and Child Crime':  { icon: '🛡️', accent: 5 },
  'New Criminal Laws':      { icon: '🔏', accent: 3 },
  'Educational Scenario':   { icon: '🎓', accent: 4 },
  'Local Self-Government':  { icon: '🏛️', accent: 0 },
  'Animal Husbandry':       { icon: '🐄', accent: 1 },
  'History':                { icon: '📜', accent: 0 },
  'Geography':              { icon: '🗺️', accent: 1 },
  'Economy':                { icon: '📈', accent: 2 },
};

function getSubjectMeta(name = '') {
  return SUBJECT_META[name] || { icon: '📚', accent: 0 };
}

// Sort subjects by canonical order; unknown subjects go to the end
function sortSubjects(subjects) {
  return [...subjects].sort((a, b) => {
    const ai = SUBJECT_ORDER.indexOf(a.section);
    const bi = SUBJECT_ORDER.indexOf(b.section);
    if (ai === -1 && bi === -1) return a.section.localeCompare(b.section);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

// Accent colours per subject (cycles)
const ACCENTS = [
  { bg: 'rgba(255,107,0,0.08)', color: '#ff6b00', border: 'rgba(255,107,0,0.2)' },
  { bg: 'rgba(59,130,246,0.08)', color: '#3b82f6', border: 'rgba(59,130,246,0.2)' },
  { bg: 'rgba(16,185,129,0.08)', color: '#10b981', border: 'rgba(16,185,129,0.2)' },
  { bg: 'rgba(245,158,11,0.08)', color: '#f59e0b', border: 'rgba(245,158,11,0.2)' },
  { bg: 'rgba(139,92,246,0.08)', color: '#8b5cf6', border: 'rgba(139,92,246,0.2)' },
  { bg: 'rgba(239,68,68,0.08)',  color: '#ef4444', border: 'rgba(239,68,68,0.2)' },
];

// ── QuizPickerModal ───────────────────────────────────────────
function QuizPickerModal({ subject, onClose, onStart }) {
  if (!subject) return null;
  const accent = ACCENTS[0];
  const quizzes = Array.from({ length: subject.quiz_count }, (_, i) => i + 1);
  const lastQuizQs = subject.question_count % 20 || 20;

  return (
    <Modal open={!!subject} onClose={onClose} title={subject.section} width={480}>
      <div className="qpicker">
        <div className="qpicker-meta">
          <span>{subject.question_count} questions</span>
          <span>·</span>
          <span>{subject.paper_count} {subject.paper_count === 1 ? 'exam' : 'exams'}</span>
          <span>·</span>
          <span>Unlimited attempts</span>
        </div>
        <div className="qpicker-label">Choose a quiz to start:</div>
        <div className="qpicker-grid">
          {quizzes.map(n => {
            const isLast = n === subject.quiz_count;
            const count = isLast ? lastQuizQs : 20;
            return (
              <button
                key={n}
                className="qpicker-btn"
                onClick={() => onStart(subject.section, n)}
              >
                <span className="qpicker-num">Quiz #{n}</span>
                <span className="qpicker-count">{count} Qs</span>
              </button>
            );
          })}
        </div>
        <div className="qpicker-note">
          💡 Questions are fixed per quiz (same order each time). Source exam shown per question.
        </div>
      </div>
    </Modal>
  );
}

// ── SubjectCard ───────────────────────────────────────────────
function SubjectCard({ subject, index, onSelect }) {
  const meta = getSubjectMeta(subject.section);
  const accent = ACCENTS[meta.accent % ACCENTS.length];
  const icon = meta.icon;

  return (
    <div
      className="subj-card fade-up"
      style={{ '--card-color': accent.color, '--card-bg': accent.bg, '--card-bdr': accent.border }}
      onClick={() => onSelect(subject)}
    >
      <div className="subj-card-icon">{icon}</div>
      <div className="subj-card-name">{subject.section}</div>
      <div className="subj-card-stats">
        <span>{subject.question_count} questions</span>
        <span>·</span>
        <span>{subject.paper_count} {subject.paper_count === 1 ? 'exam' : 'exams'}</span>
      </div>
      <div className="subj-card-footer">
        <span className="subj-quiz-count">{subject.quiz_count} Quiz{subject.quiz_count !== 1 ? 'zes' : ''}</span>
        <span className="subj-start-btn">Start →</span>
      </div>
    </div>
  );
}

// ── SubjectQuiz (main) ────────────────────────────────────────
export default function SubjectQuiz({ onStartQuiz }) {
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api.getSubjects()
      .then(data => setSubjects(sortSubjects(data || [])))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleStart = async (subjectName, quizNum) => {
    setSelected(null);
    onStartQuiz(subjectName, quizNum);
  };

  if (loading) {
    return (
      <div className="subj-loading">
        <Spinner size={28} />
        <span>Loading subjects…</span>
      </div>
    );
  }

  if (!subjects.length) {
    return (
      <div className="subj-empty">
        <div className="subj-empty-icon">📚</div>
        <div className="subj-empty-title">No subjects yet</div>
        <div className="subj-empty-sub">Add question papers first — subjects are extracted automatically.</div>
      </div>
    );
  }

  return (
    <div className="subj-page fade-in">
      <div className="subj-header">
        <div>
          <div className="subj-title">Practice by Subject</div>
          <div className="subj-sub">Questions from all exams, grouped by subject. Unlimited attempts.</div>
        </div>
      </div>

      <div className="subj-grid">
        {subjects.map((s, i) => (
          <SubjectCard
            key={s.section}
            subject={s}
            index={i}
            onSelect={setSelected}
          />
        ))}
      </div>

      <QuizPickerModal
        subject={selected}
        onClose={() => setSelected(null)}
        onStart={handleStart}
      />
    </div>
  );
}
