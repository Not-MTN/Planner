import { useEffect, useState } from 'react';

export function useNow(interval = 30000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), interval);
    return () => window.clearInterval(id);
  }, [interval]);
  return now;
}
