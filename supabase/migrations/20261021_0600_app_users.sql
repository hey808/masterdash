-- Logins. Three roles: admin sees everything; sales and installer see their own
-- form and their own commissions. Sales and installer logins point at a roster
-- person, which is how "their" commissions are found.
create table app_users (
  id              uuid primary key default gen_random_uuid(),
  email           text not null unique check (email = lower(trim(email)) and email like '%@%'),
  name            text not null check (length(trim(name)) > 0),
  role            text not null check (role in ('admin', 'sales', 'installer')),
  person_id       uuid references people(id),
  password_hash   text not null,
  active          boolean not null default true,
  -- Bumped on deactivate / password reset / role change: signs that user out everywhere.
  session_version int not null default 1,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint app_users_person_for_field_roles check (role = 'admin' or person_id is not null)
);
create index app_users_person_idx on app_users (person_id);
-- No audit trigger on purpose: the audit log stores whole rows and password hashes don't belong there.
alter table app_users enable row level security;
