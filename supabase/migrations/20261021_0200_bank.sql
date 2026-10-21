-- Bank activity: imported statement lines, categorized, feeding Home and Reports.
--
-- Money is signed cents: + into the account, − out of it.
-- Category kinds decide where a line lands on the statements:
--   income        customer / lender money in (the ledger already books the revenue)
--   other_income  money in that isn't from a deal
--   ledger        a cost the ledger already books on the deal (equipment, commissions,
--                 installer pay); counted in cash flow, not again on the income statement
--   cogs          job costs the ledger doesn't know about (install supplies)
--   opex          operating expenses
--   financing     loans, owner money in and out
--   transfer      between our own accounts
--   uncategorized not decided yet

create table bank_accounts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  last4       text not null unique check (last4 ~ '^[0-9]{4}$'),
  created_at  timestamptz not null default now()
);

create table bank_categories (
  slug  text primary key check (slug ~ '^[a-z_]+$'),
  name  text not null,
  kind  text not null check (kind in ('income','other_income','ledger','cogs','opex','financing','transfer','uncategorized')),
  sort  int not null
);

create table bank_imports (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references bank_accounts(id),
  file_name   text not null,
  row_count   int not null,
  new_count   int not null,
  first_on    date,
  last_on     date,
  created_at  timestamptz not null default now()
);

create table bank_rules (
  id          uuid primary key default gen_random_uuid(),
  match_field text not null default 'description' check (match_field in ('description','bank_category')),
  pattern     text not null check (length(trim(pattern)) > 0), -- case-insensitive substring
  direction   text check (direction in ('in','out')),           -- null = either
  category    text not null references bank_categories(slug) on update cascade,
  needs_review boolean not null default false,
  priority    int not null default 100,                          -- lower wins
  created_by  text not null default 'seed',
  created_at  timestamptz not null default now()
);

create table bank_transactions (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references bank_accounts(id),
  import_id       uuid references bank_imports(id) on delete set null,
  fingerprint     text not null,
  posted_on       date not null,
  txn_on          date,
  txn_type        text,
  check_no        text,
  description     text not null,
  merchant        text,
  bank_category   text,
  amount_cents    bigint not null,
  balance_cents   bigint,             -- the bank's end-of-posted-day balance
  category        text not null default 'uncategorized' references bank_categories(slug) on update cascade,
  category_source text not null default 'rule' check (category_source in ('rule','user')),
  rule_id         uuid references bank_rules(id) on delete set null,
  needs_review    boolean not null default true,
  note            text,
  created_at      timestamptz not null default now(),
  unique (account_id, fingerprint)
);
create index bank_transactions_posted_idx on bank_transactions (account_id, posted_on);
create index bank_transactions_category_idx on bank_transactions (category);

insert into bank_categories (slug, name, kind, sort) values
  ('customer_payments',  'Customer payments',                 'income',        10),
  ('lender_funding',     'Lender funding',                    'income',        20),
  ('other_income',       'Other income',                      'other_income',  30),
  ('inventory',          'Equipment and inventory',           'ledger',        40),
  ('commissions',        'Commissions paid',                  'ledger',        50),
  ('installer_pay',      'Installer pay',                     'ledger',        60),
  ('install_supplies',   'Install supplies',                  'cogs',          70),
  ('advertising',        'Advertising and lead gen',          'opex',          80),
  ('payroll',            'Payroll and office staff',          'opex',          90),
  ('contract_labor',     'Contract labor',                    'opex',         100),
  ('software',           'Software and subscriptions',        'opex',         110),
  ('phone',              'Phone and internet',                'opex',         120),
  ('vehicle',            'Vehicle and fuel',                  'opex',         130),
  ('travel',             'Travel',                            'opex',         140),
  ('meals',              'Meals',                             'opex',         150),
  ('office',             'Office, shipping and supplies',     'opex',         160),
  ('utilities',          'Utilities',                         'opex',         170),
  ('professional',       'Professional services',             'opex',         180),
  ('bank_fees',          'Bank and card fees',                'opex',         190),
  ('card_payments',      'Credit card payments (charges not itemized)', 'opex', 200),
  ('checks',             'Checks (payee unknown)',            'opex',         210),
  ('other_expense',      'Other expenses',                    'opex',         220),
  ('loan_payments',      'Loan and financing payments',       'financing',    230),
  ('owner_contributions','Owner contributions',               'financing',    240),
  ('owner_draws',        'Owner draws and personal',          'financing',    250),
  ('transfers',          'Transfers between our accounts',    'transfer',     260),
  ('uncategorized',      'Uncategorized',                     'uncategorized',270);

