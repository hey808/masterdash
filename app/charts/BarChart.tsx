"use client";

import { useEffect, useRef, useState } from "react";

export interface Series {
  name: string;
  /** A CSS color or var(); text never uses it. */
  color: string;
  values: number[];
}

/** Round tick steps (1, 2 or 5 × 10ⁿ), about four of them, covering v. */
function niceTicks(v: number): number[] {
  if (v <= 0) return [0, 1];
  const raw = v / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * p >= raw) ?? 10) * p;
  const n = Math.ceil(v / step);
  return Array.from({ length: n + 1 }, (_, i) => i * step);
}

/**
 * Vertical bars, grouped when there's more than one series. One y-axis, thin
 * marks with rounded tops, a hover tooltip per column, a legend for 2+ series,
 * and the numbers as a table for screen readers.
 */
export default function BarChart({ labels, series, format, title, detail, height = 210 }: {
  labels: string[];
  series: Series[];
  format: (v: number) => string;
  title: string;
  /** Extra tooltip lines for a column. */
  detail?: (i: number) => string | null;
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const padL = 52;
  const padR = 8;
  const padT = 10;
  const padB = 24;
  const n = labels.length;
  const ticks = niceTicks(Math.max(0, ...series.flatMap((s) => s.values)));
  const max = ticks[ticks.length - 1]!;
  const plotW = w - padL - padR;
  const plotH = height - padT - padB;
  const col = plotW / Math.max(1, n);
  const groupW = Math.min(col * 0.72, 18 * series.length + 2 * (series.length - 1));
  const gap = series.length > 1 ? 2 : 0;
  const barW = Math.max(1.5, (groupW - gap * (series.length - 1)) / series.length);
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const every = Math.max(1, Math.ceil(52 / col)); // keep x labels from colliding
  const empty = series.every((s) => s.values.every((v) => !v));

  /** A bar with a 4px rounded top, square at the baseline. */
  const bar = (x: number, v: number) => {
    const top = y(v);
    const h = padT + plotH - top;
    if (h <= 0) return "";
    const r = Math.min(4, barW / 2, h);
    return `M${x},${padT + plotH}V${top + r}Q${x},${top} ${x + r},${top}H${x + barW - r}Q${x + barW},${top} ${x + barW},${top + r}V${padT + plotH}Z`;
  };

  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <span className="chart-title">{title}</span>
        {series.length > 1 && (
          <span className="chart-legend">
            {series.map((s) => (
              <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>
            ))}
          </span>
        )}
      </figcaption>
      <div ref={box} className="chart-box" onMouseLeave={() => setHover(null)}>
        {empty ? (
          <p className="chart-empty">Nothing in this period.</p>
        ) : (
          <svg width={w} height={height} role="img" aria-label={`${title}, ${labels[0]} to ${labels[n - 1]}`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} className={t === 0 ? "chart-base" : "chart-grid"} />
                <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="chart-tick">{format(t)}</text>
              </g>
            ))}
            {hover != null && <rect x={padL + hover * col} y={padT} width={col} height={plotH} className="chart-hover" />}
            {labels.map((_, i) => {
              const x0 = padL + i * col + (col - groupW) / 2;
              return series.map((s, k) => <path key={`${i}-${k}`} d={bar(x0 + k * (barW + gap), s.values[i] ?? 0)} fill={s.color} />);
            })}
            {labels.map((l, i) =>
              i % every === 0 ? (
                <text key={l + i} x={padL + i * col + col / 2} y={height - 6} textAnchor="middle" className="chart-tick">{l}</text>
              ) : null,
            )}
            {labels.map((_, i) => (
              <rect key={`h${i}`} x={padL + i * col} y={0} width={col} height={height} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
            ))}
          </svg>
        )}
        {hover != null && !empty && (
          <div className="chart-tip" style={{ left: Math.min(Math.max(padL + hover * col + col / 2, 90), w - 90) }}>
            <strong>{labels[hover]}</strong>
            {series.map((s) => (
              <span key={s.name}><i style={{ background: s.color }} />{s.name} <b>{format(s.values[hover] ?? 0)}</b></span>
            ))}
            {detail?.(hover) && <span className="muted">{detail(hover)}</span>}
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th>Period</th>{series.map((s) => <th key={s.name}>{s.name}</th>)}</tr></thead>
        <tbody>{labels.map((l, i) => <tr key={l + i}><td>{l}</td>{series.map((s) => <td key={s.name}>{format(s.values[i] ?? 0)}</td>)}</tr>)}</tbody>
      </table>
    </figure>
  );
}
