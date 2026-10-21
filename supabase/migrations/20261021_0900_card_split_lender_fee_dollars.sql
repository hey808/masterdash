-- Ledger columns, 2026-10-21 (Cade):
--   * A card portion joins the split: cash + card + financed = price.
--   * The lender fee is a dollar amount recorded when funding hits (the fee on the
--     lender payment row), not a rate stamped at sale. deals.lender_rate stays for
--     history but nothing reads it.
--   * "Record funding" is a form, logged in form_submissions.

alter table deals add column card_portion_cents bigint not null default 0 check (card_portion_cents >= 0);

alter table deals drop constraint deals_split_matches;
alter table deals add constraint deals_split_matches check (
  cash_portion_cents + card_portion_cents + financed_portion_cents = price_cents or split_exception is not null
);

-- Deals already funded kept their fee as rate x financed. Move that dollar amount onto
-- the largest lender payment so nothing they show changes. Deals with a typed fee
-- (loan_interest_override_cents) keep it. Unfunded deals get their fee at funding.
with funded as (
  select distinct on (p.deal_id) p.id, round(d.financed_portion_cents * d.lender_rate)::bigint as fee
  from payments p
  join deals d on d.id = p.deal_id
  where p.source = 'lender'
    and d.loan_interest_override_cents is null
    and d.lender_rate > 0
    and d.financed_portion_cents > 0
    and not exists (select 1 from payments q where q.deal_id = d.id and q.source = 'lender' and q.fee_cents <> 0)
  order by p.deal_id, p.amount_cents desc, p.id
)
update payments p set fee_cents = f.fee from funded f where p.id = f.id and f.fee > 0;

alter table form_submissions drop constraint if exists form_submissions_kind_check;
alter table form_submissions add constraint form_submissions_kind_check check (kind in ('sale', 'install', 'payout', 'funding'));
