-- Two ledger columns that come from the customer agreement:
--   soap                   did the deal include a soap package (yes/no)
--   maintenance_arr_cents  the Annual General Maintenance Plan, as annual recurring revenue ($300/yr when on)
alter table deals add column if not exists soap boolean not null default false;
alter table deals add column if not exists maintenance_arr_cents bigint not null default 0;
alter table deals drop constraint if exists deals_maintenance_arr_check;
alter table deals add constraint deals_maintenance_arr_check check (maintenance_arr_cents >= 0);

-- Deals that already have an agreement take their soap and plan from it (latest one that isn't cancelled).
update deals d set soap = a.soap_package <> 'none', maintenance_arr_cents = case when a.maintenance_plan then 30000 else 0 end
from (select distinct on (deal_id) deal_id, soap_package, maintenance_plan from agreements where deal_id is not null and status <> 'void' order by deal_id, created_at desc) a
where a.deal_id = d.id;
