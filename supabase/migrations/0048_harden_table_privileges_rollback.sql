-- Reversión de 0048: restaura los privilegios que existían antes (verificados
-- el 2026-10-17). Úsalo solo si el endurecimiento rompe algo.
grant delete, insert, references, select, trigger, truncate, update
  on public.leads, public.lead_notes, public.profiles, public.site_settings to anon;
grant delete, insert, references, select, trigger, truncate, update
  on public.articles, public.destinations, public.destination_images,
     public.itinerary_days, public.site_content to anon;
grant truncate, trigger, references on public.articles, public.destination_images, public.destinations,
  public.itinerary_days, public.lead_notes, public.leads, public.profiles, public.proposals,
  public.site_content, public.site_settings to authenticated;
grant insert on public.profiles to authenticated;
