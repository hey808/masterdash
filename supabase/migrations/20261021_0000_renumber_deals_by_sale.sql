-- Deal numbers count up from the first sale (Cade, 2026-10-20): #1 is the
-- earliest sale date. New deals keep taking the next number.
select set_config('app.actor', 'admin:cade renumber deals by sale date', true);

update deals set number = number + 1000000;
with ordered as (
  select id, row_number() over (order by sale_date, created_at, number) as n from deals
)
update deals d set number = ordered.n from ordered where d.id = ordered.id;
select setval('deal_number_seq', (select coalesce(max(number), 0) + 1 from deals), false);
