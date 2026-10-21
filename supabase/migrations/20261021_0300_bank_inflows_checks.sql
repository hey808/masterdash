-- Cade, 2026-10-20: every deposit is revenue, and checks with no payee are commissions paid.

-- Money in: anything not already lender funding counts as customer payments.
update bank_rules set category = 'customer_payments', needs_review = false
 where direction = 'in' and category <> 'lender_funding';
-- The account-verification pennies go both ways; split the rule so deposits land in revenue.
update bank_rules set direction = 'out' where pattern = 'ACCTVERIFY' and direction is null;
insert into bank_rules (match_field, pattern, direction, category, needs_review, priority, created_by)
values ('description', 'ACCTVERIFY', 'in', 'customer_payments', false, 1, 'seed');

-- Checks: commissions paid.
update bank_rules set category = 'commissions', needs_review = false
 where match_field = 'bank_category' and pattern = 'Cash & Checks';
update bank_categories set name = 'Checks (unassigned)' where slug = 'checks';

-- Re-file existing lines that a rule (not a person) categorized.
update bank_transactions set category = 'customer_payments', needs_review = false, rule_id = null
 where category_source = 'rule' and amount_cents > 0 and category not in ('customer_payments', 'lender_funding');
update bank_transactions set category = 'commissions', needs_review = false
 where category_source = 'rule' and category = 'checks';
