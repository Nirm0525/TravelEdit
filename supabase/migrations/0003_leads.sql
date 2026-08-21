-- Módulo: solicitudes (leads)

create table leads (
  id                         uuid primary key default gen_random_uuid(),
  name                       text not null,
  email                      text not null,
  phone                      text,
  destination_interest_id    uuid references destinations(id),
  destination_interest_text  text,
  origin                     text not null default 'formulario_web'
                               check (origin in ('formulario_web','whatsapp','instagram','referido','email','otro')),
  message                    text,
  -- respuestas del formulario "Let's start your Edit" (acompañantes, fechas,
  -- estilo, presupuesto, etc.) — se guardan tal cual, tipadas del lado de
  -- Angular (LeadTripDetails), no con columnas/checks por cada campo.
  details                    jsonb not null default '{}',
  status                     text not null default 'nueva'
                               check (status in ('nueva','contactada','propuesta_enviada','cerrada_ganada','cerrada_perdida')),
  assigned_to                uuid references profiles(id),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create table lead_notes (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references leads(id) on delete cascade,
  author_id   uuid not null references profiles(id),
  body        text not null,
  created_at  timestamptz not null default now()
);
-- sin update/delete: historial inmutable por diseño.

-- Rate-limit para submit-lead. Sin políticas: ni anon ni authenticated la
-- tocan, solo la Edge Function con service role (que sí bypassa RLS).
create table lead_submission_attempts (
  id          uuid primary key default gen_random_uuid(),
  ip_hash     text not null,
  created_at  timestamptz not null default now()
);

alter table leads enable row level security;
alter table lead_notes enable row level security;
alter table lead_submission_attempts enable row level security;

create policy leads_select on leads for select using (is_staff());
create policy leads_update on leads for update using (is_staff());
create policy leads_delete on leads for delete using (app_user_role() = 'admin');
-- sin policy de insert: el formulario público llama a la Edge Function
-- submit-lead, que valida captcha, aplica rate-limit, y hace el insert ella
-- misma fijando status='nueva' y assigned_to=null — el cliente nunca escribe
-- esos campos directo, ni siquiera si quisiera.

create policy lead_notes_select on lead_notes for select using (is_staff());
create policy lead_notes_insert on lead_notes for insert with check (is_staff() and author_id = auth.uid());

create trigger trg_leads_updated_at before update on leads for each row execute function set_updated_at();

create index idx_leads_status_created on leads (status, created_at desc);
create index idx_lead_notes_lead_id on lead_notes (lead_id);
create index idx_lead_submission_attempts on lead_submission_attempts (ip_hash, created_at desc);
