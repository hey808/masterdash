"use client";

import { shortDate, todayET } from "@/lib/dates";
import { FRAMES, frameRange, type Frame } from "@/lib/timeframe";

/** The time frame dropdown (plus a from/to pair for a custom range). Controlled. */
export default function TimeFrame({
  frame,
  from,
  to,
  onChange,
  prefix,
  allowAll = true,
  label = "Time frame",
}: {
  frame: Frame;
  from: string;
  to: string;
  onChange: (frame: Frame, from: string, to: string) => void;
  /** e.g. "Sold" → "Sold: this month". */
  prefix?: string;
  allowAll?: boolean;
  label?: string;
}) {
  const [rf, rt] = frameRange(frame, todayET(), from, to);
  const text = (f: Frame) => (prefix ? `${prefix}: ${FRAMES[f].toLowerCase()}` : FRAMES[f]);
  return (
    <div className="frame">
      <select aria-label={label} value={frame} onChange={(e) => onChange(e.target.value as Frame, from, to)} className={frame !== "all" ? "on" : ""}>
        {(Object.keys(FRAMES) as Frame[]).filter((f) => allowAll || f !== "all").map((f) => <option key={f} value={f}>{text(f)}</option>)}
      </select>
      {frame === "custom" && (
        <>
          <input type="date" aria-label="From" value={from} max={to || undefined} onChange={(e) => onChange(frame, e.target.value, to)} />
          <span className="muted">to</span>
          <input type="date" aria-label="To" value={to} min={from || undefined} onChange={(e) => onChange(frame, from, e.target.value)} />
        </>
      )}
      {frame !== "all" && frame !== "custom" && rf && <span className="muted">{rf === rt ? shortDate(rf) : `${shortDate(rf)} to ${shortDate(rt)}`}</span>}
    </div>
  );
}
