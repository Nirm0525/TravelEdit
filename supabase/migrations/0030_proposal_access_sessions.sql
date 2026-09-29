-- Módulo: Smart Proposal Builder — sesiones de acceso público.
--
-- public_token nunca es, por sí solo, suficiente para leer el contenido de
-- una propuesta (ver 0029_proposals.sql: access_required/access_code_hash).
-- Cuando un cliente valida token + código correctamente
-- (verify_proposal_access(), en 0031_proposals_public_rpc.sql), se le emite
-- una fila aquí: su `id` (uuid aleatorio de 122 bits) ES el session token
-- que el sitio público guarda en sessionStorage y reenvía en cada llamada
-- posterior (get_proposal_content()/accept_proposal()) para no volver a
-- pedir el código durante esa misma visita. No hay JWT ni secreto
-- compartido de por medio: el "secreto" es simplemente esta fila aleatoria
-- server-side, que expira sola y se puede revocar borrándola.
--
-- Sin políticas RLS, mismo patrón que lead_submission_attempts
-- (0003_leads.sql): ni anon ni authenticated la tocan directo — RLS
-- habilitada sin ninguna policy deniega todo por defecto salvo al owner de
-- la tabla. Solo la tocan las funciones security definer de 0031/0032, que
-- corren con el privilegio del owner de la función (el rol que aplicó las
-- migraciones), no del rol que las invoca.
create table proposal_access_sessions (
  id            uuid primary key default gen_random_uuid(),
  proposal_id   uuid not null references proposals(id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '2 hours',
  last_seen_at  timestamptz
);

alter table proposal_access_sessions enable row level security;

create index idx_proposal_access_sessions_proposal_id on proposal_access_sessions (proposal_id);
create index idx_proposal_access_sessions_expires_at on proposal_access_sessions (expires_at);
