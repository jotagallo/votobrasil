import { useMemo } from 'react';
import { assignSeatBlocks, hemicycleLayout } from '../lib/hemicycle';

const DEMO_BLOCKS = [
  { id: 'a', seats: 44, color: '#002776' },
  { id: 'b', seats: 34, color: '#0b4da2' },
  { id: 'c', seats: 26, color: '#3e92d8' },
  { id: 'd', seats: 22, color: '#009c3b' },
  { id: 'e', seats: 14, color: '#f2c300' },
  { id: 'f', seats: 10, color: '#b9c6dc' },
] as const;

const TOTAL = DEMO_BLOCKS.reduce((sum, block) => sum + block.seats, 0);

/** Hemiciclo decorativo da Home: cadeiras genéricas nas cores da marca, sem dados reais. */
export function HeroArc() {
  const { layout, dots } = useMemo(() => {
    const base = hemicycleLayout(TOTAL, { width: 400 });
    const assignments = assignSeatBlocks(DEMO_BLOCKS);
    const items = assignments.flatMap((assignment) => {
      const color = DEMO_BLOCKS.find((block) => block.id === assignment.id)?.color ?? '#b9c6dc';
      return base.seats.slice(assignment.from, assignment.to).map((seat, i) => ({
        key: `${assignment.id}-${i}`,
        x: seat.x,
        y: seat.y,
        delay: Math.round((seat.angle / Math.PI) * 700),
        color,
      }));
    });
    return { layout: base, dots: items };
  }, []);

  return (
    <svg
      className="hero__arc"
      viewBox={`0 0 ${layout.width} ${layout.cy + layout.dotRadius + 2}`}
      aria-hidden="true"
      focusable="false"
    >
      {dots.map((dot) => (
        <circle
          key={dot.key}
          cx={dot.x}
          cy={dot.y}
          r={layout.dotRadius}
          fill={dot.color}
          style={{ animationDelay: `${dot.delay}ms` }}
        />
      ))}
    </svg>
  );
}
