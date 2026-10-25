-- Kapazitätsplanung Montage (Fabian, 2026-10-25): verfügbare Manntage je Tag.
-- Gezählt werden aktive Monteure, die für die Montage eingeplant werden (profiles.montage_capacity),
-- abzüglich genehmigtem Urlaub bzw. Überstundenabbau. Samstag/Sonntag zählen nicht,
-- Feiertage zieht die App ab. Die Funktion gibt nur Zahlen zurück, keine Namen.

alter table public.profiles add column if not exists montage_capacity boolean not null default true;

create or replace function public.profiles_zz_capacity_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and new.montage_capacity is distinct from old.montage_capacity then
    raise exception 'Die Montage-Kapazität pflegt nur der Admin';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_zz_capacity_guard on public.profiles;
create trigger profiles_zz_capacity_guard
  before update on public.profiles
  for each row execute function public.profiles_zz_capacity_guard();

create or replace function public.montage_capacity(p_from date, p_to date)
returns table (day date, installers integer, available integer)
language sql
stable
security definer
set search_path = ''
as $$
  with days as (
    select d::date as day
      from generate_series(p_from, least(p_to, p_from + 400), interval '1 day') d
     where extract(isodow from d) <= 5
  ),
  crew as (
    select id from public.profiles where role = 'monteur' and active and montage_capacity
  )
  select days.day,
         (select count(*) from crew)::integer,
         (select count(*) from crew c
           where not exists (select 1 from public.vacation_requests v
                              where v.user_id = c.id and v.state = 'genehmigt'
                                and days.day between v.start_date and v.end_date))::integer
    from days
   where public.my_role() in ('admin', 'teamleiter', 'disposition')
   order by days.day;
$$;

revoke all on function public.montage_capacity(date, date) from public, anon;
grant execute on function public.montage_capacity(date, date) to authenticated;
