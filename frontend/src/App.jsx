// App.jsx — Top-level router between Home ↔ Exam
import React, { useState, useEffect } from 'react';
import Home from './components/Home/Home';
import Exam from './components/Exam/Exam';
import { Spinner } from './components/UI';
import { api } from './utils/api';
import './styles/global.css';
import './App.css';

const SCREENS = { HOME: 'home', LOADING: 'loading', EXAM: 'exam' };

export default function App() {
  const [screen, setScreen]       = useState(SCREENS.HOME);
  const [paper, setPaper]         = useState(null);
  const [questions, setQuestions] = useState([]);
  const [loadErr, setLoadErr]     = useState('');
  const [backendOk, setBackendOk] = useState(null); // null=checking, true/false

  // Check backend health on mount
  useEffect(() => {
    api.health()
      .then(() => setBackendOk(true))
      .catch(() => setBackendOk(false));
  }, []);

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

  const handleBack = () => {
    setPaper(null);
    setQuestions([]);
    setScreen(SCREENS.HOME);
  };

  // Backend not running notice
  if (backendOk === false) {
    return (
      <div className="app-offline">
        <div className="offline-card">
          <div className="offline-icon">⚡</div>
          <div className="offline-title">Backend not running</div>
          <div className="offline-msg">
            Start the backend server first:
          </div>
          <pre className="offline-code">
{`cd backend
cp .env.example .env
# Add your ANTHROPIC_API_KEY in .env
npm install
npm start`}
          </pre>
          <div className="offline-msg" style={{marginTop:'1rem'}}>
            Then refresh this page. The backend runs on <strong>http://localhost:3001</strong>
          </div>
          <button className="btn btn-primary" style={{marginTop:'1rem'}} onClick={() => window.location.reload()}>
            🔄 Retry
          </button>
        </div>
      </div>
    );
  }

  if (backendOk === null) {
    return (
      <div className="app-splash">
        <Spinner size={32} />
        <div style={{marginTop:'1rem', color:'var(--text2)', fontSize:'13px'}}>Connecting to backend…</div>
      </div>
    );
  }

  return (
    <div className="app">
      {screen === SCREENS.HOME && (
        <>
          {loadErr && (
            <div className="app-error">
              ⚠ {loadErr}
              <button onClick={() => setLoadErr('')}>✕</button>
            </div>
          )}
          <Home onStartQuiz={handleStartQuiz} />
        </>
      )}

      {screen === SCREENS.LOADING && (
        <div className="app-splash">
          <Spinner size={32} />
          <div style={{marginTop:'1rem', color:'var(--text2)', fontSize:'13px'}}>Loading questions…</div>
        </div>
      )}

      {screen === SCREENS.EXAM && paper && (
        <Exam
          paper={paper}
          questions={questions}
          onBack={handleBack}
          onFinish={handleBack}
        />
      )}
    </div>
  );
}
