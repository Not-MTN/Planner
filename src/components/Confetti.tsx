import { useEffect, useMemo, useState } from 'react';

const COLORS = ['#7fa98a', '#d09468', '#c58b92', '#9887c6', '#7d96ad', '#e0b64f', '#a9c2b0'];

interface Piece {
  left: number;
  delay: number;
  duration: number;
  color: string;
  width: number;
  height: number;
  drift: number;
  rotate: number;
  round: boolean;
}

/**
 * Tiny deterministic PRNG (mulberry32). `seed` is the celebration counter, so
 * deriving the burst from it makes the memo genuinely depend on the value it
 * already listed — and the same celebration looks the same on a re-render.
 */
function randomFor(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function Confetti({ seed }: { seed: number }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (seed <= 0 || prefersReducedMotion()) return;
    setShow(true);
    const id = window.setTimeout(() => setShow(false), 2100);
    return () => window.clearTimeout(id);
  }, [seed]);

  const pieces = useMemo<Piece[]>(() => {
    const random = randomFor(seed);
    return Array.from({ length: 36 }, (_, index) => ({
      left: 4 + random() * 92,
      delay: random() * 0.22,
      duration: 1.15 + random() * 0.75,
      color: COLORS[index % COLORS.length],
      width: 5 + random() * 6,
      height: 8 + random() * 8,
      drift: -90 + random() * 180,
      rotate: random() * 720 - 360,
      round: random() > 0.6,
    }));
  }, [seed]);

  if (!show) return null;

  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((piece, index) => (
        <span
          key={`${seed}-${index}`}
          style={{
            left: `${piece.left}%`,
            width: piece.width,
            height: piece.round ? piece.width : piece.height,
            background: piece.color,
            borderRadius: piece.round ? '50%' : '2px',
            animationDelay: `${piece.delay}s`,
            animationDuration: `${piece.duration}s`,
            ['--drift' as string]: `${piece.drift}px`,
            ['--spin' as string]: `${piece.rotate}deg`,
          }}
        />
      ))}
    </div>
  );
}
