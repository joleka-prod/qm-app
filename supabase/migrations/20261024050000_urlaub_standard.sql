-- Standard-Urlaubsanspruch 30 Tage für alle Benutzer (auch neu angelegte).
alter table public.profiles alter column vacation_days set default 30;
update public.profiles set vacation_days = 30 where vacation_days = 0;
