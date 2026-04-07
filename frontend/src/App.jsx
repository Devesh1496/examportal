// App.jsx — Top-level router with Auth protection + Subject Quiz
import React, { useState, useEffect } from 'react';
import Home from './components/Home/Home';
import Exam from './components/Exam/Exam';
import PaperView from './components/PaperView/PaperView';
import SubjectQuiz from './components/SubjectQuiz/SubjectQuiz';
import Profile from './components/Profile/Profile';
import Auth from './components/Auth/Auth';
import { Spinner } from './components/UI';
import { api } from './utils/api';
import { supabase } from './supabaseClient';
import './styles/global.css';
import './App.css';

const SCREENS = {
  HOME: 'home',
  LOADING: 'loading',
  EXAM: 'exam',
  PAPER_VIEW: 'paper_view',
  SUBJECT_EXAM: 'subject_exam',
};

// viewMode controls which is visible when exam is active
// 'quiz' = show Exam, 'paper' = show PaperView (quiz stays mounted)

export default function App() {
  const [session, setSession]         = useState(null);
  const [loading, setLoading]         = useState(true);
  const [isAdmin, setIsAdmin]         = useState(false);
  const [screen, setScreen]           = useState(SCREENS.HOME);
  const [activeTab, setActiveTab]     = useState('papers'); // 'papers' | 'subjects'
  const [paper, setPaper]             = useState(null);
  const [questions, setQuestions]     = useState([]);
  const [loadErr, setLoadErr]         = useState('');
  const [backendOk, setBackendOk]     = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  // Subject quiz state
  const [subjectInfo, setSubjectInfo] = useState(null); // { subject, quizNum, totalQuizzes }
  const [viewMode, setViewMode] = useState('quiz'); // 'quiz' | 'paper' — toggled during active exam
  const [jumpToQ, setJumpToQ] = useState(null); // question index to jump to in quiz

  useEffect(() => {
    api.health()
      .then(() => setBackendOk(true))
      .catch(() => setBackendOk(false));

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchProfile(session.user.id);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchProfile(session.user.id);
      else setIsAdmin(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (uid) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', uid)
        .single();
      if (!error && data?.role === 'admin') setIsAdmin(true);
    } catch (e) {
      console.error('Error fetching profile:', e);
    }
  };

  // ── Full-paper quiz ──
  const handleStartQuiz = async (selectedPaper) => {
    setScreen(SCREENS.LOADING);
    setLoadErr('');
    try {
      const data = await api.getQuestions(selectedPaper.id);
      if (!data.questions?.length) {
        setLoadErr('No questions found for this paper.');
        setScreen(SCREENS.HOME);
        return;
      }
      setPaper(selectedPaper);
      setQuestions(data.questions);
      setScreen(SCREENS.EXAM);
    } catch (e) {
      setLoadErr(e.message);
      setScreen(SCREENS.HOME);
    }
  };

  // ── Subject quiz ──
  const handleStartSubjectQuiz = async (subject, quizNum) => {
    setScreen(SCREENS.LOADING);
    try {
      const data = await api.getSubjectQuiz(subject, quizNum);
      if (!data.questions?.length) {
        setLoadErr('No questions found for this quiz.');
        setScreen(SCREENS.HOME);
        return;
      }
      setSubjectInfo({ subject, quizNum, totalQuizzes: data.total_quizzes });
      setQuestions(data.questions);
      setPaper({ title: `${subject} — Quiz #${quizNum}`, metadata: {}, total_q: data.total_questions });
      setScreen(SCREENS.SUBJECT_EXAM);
    } catch (e) {
      setLoadErr(e.message);
      setScreen(SCREENS.HOME);
    }
  };

  const handleViewPaper = (selectedPaper) => {
    setPaper(selectedPaper);
    setViewMode('quiz');
    setScreen(SCREENS.PAPER_VIEW);
  };

  const handleBack = () => {
    setPaper(null);
    setQuestions([]);
    setSubjectInfo(null);
    setViewMode('quiz');
    setJumpToQ(null);
    setScreen(SCREENS.HOME);
  };

  // Toggle between quiz and paper view (keeps quiz state alive)
  const handleToggleView = () => {
    setViewMode(v => v === 'quiz' ? 'paper' : 'quiz');
  };

  // Jump from PaperView to a specific question in quiz
  const handleJumpToQuestion = (idx) => {
    setJumpToQ(idx);
    setViewMode('quiz');
  };

  // ── Offline / loading states ──
  if (backendOk === false) {
    return (
      <div className="app-offline">
        <div className="offline-card">
          <div className="offline-icon">K</div>
          <div className="offline-title">Connection Lost</div>
          <div className="offline-msg">Gateway is unreachable. Check your local backend.</div>
          <pre className="offline-code">{`cd backend\nnpm start`}</pre>
          <button className="btn btn-primary" style={{marginTop:'1rem'}} onClick={() => window.location.reload()}>🔄 Retry</button>
        </div>
      </div>
    );
  }

  if (loading || backendOk === null) {
    return (
      <div className="app-splash">
        <Spinner size={32} />
        <div style={{marginTop:'1rem', color:'var(--text2)', fontSize:'13px'}}>Preparing environment…</div>
      </div>
    );
  }

  if (!session) return <Auth />;

  return (
    <div className="app">
      {/* ── Error banner ── */}
      {loadErr && screen === SCREENS.HOME && (
        <div className="app-error">
          ⚠ {loadErr}
          <button onClick={() => setLoadErr('')}>✕</button>
        </div>
      )}

      {/* ── HOME with tabs ── */}
      {screen === SCREENS.HOME && (
        <div className="app-home-wrap">
          {/* Shared header */}
          <div className="app-topbar">
            <div className="app-brand">
              <div className="app-brand-icon">K</div>
              <div>
                <div className="app-brand-name">Kinetic Academy</div>
                <div className="app-brand-sub">AI Exam Portal</div>
              </div>
            </div>

            {/* Tabs */}
            <div className="app-tabs">
              <button
                className={`app-tab${activeTab === 'papers' ? ' active' : ''}`}
                onClick={() => setActiveTab('papers')}
              >
                📄 Full Papers
              </button>
              <button
                className={`app-tab${activeTab === 'subjects' ? ' active' : ''}`}
                onClick={() => setActiveTab('subjects')}
              >
                📚 Subject Practice
              </button>
            </div>

            {/* Right actions */}
            <div className="app-topbar-right">
              {isAdmin && activeTab === 'papers' && (
                <>
                  <button className="btn btn-ghost btn-sm" onClick={() => api.scrapeAll().catch(() => {})}>
                    🔄 Scan
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={() => {
                    // trigger AddPaperModal via a custom event
                    window.dispatchEvent(new CustomEvent('open-add-paper'));
                  }}>
                    + Add Paper
                  </button>
                </>
              )}
              <button className="app-avatar-btn" onClick={() => setShowProfile(true)}>
                <div className="app-avatar">
                  {session.user?.email?.[0]?.toUpperCase()}
                </div>
              </button>
            </div>
          </div>

          {/* Tab content */}
          <div className="app-tab-content">
            {activeTab === 'papers' && (
              <Home
                isAdmin={isAdmin}
                onStartQuiz={handleStartQuiz}
                onViewPaper={handleViewPaper}
                embedded={true}
              />
            )}
            {activeTab === 'subjects' && (
              <SubjectQuiz onStartQuiz={handleStartSubjectQuiz} />
            )}
          </div>
        </div>
      )}

      {/* ── LOADING ── */}
      {screen === SCREENS.LOADING && (
        <div className="app-splash">
          <div className="home-logo-icon">K</div>
          <Spinner size={32} />
          <div style={{marginTop:'1.5rem', color:'var(--text2)', fontWeight:600}}>Preparing your session…</div>
        </div>
      )}

      {/* ── FULL PAPER EXAM (stays mounted when toggling to paper view) ── */}
      {(screen === SCREENS.EXAM) && paper && (
        <div style={{ display: viewMode === 'quiz' ? 'block' : 'none' }}>
          <Exam
            paper={paper}
            questions={questions}
            onBack={handleBack}
            onFinish={handleBack}
            onToggleView={handleToggleView}
            noSave={false}
            showSource={false}
            jumpToQ={jumpToQ}
            onJumpHandled={() => setJumpToQ(null)}
          />
        </div>
      )}

      {/* Paper view alongside quiz (when toggled from quiz) */}
      {screen === SCREENS.EXAM && paper && viewMode === 'paper' && (
        <PaperView
          paperId={paper.id}
          initialPaper={paper}
          onBack={handleToggleView}
          onStartQuiz={() => setViewMode('quiz')}
          onJumpToQuestion={handleJumpToQuestion}
          isQuizActive={true}
        />
      )}

      {/* ── SUBJECT EXAM ── */}
      {screen === SCREENS.SUBJECT_EXAM && paper && (
        <Exam
          paper={paper}
          questions={questions}
          onBack={handleBack}
          onFinish={handleBack}
          onToggleView={null}
          noSave={true}
          showSource={true}
        />
      )}

      {/* ── PAPER VIEW (standalone, from home) ── */}
      {screen === SCREENS.PAPER_VIEW && paper && (
        <PaperView
          paperId={paper.id}
          initialPaper={paper}
          onBack={handleBack}
          onStartQuiz={handleStartQuiz}
          isAdmin={isAdmin}
        />
      )}

      {/* ── PROFILE PANEL ── */}
      {showProfile && <Profile onClose={() => setShowProfile(false)} />}
    </div>
  );
}
