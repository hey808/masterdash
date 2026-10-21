-- What happened at each sales appointment, as the rep reports it: declined,
-- rescheduled, or closed (a sale, linked to its deal). One row per GoHighLevel
-- appointment; a rep can change it until it's closed.
create table if not exists appointment_dispositions (
  appointment_id   text primary key,
  location_id      uuid references locations(id),
  person_id        uuid references people(id),
  appointment_day  date not null,
  customer_name    text,
  contact_id       text,
  outcome          text not null check (outcome in ('declined', 'rescheduled', 'closed')),
  reason           text,
  note             text,
  rescheduled_to   date,
  deal_id          uuid references deals(id) on delete set null,
  recorded_by      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists appointment_dispositions_day_idx on appointment_dispositions (appointment_day);

drop trigger if exists appointment_dispositions_audit on appointment_dispositions;
create trigger appointment_dispositions_audit after insert or update or delete on appointment_dispositions
  for each row execute function audit_row('appointment_id');
alter table appointment_dispositions enable row level security;
