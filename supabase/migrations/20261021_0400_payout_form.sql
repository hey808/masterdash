-- Payout form submissions (one payment to one person, split across their deals).
alter table form_submissions drop constraint if exists form_submissions_kind_check;
alter table form_submissions add constraint form_submissions_kind_check check (kind in ('sale', 'install', 'payout'));
