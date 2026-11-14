do $mindmate_staff_access$
begin
  grant select on public.conversations, public.messages to service_role;
  perform pg_notify('pgrst', 'reload schema');
end
$mindmate_staff_access$;
