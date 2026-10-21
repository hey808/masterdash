-- Customer agreements: the contract a rep prepares and the customer signs
-- electronically. Once sent, the system, price and payment are locked; the
-- customer can only correct contact details, initial and sign. A signed
-- agreement never changes: it carries the terms text it was signed under and
-- an audit trail (when, from where, which browser, a hash of what was signed).
create table if not exists agreements (
  id                  uuid primary key default gen_random_uuid(),
  number              text not null unique,                 -- short code shown on the document, e.g. K98GJAA4
  token               text not null unique,                 -- secret for the customer's signing link
  status              text not null default 'sent' check (status in ('sent', 'signed', 'void')),
  deal_id             uuid references deals(id) on delete set null,
  appointment_id      text,
  location_id         uuid references locations(id),
  rep_id              uuid references people(id),

  first_name          text not null,
  last_name           text not null,
  address             text,
  unit                text,
  city                text,
  state               text,
  zip                 text,
  phone               text,
  phone2              text,
  email               text,

  hardness            text,
  systems             text[] not null default '{}',
  equipment           text[] not null default '{}',         -- line items shown on the agreement
  soap_package        text not null default 'none' check (soap_package in ('none', 'basic', 'standard', 'premium')),
  maintenance_plan    boolean not null default false,
  price_cents         bigint not null check (price_cents > 0),
  financed_cents      bigint not null default 0 check (financed_cents >= 0),
  lender              text,
  deposit_cents       bigint not null default 0 check (deposit_cents >= 0),
  deposit_method      text,
  install_date        date,
  notes               text,
  installer_notes     text,
  rep_initials        text,

  terms_version       text not null,
  terms_text          text not null,

  customer_initials   text,
  signature_png       text,                                  -- data:image/png;base64,...
  signed_name         text,
  signed_at           timestamptz,
  signed_ip           text,
  signed_user_agent   text,
  signed_hash         text,                                  -- sha256 of the agreement content as signed
  voided_at           timestamptz,
  void_reason         text,

  created_by          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint agreements_signed_complete check (status <> 'signed' or (signature_png is not null and signed_at is not null and customer_initials is not null))
);
create index if not exists agreements_deal_idx on agreements (deal_id);
create index if not exists agreements_rep_idx on agreements (rep_id, created_at desc);

-- No generic audit trigger: it would copy the signing token and signature image into
-- audit_log. The row carries its own trail (created_by, signed_at/ip/user agent/hash).
alter table agreements enable row level security;
