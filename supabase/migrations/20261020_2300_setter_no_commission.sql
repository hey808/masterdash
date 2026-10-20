-- Setters earn no commission (Cade, 2026-10-20). Applies to every deal,
-- past and future. Payouts already made to setters stay as history; they
-- now read as paid-more-than-earned so they can be squared up.
select set_config('app.actor', 'admin:cade setter earns no commission', true);

update comp_plans set setter_rate = 0 where setter_rate <> 0;
update deals set setter_rate = 0 where setter_rate <> 0;
