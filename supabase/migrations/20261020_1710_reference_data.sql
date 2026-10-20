-- Reference data as of 2026-10-20. Sources noted per block.

-- Locations. The four new markets start inactive until they open.
insert into locations (slug, name, state, active) values
  ('wilmington',   'Wilmington',   'NC', true),
  ('myrtle-beach', 'Myrtle Beach', 'SC', true),
  ('greenville',   'Greenville',   'SC', false),
  ('columbia',     'Columbia',     'SC', false),
  ('charleston',   'Charleston',   'SC', false),
  ('charlotte',    'Charlotte',    'NC', false);

-- Lenders. Dealer fee rates per the Mission Control ledger (10% standard).
insert into lenders (name, in_house) values
  ('ISPC', false),
  ('House lender', true),
  ('Foundation', false);
insert into lender_rates (lender_id, effective_from, dealer_fee_rate)
select id, date '2026-07-01', 0.10 from lenders;

-- SKUs and cost history. Costs from Mission Control's price book and the
-- Aquonyx dealer price list (MC migration 20261019_0200_aquonyx_costs).
insert into skus (code, name, category) values
  ('CHLOR-A-SOFT-SYS', 'Aquonyx Diamond filter/softener combo', 'softener'),
  ('CS',               'Chlorosoft (legacy code)',              'softener'),
  ('CS-30',            'Chlorosoft 30,000',                     'softener'),
  ('CS-45',            'Chlorosoft 45,000',                     'softener'),
  ('PWF',              'Premium whole-home filter',             'filter'),
  ('RO',               'Reverse osmosis (4 stage)',             'ro'),
  ('UV',               'UV light',                              'uv'),
  ('WELL',             'Well system',                           'well'),
  ('WH',               'Water heater',                          'other');

insert into sku_costs (sku_code, effective_from, unit_cost_cents, note) values
  ('CHLOR-A-SOFT-SYS', '2026-07-01',  85000, 'Aquonyx DIA-1054'),
  ('CS',               '2026-07-01', 129900, null),
  ('CS-30',            '2026-07-01',  69400, null),
  ('CS-45',            '2026-07-01',  95000, null),
  ('PWF',              '2026-07-01',  65000, null),
  ('PWF',              '2026-10-19',  62500, 'Aquonyx BD-10'),
  ('RO',               '2026-07-01',  30000, null),
  ('RO',               '2026-10-19',  29700, 'Aquonyx CC-4S-WCF'),
  ('UV',               '2026-07-01',  42000, null),
  ('WELL',             '2026-07-01', 229900, null),
  ('WH',               '2026-07-01',  90000, null);

-- Comp plan (Mission Control DEFAULT_COMMISSION_RULES). The $250 admin fee
-- applies to deals sold on or after 2026-09-10.
insert into comp_plans (effective_from, tier_threshold_cents, rate_at_or_above, rate_below,
                        manager_rate, setter_rate, canvasser_rate, admin_fee_cents, card_fee_rate, note) values
  ('2026-07-01', 749500, 0.15, 0.10, 0.03, 0.01, 0.01,     0, 0.0299, 'Launch plan'),
  ('2026-09-10', 749500, 0.15, 0.10, 0.03, 0.01, 0.01, 25000, 0.0299, '$250 admin fee added');
