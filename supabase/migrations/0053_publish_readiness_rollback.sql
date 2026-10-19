-- Reversión de 0053: vuelve a la publish_proposal() que tenía producción (reglas escritas dentro, mensaje genérico)
-- y elimina get_publish_readiness(). El constructor que muestra la lista de pendientes deja de funcionar con ella
-- (cae al comportamiento anterior: intenta publicar y muestra el error de la base).
begin;

CREATE OR REPLACE FUNCTION public.publish_proposal(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_proposal public.proposals%rowtype;
  v_missing text[] := '{}';
  v_has_access_code boolean := false;
begin

  if not public.can_manage_proposals() then
    raise exception 'No autorizado';
  end if;


  select p.*
  into v_proposal
  from public.proposals p
  where p.id = p_id;


  if not found then
    raise exception 'Propuesta no encontrada';
  end if;


  if v_proposal.status <> 'draft' then
    raise exception
      'Solo se puede publicar una propuesta en estado draft';
  end if;


  if coalesce(
       trim(v_proposal.title),
       ''
     ) = '' then

    v_missing := array_append(
      v_missing,
      'título de portada'
    );

  end if;


  if jsonb_typeof(
       v_proposal.content -> 'days'
     ) <> 'array'
     or jsonb_array_length(
       coalesce(
         v_proposal.content -> 'days',
         '[]'::jsonb
       )
     ) = 0 then

    v_missing := array_append(
      v_missing,
      'al menos un día de itinerario'
    );

  end if;


  if jsonb_typeof(
       v_proposal.content
         -> 'pricing'
         -> 'lines'
     ) <> 'array'
     or jsonb_array_length(
       coalesce(
         v_proposal.content
           -> 'pricing'
           -> 'lines',
         '[]'::jsonb
       )
     ) = 0 then

    v_missing := array_append(
      v_missing,
      'al menos una línea de precio'
    );

  end if;


  if v_proposal.access_required then

    select exists (
      select 1
      from public.proposal_access_credentials c
      where c.proposal_id = p_id
        and c.access_code_hash is not null
        and length(c.access_code_hash) > 0
    )
    into v_has_access_code;


    if not v_has_access_code then

      v_missing := array_append(
        v_missing,
        'código de acceso'
      );

    end if;

  end if;


  if cardinality(v_missing) > 0 then

    raise exception
      'Faltan datos para publicar: %',
      array_to_string(v_missing, ', ');

  end if;


  update public.proposals
  set
    status = 'published',
    published_at = now()
  where id = p_id;

end;
$function$;

drop function if exists public.get_publish_readiness(uuid);

commit;
