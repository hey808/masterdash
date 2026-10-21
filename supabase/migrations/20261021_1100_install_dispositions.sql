-- Installers disposition their install appointments too: completed (the install
-- form, linked to the deal), rescheduled, or incomplete (couldn't finish).
alter table appointment_dispositions add column if not exists kind text not null default 'sales';
alter table appointment_dispositions drop constraint if exists appointment_dispositions_kind_check;
alter table appointment_dispositions add constraint appointment_dispositions_kind_check check (kind in ('sales', 'install'));
alter table appointment_dispositions drop constraint if exists appointment_dispositions_outcome_check;
alter table appointment_dispositions add constraint appointment_dispositions_outcome_check
  check (outcome in ('declined', 'rescheduled', 'closed', 'completed', 'incomplete'));
