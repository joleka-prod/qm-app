-- Versandstatus des Kundenberichts. Wird nur von der Edge Function send-report (Service-Schlüssel) gesetzt.

alter table public.tickets
  add column report_sent_at timestamptz,
  add column report_send_error text not null default '';

create or replace function public.tickets_zz_customer_email()
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
  -- Versandstatus dürfen angemeldete Nutzer nicht selbst setzen
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.report_sent_at := null;
      new.report_send_error := '';
    else
      new.report_sent_at := old.report_sent_at;
      new.report_send_error := old.report_send_error;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.log_ticket_report_mail()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.report_sent_at is distinct from old.report_sent_at and new.report_sent_at is not null then
    insert into public.ticket_events (ticket_id, actor, kind, details)
    values (new.id, null, 'bericht_gesendet', new.customer_email);
  end if;
  return new;
end;
$$;

create trigger tickets_log_report_mail
  after update of report_sent_at on public.tickets
  for each row execute function public.log_ticket_report_mail();
