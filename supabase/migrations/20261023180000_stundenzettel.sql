-- Stundenzettel: Arbeitszeit pro Tag (Beginn, Ende, Pause) je Monteur.
-- Monteure tragen ihre eigenen Tage ein und können sie 14 Tage lang ändern.
-- QM und Teamleiter sehen und korrigieren alle, löschen kann nur der Admin.

create table public.work_days (
  id bigint generated always as identity primary key,
  installer_id uuid not null default auth.uid() references public.profiles (id),
  day date not null,
  start_time time not null,
  end_time time not null,
  break_minutes integer not null default 0 check (break_minutes between 0 and 600),
  note text not null default '' check (length(note) <= 300),
  edited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (installer_id, day),
  check (end_time > start_time)
);

create index work_days_day_idx on public.work_days (day);

alter table public.work_days enable row level security;

create policy "Stundenzettel sehen"
  on public.work_days for select to authenticated
  using (installer_id = auth.uid() or public.my_role() in ('admin', 'teamleiter'));

create policy "Stundenzettel eintragen"
  on public.work_days for insert to authenticated
  with check (installer_id = auth.uid() or public.my_role() in ('admin', 'teamleiter'));

create policy "Stundenzettel ändern"
  on public.work_days for update to authenticated
  using (installer_id = auth.uid() or public.my_role() in ('admin', 'teamleiter'))
  with check (installer_id = auth.uid() or public.my_role() in ('admin', 'teamleiter'));

create policy "Admin löscht Stundenzettel"
  on public.work_days for delete to authenticated
  using (public.is_admin());

create or replace function public.work_days_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_planner boolean := auth.uid() is null or public.my_role() in ('admin', 'teamleiter');
begin
  new.note := trim(new.note);
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.installer_id := old.installer_id;
    new.created_at := old.created_at;
  end if;
  if new.day > current_date then
    raise exception 'Arbeitszeit kann nicht für die Zukunft eingetragen werden';
  end if;
  if not v_planner then
    if new.installer_id <> auth.uid() then
      raise exception 'Keine Berechtigung';
    end if;
    if new.day < current_date - 14 or (tg_op = 'UPDATE' and old.day < current_date - 14) then
      raise exception 'Tage, die länger als 14 Tage zurückliegen, kann nur QM oder ein Teamleiter ändern';
    end if;
    new.edited_by := case when tg_op = 'UPDATE' then old.edited_by end;
  elsif new.installer_id <> auth.uid() then
    new.edited_by := auth.uid();
  end if;
  if not exists (select 1 from public.profiles where id = new.installer_id and role = 'monteur') then
    raise exception 'Stundenzettel gibt es nur für Monteure';
  end if;
  return new;
end;
$$;

create trigger work_days_guard
  before insert or update on public.work_days
  for each row execute function public.work_days_guard();
