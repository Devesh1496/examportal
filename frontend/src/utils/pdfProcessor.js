// utils/pdfProcessor.js — Client-side PDF rendering + Backend AI extraction (async polling)
import * as pdfjsLib from 'pdfjs-dist';
import { supabase } from '../supabaseClient';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';

const BASE = process.env.REACT_APP_BACKEND_URL || '/api';

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = { 'Content-Type': 'application/json' };
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  return headers;
}

// ─── FETCH PDF VIA BACKEND PROXY (for URL input) ────────────
export async function fetchPdfAsArrayBuffer(pdfUrl, onStatus) {
  onStatus?.('Downloading PDF…');
  const headers = await getAuthHeaders();
  const res = await fetch(`${BASE}/proxy/pdf?url=${encodeURIComponent(pdfUrl)}`, { headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to download PDF: ${res.status}`);
  }
  return await res.arrayBuffer();
}

// ─── RENDER PDF TO BASE64 IMAGES ─────────────────────────────
export async function renderPdfToImages(arrayBuffer, onStatus) {
  onStatus?.('Rendering PDF pages to images…');
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  const base64Images = [];

  for (let i = 1; i <= numPages; i++) {
    onStatus?.(`Rendering page ${i}/${numPages}…`);
    const page = await pdf.getPage(i);
    const scale = 1.5;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    base64Images.push(dataUrl);

    canvas.width = 0;
    canvas.height = 0;
  }
  return base64Images;
}

// ─── POLL JOB UNTIL COMPLETE ────────────────────────────────
async function pollJob(jobId, onStatus) {
  let elapsed = 0;
  const POLL_INTERVAL = 5000; // 5 seconds
  const MAX_WAIT = 15 * 60 * 1000; // 15 minutes

  while (elapsed < MAX_WAIT) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    elapsed += POLL_INTERVAL;

    const mins = Math.floor(elapsed / 60000);
    const secs = Math.floor((elapsed % 60000) / 1000);
    try {
      // Refresh auth headers each poll to avoid token expiry during long extractions
      const headers = await getAuthHeaders();
      const res = await fetch(`${BASE}/jobs/${jobId}`, { headers });
      const data = await res.json();

      if (data.status === 'done') {
        return data;
      }
      if (data.status === 'failed') {
        throw new Error(data.error || 'Extraction failed on server');
      }
      // Show progress if available
      if (data.progress) {
        const { chunk, totalChunks, questionsExtracted, totalQuestions } = data.progress;
        onStatus?.(`Extracting chunk ${chunk}/${totalChunks} — ${questionsExtracted}/${totalQuestions} questions done`);
      } else {
        onStatus?.(`AI extracting questions… ${mins}m ${secs}s elapsed`);
      }
      // still processing — continue polling
    } catch (err) {
      // Network blip — keep polling unless it's a real error
      if (err.message && !err.message.includes('fetch')) throw err;
    }
  }
  throw new Error('Extraction timed out after 15 minutes. Please try again.');
}

// ─── SEND IMAGES TO BACKEND → ASYNC JOB → POLL ─────────────
async function extractViaBackend(images, paperTitle, onStatus) {
  onStatus?.(`Uploading ${images.length} pages to server…`);
  const headers = await getAuthHeaders();

  const res = await fetch(`${BASE}/papers/process-images`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ images, title: paperTitle }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to start extraction');

  // If backend returned a jobId, poll for completion
  if (data.jobId) {
    onStatus?.('AI extraction started, processing questions…');
    const result = await pollJob(data.jobId, onStatus);
    onStatus?.(`Extracted ${result.questions.length} questions!`);
    return result;
  }

  // Legacy: backend returned result directly
  onStatus?.(`Extracted ${data.questions.length} questions!`);
  return data;
}

// ─── PROCESS FROM URL ───────────────────────────────────────
export async function processPaperClientSide(pdfUrl, paperTitle, onStatus) {
  onStatus?.('Starting extraction…');
  const arrayBuffer = await fetchPdfAsArrayBuffer(pdfUrl, onStatus);
  const images = await renderPdfToImages(arrayBuffer, onStatus);
  return await extractViaBackend(images, paperTitle, onStatus);
}

// ─── PROCESS FROM FILE — upload binary PDF, server renders + extracts ─
export async function processPaperFromFile(file, paperTitle, onStatus) {
  onStatus?.('Uploading PDF to server…');
  const headers = await getAuthHeaders();
  // Don't set Content-Type — browser sets it with boundary for FormData

  const formData = new FormData();
  formData.append('file', file);
  formData.append('title', paperTitle || '');
  formData.append('paper', paperTitle || file.name.replace(/\.pdf$/i, ''));

  const res = await fetch(`${BASE}/papers/upload`, {
    method: 'POST',
    // No Content-Type header — let browser set multipart boundary
    headers: { Authorization: headers.Authorization },
    body: formData,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');

  // Poll for extraction results
  if (data.jobId) {
    onStatus?.('Server rendering pages and extracting questions…');
    const result = await pollJob(data.jobId, onStatus);
    onStatus?.(`Extracted ${result.questions.length} questions!`);
    return result;
  }

  onStatus?.(`Extracted ${data.questions.length} questions!`);
  return data;
}
