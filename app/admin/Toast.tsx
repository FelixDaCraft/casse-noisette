'use client';
import { useEffect, useState, useCallback } from 'react';

/** Message bref en bas d'écran (2,4 s), pour confirmer une action sans bloquer. */
export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const toast = useCallback((m: string) => setMessage(m), []);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 2400);
    return () => clearTimeout(t);
  }, [message]);

  const element = message ? (
    <div className="toast" role="status">
      {message}
    </div>
  ) : null;

  return { toast, element };
}
