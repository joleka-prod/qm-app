-- E-Mail-Adresse des Kunden und Wunsch, den Bericht per E-Mail zu bekommen (wird bei der Unterschrift abgefragt).

alter table public.tickets
  add column customer_email text not null default '',
  add column report_by_email boolean not null default false;

alter table public.tickets
  add constraint tickets_customer_email_check
    check (customer_email = '' or customer_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add constraint tickets_report_by_email_check
    check (not report_by_email or customer_email <> '');

create function public.tickets_zz_customer_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.customer_email := lower(trim(new.customer_email));
  if new.ticket_type = 'qm' then
    new.customer_email := '';
    new.report_by_email := false;
  end if;
  return new;
end;
$$;

create trigger tickets_zz_customer_email
  before insert or update on public.tickets
  for each row execute function public.tickets_zz_customer_email();
