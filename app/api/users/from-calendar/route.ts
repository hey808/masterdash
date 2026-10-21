import { calendarPeople } from "@/lib/ghl";
import { createCalendarLogins } from "@/lib/users";
import { respond } from "../../_respond";

export const dynamic = "force-dynamic";

/** Creates a login for everyone booked on the GHL calendars (last 90 days to 60 ahead). Passwords are returned once. */
export async function POST() {
  return respond(async () => {
    const now = Date.now();
    const { people } = await calendarPeople(new Date(now - 90 * 86_400_000).toISOString(), new Date(now + 60 * 86_400_000).toISOString());
    return createCalendarLogins(people, "web:team");
  });
}
