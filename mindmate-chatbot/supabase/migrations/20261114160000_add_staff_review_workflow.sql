alter table public.support_events
  add column workflow_status text not null default 'needs_review'
    check (workflow_status in ('needs_review', 'assigned', 'contact_attempted', 'reviewed', 'resolved', 'false_positive')),
  add column assignee_id uuid references auth.users(id) on delete set null,
  add column workflow_version integer not null default 0 check (workflow_version >= 0),
  add column review_updated_at timestamptz;

update public.support_events set workflow_status = case
  when review_status in ('reviewed', 'resolved', 'false_positive') then review_status else 'needs_review' end;

create table public.support_review_history (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.support_events(id) on delete cascade,
  version integer not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text not null,
  from_status text not null,
  to_status text not null,
  from_assignee_id uuid references auth.users(id) on delete set null,
  to_assignee_id uuid references auth.users(id) on delete set null,
  from_assignee_email text,
  to_assignee_email text,
  note text not null default '' check (char_length(note) <= 4000),
  created_at timestamptz not null default now(),
  unique (event_id, version)
);
create index support_review_history_event_idx on public.support_review_history(event_id, version);
create index support_events_workflow_idx on public.support_events(workflow_status, assignee_id, created_at);
alter table public.support_review_history enable row level security;
revoke all on public.support_review_history from public, anon, authenticated, service_role;
grant select, insert on public.support_review_history to service_role;

-- Only the authenticated staff API calls this function with its verified actor ID.
-- Row locking, version checks, the update and the append-only audit are atomic.
create function public.update_support_review(
  p_event_id uuid, p_expected_version integer, p_status text,
  p_assignee_id uuid, p_note text, p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $review$
declare
  previous public.support_events%rowtype;
  actor_email text;
  previous_email text;
  next_email text;
begin
  if p_status is null or p_status not in ('needs_review','assigned','contact_attempted','reviewed','resolved','false_positive')
    or p_expected_version is null or p_expected_version < 0 or p_note is null or char_length(p_note) > 4000 then
    raise exception using errcode = '22023', message = 'Invalid review update';
  end if;
  if p_status in ('assigned','contact_attempted') and p_assignee_id is null then
    raise exception using errcode = '22023', message = 'Choose an assignee';
  end if;
  select email into actor_email from auth.users where id = p_actor_id;
  if actor_email is null then raise exception using errcode = '22023', message = 'Reviewer not found'; end if;
  if p_assignee_id is not null then
    select email into next_email from auth.users where id = p_assignee_id;
    if next_email is null then raise exception using errcode = '22023', message = 'Assignee not found'; end if;
  end if;
  select * into previous from public.support_events where id = p_event_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Detection not found'; end if;
  if previous.workflow_version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'Review changed; reload before saving';
  end if;
  if previous.workflow_status = p_status and previous.assignee_id is not distinct from p_assignee_id and btrim(p_note) = '' then
    raise exception using errcode = '22023', message = 'No review changes';
  end if;
  select email into previous_email from auth.users where id = previous.assignee_id;
  update public.support_events set workflow_status = p_status, assignee_id = p_assignee_id,
    workflow_version = workflow_version + 1, review_updated_at = now(),
    review_status = case when p_status in ('resolved','false_positive','reviewed') then p_status
      when previous.review_status in ('resolved','false_positive','reviewed') then 'unconfigured'
      else previous.review_status end,
    reviewed_at = case when p_status in ('resolved','false_positive','reviewed') then now() else null end
  where id = p_event_id;
  insert into public.support_review_history(event_id, version, actor_id, actor_email, from_status, to_status,
    from_assignee_id, to_assignee_id, from_assignee_email, to_assignee_email, note)
  values (p_event_id, previous.workflow_version + 1, p_actor_id, actor_email, previous.workflow_status, p_status,
    previous.assignee_id, p_assignee_id, previous_email, next_email, btrim(p_note));
  return jsonb_build_object('version', previous.workflow_version + 1, 'status', p_status, 'assignee_id', p_assignee_id);
end
$review$;
revoke all on function public.update_support_review(uuid, integer, text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.update_support_review(uuid, integer, text, uuid, text, uuid) to service_role;
notify pgrst, 'reload schema';
