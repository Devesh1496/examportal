// utils/api.js — All API calls centralised
const BASE = '/api';

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  // Papers
  getPapers:    (params = {}) => req('/papers?' + new URLSearchParams(params)),
  getPaper:     (id)          => req(`/papers/${id}`),
  getQuestions: (id)          => req(`/papers/${id}/questions`),
  deletePaper:  (id)          => req(`/papers/${id}`, { method: 'DELETE' }),
  getPaperStatus: (id)        => req(`/papers/${id}/status`),

  // Save paper + questions (client-side processed)
  savePaper: (paperData, questions, passages) => req('/papers/save', {
    method: 'POST',
    body: { paper: paperData, questions, passages },
  }),

  // Scraping (existing endpoints)
  scrapeAll:  ()              => req('/scrape', { method: 'POST' }),
  scrapeUrl:  (url, title)    => req('/scrape/url', { method: 'POST', body: { url, title } }),

  // Attempts
  saveAttempt: (data)         => req('/attempts', { method: 'POST', body: data }),
  getAttempts: (paper_id)     => req('/attempts' + (paper_id ? `?paper_id=${paper_id}` : '')),

  // Misc
  getStats:   ()              => req('/stats'),
  health:     ()              => req('/health'),
};
