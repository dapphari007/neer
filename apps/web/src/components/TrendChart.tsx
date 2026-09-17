import { useMemo, useRef, useState } from 'react';
import type { TrendPoint } from '../lib/api';
import { num, shortDate } from '../lib/format';

/**
 * The index trend, with its credible interval drawn as a ribbon.
 *
 * Two decisions shape this chart.
 *
 * **The ribbon is not decoration.** A point line alone asserts a precision the
 * underlying citizen data does not have. Drawing the interval means the chart
 * cannot be read as more certain than it is, and the ribbon visibly breathes as
 * sampling thickens and thins — which is the single clearest demonstration that
 * the uncertainty model is doing real work rather than being reported for form.
 *
 * **Rainfall is a separate panel, not a second y-axis.** Overlaying two measures
 * on two scales is the most common way to manufacture a correlation that is not
 * there: the apparent relationship between the lines is an artefact of whatever
 * scales the author happened to choose. Sharing the x-axis across stacked panels
 * shows the same timing relationship and cannot be tuned to imply anything.
 */

interface Props {
  points: TrendPoint[];
  showSubIndices: boolean;
}

const WIDTH = 900;
const MAIN_HEIGHT = 260;
const RAIN_HEIGHT = 72;
const PAD = { top: 12, right: 16, bottom: 22, left: 40 };

/**
 * Trailing window for the smoothed line, in days.
 *
 * Citizen sampling is irregular and each day's score rests on one or two visits,
 * so the raw daily series is dominated by sampling noise — a single low reading
 * looks identical to the start of a decline. Plotting it unsmoothed buries the
 * trend the chart exists to show.
 *
 * The window is measured in DAYS, not in points. An index-based window would
 * silently span three weeks at a sparsely sampled site and four days at a busy
 * one, so the same visual smoothness would mean completely different things at
 * different sites on the same screen.
 *
 * Raw daily values are still drawn, as faint dots. Smoothing that hides its own
 * inputs invites the reader to trust a line that was never measured.
 */
const SMOOTH_WINDOW_DAYS = 7;

const SERIES = [
  { key: 'ecologicalScore', label: 'Ecological', color: 'var(--series-ecological)' },
  { key: 'pressureScore', label: 'Pressure', color: 'var(--series-pressure)' },
  { key: 'exposureScore', label: 'Exposure', color: 'var(--series-exposure)' },
] as const;

