-- Montage-Kapazität (Fabian, 2026-10-29): Die Personalakte ist führend. Es zählen nur Monteure mit Haken,
-- die eine Personalakte mit Status "Aktiv" haben. Wird die Personalakte gelöscht oder auf "nicht aktiv"
-- bzw. "Langzeitkrank" gesetzt, fällt der Monteur aus der Kapazität, auch wenn sein App-Zugang noch besteht.

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
    select p.id from public.profiles p
     where p.role = 'monteur' and p.active and p.montage_capacity
       and exists (select 1 from public.employees e where e.user_id = p.id and e.status = 'Aktiv')
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
