-- Ledger foundation (slice 1).
--
-- The deal ledger is the source of truth. Rules this schema enforces:
--   * Money is integer cents (bigint). No floats anywhere money is stored.
--   * Humans type facts; the app derives everything else (src/lib/ledger).
--     A derived number is never stored, except as an explicit, reasoned
--     override column that the audit log records.
--   * Rates are stamped onto the deal when it is sold. Changing a comp plan,
--     lender rate or SKU cost later never rewrites a past deal.
--   * Money in (payments) and money out (payouts) are rows, not checkboxes.
--   * Every insert, update and delete on a ledger table is audit-logged.

create extension if not exists pgcrypto;

-- ── Reference data ──────────────────────────────────────────────────────

create table locations (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name        text not null,
  state       text not null check (state ~ '^[A-Z]{2}$'),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table people (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  email             text,
  phone             text,
  roles             text[] not null default '{}'
                    check (roles <@ array['owner','admin','manager','closer','setter','canvasser','installer']::text[]),
  home_location_id  uuid references locations(id),
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);
create unique index people_name_key on people (lower(name));
create unique index people_email_key on people (lower(email)) where email is not null;

create table lenders (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  in_house    boolean not null default false,   -- Clearflow carries the note itself
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- A lender's dealer fee over time. Deals stamp the rate in force on the sale date.
create table lender_rates (
  lender_id       uuid not null references lenders(id) on delete cascade,
  effective_from  date not null,
  dealer_fee_rate numeric(7,6) not null check (dealer_fee_rate >= 0 and dealer_fee_rate < 1),
  primary key (lender_id, effective_from)
);

create table skus (
  code                       text primary key check (code = upper(code) and code !~ '\s'),
  name                       text not null,
  category                   text not null default 'other',
  default_installer_pay_cents bigint check (default_installer_pay_cents >= 0),
  active                     boolean not null default true,
  created_at                 timestamptz not null default now()
);

-- Unit cost over time. A deal line snapshots the cost in force on the sale date.
create table sku_costs (
  sku_code        text not null references skus(code) on update cascade,
  effective_from  date not null,
  unit_cost_cents bigint not null check (unit_cost_cents >= 0),
  note            text,
  primary key (sku_code, effective_from)
);

-- Commission plan over time. A deal stamps the plan in force on its sale date.
create table comp_plans (
  id                     uuid primary key default gen_random_uuid(),
  effective_from         date not null unique,
  tier_threshold_cents   bigint not null check (tier_threshold_cents > 0),
  rate_at_or_above       numeric(7,6) not null check (rate_at_or_above between 0 and 1),
  rate_below             numeric(7,6) not null check (rate_below between 0 and 1),
  manager_rate           numeric(7,6) not null check (manager_rate between 0 and 1),
  setter_rate            numeric(7,6) not null check (setter_rate between 0 and 1),
  canvasser_rate         numeric(7,6) not null check (canvasser_rate between 0 and 1),
  admin_fee_cents        bigint not null check (admin_fee_cents >= 0),
  card_fee_rate          numeric(7,6) not null check (card_fee_rate between 0 and 1),
  note                   text
);

create table import_batches (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,             -- 'mission-control-csv', 'mission-control-db', ...
  file_name   text,
  imported_at timestamptz not null default now(),
  row_count   int not null,
  report      jsonb not null default '{}'
);

-- ── The ledger ──────────────────────────────────────────────────────────

create sequence deal_number_seq start 1001;

create table deals (
  id                    uuid primary key default gen_random_uuid(),
  number                bigint not null unique default nextval('deal_number_seq'),
  location_id           uuid not null references locations(id),
  customer_name         text not null check (length(trim(customer_name)) > 0),
  customer_address      text,
  sale_date             date not null,
  lead_source           text,
  external_ref          text,              -- AquaReport contract id, etc.

  closer_id             uuid references people(id),
  manager_id            uuid references people(id),
  setter_id             uuid references people(id),
  canvasser_id          uuid references people(id),
  installer_id          uuid references people(id),

  -- What was sold and how it is paid for.
  price_cents             bigint not null check (price_cents >= 0),
  cash_portion_cents      bigint not null default 0 check (cash_portion_cents >= 0),
  financed_portion_cents  bigint not null default 0 check (financed_portion_cents >= 0),
  split_exception         text,            -- why cash + financed may differ from price
  lender_id               uuid references lenders(id),

  -- Rates stamped at sale (from comp_plans / lender_rates), editable with audit.
  comp_plan_id            uuid references comp_plans(id),
  lender_rate             numeric(7,6) not null default 0 check (lender_rate >= 0 and lender_rate < 1),
  commission_rate         numeric(7,6) not null default 0 check (commission_rate between 0 and 1),
  commission_rate_source  text not null default 'plan' check (commission_rate_source in ('plan','override')),
  manager_rate            numeric(7,6) not null default 0 check (manager_rate between 0 and 1),
  setter_rate             numeric(7,6) not null default 0 check (setter_rate between 0 and 1),
  canvasser_rate          numeric(7,6) not null default 0 check (canvasser_rate between 0 and 1),
  admin_fee_cents         bigint not null default 0 check (admin_fee_cents >= 0),
  extras_cents            bigint not null default 0 check (extras_cents >= 0),
  extras_note             text,
  installer_pay_cents     bigint check (installer_pay_cents >= 0),

  -- Narrow, reasoned overrides of derived values. Null = calculated.
  loan_interest_override_cents     bigint check (loan_interest_override_cents >= 0),
  card_fee_override_cents          bigint check (card_fee_override_cents >= 0),
  funding_expected_override_cents  bigint check (funding_expected_override_cents >= 0),
  cogs_override_cents              bigint check (cogs_override_cents >= 0),
  override_reason                  text,

  -- Lifecycle.
  install_scheduled_on  date,
  installed_on          date,             -- revenue is recognized on this date
  cancelled_at          timestamptz,
  cancel_reason         text,
  closed_at             timestamptz,      -- manual sign-off: nothing left to do
  note                  text,

  import_batch_id       uuid references import_batches(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  version               int not null default 1,   -- optimistic concurrency

  constraint deals_split_matches check (
    cash_portion_cents + financed_portion_cents = price_cents or split_exception is not null
  ),
  constraint deals_financed_needs_lender check (financed_portion_cents = 0 or lender_id is not null or split_exception is not null),
  constraint deals_override_reason check (
    override_reason is not null or (
      loan_interest_override_cents is null and card_fee_override_cents is null
      and funding_expected_override_cents is null and cogs_override_cents is null
      and commission_rate_source = 'plan'
    )
  ),
  constraint deals_cancel_reason check (cancelled_at is null or cancel_reason is not null),
  constraint deals_install_after_sale check (installed_on is null or installed_on >= sale_date - 30)
);
create index deals_location_idx on deals (location_id);
create index deals_sale_date_idx on deals (sale_date);
create index deals_installed_on_idx on deals (installed_on);

create table deal_lines (
  id               uuid primary key default gen_random_uuid(),
  deal_id          uuid not null references deals(id) on delete cascade,
  sku_code         text not null references skus(code) on update cascade,
  qty              int not null default 1 check (qty > 0),
  unit_cost_cents  bigint not null check (unit_cost_cents >= 0),   -- snapshot at sale
  sort             int not null default 0,
  created_at       timestamptz not null default now()
);
create index deal_lines_deal_idx on deal_lines (deal_id);

-- Money in. A customer payment or a lender funding, one row per deposit.
create table payments (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid not null references deals(id) on delete cascade,
  source       text not null check (source in ('customer','lender')),
  method       text not null check (method in ('cash','check','card','ach','zelle','lender','other','unknown')),
  amount_cents bigint not null check (amount_cents <> 0),   -- negative = refund / clawback
  fee_cents    bigint not null default 0 check (fee_cents >= 0),
  received_on  date,                                         -- null only for imported totals
  bank_ref     text,
  note         text,
  import_batch_id uuid references import_batches(id),
  created_at   timestamptz not null default now(),
  constraint payments_dated check (received_on is not null or import_batch_id is not null)
);
create index payments_deal_idx on payments (deal_id);

-- Money out. Commission, override, setter, canvasser and installer pay actually paid.
-- What is owed is derived: earned (from the deal) minus paid (these rows).
create table payouts (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid not null references deals(id) on delete cascade,
  person_id    uuid references people(id),
  kind         text not null check (kind in ('closer','override','setter','canvasser','installer')),
  amount_cents bigint not null check (amount_cents <> 0),
  paid_on      date,
  method       text,
  note         text,
  import_batch_id uuid references import_batches(id),
  created_at   timestamptz not null default now(),
  constraint payouts_dated check (paid_on is not null or import_batch_id is not null)
);
create index payouts_deal_idx on payouts (deal_id);

-- ── Housekeeping triggers ───────────────────────────────────────────────

create or replace function touch_deal() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end $$;
create trigger deals_touch before update on deals for each row execute function touch_deal();

-- Audit: every write to a ledger table. The app sets `app.actor` per transaction
-- (select set_config('app.actor', '<person id or email>', true)).
create table audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor       text,
  table_name  text not null,
  row_id      text,
  action      text not null check (action in ('insert','update','delete')),
  before      jsonb,
  after       jsonb
);
create index audit_log_row_idx on audit_log (table_name, row_id);

create or replace function audit_row() returns trigger language plpgsql as $$
declare
  actor text := nullif(current_setting('app.actor', true), '');
begin
  if tg_op = 'INSERT' then
    insert into audit_log(actor, table_name, row_id, action, after)
      values (actor, tg_table_name, to_jsonb(new)->>(tg_argv[0]), 'insert', to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) - 'updated_at' - 'version' = to_jsonb(old) - 'updated_at' - 'version' then
      return new;  -- no real change
    end if;
    insert into audit_log(actor, table_name, row_id, action, before, after)
      values (actor, tg_table_name, to_jsonb(new)->>(tg_argv[0]), 'update', to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into audit_log(actor, table_name, row_id, action, before)
      values (actor, tg_table_name, to_jsonb(old)->>(tg_argv[0]), 'delete', to_jsonb(old));
    return old;
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['locations','people','lenders','deals','deal_lines','payments','payouts','comp_plans'] loop
    execute format('create trigger %I_audit after insert or update or delete on %I for each row execute function audit_row(''id'')', t, t);
  end loop;
  execute 'create trigger skus_audit after insert or update or delete on skus for each row execute function audit_row(''code'')';
  execute 'create trigger sku_costs_audit after insert or update or delete on sku_costs for each row execute function audit_row(''sku_code'')';
  execute 'create trigger lender_rates_audit after insert or update or delete on lender_rates for each row execute function audit_row(''lender_id'')';
end $$;

-- The audit log is append-only.
create or replace function audit_log_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function audit_log_immutable();

-- ── Lookups the app uses when a deal is sold ────────────────────────────

create or replace function comp_plan_on(d date) returns comp_plans language sql stable as $$
  select * from comp_plans where effective_from <= d order by effective_from desc limit 1
$$;

create or replace function sku_cost_on(code text, d date) returns bigint language sql stable as $$
  select unit_cost_cents from sku_costs where sku_code = code and effective_from <= d
  order by effective_from desc limit 1
$$;

create or replace function lender_rate_on(lender uuid, d date) returns numeric language sql stable as $$
  select dealer_fee_rate from lender_rates where lender_id = lender and effective_from <= d
  order by effective_from desc limit 1
$$;

-- Row level security on; only the server (service role) reads and writes for now.
do $$
declare t text;
begin
  foreach t in array array['locations','people','lenders','lender_rates','skus','sku_costs','comp_plans',
                           'import_batches','deals','deal_lines','payments','payouts','audit_log'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
