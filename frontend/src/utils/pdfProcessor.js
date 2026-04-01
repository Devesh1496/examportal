// utils/pdfProcessor.js — Client-side PDF rendering + native Backend AI image extraction
import * as pdfjsLib from 'pdfjs-dist';

// Use the CDN worker to avoid bundler issues
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';

// ─── FETCH PDF VIA BACKEND PROXY ─────────────────────────────
export async function fetchPdfAsArrayBuffer(pdfUrl, onStatus) {
  onStatus?.('Downloading PDF…');
  const res = await fetch(`/api/proxy/pdf?url=${encodeURIComponent(pdfUrl)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to download: ${res.status}`);
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
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    base64Images.push(dataUrl);

    canvas.width = 0;
    canvas.height = 0;
  }
  return base64Images;
}

// ─── MAIN ORCHESTRATOR ───────────────────────────────────────
export async function processPaperClientSide(pdfUrl, paperTitle, onStatus) {
  onStatus?.('Starting Native Backend Image Extraction…');
  
  // 1. Download proxy
  const arrayBuffer = await fetchPdfAsArrayBuffer(pdfUrl, onStatus);
  
  // 2. Client-side PDF string conversion
  const images = await renderPdfToImages(arrayBuffer, onStatus);
  onStatus?.(`Sending ${images.length} images to local AI processing…`);

  // 3. Backend AI processing securely
  const res = await fetch('/api/papers/process-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images, title: paperTitle })
  });
  
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to extract questions');

  onStatus?.(`Extracted ${data.questions.length} questions successfully!`);
  return data;
}
