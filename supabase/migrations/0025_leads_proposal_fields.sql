-- Campos de "propuesta enviada" en leads — ya existen en producción (se
-- agregaron directo en el dashboard antes de escribir esta migración). Este
-- archivo solo documenta ese esquema para que quede en el historial de
-- migraciones y cualquier entorno nuevo (`supabase db reset`, un fork, etc.)
-- termine con la misma estructura. Todo el DDL es defensivo (`IF NOT
-- EXISTS` / chequeo de pg_constraint) para que correrlo otra vez contra la
-- base real, que ya tiene estas columnas, sea un no-op seguro.

alter table public.leads
  add column if not exists proposal_subject text,
  add column if not exists proposal_message text,
  add column if not exists proposal_sent_at timestamptz,
  add column if not exists proposal_sent_by uuid,
  add column if not exists proposal_email_status text,
  add column if not exists proposal_email_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leads_proposal_sent_by_fkey'
  ) then
    alter table public.leads
      add constraint leads_proposal_sent_by_fkey foreign key (proposal_sent_by) references public.profiles(id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leads_proposal_email_status_check'
  ) then
    alter table public.leads
      add constraint leads_proposal_email_status_check
      check (proposal_email_status = any (array['pending', 'sent', 'failed']));
  end if;
end $$;
