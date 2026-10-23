-- Stempeluhr statt Handeingabe: Monteure starten und stoppen ihre Arbeitszeit nach dem
-- Login (Stundenkonto). Im Auftrag starten und stoppen sie zusätzlich die Zeit für den
-- Auftrag; das geht nur, solange sie eingestempelt sind. Ausstempeln stoppt auch die
-- Auftragszeit. QM und Teamleiter können Stempelzeiten korrigieren, der Admin löschen.

drop table if exists public.work_days;
drop function if exists public.work_days_guard();

create table public.attendance (
  id bigint generated always as identity primary key,
  installer_id uuid not null references public.profiles (id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  note text not null default '' check (length(note) <= 300),
  edited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create index attendance_installer_idx on public.attendance (installer_id, started_at);
create unique index attendance_one_running on public.attendance (installer_id) where ended_at is null;

alter table public.attendance enable row level security;

create policy "Stempelzeiten sehen"
  on public.attendance for select to authenticated
  using (installer_id = auth.uid() or public.my_role() in ('admin', 'teamleiter'));

-- Nachtragen und Korrigieren nur durch Planer; Monteure stempeln über clock_in / clock_out
create policy "Planer tragen Stempelzeiten nach"
  on public.attendance for insert to authenticated
  with check (public.my_role() in ('admin', 'teamleiter'));

create policy "Planer korrigieren Stempelzeiten"
  on public.attendance for update to authenticated
  using (public.my_role() in ('admin', 'teamleiter'))
  with check (public.my_role() in ('admin', 'teamleiter'));

create policy "Admin löscht Stempelzeiten"
  on public.attendance for delete to authenticated
  using (public.is_admin());

create or replace function public.attendance_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.note := trim(new.note);
  if tg_op = 'UPDATE' then
    new.installer_id := old.installer_id;
    new.created_at := old.created_at;
  end if;
  -- Änderungen durch andere (Planer) werden vermerkt
  if auth.uid() is not null and new.installer_id <> auth.uid() then
    new.edited_by := auth.uid();
  end if;
  if new.ended_at is not null and new.ended_at < new.started_at then
    raise exception 'Das Ende muss nach dem Beginn liegen';
  end if;
  if not exists (select 1 from public.profiles where id = new.installer_id and role = 'monteur') then
    raise exception 'Die Zeiterfassung gibt es nur für Monteure';
  end if;
  return new;
end;
$$;

create trigger attendance_guard
  before insert or update on public.attendance
  for each row execute function public.attendance_guard();

create or replace function public.clock_in()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if public.my_role() is distinct from 'monteur' then
    raise exception 'Die Zeiterfassung gibt es nur für Monteure';
  end if;
  select id into v_id from public.attendance where installer_id = auth.uid() and ended_at is null;
  if found then
    return v_id;
  end if;
  insert into public.attendance (installer_id) values (auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.clock_out()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.time_entries set ended_at = greatest(now(), started_at)
  where installer_id = auth.uid() and ended_at is null;
  update public.attendance set ended_at = greatest(now(), started_at)
  where installer_id = auth.uid() and ended_at is null;
end;
$$;

-- Auftragszeit nur, solange eingestempelt
create or replace function public.start_time_entry(p_ticket_id bigint, p_kind public.time_kind)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  if not exists (
    select 1 from public.tickets t
    where t.id = p_ticket_id and t.ticket_type <> 'qm' and t.status <> 'abgeschlossen'
      and public.is_on_team(t.team_id, t.montage_date)
  ) then
    raise exception 'Zeiten können nur Monteure des eingeplanten Teams erfassen, solange der Einsatz offen ist';
  end if;
  if not exists (select 1 from public.attendance where installer_id = auth.uid() and ended_at is null) then
    raise exception 'Bitte zuerst oben die Zeiterfassung starten';
  end if;
  update public.time_entries set ended_at = greatest(now(), started_at)
  where installer_id = auth.uid() and ended_at is null;
  insert into public.time_entries (ticket_id, installer_id, kind)
  values (p_ticket_id, auth.uid(), p_kind)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.clock_in() from public, anon;
revoke execute on function public.clock_out() from public, anon;
grant execute on function public.clock_in() to authenticated;
grant execute on function public.clock_out() to authenticated;
