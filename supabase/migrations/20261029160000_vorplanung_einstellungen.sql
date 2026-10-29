-- Einstellungen der Vorplanung (Fabian, 2026-10-29): Stunden je Manntag und Referenzwert je Kalenderwoche.
-- Eine einzige Zeile; lesen dürfen alle angemeldeten Benutzer, ändern nur der Admin.

create table if not exists public.planning_settings (
  id boolean primary key default true check (id),
  hours_per_man_day numeric(4, 1) not null default 9 check (hours_per_man_day > 0 and hours_per_man_day <= 24),
  reference_hours_per_week numeric(7, 1) not null default 720 check (reference_hours_per_week >= 0 and reference_hours_per_week <= 100000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

insert into public.planning_settings (id) values (true) on conflict (id) do nothing;

alter table public.planning_settings enable row level security;

drop policy if exists planning_settings_select on public.planning_settings;
create policy planning_settings_select on public.planning_settings
  for select to authenticated using (true);

drop policy if exists planning_settings_update on public.planning_settings;
create policy planning_settings_update on public.planning_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, update on public.planning_settings to authenticated;
