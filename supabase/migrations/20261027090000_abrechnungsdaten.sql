-- Abrechnungsrelevante Angaben in den Stammdaten (Fabian, 2026-10-27): was die Lohnabrechnung (ADDISON)
-- je Mitarbeiter braucht. Die Wochenarbeitszeit steht jetzt in den Stammdaten und wird wie Name und
-- Urlaubsanspruch an den App-Benutzer weitergegeben (Soll-Stunden, Überstunden).

alter table public.employees
  add column if not exists birth_name text not null default '',
  add column if not exists birth_place text not null default '',
  add column if not exists nationality text not null default '',
  add column if not exists tax_id text not null default '',
  add column if not exists church_tax text not null default '',
  add column if not exists social_security_no text not null default '',
  add column if not exists health_insurance text not null default '',
  add column if not exists insurance_type text not null default '',
  add column if not exists iban text not null default '',
  add column if not exists bic text not null default '',
  add column if not exists account_holder text not null default '',
  add column if not exists employment_type text not null default '',
  add column if not exists job_title text not null default '',
  add column if not exists wage_type text not null default '',
  add column if not exists disability text not null default '',
  add column if not exists exit_date date,
  add column if not exists probation_end date,
  add column if not exists contract_end date,
  add column if not exists child_allowance numeric(3, 1) check (child_allowance between 0 and 20),
  add column if not exists weekly_hours numeric(4, 1) check (weekly_hours between 0 and 60);

create or replace function public.employees_sync_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, ''));
begin
  if new.user_id is null then
    return new;
  end if;
  perform set_config('app.employee_sync', '1', true);
  update public.profiles p set
    full_name = case when v_name <> '' then v_name else p.full_name end,
    vacation_days = coalesce(new.vacation_days, p.vacation_days),
    weekly_hours = coalesce(new.weekly_hours, p.weekly_hours),
    -- den eigenen Zugang sperrt man sich nicht selbst
    active = case when p.id = auth.uid() then p.active else new.status <> 'nicht aktiv' end
  where p.id = new.user_id
    and (p.full_name is distinct from case when v_name <> '' then v_name else p.full_name end
         or p.vacation_days is distinct from coalesce(new.vacation_days, p.vacation_days)
         or p.weekly_hours is distinct from coalesce(new.weekly_hours, p.weekly_hours)
         or p.active is distinct from case when p.id = auth.uid() then p.active else new.status <> 'nicht aktiv' end);
  perform set_config('app.employee_sync', '', true);
  return new;
end;
$$;

drop trigger if exists employees_sync_user on public.employees;
create trigger employees_sync_user
  after insert or update of first_name, last_name, vacation_days, weekly_hours, status, user_id on public.employees
  for each row execute function public.employees_sync_user();

