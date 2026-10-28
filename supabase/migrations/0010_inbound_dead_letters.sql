-- Prompt 4: the inbound processor dead-letters events it could not process (0009 is committed, so this is
-- a new migration). Payload carries ids only (eventId), never raw content.
alter table public.dead_letters drop constraint dead_letters_source_check;
alter table public.dead_letters add constraint dead_letters_source_check check (source in ('followup_actions', 'inbound_events'));

-- Task reasons are codes; provider codes carry digits (dsn_5_1_1, wa_131026).
alter table public.tasks drop constraint tasks_reason_check;
alter table public.tasks add constraint tasks_reason_check check (reason is null or reason ~ '^[a-z0-9_]{1,60}$');
