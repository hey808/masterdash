-- Mission Control projected a card fee on a few deals before any payment came in,
-- and the import stored it as a fixed card-fee override. Card fees come only from
-- actual card payments, so clear those projections (3 deals, none with a payment).
update deals
set card_fee_override_cents = null,
    override_reason = nullif(trim(both '; ' from regexp_replace(override_reason, '(Imported from Mission Control; )?expected card fee of \$[0-9,.]+ before any card payment;?', '')), ''),
    version = version + 1,
    updated_at = now()
where card_fee_override_cents is not null
  and override_reason ilike '%expected card fee%before any card payment%'
  and not exists (select 1 from payments p where p.deal_id = deals.id and p.fee_cents > 0);
