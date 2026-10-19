-- Módulo: Smart Proposal Builder — importación de propuestas desde PDF
-- (The Edit Assistant).
--
-- Qué hace:
--   1) proposals.origin_channel: por qué canal llegó el cliente. Las propuestas
--      que ya tienen lead quedan como 'web'; las demás como 'other'.
--   2) proposals.client_phone: teléfono del cliente cuando no hay lead.
--      (lead_id ya admite null desde 0029 y client_email existe desde 0045.)
--   3) proposal_imports: una fila por PDF subido. La Edge Function
--      import-proposal-pdf escribe aquí lo extraído (`extracted`) y la
--      comparación (`diff`); nunca toca las tablas de la propuesta.
--   4) Bucket privado proposal-imports (solo PDF, máx. 20 MB).
--
-- Alternativas (Opción A/B): viven dentro de proposals.content (jsonb), como
-- campos optionGroup/optionLabel de cada servicio — no hay tabla de elementos
-- a la que agregarle columnas. No requiere cambios de SQL.
--
-- Seguridad: mismo criterio que proposals (0047). Admin y editor ven todo; la
-- Asesora (staff) solo sus importaciones. La asesora solo puede INSERTAR la fila
-- inicial (estado 'uploaded'); status/extracted/diff/error los escribe la
-- service role (Edge Functions), que se salta RLS. Convención de ruta en
-- Storage: <auth.uid()>/<uuid>.pdf.
-- NOTA producción: app_user_role() vive en `private`; todo va calificado.

-- Todo o nada: si algún paso falla, no queda nada aplicado.
begin;

-- ------------------------------------------------------------------
-- proposals: canal de origen y teléfono
-- ------------------------------------------------------------------
alter table public.proposals
  add column if not exists origin_channel text not null default 'other',
  add column if not exists client_phone text;

alter table public.proposals drop constraint if exists proposals_origin_channel_check;
alter table public.proposals
  add constraint proposals_origin_channel_check
  check (origin_channel in ('web', 'whatsapp', 'email', 'phone', 'referral', 'other'));

-- Backfill: lo que ya nació de una solicitud del sitio es 'web'.
update public.proposals set origin_channel = 'web' where lead_id is not null and origin_channel = 'other';

-- ------------------------------------------------------------------
-- proposal_imports
-- ------------------------------------------------------------------
create table public.proposal_imports (
  id          uuid primary key default gen_random_uuid(),
  -- Null hasta que se crea la propuesta (modo 'new'). Si se borra la propuesta,
  -- el registro de la importación se conserva.
  proposal_id uuid references public.proposals(id) on delete set null,
  file_path   text not null,
  mode        text not null check (mode in ('new', 'merge')),
  status      text not null default 'uploaded'
                check (status in ('uploaded', 'processing', 'ready', 'applied', 'failed')),
  extracted   jsonb,
  diff        jsonb,
  error       text,
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  applied_at  timestamptz,
  -- Una importación 'merge' siempre apunta a una propuesta existente.
  constraint proposal_imports_merge_needs_proposal
    check (mode = 'new' or proposal_id is not null)
);

create index idx_proposal_imports_proposal_id on public.proposal_imports (proposal_id);
create index idx_proposal_imports_created_by on public.proposal_imports (created_by);

alter table public.proposal_imports enable row level security;

create policy proposal_imports_select on public.proposal_imports for select
  using (public.can_manage_proposals() and public.is_own_or_full(created_by));

-- WITH CHECK: la fila nace a nombre de quien sube, en estado 'uploaded', sin
-- resultados, y — si hay propuesta (modo 'merge') — sobre una que ese usuario
-- puede EDITAR: mismo criterio que proposals_update (can_manage_proposals() y
-- is_own_or_full(advisor_id)), no solo verla. El archivo debe estar en la
-- carpeta del propio usuario, la misma que exige la policy del bucket.
create policy proposal_imports_insert on public.proposal_imports for insert
  with check (
    public.can_manage_proposals()
    and created_by = auth.uid()
    and status = 'uploaded'
    and extracted is null and diff is null and error is null and applied_at is null
    and (
      proposal_id is null
      or exists (
        select 1 from public.proposals p
        where p.id = proposal_id and public.is_own_or_full(p.advisor_id)
      )
    )
    -- Ruta exacta <auth.uid()>/<uuid>.pdf: sin subcarpetas ni segmentos "..".
    and file_path ~ ('^' || auth.uid()::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$')
  );

-- Sin policy de UPDATE/DELETE para authenticated: solo la service role cambia el
-- estado o borra. Privilegios de tabla acordes (ver 0048).
revoke all on public.proposal_imports from anon, authenticated;
grant select on public.proposal_imports to authenticated;
grant insert (proposal_id, file_path, mode, created_by) on public.proposal_imports to authenticated;

-- ------------------------------------------------------------------
-- Storage: bucket privado proposal-imports
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proposal-imports', 'proposal-imports', false, 20971520, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = 20971520, allowed_mime_types = array['application/pdf'];

-- Admin/editor: todo el bucket. Asesora: solo su carpeta <auth.uid()>/.
-- Sin policy de UPDATE/DELETE: un PDF subido no se reemplaza ni se borra desde el cliente.
create policy proposal_imports_storage_read on storage.objects for select
  using (
    bucket_id = 'proposal-imports'
    and public.can_manage_proposals()
    and (private.app_user_role() <> 'staff' or (storage.foldername(name))[1] = auth.uid()::text)
  );

create policy proposal_imports_storage_insert on storage.objects for insert
  with check (
    bucket_id = 'proposal-imports'
    and public.can_manage_proposals()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;
