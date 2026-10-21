import type { CalEvent } from "@/lib/ghl";

const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const STATUS: Record<string, string> = { showed: "Showed", noshow: "No-show", cancelled: "Cancelled", new: "Unconfirmed", invalid: "Invalid" };

export const fmtTime = (iso: string) => time.format(new Date(iso));

/** One appointment: time, title, type, location, who; opens for address, notes and a GHL link. */
export default function EventItem({ e, open }: { e: CalEvent; open?: boolean }) {
  return (
    <li className={`cal-ev k-${e.kind} s-${e.status}`}>
      <details open={open}>
        <summary>
          <span className="t">{fmtTime(e.start)} – {fmtTime(e.end)}</span>
          <span className="title">{e.title}</span>
          <span className="meta">
            <span className={`kind k-${e.kind}`}>{e.kind === "install" ? "Install" : "Sales"}</span>
            <span>{e.locationName}</span>
            {e.assignedTo && <span>{e.assignedTo}</span>}
            {STATUS[e.status] && <span className="st">{STATUS[e.status]}</span>}
          </span>
        </summary>
        <div className="cal-more">
          <p>{e.calendarName}</p>
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
  );
}
