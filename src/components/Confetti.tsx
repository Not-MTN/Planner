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

  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: 36 }, (_, index) => ({
        left: 4 + Math.random() * 92,
        delay: Math.random() * 0.22,
        duration: 1.15 + Math.random() * 0.75,
        color: COLORS[index % COLORS.length],
        width: 5 + Math.random() * 6,
        height: 8 + Math.random() * 8,
        drift: -90 + Math.random() * 180,
        rotate: Math.random() * 720 - 360,
        round: Math.random() > 0.6,
      })),
    [seed],
  );

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