export function TrendChart({ points, showSubIndices }: Props) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const geometry = useMemo(() => {
    const valid = points.filter((p) => p.sohi !== null);
    if (valid.length < 2) return null;

    // Trailing rolling mean over a fixed span of days.
    const times = valid.map((p) => Date.parse(p.day));
    const smoothed = valid.map((point, index) => {
      const cutoff = times[index]! - SMOOTH_WINDOW_DAYS * 86_400_000;
      let start = index;
      while (start > 0 && times[start - 1]! >= cutoff) start -= 1;
      const window = valid.slice(start, index + 1);

      const mean = (accessor: (p: TrendPoint) => number | null): number | null => {
        const values = window.map(accessor).filter((v): v is number => v !== null);
        return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
      };

      return {
        day: point.day,
        sohi: mean((p) => p.sohi),
        sohiLow: mean((p) => p.sohiLow),
        sohiHigh: mean((p) => p.sohiHigh),
        ecologicalScore: mean((p) => p.ecologicalScore),
        pressureScore: mean((p) => p.pressureScore),
        exposureScore: mean((p) => p.exposureScore),
        confidence: point.confidence,
        nObs: point.nObs,
        tempMeanC: point.tempMeanC,
        precipMm: point.precipMm,
        dischargeM3s: point.dischargeM3s,
      } satisfies TrendPoint;
    });

    const innerWidth = WIDTH - PAD.left - PAD.right;
    const innerHeight = MAIN_HEIGHT - PAD.top - PAD.bottom;

    const t0 = Date.parse(valid[0]!.day);
    const t1 = Date.parse(valid.at(-1)!.day);
    const span = Math.max(1, t1 - t0);

    const x = (day: string) => PAD.left + ((Date.parse(day) - t0) / span) * innerWidth;
    // The index is defined on 0–100, so the y-axis is fixed to it. Auto-scaling
    // to the data range would make a two-point wobble look like a collapse.
    const y = (value: number) => PAD.top + innerHeight - (value / 100) * innerHeight;

    const line = (accessor: (p: TrendPoint) => number | null): string =>
      smoothed
        .map((p) => {
          const value = accessor(p);
          return value === null ? null : `${x(p.day).toFixed(1)},${y(value).toFixed(1)}`;
        })
        .filter((c): c is string => c !== null)
        .map((c, i) => (i === 0 ? `M${c}` : `L${c}`))
        .join(' ');

    const ribbon = (() => {
      const upper = smoothed.map(
        (p) => `${x(p.day).toFixed(1)},${y(p.sohiHigh ?? p.sohi!).toFixed(1)}`,
      );
      const lower = smoothed
        .map((p) => `${x(p.day).toFixed(1)},${y(p.sohiLow ?? p.sohi!).toFixed(1)}`)
        .reverse();
      return `M${upper.join(' L')} L${lower.join(' L')} Z`;
    })();

    const maxRain = Math.max(10, ...valid.map((p) => p.precipMm ?? 0));

    return { valid, smoothed, innerWidth, innerHeight, x, y, line, ribbon, maxRain };
  }, [points]);

  if (!geometry) {
    return (
      <div className="loading">Not enough scored days at this site to draw a trend.</div>
    );
  }

  const { valid, smoothed, x, y, line, ribbon, maxRain } = geometry;
  const hovered = hoverIndex !== null ? valid[hoverIndex] : null;
  const hoveredSmooth = hoverIndex !== null ? smoothed[hoverIndex] : null;

  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Map the pointer into the SVG's own coordinate space, since the element is
    // scaled responsively by its viewBox.
    const svgX = ((event.clientX - rect.left) / rect.width) * WIDTH;
    let nearest = 0;
    let best = Infinity;
    valid.forEach((p, i) => {
      const distance = Math.abs(x(p.day) - svgX);
      if (distance < best) {
        best = distance;
        nearest = i;
      }
    });
    setHoverIndex(nearest);
  };

  const gridValues = [0, 20, 40, 60, 80, 100];

  return (
    <div className="chart-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${MAIN_HEIGHT + RAIN_HEIGHT}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
        role="img"
        aria-label="Stream One Health Index over time, with credible interval and daily rainfall"
      >
        {/* Status class bands — faint, so the reader can see which class a value
            sits in without consulting a legend, but never competing with data. */}
        {gridValues.slice(0, -1).map((v) => (
          <line
            key={v}
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={y(v)}
            y2={y(v)}
            stroke="var(--gridline)"
            strokeWidth={1}
          />
        ))}

        {gridValues.map((v) => (
          <text
            key={v}
            x={PAD.left - 8}
            y={y(v) + 3.5}
            textAnchor="end"
            fontSize={10}
            fill="var(--text-muted)"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {v}
          </text>
        ))}

        {/* Credible interval */}
        <path d={ribbon} fill="var(--series-ecological)" fillOpacity={0.13} stroke="none" />

        {/* Sub-indices, drawn under the headline so they read as context */}
        {showSubIndices &&
          SERIES.map((series) => (
            <path
              key={series.key}
              d={line((p) => p[series.key])}
              fill="none"
              stroke={series.color}
              strokeWidth={1.5}
              strokeOpacity={0.75}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

        {/* Raw daily values — the measurements the smoothed line is built from */}
        {valid.map((p) => (
          <circle
            key={`raw-${p.day}`}
            cx={x(p.day)}
            cy={y(p.sohi!)}
            r={1.6}
            fill="var(--text-muted)"
            fillOpacity={0.45}
          />
        ))}

        {/* The headline index, 7-day trailing mean */}
        <path
          d={line((p) => p.sohi)}
          fill="none"
          stroke="var(--text-primary)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Crosshair */}
        {hovered && (
          <>
            <line
              x1={x(hovered.day)}
              x2={x(hovered.day)}
              y1={PAD.top}
              y2={MAIN_HEIGHT - PAD.bottom + RAIN_HEIGHT}
              stroke="var(--axis)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle
              cx={x(hovered.day)}
              cy={y(hoveredSmooth?.sohi ?? hovered.sohi!)}
              r={4.5}
              fill="var(--text-primary)"
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
          </>
        )}

        {/* x-axis ticks: first, middle, last — enough to orient, not enough to clutter */}
        {[0, Math.floor(valid.length / 2), valid.length - 1].map((i) => (
          <text
            key={i}
            x={x(valid[i]!.day)}
            y={MAIN_HEIGHT - 6}
            textAnchor={i === 0 ? 'start' : i === valid.length - 1 ? 'end' : 'middle'}
            fontSize={10}
            fill="var(--text-muted)"
          >
            {shortDate(valid[i]!.day)}
          </text>
        ))}

        {/* ── Rainfall: its own panel, its own scale, shared x ──────────────── */}
        <g transform={`translate(0, ${MAIN_HEIGHT})`}>
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={RAIN_HEIGHT - 14}
            y2={RAIN_HEIGHT - 14}
            stroke="var(--axis)"
            strokeWidth={1}
          />
          <text x={PAD.left} y={11} fontSize={10} fill="var(--text-muted)">
            Daily rainfall (mm) — real, Open-Meteo
          </text>
          {valid.map((p) => {
            const mm = p.precipMm ?? 0;
            if (mm <= 0) return null;
            const height = (mm / maxRain) * (RAIN_HEIGHT - 32);
            return (
              <rect
                key={p.day}
                x={x(p.day) - 1.25}
                y={RAIN_HEIGHT - 14 - height}
                width={2.5}
                height={height}
                fill="var(--series-ecological)"
                fillOpacity={0.55}
                rx={1.25}
              />
            );
          })}
        </g>
      </svg>

      {hovered && (
        <div
          className="tooltip"
          style={{
            left: `${Math.min(88, Math.max(2, (x(hovered.day) / WIDTH) * 100))}%`,
            top: 18,
            transform: (x(hovered.day) / WIDTH) > 0.6 ? 'translateX(-104%)' : 'translateX(8px)',
          }}
        >
          <div className="tooltip-date">{shortDate(hovered.day)}</div>
          <div className="tooltip-row">
            <span>Index (7-day mean)</span>
            <b>{num(hoveredSmooth?.sohi)}</b>
          </div>
          <div className="tooltip-row">
            <span>Measured that day</span>
            <b>{num(hovered.sohi)}</b>
          </div>
          <div className="tooltip-row">
            <span>Credible range</span>
            <b>
              {num(hoveredSmooth?.sohiLow)}–{num(hoveredSmooth?.sohiHigh)}
            </b>
          </div>
          {showSubIndices &&
            SERIES.map((s) => (
              <div className="tooltip-row" key={s.key}>
                <span>{s.label}</span>
                <b>{num(hoveredSmooth?.[s.key])}</b>
              </div>
            ))}
          <div className="tooltip-row">
            <span>Observations</span>
            <b>{hovered.nObs}</b>
          </div>
          {hovered.precipMm !== null && hovered.precipMm > 0 && (
            <div className="tooltip-row">
              <span>Rainfall</span>
              <b>{num(hovered.precipMm)} mm</b>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Legend. Always present for multiple series, so identity is never colour-alone. */
export function TrendLegend({ showSubIndices }: { showSubIndices: boolean }) {
  return (
    <div className="chart-legend">
      <span>
        <i style={{ background: 'var(--text-primary)', height: 3 }} />
        Index, 7-day mean
      </span>
      <span>
        <i
          style={{
            background: 'var(--text-muted)',
            width: 6,
            height: 6,
            borderRadius: '50%',
            opacity: 0.5,
          }}
        />
        Measured daily value
      </span>
      <span>
        <i
          style={{
            background: 'var(--series-ecological)',
            opacity: 0.25,
            height: 9,
            borderRadius: 2,
          }}
        />
        Credible interval
      </span>
      {showSubIndices &&
        SERIES.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
    </div>
  );
}

/** The table fallback every chart ships with. */
export function TrendTable({ points }: { points: TrendPoint[] }) {
  const rows = points.filter((p) => p.sohi !== null).slice(-30).reverse();
  return (
    <details className="table-toggle">
      <summary>View the last 30 scored days as a table</summary>
      <table className="data">
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Index</th>
            <th scope="col">Range</th>
            <th scope="col">Confidence</th>
            <th scope="col">Obs.</th>
            <th scope="col">Rain (mm)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.day}>
              <td>{shortDate(p.day)}</td>
              <td className="num">{num(p.sohi)}</td>
              <td className="num">
                {num(p.sohiLow)}–{num(p.sohiHigh)}
              </td>
              <td className="num">{p.confidence === null ? '—' : `${Math.round(p.confidence * 100)}%`}</td>
              <td className="num">{p.nObs}</td>
              <td className="num">{num(p.precipMm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
