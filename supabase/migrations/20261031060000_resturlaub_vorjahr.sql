-- Resturlaub aus dem Vorjahr (Fabian, 2026-10-31): nicht genommener Urlaub des Vorjahres kommt zum Anspruch dazu
-- (Meine Zeiten: Resturlaub aus Vorjahr + Urlaubsanspruch = Urlaubsanspruch gesamt).
-- Automatisch: Rest Vorjahr = Übertrag Vorjahr + Anspruch − genehmigter Urlaub im Vorjahr, Jahr für Jahr ab dem ersten
-- Jahr mit Urlaubsdaten. Weil ältere Jahre nicht vollständig in der App sind, können Admin und Personalabteilung den
-- Wert je Jahr festlegen (vacation_carryover); ein festgelegter Wert gilt statt der Rechnung und ist Startpunkt für später.

create table if not exists public.vacation_carryover (
  user_id uuid not null references public.profiles(id) on delete cascade,
  year int not null check (year between 2000 and 2100),
  days numeric(4,1) not null default 0 check (days between -366 and 366),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (user_id, year)
);

alter table public.vacation_carryover enable row level security;

drop policy if exists "Resturlaub sehen" on public.vacation_carryover;
create policy "Resturlaub sehen"
  on public.vacation_carryover for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.is_supervisor_of(user_id)
         or public.has_hr_access());

create or replace function public.set_vacation_carryover(p_user uuid, p_year int, p_days numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin() or (public.has_hr_access() and p_user <> auth.uid())) then
    raise exception 'Resturlaub pflegen Admin und Personalabteilung (nicht den eigenen)';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'Ungültiges Jahr';
  end if;
  if p_days is null then
    delete from public.vacation_carryover where user_id = p_user and year = p_year;
    return;
  end if;
  if abs(p_days) > 366 or p_days * 2 <> round(p_days * 2) then
    raise exception 'Bitte beim Resturlaub ganze oder halbe Tage eintragen';
  end if;
  insert into public.vacation_carryover (user_id, year, days, updated_by)
  values (p_user, p_year, p_days, auth.uid())
  on conflict (user_id, year) do update
    set days = excluded.days, updated_by = excluded.updated_by, updated_at = now()
    where public.vacation_carryover.days is distinct from excluded.days;
end;
$$;
revoke execute on function public.set_vacation_carryover(uuid, int, numeric) from public, anon;
grant execute on function public.set_vacation_carryover(uuid, int, numeric) to authenticated;

-- Resturlaub aus dem Vorjahr für ein Jahr (festgelegt oder berechnet); null ohne Berechtigung
create or replace function public.vacation_carryover_days(p_user uuid, p_year int)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_allowance numeric;
  v_start int;
  v_carry numeric := 0;
  v_fixed numeric;
  y int;
begin
  if not (p_user = auth.uid() or public.is_admin() or public.is_supervisor_of(p_user) or public.has_hr_access()) then
    return null;
  end if;
  select coalesce(vacation_days, 0) into v_allowance from public.profiles where id = p_user;
  select least(
           (select min(year) from public.vacation_carryover where user_id = p_user),
           (select extract(year from min(start_date))::int from public.vacation_requests
             where user_id = p_user and kind = 'urlaub' and state = 'genehmigt'))
    into v_start;
  if v_start is null or v_start >= p_year then
    select days into v_fixed from public.vacation_carryover where user_id = p_user and year = p_year;
    return coalesce(v_fixed, 0);
  end if;
  for y in v_start .. p_year loop
    v_fixed := null;
    select days into v_fixed from public.vacation_carryover where user_id = p_user and year = y;
    if v_fixed is not null then
      v_carry := v_fixed;
    end if;
    exit when y = p_year;
    v_carry := v_carry + coalesce(v_allowance, 0) - coalesce((
      select sum(days) from public.vacation_requests
       where user_id = p_user and kind = 'urlaub' and state = 'genehmigt'
         and start_date between make_date(y, 1, 1) and make_date(y, 12, 31)), 0);
  end loop;
  return v_carry;
end;
$$;
revoke execute on function public.vacation_carryover_days(uuid, int) from public, anon;
grant execute on function public.vacation_carryover_days(uuid, int) to authenticated;
