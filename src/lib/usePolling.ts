"use client";

import { useEffect, useRef, useState } from "react";

export function usePolling<T>(
  fn: () => Promise<T>,
  intervalMs: number = 3000
): { data: T | null; error: Error | null; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const tickRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const result = await fn();
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    const id = setInterval(run, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, tickRef.current]);

  return {
    data,
    error,
    loading,
    refresh: () => {
      tickRef.current += 1;
    },
  };
}
