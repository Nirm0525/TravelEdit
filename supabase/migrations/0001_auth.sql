-- Módulo: autenticación
-- Perfiles de staff, roles, y las funciones/políticas RLS que dependen de ellos.
-- El resto del esquema (destinos, leads, articles, site_content) llega en sus
-- propias migraciones cuando se construya cada módulo.

create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null,
  role       text not null default 'editor' check (role in ('admin','editor')),
  created_at timestamptz not null default now()
);

-- crea el perfil automáticamente cuando se crea el usuario en auth.users
-- (alta desde el dashboard de Supabase, invitación, o signInWithPassword tras
-- un admin.createUser — nunca hay auto-registro público)
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- NOTA: "current_role" es una construcción reservada del estándar SQL
-- (como current_user) que Postgres resuelve por gramática, no por search_path.
-- Definir una función pública con ese nombre nunca se llama a sí misma: siempre
-- resuelve a la función nativa del sistema. Por eso el nombre es app_user_role.
create function app_user_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_user_role() is not null
$$;

-- una política "update using (auth.uid() = id)" no evita que el propio usuario
-- cambie su rol en el mismo UPDATE — with check no distingue qué columna cambió.
-- Lo bloquea este trigger, no la política.
create function prevent_role_self_escalation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and public.app_user_role() is distinct from 'admin' then
    raise exception 'Solo un admin puede cambiar el rol de un usuario';
  end if;
  return new;
end;
$$;
create trigger trg_prevent_role_self_escalation
  before update on profiles
  for each row execute function prevent_role_self_escalation();

alter table profiles enable row level security;

create policy profiles_select on profiles for select
  using (auth.uid() = id or app_user_role() = 'admin');

create policy profiles_update on profiles for update
  using (auth.uid() = id or app_user_role() = 'admin');

create policy profiles_delete on profiles for delete
  using (app_user_role() = 'admin');
