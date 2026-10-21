"use client";

import { useEffect, useMemo, useState } from "react";
import type { CalEvent } from "@/lib/ghl";
import EventItem, { fmtTime } from "./EventItem";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const longDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

/**
 * A month grid (Monday first, 6 weeks). Each day shows how many sales appointments and
 * installs are booked plus the first few; clicking a day lists that day's appointments.
 * The selected day is kept in the URL (?day=) so a refresh or shared link opens the same day.
 */
export default function Month({ month, days, events, today, initialDay, compact }: {
  month: string; // yyyy-mm
  days: string[]; // the 42 grid days
  events: CalEvent[];
  today: string;
  initialDay: string;
  compact?: boolean;
}) {
  const [day, setDay] = useState(initialDay);
  useEffect(() => setDay(initialDay), [initialDay]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) {
      const l = m.get(e.day) ?? [];
      l.push(e);
      m.set(e.day, l);
    }
    return m;
  }, [events]);

  function pick(d: string) {
    setDay(d);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("day", d);
      window.history.replaceState(null, "", u);
    } catch {
      /* ignore */
    }
  }

  const list = byDay.get(day) ?? [];
  const live = list.filter((e) => e.status !== "cancelled");
  const shown = compact ? 2 : 3;

  return (
    <div className={`cal-month-wrap ${compact ? "compact" : ""}`}>
      <div className="cal-month" role="grid" aria-label="Month">
        {WEEKDAYS.map((w) => (
          <div key={w} className="cal-wd" role="columnheader">{w}</div>
        ))}
        {days.map((d) => {
          const evs = byDay.get(d) ?? [];
          const active = evs.filter((e) => e.status !== "cancelled");
          const sales = active.filter((e) => e.kind === "sales").length;
          const installs = active.filter((e) => e.kind === "install").length;
          const cls = [
            "cal-cell",
            d.slice(0, 7) !== month ? "out" : "",
            d === today ? "today" : "",
            d === day ? "sel" : "",
            d < today ? "past" : "",
          ].join(" ");
          return (
            <button key={d} type="button" role="gridcell" className={cls} aria-selected={d === day} aria-label={`${longDay(d)}: ${sales} sales, ${installs} installs`} onClick={() => pick(d)}>
              <span className="cal-cell-head">
                <span className="num">{Number(d.slice(8))}</span>
                {(sales > 0 || installs > 0) && (
                  <span className="counts">
                    {sales > 0 && <span className="c-sales" title="Sales appointments">{sales}</span>}
                    {installs > 0 && <span className="c-install" title="Installs">{installs}</span>}
                  </span>
                )}
              </span>
              <span className="chips">
                {active.slice(0, shown).map((e) => (
                  <span key={`${e.location}:${e.id}`} className={`chip k-${e.kind}`}>
                    <b>{fmtTime(e.start).replace(":00", "").replace(" ", "").toLowerCase()}</b> {e.title}
                  </span>
                ))}
                {active.length > shown && <span className="more">+{active.length - shown} more</span>}
              </span>
            </button>
          );
        })}
      </div>

      <aside className="cal-daypanel" aria-live="polite">
        <header>
          <h3>{longDay(day)}{day === today ? " · Today" : ""}</h3>
          <span className="muted">
            {live.filter((e) => e.kind === "sales").length} sales · {live.filter((e) => e.kind === "install").length} installs
          </span>
        </header>
        {list.length === 0 ? <p className="cal-none">Nothing booked.</p> : <ul>{list.map((e) => <EventItem key={`${e.location}:${e.id}`} e={e} />)}</ul>}
      </aside>
    </div>
  );
}
