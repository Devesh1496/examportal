// hooks/usePolling.js — Polls an endpoint until condition is met
import { useState, useEffect, useRef } from 'react';
import { api } from '../utils/api';

export function usePaperStatus(paperId, onReady) {
  const [status, setStatus] = useState(null);
  const [totalQ, setTotalQ] = useState(0);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!paperId) return;

    const poll = async () => {
      try {
        const data = await api.getPaperStatus(paperId);
        setStatus(data.status);
        setTotalQ(data.total_q || 0);
        if (data.status === 'ready' || data.status === 'failed') {
          clearInterval(intervalRef.current);
          if (data.status === 'ready' && onReady) onReady(data);
        }
      } catch {}
    };

    poll();
    intervalRef.current = setInterval(poll, 2500);
    return () => clearInterval(intervalRef.current);
  }, [paperId]);

  return { status, totalQ };
}
