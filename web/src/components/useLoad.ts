import { useCallback, useEffect, useState } from 'react';

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(() => {
    setLoading(true);
    setErr('');
    fn().then(setData).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, deps);
  useEffect(reload, [reload]);
  return { data, err, loading, reload, setData };
}
