-- Doppelte Mitarbeiter zusammenführen (Fabian, 2026-10-27): p_keep bleibt, p_drop wird aufgelöst.
-- Leere Felder von p_keep werden aus p_drop gefüllt, Lohnkonzept-Haken und weitere Felder vereinigt,
-- alle Einträge der Untertabellen wandern zu p_keep (gleiche Einträge nur einmal). Hat nur p_drop einen
-- App-Benutzer, geht er an p_keep über; haben beide einen, bleibt der von p_drop ohne Personalakte bestehen.
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
    vl_payment = k.vl_payment or d.vl_payment,
    wage_concept = d.wage_concept || k.wage_concept,
    extra = d.extra || k.extra,
    user_id = coalesce(k.user_id, v_user)
  where k.id = p_keep;

  delete from public.employees where id = p_drop;
end;
$$;

revoke all on function public.merge_employees(bigint, bigint) from public, anon;
grant execute on function public.merge_employees(bigint, bigint) to authenticated;
