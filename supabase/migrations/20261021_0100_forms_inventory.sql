-- Forms (sales + installer) and per-location inventory with purchase orders.

-- Contact details captured on the sales form.
alter table deals add column if not exists customer_phone text;
alter table deals add column if not exists customer_email text;

-- Every form submission, as submitted, for the record.
create table form_submissions (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('sale', 'install')),
  deal_id      uuid references deals(id) on delete set null,
  submitted_by uuid references people(id),
  payload      jsonb not null,
  created_at   timestamptz not null default now()
);
create index form_submissions_deal_idx on form_submissions (deal_id);

-- Purchase orders, per location.
create sequence po_number_seq start 1;
create table purchase_orders (
  id           uuid primary key default gen_random_uuid(),
  number       bigint not null unique default nextval('po_number_seq'),
  location_id  uuid not null references locations(id),
  vendor       text not null check (length(trim(vendor)) > 0),
  status       text not null default 'ordered' check (status in ('ordered', 'received', 'cancelled')),
  ordered_on   date not null,
  expected_on  date,
  received_on  date,
  note         text,
  created_at   timestamptz not null default now(),
  constraint po_received_dated check (status <> 'received' or received_on is not null)
);
create table purchase_order_lines (
  id              uuid primary key default gen_random_uuid(),
  po_id           uuid not null references purchase_orders(id) on delete cascade,
  sku_code        text not null references skus(code) on update cascade,
  qty             int not null check (qty > 0),
  unit_cost_cents bigint not null check (unit_cost_cents >= 0)
);
create index po_lines_po_idx on purchase_order_lines (po_id);

-- Counts and corrections. A shelf count is stored as the difference from what the books said.
create table inventory_adjustments (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references locations(id),
  sku_code     text not null references skus(code) on update cascade,
  qty_delta    int not null check (qty_delta <> 0),
  reason       text not null check (reason in ('count', 'damaged', 'returned', 'transfer', 'other')),
  adjusted_on  date not null,
  note         text,
  created_at   timestamptz not null default now()
);
create index inventory_adjustments_loc_idx on inventory_adjustments (location_id, sku_code);

do $$
declare t text;
begin
  foreach t in array array['form_submissions','purchase_orders','purchase_order_lines','inventory_adjustments'] loop
    execute format('create trigger %I_audit after insert or update or delete on %I for each row execute function audit_row(''id'')', t, t);
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