-- Starting rules, from the Aug to Oct 2026 Truist statements. Guesses carry needs_review.
insert into bank_rules (match_field, pattern, direction, category, needs_review, priority) values
  -- money in
  ('description', 'MERCH FUND ISPC',             'in',  'lender_funding',      false, 10),
  ('description', 'HOUSECALL PRO CLEAR FLOW',    'in',  'customer_payments',   false, 10),
  ('description', 'MOBILE DEPOSIT',              'in',  'customer_payments',   false, 20),
  ('description', 'COUNTER DEPOSIT',             'in',  'customer_payments',   false, 20),
  ('description', 'DEPOSIT',                     'in',  'customer_payments',   false, 30),
  ('description', 'TRUIST ONLINE TRANSFER',      'in',  'transfers',           true,  20),
  ('description', 'LANDVEST',                    'in',  'other_income',        true,  20),
  -- moving money between accounts
  ('description', 'TRANSFER TO CHECKING',        'out', 'transfers',           true,  10),
  ('description', 'TO ****9623',                 'out', 'transfers',           true,  10),
  -- fees first so they beat the vendor name in the same line
  ('description', 'INT''L SERVICE ASSESSMENT FEE', null, 'bank_fees',          false,  5),
  ('description', 'SERVICE CHARGES',             'out', 'bank_fees',           false,  5),
  ('description', 'DELUXE CHECK',                'out', 'bank_fees',           false,  5),
  ('description', 'ACCTVERIFY',                  null,  'bank_fees',           false,  1),
  -- equipment
  ('description', 'AQUONYX',                     'out', 'inventory',           false, 10),
  ('description', 'EXCALIBUR WATER',             'out', 'inventory',           false, 10),
  ('description', 'PURE & GENTLE',               'out', 'inventory',           true,  10),
  ('description', 'CHARGER - BRANCH',            'out', 'inventory',           true,  10),
  ('description', 'WET INTERNATIONAL',           'out', 'inventory',           true,  10),
  -- people
  ('description', 'Brock2 PAYMENT ID',           'out', 'commissions',         false, 10),
  ('description', 'Adam PAYMENT ID',             'out', 'commissions',         false, 10),
  ('description', 'CASH APP*MICHAEL',            'out', 'commissions',         true,  10),
  ('description', 'Angel Meija',                 'out', 'installer_pay',       false, 10),
  ('description', 'Annie Mcpherson',             'out', 'payroll',             true,  10),
  ('description', 'Jake PAYMENT ID',             'out', 'contract_labor',      true,  10),
  ('description', 'Thomas Phillios',             'out', 'contract_labor',      true,  10),
  ('description', 'CASH APP*THOMAS',             'out', 'contract_labor',      true,  10),
  ('description', 'Ron Scheckyls',               'out', 'contract_labor',      true,  10),
  ('description', 'CASH APP*NATHAN',             'out', 'contract_labor',      true,  10),
  ('description', 'CASH APP*DOMINIC',            'out', 'contract_labor',      true,  10),
  ('description', 'CURTIS DAVIS',                'out', 'contract_labor',      true,  10),
  ('description', 'Joe Dooley',                  'out', 'owner_draws',         true,  10),
  ('description', 'Randy McPherson',             'out', 'owner_draws',         true,  10),
  ('description', 'CASH APP*AVA',                'out', 'owner_draws',         true,  10),
  ('description', 'CASH APP*BENJAMIN',           'out', 'owner_draws',         true,  10),
  -- debt and cards
  ('description', 'APPLECARD',                   'out', 'card_payments',       false, 10),
  ('description', 'AMERICAN EXPRESS',            'out', 'card_payments',       false, 10),
  ('description', 'AMEX',                        'out', 'card_payments',       false, 15),
  ('description', 'CHASE CREDIT CRD',            'out', 'card_payments',       false, 10),
  ('description', 'MBFS',                        'out', 'loan_payments',       false, 10),
  ('description', 'INTUIT FINANCING',            'out', 'loan_payments',       false, 10),
  ('description', 'SMARTPAY',                    'out', 'loan_payments',       true,  10),
  ('description', 'PATELCO',                     'out', 'loan_payments',       true,  10),
  -- marketing
  ('description', 'FACEBK',                      'out', 'advertising',         false, 10),
  ('description', 'THE LEVEREDGE',               'out', 'advertising',         true,  10),
  -- software and phone
  ('description', 'HOUSECALL PRO',               'out', 'software',            false, 20),
  ('description', 'QBOOKS',                      'out', 'software',            false, 20),
  ('description', 'QUICKBOOKS',                  'out', 'software',            false, 20),
  ('description', 'ZAPIER',                      'out', 'software',            false, 20),
  ('description', 'GODADDY',                     'out', 'software',            false, 20),
  ('description', 'OPENAI',                      'out', 'software',            false, 20),
  ('description', 'FIELDY',                      'out', 'software',            false, 20),
  ('description', 'TURBOSCRIBE',                 'out', 'software',            false, 20),
  ('description', 'ARTLIST',                     'out', 'software',            false, 20),
  ('description', 'TBESTPDF',                    'out', 'software',            false, 20),
  ('description', 'SQUARESPACE',                 'out', 'software',            false, 20),
  ('description', 'VERIZON',                     'out', 'phone',               false, 20),
  ('description', 'INTUIT',                      'in',  'software',            false, 20),
  ('description', 'THE UPS STORE',               'out', 'office',              false, 20),
  -- install supplies
  ('description', 'LOWE''S',                     'out', 'install_supplies',    false, 20),
  ('description', 'HOME DEPOT',                  'out', 'install_supplies',    false, 20),
  ('description', 'HOMEDEPOT',                   'out', 'install_supplies',    false, 20),
  ('description', 'HARDWARE',                    'out', 'install_supplies',    false, 25),
  ('description', 'ACE HARD',                    'out', 'install_supplies',    false, 20),
  ('description', 'HDWE',                        'out', 'install_supplies',    false, 25),
  ('description', 'LUMBER EXPRESS',              'out', 'install_supplies',    false, 20),
  ('description', 'CAROLINA PLUMBING',           'out', 'install_supplies',    false, 20),
  ('description', 'TRUE VALUE',                  'out', 'install_supplies',    false, 20),
  ('description', 'SIMPSON LAKE CITY',           'out', 'install_supplies',    true,  20),
  -- personal-looking
  ('description', 'CHAPMAN HIGH',                'out', 'owner_draws',         true,  20),
  ('description', 'GREAT CLIPS',                 'out', 'owner_draws',         true,  20),
  ('description', 'GRAYCLIFF CIGAR',             'out', 'owner_draws',         true,  20),
  ('description', 'CSC SERVICEWO',               'out', 'owner_draws',         true,  20),
  ('description', 'STITCHMASTER',                'out', 'owner_draws',         true,  20),
  -- fall back on the bank's own category
  ('bank_category', 'Food & Catering',               'out', 'meals',          false, 60),
  ('bank_category', 'Travel Expenses',               'out', 'travel',         false, 60),
  ('bank_category', 'Vehicle Expenses',              'out', 'vehicle',        false, 60),
  ('bank_category', 'Utilities',                     'out', 'utilities',      false, 60),
  ('bank_category', 'Taxes & Fees',                  'out', 'bank_fees',      false, 60),
  ('bank_category', 'Cash & Checks',                 'out', 'checks',         true,  60),
  ('bank_category', 'Office Supplies & Equipment',   'out', 'office',         true,  70),
  ('bank_category', 'Professional & Legal Services', 'out', 'professional',   true,  70),
  ('bank_category', 'Wellness & Welfare',            'out', 'owner_draws',    true,  70),
  ('bank_category', 'Loan & Mortgages',              'out', 'loan_payments',  true,  70);

do $$
declare t text;
begin
  foreach t in array array['bank_accounts','bank_imports','bank_rules','bank_transactions'] loop
    execute format('create trigger %I_audit after insert or update or delete on %I for each row execute function audit_row(''id'')', t, t);
    execute format('alter table %I enable row level security', t);
  end loop;
  execute 'alter table bank_categories enable row level security';
end $$;