-- Zusammenführen kennt die neuen Felder
create or replace function public.merge_employees(p_keep bigint, p_drop bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.employees;
  v_user uuid;
begin
  if not public.has_hr_access() then
    raise exception 'Nur für die Personalabteilung';
  end if;
  if p_keep = p_drop then
    raise exception 'Bitte zwei verschiedene Mitarbeiter wählen';
  end if;
  select * into d from public.employees where id = p_drop for update;
  if not found or not exists (select 1 from public.employees where id = p_keep) then
    raise exception 'Mitarbeiter nicht gefunden';
  end if;

  perform set_config('app.employee_merge', '1', true);
  update public.employee_log set employee_id = p_keep where employee_id = p_drop;

  update public.employee_entries set employee_id = p_keep where employee_id = p_drop;
  delete from public.employee_entries e
  using public.employee_entries o
  where e.employee_id = p_keep and o.employee_id = p_keep
    and e.kind = o.kind and e.data = o.data and e.id > o.id;

  v_user := d.user_id;
  update public.employees set user_id = null where id = p_drop;

  update public.employees k set
    personnel_number = case when k.personnel_number = '' then d.personnel_number else k.personnel_number end,
    status = case when k.status = '' then d.status else k.status end,
    tax_class = case when k.tax_class = '' then d.tax_class else k.tax_class end,
    salutation = case when k.salutation = '' then d.salutation else k.salutation end,
    first_name = case when k.first_name = '' then d.first_name else k.first_name end,
    last_name = case when k.last_name = '' then d.last_name else k.last_name end,
    mother_tongue = case when k.mother_tongue = '' then d.mother_tongue else k.mother_tongue end,
    marital_status = case when k.marital_status = '' then d.marital_status else k.marital_status end,
    street = case when k.street = '' then d.street else k.street end,
    house_no = case when k.house_no = '' then d.house_no else k.house_no end,
    zip = case when k.zip = '' then d.zip else k.zip end,
    city = case when k.city = '' then d.city else k.city end,
    phone_private = case when k.phone_private = '' then d.phone_private else k.phone_private end,
    mobile_private = case when k.mobile_private = '' then d.mobile_private else k.mobile_private end,
    email_private = case when k.email_private = '' then d.email_private else k.email_private end,
    department = case when k.department = '' then d.department else k.department end,
    specific_experience = case when k.specific_experience = '' then d.specific_experience else k.specific_experience end,
    residence_title = case when k.residence_title = '' then d.residence_title else k.residence_title end,
    birth_date = coalesce(k.birth_date, d.birth_date),
    vacation_days = coalesce(k.vacation_days, d.vacation_days),
    entry_date = coalesce(k.entry_date, d.entry_date),
    residence_valid_until = coalesce(k.residence_valid_until, d.residence_valid_until),
    birth_name = case when k.birth_name = '' then d.birth_name else k.birth_name end,
    birth_place = case when k.birth_place = '' then d.birth_place else k.birth_place end,
    nationality = case when k.nationality = '' then d.nationality else k.nationality end,
    tax_id = case when k.tax_id = '' then d.tax_id else k.tax_id end,
    church_tax = case when k.church_tax = '' then d.church_tax else k.church_tax end,
    social_security_no = case when k.social_security_no = '' then d.social_security_no else k.social_security_no end,
    health_insurance = case when k.health_insurance = '' then d.health_insurance else k.health_insurance end,
    insurance_type = case when k.insurance_type = '' then d.insurance_type else k.insurance_type end,
    iban = case when k.iban = '' then d.iban else k.iban end,
    bic = case when k.bic = '' then d.bic else k.bic end,
    account_holder = case when k.account_holder = '' then d.account_holder else k.account_holder end,
    employment_type = case when k.employment_type = '' then d.employment_type else k.employment_type end,
    job_title = case when k.job_title = '' then d.job_title else k.job_title end,
    wage_type = case when k.wage_type = '' then d.wage_type else k.wage_type end,
    disability = case when k.disability = '' then d.disability else k.disability end,
    exit_date = coalesce(k.exit_date, d.exit_date),
    probation_end = coalesce(k.probation_end, d.probation_end),
    contract_end = coalesce(k.contract_end, d.contract_end),
    child_allowance = coalesce(k.child_allowance, d.child_allowance),
    weekly_hours = coalesce(k.weekly_hours, d.weekly_hours),
    vl_payment = k.vl_payment or d.vl_payment,
    wage_concept = d.wage_concept || k.wage_concept,
    user_id = coalesce(k.user_id, v_user)
  where k.id = p_keep;

  perform public.employee_log_write(p_keep, 'zusammengeführt', null, jsonb_build_object(
    'akte', jsonb_build_object('alt', trim(d.first_name || ' ' || d.last_name) || coalesce(' (Nr. ' || nullif(d.personnel_number, '') || ')', ''), 'neu', null)));

  delete from public.employees where id = p_drop;
end;
$$;

-- Wochenarbeitszeit einmalig aus den App-Benutzern übernehmen
update public.employees e set weekly_hours = p.weekly_hours
  from public.profiles p
 where p.id = e.user_id and e.weekly_hours is null;
