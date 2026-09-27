import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';

export function useNow(interval = 30000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), interval);
    return () => window.clearInterval(id);
  }, [interval]);
  return now;
}

export function useImportFile(onText: (text: string) => void) {
  const ref = useRef<HTMLInputElement>(null);
  const onChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        onText(await file.text());
      } catch {
        onText('');
      }
    },
    [onText],
  );
  const open = useCallback(() => ref.current?.click(), []);
  return { ref, onChange, open };
}
