-- Jedes Team hat pro Tag genau einen verantwortlichen Monteur. Einsätze können einem Team an einem Tag
-- nur zugeordnet werden, wenn dort ein Verantwortlicher eingeteilt ist.

alter table public.team_members add column lead boolean not null default false;

-- Bisherige Besetzung: der zuerst Eingeteilte wird verantwortlich
update public.team_members m set lead = true
where (m.team_id, m.day, m.created_at, m.installer_id) in (
  select distinct on (team_id, day) team_id, day, created_at, installer_id
  from public.team_members order by team_id, day, created_at, installer_id
);

create unique index team_members_one_lead on public.team_members (team_id, day) where lead;

create or replace function public.team_members_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = new.installer_id and role::text = 'monteur' and active) then
    raise exception 'Bitte einen aktiven Monteur auswählen';
  end if;
  if (select count(*) from public.team_members
      where team_id = new.team_id and day = new.day and installer_id <> new.installer_id) >= 3 then
    raise exception 'Ein Team hat höchstens 3 Monteure pro Tag';
  end if;
  -- Der erste Monteur eines Teams am Tag wird automatisch verantwortlich; gewechselt wird über set_team_lead
  if tg_op = 'INSERT' then
    new.lead := not exists (select 1 from public.team_members where team_id = new.team_id and day = new.day and lead);
  end if;
  return new;
end;
$$;

-- Letzten Monteur nicht austragen, solange das Team an dem Tag offene Einsätze hat;
-- geht der Verantwortliche, übernimmt der nächste im Team.
create function public.team_members_before_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.team_members
                 where team_id = old.team_id and day = old.day and installer_id <> old.installer_id)
     and exists (select 1 from public.tickets
                 where team_id = old.team_id and montage_date = old.day and status <> 'abgeschlossen') then
    raise exception 'Das Team hat an diesem Tag noch Einsätze. Bitte zuerst die Einsätze umplanen.';
  end if;
  return old;
end;
$$;

create trigger team_members_before_delete
  before delete on public.team_members
  for each row execute function public.team_members_before_delete();

create function public.team_members_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.lead then
    update public.team_members set lead = true
    where (team_id, day, installer_id) = (
      select team_id, day, installer_id from public.team_members
      where team_id = old.team_id and day = old.day
      order by created_at, installer_id limit 1
    );
  end if;
  return null;
end;
$$;

create trigger team_members_after_delete
  after delete on public.team_members
  for each row execute function public.team_members_after_delete();

-- Verantwortlichen wechseln (läuft mit den Rechten des Aufrufers, also nur für Planer)
create function public.set_team_lead(p_team_id smallint, p_day date, p_installer_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.team_members
                 where team_id = p_team_id and day = p_day and installer_id = p_installer_id) then
    raise exception 'Der Monteur ist an diesem Tag nicht in dem Team';
  end if;
  update public.team_members set lead = false where team_id = p_team_id and day = p_day and lead;
  update public.team_members set lead = true
   where team_id = p_team_id and day = p_day and installer_id = p_installer_id;
  if not found then
    raise exception 'Keine Berechtigung';
  end if;
end;
$$;

-- Einsätze nur einem Team zuordnen, das an dem Tag einen Verantwortlichen hat
create function public.tickets_zz_team_lead()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_team text;
begin
  if new.team_id is not null and new.montage_date is not null
     and (tg_op = 'INSERT' or new.team_id is distinct from old.team_id or new.montage_date is distinct from old.montage_date)
     and not exists (select 1 from public.team_members
                     where team_id = new.team_id and day = new.montage_date and lead) then
    select name into v_team from public.teams where id = new.team_id;
    raise exception 'Für % ist am % kein verantwortlicher Monteur eingeteilt', v_team, to_char(new.montage_date, 'DD.MM.YYYY');
  end if;
  return new;
end;
$$;

create trigger tickets_zz_team_lead
  before insert or update on public.tickets
  for each row execute function public.tickets_zz_team_lead();
