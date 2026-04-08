// utils/api.js — All API calls centralised
import { supabase } from '../supabaseClient';

const BASE = process.env.REACT_APP_BACKEND_URL || 'http://localhost:3001/api';

async function req(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  // Papers
  getPapers:      (params = {}) => req('/papers?' + new URLSearchParams(params)),
  getPaper:       (id)          => req(`/papers/${id}`),
  getQuestions:   (id)          => req(`/papers/${id}/questions`),
  deletePaper:    (id)          => req(`/papers/${id}`, { method: 'DELETE' }),
  getPaperStatus: (id)          => req(`/papers/${id}/status`),

  // Save paper + questions (client-side processed)
  savePaper: (paperData, questions, passages) => req('/papers/save', {
    method: 'POST',
    body: { paper: paperData, questions, passages },
  }),

  // Answer Key (Admin)
  getAnswerKey:     (id)          => req(`/papers/${id}/answers`),
  uploadAnswerKey:  (id, answers) => req(`/papers/${id}/answer-key`, { method: 'POST', body: { answers } }),
  extractAnswerKeyPdf: async (id, file) => {
    const { data: { session } } = await supabase.auth.getSession();
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${BASE}/papers/${id}/answer-key/extract-pdf`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token}` },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },

  // Subject Quiz
  getSubjects:    ()                          => req('/subjects'),
  getSubjectQuiz: (subject, num)              => req(`/subjects/${encodeURIComponent(subject)}/quiz/${num}`),

  // Scraping
  scrapeAll:  () => req('/scrape', { method: 'POST' }),
  scrapeUrl:  (url, title) => req('/scrape/url', { method: 'POST', body: { url, title } }),

  // Attempts
  saveAttempt: (data) => req('/attempts', { method: 'POST', body: data }),
  getAttempts: (paper_id) => req('/attempts' + (paper_id ? `?paper_id=${paper_id}` : '')),

  // Jobs (async processing)
  getJob: (id) => req(`/jobs/${id}`),

  // Misc
  getStats: () => req('/stats'),
  health:   () => req('/health'),
};
