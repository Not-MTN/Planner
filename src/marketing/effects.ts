import { useEffect, useRef, useState } from 'react';

/** True once the page has scrolled past `threshold` pixels. */
export function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return scrolled;
}

/** 0 → 1 progress through the whole document. */
export function useScrollProgress(): number {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        setProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  return progress;
}

/** Fires once when the element first enters the viewport. */
export function useInView<T extends HTMLElement>(threshold = 0.25) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => setInView(entries.some((entry) => entry.isIntersecting)), {
      threshold,
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);
  return { ref, inView };
}

/**
 * Turns scroll position inside an element into a stage index — used by the
 * guardian dashboard section, which assembles itself as you scroll past it.
 */
export function useStage<T extends HTMLElement>(count: number) {
  const ref = useRef<T | null>(null);
  const [stage, setStage] = useState(0);
  useEffect(() => {
    let frame = 0;
    const compute = () => {
      const node = ref.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const vh = window.innerHeight;
      const start = vh * 0.8;
      const end = vh * 0.2;
      const span = start - end + rect.height * 0.5;
      const progress = (start - rect.top) / span;
      const clamped = Math.min(0.999, Math.max(0, progress));
      setStage(Math.floor(clamped * count));
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        compute();
      });
    };
    compute();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [count]);
  return { ref, stage };
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/**
 * Tracks the pointer inside an element and writes CSS custom properties:
 * --mx/--my for the spotlight glow, --tilt-x/--tilt-y for a subtle 3D tilt.
 */
export function pointerMove(event: React.MouseEvent<HTMLElement>, options: { tilt?: number } = {}) {
  const node = event.currentTarget;
  const rect = node.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  node.style.setProperty('--mx', `${x}px`);
  node.style.setProperty('--my', `${y}px`);
  if (options.tilt && !prefersReducedMotion()) {
    const tilt = options.tilt;
    node.style.setProperty('--tilt-y', `${((x / rect.width) * 2 - 1) * tilt}deg`);
    node.style.setProperty('--tilt-x', `${(1 - (y / rect.height) * 2) * tilt}deg`);
  }
}

export function pointerLeave(event: React.MouseEvent<HTMLElement>) {
  const node = event.currentTarget;
  node.style.setProperty('--tilt-x', '0deg');
  node.style.setProperty('--tilt-y', '0deg');
}

/** Gentle pointer parallax for the hero artwork. Disabled for reduced motion. */
export function useParallax<T extends HTMLElement>(strength = 1) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || prefersReducedMotion()) return;
    let frame = 0;
    const onMove = (event: MouseEvent) => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const rect = node.getBoundingClientRect();
        const x = (event.clientX - (rect.left + rect.width / 2)) / window.innerWidth;
        const y = (event.clientY - (rect.top + rect.height / 2)) / window.innerHeight;
        node.style.setProperty('--px', `${(-x * 26 * strength).toFixed(2)}px`);
        node.style.setProperty('--py', `${(-y * 20 * strength).toFixed(2)}px`);
      });
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [strength]);
  return ref;
}

/** Counts up to the first number in a string once `active` becomes true. */
export function useCountUp(text: string, active: boolean): string {
  const match = /^(\d+)/.exec(text);
  const target = match ? Number(match[1]) : null;
  const rest = match ? text.slice(match[1].length) : text;
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (target === null || !active) return;
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }
    let frame = 0;
    const started = performance.now();
    const duration = 1100;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [target, active]);

  if (target === null) return text;
  return `${value}${rest}`;
}
