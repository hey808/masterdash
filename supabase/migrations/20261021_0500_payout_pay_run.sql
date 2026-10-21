-- Which Friday pay run a payout belongs to. Set by the payout form and the pay run screen;
-- older payouts leave it null and fall back to their date (Friday through the next Thursday).
alter table payouts add column if not exists pay_run date;
alter table payouts drop constraint if exists payouts_pay_run_friday;
alter table payouts add constraint payouts_pay_run_friday check (pay_run is null or extract(isodow from pay_run) = 5);
