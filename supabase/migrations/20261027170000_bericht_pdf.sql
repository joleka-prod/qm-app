-- Der an den Kunden gesendete Servicebericht (PDF) wird im Auftrag gespeichert,
-- damit man ihn später noch einmal ansehen kann. Datei: Bucket ticket-photos unter
-- <ticket_id>/servicebericht-*.pdf. Gesetzt wird der Pfad nur von der Edge Function send-report.

alter table public.tickets
  add column if not exists report_pdf_path text;

-- PDF-Dateien im Bucket erlauben
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
where id = 'ticket-photos';

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
  -- Versandstatus und gespeichertes PDF dürfen angemeldete Nutzer nicht selbst setzen
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.report_sent_at := null;
      new.report_send_error := '';
      new.report_pdf_path := null;
    else
      new.report_sent_at := old.report_sent_at;
      new.report_send_error := old.report_send_error;
      new.report_pdf_path := old.report_pdf_path;
    end if;
  end if;
  return new;
end;
$$;
