import type { CalEvent } from "@/lib/ghl";

const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
const dayNum = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
/** On Home, keep the week compact: first few per day, the rest on the Calendar page. */
const MAX_COMPACT = 5;
const STATUS: Record<string, string> = { showed: "Showed", noshow: "No-show", cancelled: "Cancelled", new: "Unconfirmed", invalid: "Invalid" };

/** One week, a column per day (stacked on phones). Server-rendered; details open in place. */
export default function Week({ days, events, today, compact }: { days: string[]; events: CalEvent[]; today: string; compact?: boolean }) {
  const byDay = new Map(days.map((d) => [d, [] as CalEvent[]]));
  for (const e of events) byDay.get(e.day)?.push(e);
  return (
    <div className={`cal-week ${compact ? "compact" : ""}`}>
      {days.map((d) => {
        const list = byDay.get(d)!;
        return (
          <section key={d} className={`cal-day ${d === today ? "today" : ""} ${d < today ? "past" : ""}`} aria-label={`${dayName(d)} ${dayNum(d)}`}>
            <header>
              <span className="dn">{dayName(d)}</span>
              <span className="dd">{dayNum(d)}</span>
              {list.length > 0 && <span className="dc">{list.length}</span>}
            </header>
            {list.length === 0 ? (
              <p className="cal-none">Nothing booked</p>
            ) : (
              <ul>
                {(compact ? list.slice(0, MAX_COMPACT) : list).map((e) => (
                  <li key={`${e.location}:${e.id}`} className={`cal-ev k-${e.kind} s-${e.status}`}>
                    <details>
                      <summary>
                        <span className="t">{time.format(new Date(e.start))}</span>
                        <span className="title">{e.title}</span>
                        <span className="meta">
                          <span className={`kind k-${e.kind}`}>{e.kind === "install" ? "Install" : "Sales"}</span>
                          <span>{e.locationName === "Myrtle Beach" ? "MB" : "WIL"}</span>
                          {e.assignedTo && <span>{e.assignedTo}</span>}
                          {STATUS[e.status] && <span className="st">{STATUS[e.status]}</span>}
                        </span>
                      </summary>
                      <div className="cal-more">
                        <p>
                          {time.format(new Date(e.start))} to {time.format(new Date(e.end))} · {e.calendarName} · {e.locationName}
                        </p>
                        {e.address && (
                          <p>
                            <a href={`https://maps.google.com/?q=${encodeURIComponent(e.address)}`} target="_blank" rel="noreferrer">{e.address}</a>
                          </p>
                        )}
                        {e.notes && <p className="notes">{e.notes}</p>}
                        {e.contactUrl && (
                          <p>
                            <a href={e.contactUrl} target="_blank" rel="noreferrer">Open in GoHighLevel →</a>
                          </p>
                        )}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            {compact && list.length > MAX_COMPACT && (
              <a className="cal-more-link" href="/calendar">+{list.length - MAX_COMPACT} more</a>
            )}
          </section>
        );
      })}
    </div>
  );
}
