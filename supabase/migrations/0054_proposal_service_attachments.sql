-- Módulo: Smart Proposal Builder — documentos adjuntos por servicio del itinerario (boleto, voucher,
-- confirmación…). Los archivos viven en un bucket PRIVADO; aquí solo la metadata.
--
-- Diseño (ver las Edge Functions proposal-service-files y proposal-documents):
--  - NINGUNA policy sobre storage.objects para este bucket: anon y authenticated no pueden listar, leer ni
--    escribir. Toda operación de Storage la hace una Edge Function con service_role después de validar al usuario
--    (admin: JWT + can_manage_proposals() + alcance de la propuesta) o la sesión del cliente (token + sessionToken).
--  - La tabla solo se LEE directamente desde el admin (RLS: can_manage_proposals() y la propuesta visible para el
--    usuario, lo que respeta el alcance de la Asesora). Escribir (insert/update/delete) es solo de service_role.
--  - El cliente (anon) no tiene ningún privilegio sobre la tabla; sus documentos visibles los entrega la Edge.
--  - No se crea ninguna función SECURITY DEFINER: los triggers son SECURITY INVOKER y se disparan solo con
--    inserciones/actualizaciones de service_role.
--  - service_id vive dentro de proposals.content, así que no hay FK: un trigger comprueba al insertar (o al cambiar
--    proposal_id/service_id) que el servicio exista en el contenido de ESA propuesta (mismo criterio que
--    set_proposal_service_choice, 0043) y que no se pase de 10 archivos por servicio.
--
-- Archivos huérfanos (subidos con URL firmada pero nunca finalizados, o que quedaron tras un reemplazo/borrado
-- parcial): NO se necesita metadata extra ni tabla temporal. La ruta <proposal_id>/<service_id>/<uuid>.<ext> ya dice a qué
-- propuesta y servicio iban, y storage.objects guarda created_at. Un objeto es huérfano si ninguna fila de esta tabla lo
-- apunta; para no tocar nunca una subida en curso (la URL firmada vive 2 h) se exige una antigüedad de 30 días, salvo si
-- su propuesta ya no existe. Consulta de SOLO LECTURA para listarlos (la limpieza real es una fase posterior):
--
--   select o.name, o.created_at, (o.metadata ->> 'size')::bigint as size,
--          not exists (select 1 from public.proposals p where p.id::text = split_part(o.name, '/', 1)) as proposal_gone
--     from storage.objects o
--    where o.bucket_id = 'proposal-service-files'
--      and not exists (select 1 from public.proposal_service_attachments a where a.storage_path = o.name)
--      and (o.created_at < now() - interval '30 days'
--           or not exists (select 1 from public.proposals p where p.id::text = split_part(o.name, '/', 1)));
--
-- Aplicar con: supabase db query --linked -f supabase/migrations/0054_proposal_service_attachments.sql
-- (las migraciones de este proyecto se aplican a mano, no con db push).
-- Verificar (solo lectura, tras aplicarla):
--   supabase db query --linked -f supabase/migration-scripts/0054_proposal_service_attachments_verify.sql
-- Reversión (destructiva; fuera de supabase/migrations a propósito):
--   supabase db query --linked -f supabase/migration-scripts/0054_proposal_service_attachments_rollback.sql
begin;

create table public.proposal_service_attachments (
  id                uuid primary key default gen_random_uuid(),
  proposal_id       uuid not null references public.proposals(id) on delete cascade,
  service_id        text not null,
  -- Nombre original, solo para mostrar (nunca forma parte de la ruta de Storage).
  file_name         text not null,
  -- <proposal_id>/<service_id>/<uuid>.<ext>, generado por el servidor.
  storage_path      text not null,
  mime_type         text not null,
  file_size         bigint not null,
  -- Seguridad por defecto: un documento nuevo es interno hasta que la asesora lo marque como visible.
  visible_to_client boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id) on delete set null,

  constraint psa_service_id_not_blank check (btrim(service_id) <> '' and char_length(service_id) <= 64),
  constraint psa_file_name_not_blank check (btrim(file_name) <> '' and char_length(file_name) <= 200),
  constraint psa_storage_path_unique unique (storage_path),
  constraint psa_mime_type_allowed check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  constraint psa_file_size_range check (file_size >= 0 and file_size <= 10485760)
);

create index idx_psa_proposal_service on public.proposal_service_attachments (proposal_id, service_id);
-- Cubre la FK created_by (evita el aviso "unindexed foreign key" del Security/Performance Advisor).
create index idx_psa_created_by on public.proposal_service_attachments (created_by);

-- updated_at: la misma función que usan las demás tablas del módulo (0029).
create trigger trg_psa_updated_at
  before update on public.proposal_service_attachments
  for each row execute function public.set_updated_at();

-- El servicio debe existir en el contenido de esa propuesta y no se superan 10 archivos por servicio.
-- SECURITY INVOKER con search_path vacío: solo lo ejecuta service_role al insertar/actualizar.
create or replace function public.enforce_service_attachment() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1
    from public.proposals p,
         jsonb_array_elements(case when jsonb_typeof(p.content -> 'days') = 'array' then p.content -> 'days' else '[]'::jsonb end) as d,
         jsonb_array_elements(case when jsonb_typeof(d -> 'services') = 'array' then d -> 'services' else '[]'::jsonb end) as sv
    where p.id = new.proposal_id
      and sv ->> 'id' = new.service_id
  ) then
    raise exception 'service_not_found' using errcode = 'P0002';
  end if;

  -- Serializa las altas concurrentes del mismo servicio para que el tope se cumpla de verdad.
  perform pg_advisory_xact_lock(hashtextextended(new.proposal_id::text || ':' || new.service_id, 0));
  if tg_op = 'INSERT'
     and (select count(*) from public.proposal_service_attachments a
           where a.proposal_id = new.proposal_id and a.service_id = new.service_id) >= 10 then
    raise exception 'too_many_files' using errcode = '54000';
  end if;
  return new;
end;
$$;

-- Una función de trigger no debe poder invocarse por nadie: sin EXECUTE para PUBLIC, anon ni authenticated (el trigger se
-- dispara igual: Postgres comprueba EXECUTE al crear el trigger, no al dispararlo).
revoke execute on function public.enforce_service_attachment() from public, anon, authenticated;

create trigger trg_psa_enforce
  before insert or update of proposal_id, service_id on public.proposal_service_attachments
  for each row execute function public.enforce_service_attachment();

-- Privilegios: nada para PUBLIC ni anon; el admin solo lee; service_role hace todo.
revoke all on table public.proposal_service_attachments from public, anon, authenticated;
grant select on table public.proposal_service_attachments to authenticated;
grant all on table public.proposal_service_attachments to service_role;

alter table public.proposal_service_attachments enable row level security;

-- Lectura admin: quien puede gestionar propuestas Y ve esa propuesta. El exists se evalúa con la RLS de proposals
-- (0047), así que una Asesora solo lee los documentos de sus propias propuestas.
create policy psa_select on public.proposal_service_attachments for select to authenticated
  using (
    public.can_manage_proposals()
    and exists (select 1 from public.proposals p where p.id = proposal_id)
  );

-- Bucket privado. Sin policies sobre storage.objects: solo service_role (Edge Functions) lo toca.
-- file_size_limit y allowed_mime_types los aplica Storage también en la subida con URL firmada.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proposal-service-files', 'proposal-service-files', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = 10485760,
      allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

commit;
