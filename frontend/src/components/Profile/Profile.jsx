// Profile.jsx — User profile with attempt history
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { api } from '../../utils/api';
import { Spinner } from '../UI';
import './Profile.css';

export default function Profile({ onClose }) {
  const [profile, setProfile]   = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Fetch profile
        const { data: prof } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        setProfile(prof);

        // Fetch attempts with paper names
        const attemptsData = await api.getAttempts();
        // Enrich with paper titles via papers API
        const enriched = await Promise.all(
          (attemptsData || []).slice(0, 50).map(async (a) => {
            try {
              const paper = await api.getPaper(a.paper_id);
              return { ...a, paper_title: paper?.title || 'Unknown' };
            } catch {
              return { ...a, paper_title: 'Unknown' };
            }
          })
        );
        setAttempts(enriched);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  // Aggregate stats
  const totalAttempts = attempts.length;
  const avgScore = totalAttempts > 0
    ? (attempts.reduce((s, a) => s + (a.score || 0), 0) / totalAttempts).toFixed(1)
    : 0;
  const bestScore = totalAttempts > 0
    ? Math.max(...attempts.map(a => a.score || 0)).toFixed(1)
    : 0;

  return (
    <div className="profile-overlay fade-in" onClick={onClose}>
      <div className="profile-panel fade-up" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="profile-header">
          <div className="profile-avatar">
            {profile?.full_name?.[0]?.toUpperCase() || profile?.email?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="profile-info">
            <div className="profile-name">{profile?.full_name || 'Candidate'}</div>
            <div className="profile-email">{profile?.email}</div>
            <span className={`profile-role-badge ${profile?.role === 'admin' ? 'admin' : 'candidate'}`}>
              {profile?.role === 'admin' ? '🛡 Admin' : '🎓 Candidate'}
            </span>
          </div>
          <button className="profile-close" onClick={onClose}>✕</button>
        </div>

        {loading ? (
          <div className="profile-loading"><Spinner size={24} /></div>
        ) : (
          <>
            {/* Stats */}
            <div className="profile-stats">
              <div className="ps-card">
                <div className="ps-val">{totalAttempts}</div>
                <div className="ps-lbl">Attempts</div>
              </div>
              <div className="ps-card">
                <div className="ps-val">{avgScore}</div>
                <div className="ps-lbl">Avg Score</div>
              </div>
              <div className="ps-card green">
                <div className="ps-val">{bestScore}</div>
                <div className="ps-lbl">Best Score</div>
              </div>
            </div>

            {/* Attempt History */}
            {attempts.length > 0 ? (
              <div className="profile-history">
                <div className="ph-title">Attempt History</div>
                <div className="ph-list">
                  {attempts.map(a => {
                    const pct = a.correct && (a.correct + a.wrong + a.skipped) > 0
                      ? Math.round(a.correct / (a.correct + a.wrong + a.skipped) * 100)
                      : 0;
                    const grade = pct >= 75 ? 'good' : pct >= 50 ? 'ok' : 'low';
                    return (
                      <div key={a.id} className="ph-row">
                        <div className="ph-paper">{a.paper_title}</div>
                        <div className="ph-details">
                          <span className={`ph-score ${grade}`}>{a.score?.toFixed(1)}</span>
                          <span className="ph-correct">✓ {a.correct}</span>
                          <span className="ph-wrong">✗ {a.wrong}</span>
                          <span className="ph-date">
                            {new Date(a.created_at).toLocaleDateString('en-IN')}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="profile-no-attempts">
                No quiz attempts yet. Start a quiz to see your history here!
              </div>
            )}
          </>
        )}

        <div className="profile-footer">
          <button className="btn btn-ghost" onClick={handleSignOut}>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
