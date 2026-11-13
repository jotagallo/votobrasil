import { memo, useMemo } from 'react';
import { useT } from '../i18n';
import { assignSeatBlocks, hemicycleLayout } from '../lib/hemicycle';
import { OTHERS_COLOR, OTHERS_ID, seatBlocks, type SeatMap } from '../lib/parties';

interface Props {
  seats: SeatMap;
  colors: Record<string, string>;
  total: number;
  /** Descrição acessível completa (partido: cadeiras). */
  label: string;
  caption: string;
}

function HemicycleBase({ seats, colors, total, label, caption }: Props) {
  const { t, f } = useT();
  const layout = useMemo(() => hemicycleLayout(total, { width: 400 }), [total]);
  const dots = useMemo(() => {
    const assignments = assignSeatBlocks(seatBlocks(seats));
    return assignments.flatMap((block) =>
      layout.seats.slice(block.from, block.to).map((seat, i) => ({
        key: `${block.id}-${i}`,
        x: seat.x,
        y: seat.y,
        fill: block.id === OTHERS_ID ? OTHERS_COLOR : (colors[block.id] ?? OTHERS_COLOR),
      })),
    );
  }, [seats, colors, layout]);

  return (
    <figure className="hemicycle">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label={label}
        className="hemicycle__svg"
        preserveAspectRatio="xMidYMax meet"
      >
        {dots.map((dot) => (
          <circle key={dot.key} cx={dot.x} cy={dot.y} r={layout.dotRadius} fill={dot.fill} />
        ))}
        <text x={layout.cx} y={layout.cy - 18} textAnchor="middle" className="hemicycle__total">
          {f.int(total)}
        </text>
        <text x={layout.cx} y={layout.cy} textAnchor="middle" className="hemicycle__unit">
          {t('chamber.seatsUnit')}
        </text>
      </svg>
      <figcaption className="hemicycle__caption">{caption}</figcaption>
    </figure>
  );
}

export const Hemicycle = memo(HemicycleBase);
