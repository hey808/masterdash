-- Appointment slot capacity per location: who sells and who installs where, how many
-- appointments / installs each can take in a week, and the GHL user they book under.
create table capacity_members (
  id            uuid primary key default gen_random_uuid(),
  location_id   uuid not null references locations(id),
  person_id     uuid not null references people(id),
  role          text not null check (role in ('sales', 'install')),
  weekly_slots  int not null check (weekly_slots between 0 and 200),
  ghl_user_id   text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (location_id, person_id, role)
);

-- A different number for one week (time off, a short week, extra days).
create table capacity_overrides (
  member_id   uuid not null references capacity_members(id) on delete cascade,
  week_start  date not null check (extract(isodow from week_start) = 1),
  slots       int not null check (slots between 0 and 200),
  note        text,
  primary key (member_id, week_start)
);

-- Per location: how full is "full", and what a booked sales appointment costs in ads.
create table capacity_settings (
  location_id         uuid primary key references locations(id),
  target_pct          int not null default 85 check (target_pct between 10 and 150),
  cost_per_appt_cents bigint check (cost_per_appt_cents is null or cost_per_appt_cents >= 0),
  updated_at          timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['capacity_members','capacity_settings'] loop
    execute format('create trigger %I_audit after insert or update or delete on %I for each row execute function audit_row(%L)', t, t, case t when 'capacity_settings' then 'location_id' else 'id' end);
    execute format('alter table %I enable row level security', t);
  end loop;
  execute 'alter table capacity_overrides enable row level security';
end $$;
