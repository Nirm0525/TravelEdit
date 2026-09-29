-- Módulo: Smart Proposal Builder — tabla base de propuestas.
--
-- Una propuesta es un documento comercial completo (portada, introducción,
-- overview, itinerario día a día, servicios, pricing, travel tips, términos)
-- que una asesora arma para un cliente VIP, opcionalmente ligado a un lead
-- existente. Es un concepto distinto del email de texto libre que ya envía
-- la Edge Function send-proposal (ver leads.proposal_* en
-- 0025_leads_proposal_fields.sql) — esa función y esas columnas de `leads`
-- siguen existiendo tal cual, sin tocarse.
--
-- El contenido estructurado (cover/introduction/overview/days/services/
-- pricing/travelTips/terms) vive en una sola columna `content jsonb`, mismo
-- criterio que `leads.details` (0003) y `site_content.custom_sections`
-- (0014): evita una migración de esquema cada vez que cambia la forma
-- interna de una sección. `content` no se valida en SQL más allá de su tipo
-- — lo escribe siempre el builder admin (staff autenticado), no un
-- formulario público, mismo nivel de confianza que `leads.details`.
--
-- `title` y `cover_image_path` son columnas GENERATED (ver más abajo): son
-- un espejo de solo lectura de content->'cover', nunca un segundo lugar
-- donde ese dato se escribe — existen solo para que el listado admin pueda
-- hacer `select id, title, ... from proposals` sin parsear JSON, sin crear
-- la clase de duplicación fuente-de-verdad que si existe, deliberadamente,
-- para pricing_subtotal/fees/total (ver el trigger recompute_proposal_pricing
-- más abajo: esas sí son columnas normales, pero siempre recalculadas por
-- Postgres, nunca confiadas del cliente).
--
-- NOTA para cuando se construya el modelo Angular de `content` (fuera de
-- esta fase): mantener una sola moneda a nivel de Proposal (columna
-- `currency` de esta tabla) — content.pricing NO debe llevar su propio
-- campo `currency`, ni tampoco cada PricingLine.

-- Supabase instala pgcrypto en el schema `extensions` (no en `public`) por
-- convención en todo proyecto nuevo — las funciones de este módulo que usan
-- crypt()/gen_salt() lo referencian calificado como extensions.crypt(...)
-- (ver 0031/0032) precisamente por esto: con `set search_path = public`,
-- una llamada sin calificar a crypt()/gen_salt() no resuelve si la extensión
-- vive en `extensions`. Este create extension es solo defensivo para un
-- entorno realmente nuevo que no la tenga todavía.
create extension if not exists pgcrypto with schema extensions;

