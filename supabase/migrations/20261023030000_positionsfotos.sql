-- Fotos können einer Position zugeordnet werden. Ohne Position gehört das Foto zum ganzen Auftrag.
-- Wird eine Position gelöscht, bleiben ihre Fotos am Auftrag erhalten.

alter table public.ticket_photos
  add column position_id bigint references public.ticket_positions (id) on delete set null;

create index ticket_photos_position_idx on public.ticket_photos (position_id);

create function public.photos_position_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.position_id is not null and not exists (
    select 1 from public.ticket_positions p where p.id = new.position_id and p.ticket_id = new.ticket_id
  ) then
    raise exception 'Position gehört nicht zu diesem Auftrag';
  end if;
  return new;
end;
$$;

create trigger photos_position_guard
  before insert or update of position_id, ticket_id on public.ticket_photos
  for each row execute function public.photos_position_guard();