create table proposals (
  id                  uuid primary key default gen_random_uuid(),
  public_token        uuid not null default gen_random_uuid(),
  lead_id             uuid references leads(id) on delete set null,
  status              text not null default 'draft'
                        check (status in ('draft','published','viewed','accepted','expired')),
  client_name         text not null,
  destination_text    text,
  start_date          date,
  end_date            date,
  travelers_count     int,
  advisor_id          uuid references profiles(id),
  currency            text not null default 'USD',

  -- Acceso privado: public_token NUNCA es suficiente por sí solo para leer
  -- `content` — se exige además el código de acceso salvo que
  -- access_required sea false. access_code_hash nunca contiene texto plano
  -- (crypt()/gen_salt('bf'), pgcrypto) y solo se escribe a través de
  -- set_proposal_access_code() (0032_proposals_admin_rpc.sql) — ver el
  -- revoke más abajo, que bloquea escribirla directo desde el cliente.
  access_required     boolean not null default true,
  access_code_hash    text,
  -- Bloqueo GLOBAL por propuesta (no por IP ni por dispositivo): a este
  -- volumen — una propuesta = un cliente conocido, no un formulario público
  -- masivo — un contador por fila alcanza. Ver verify_proposal_access() en
  -- 0031_proposals_public_rpc.sql. Si algún día se necesita throttling por
  -- IP/dispositivo, es una tabla nueva al estilo lead_submission_attempts
  -- (0003_leads.sql), no una extensión de estas dos columnas.
  access_attempts     int not null default 0,
  access_locked_until timestamptz,

  -- Única fuente de verdad del contenido editorial y comercial.
  content             jsonb not null default '{}',

  -- Espejo de solo lectura de content->'cover' — ver nota de cabecera.
  title               text generated always as (content->'cover'->>'title') stored,
  cover_image_path    text generated always as (content->'cover'->>'imagePath') stored,

  -- Derivadas de content->'pricing', recalculadas SIEMPRE por trigger — el
  -- valor que llegue en el INSERT/UPDATE del cliente para estas tres
  -- columnas se descarta. Ver recompute_proposal_pricing() más abajo.
  pricing_subtotal    numeric not null default 0,
  pricing_fees        numeric not null default 0,
  pricing_total       numeric not null default 0,

  terms_accepted      boolean not null default false,
  accepted_at         timestamptz,
  accepted_by_name    text,

  published_at        timestamptz,
  viewed_at           timestamptz,
  expires_at          timestamptz,

  created_by          uuid references profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index idx_proposals_public_token on proposals (public_token);
create index idx_proposals_status on proposals (status);
create index idx_proposals_lead_id on proposals (lead_id);

-- ------------------------------------------------------------------
-- Permisos: mismo criterio que can_manage_leads()/can_manage_content()
-- (0007_roles_permissions.sql) — admin/editor/staff pueden gestionar
-- propuestas (igual alcance que "solicitudes", ya que una propuesta nace de
-- o se dirige a un lead). Solo admin puede borrar (ver policy delete).
-- ------------------------------------------------------------------
create function can_manage_proposals() returns boolean
language sql stable security definer set search_path = public as $$
  select app_user_role() in ('admin', 'editor', 'staff')
$$;

-- Toda función referenciada en una policy RLS necesita EXECUTE explícito
-- para el rol que la evalúa, aunque termine devolviendo false — si no,
-- Postgres no puede planificar la policy y el SELECT falla con 42501 para
-- ese rol (bug real ya pisado tres veces en este proyecto: ver
-- 0012/0022/0023/0028). anon NO recibe este grant: a diferencia de
-- destinations/articles, ninguna policy de `proposals` tiene una rama
-- pública — el acceso del cliente se resuelve siempre vía las funciones RPC
-- de 0031_proposals_public_rpc.sql, nunca leyendo esta tabla directo (mismo
-- criterio ya aplicado a can_manage_leads(), que tampoco se le otorgó a anon
-- porque `leads` no tiene lectura pública).
grant execute on function can_manage_proposals() to authenticated;

alter table proposals enable row level security;

create policy proposals_select on proposals for select using (can_manage_proposals());
create policy proposals_insert on proposals for insert
  with check (can_manage_proposals() and created_by = auth.uid());
create policy proposals_update on proposals for update using (can_manage_proposals());
create policy proposals_delete on proposals for delete using (app_user_role() = 'admin');

-- access_code_hash nunca se escribe directo desde el cliente autenticado —
-- solo set_proposal_access_code() (security definer: corre con el
-- privilegio del owner de la función, no del rol authenticated, así que este
-- revoke no la afecta) puede escribirlo, siempre hasheado. Mismo patrón que
-- "revoke update (long_description) on destinations" en 0002_destinations.sql.
revoke update (access_code_hash) on proposals from authenticated;

create trigger trg_proposals_updated_at
  before update on proposals
  for each row execute function set_updated_at();

-- ------------------------------------------------------------------
-- Pricing: content->'pricing'->'lines' / 'feesLines' es la única fuente de
-- verdad, escrita siempre por la asesora. Estas tres columnas son una caché de
-- lectura para el listado admin y se recalculan SIEMPRE aquí, ignorando
-- cualquier valor que haya llegado en el INSERT/UPDATE para ellas — "no
-- confiar en totales enviados desde Angular" se cumple por construcción, no
-- por convención.
--
-- Asume que 'lines'/'feesLines', cuando existen, son arrays jsonb bien
-- formados de objetos con "quantity"/"unitPrice" numéricos — los escribe el
-- builder admin (staff autenticado), no un formulario público; no se valida
-- estructura más allá de eso, mismo nivel de confianza que el resto de los
-- jsonb de este proyecto (leads.details, site_content.custom_sections).
-- ------------------------------------------------------------------
create function recompute_proposal_pricing() returns trigger
language plpgsql as $$
begin
  new.pricing_subtotal := coalesce((
    select sum((line->>'quantity')::numeric * (line->>'unitPrice')::numeric)
    from jsonb_array_elements(coalesce(new.content->'pricing'->'lines', '[]'::jsonb)) as line
  ), 0);

  new.pricing_fees := coalesce((
    select sum((line->>'quantity')::numeric * (line->>'unitPrice')::numeric)
    from jsonb_array_elements(coalesce(new.content->'pricing'->'feesLines', '[]'::jsonb)) as line
  ), 0);

  new.pricing_total := new.pricing_subtotal + new.pricing_fees;
  return new;
end;
$$;

create trigger trg_proposals_recompute_pricing
  before insert or update on proposals
  for each row execute function recompute_proposal_pricing();
