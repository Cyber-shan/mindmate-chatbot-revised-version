-- Private support-prioritization audit and review queue. No message text is copied here.
create table public.support_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null unique references public.messages(id) on delete cascade,
  level text not null check (level in ('LOW', 'MODERATE', 'HIGH_CONCERN', 'IMMEDIATE_SAFETY')),
  decision jsonb not null,
  review_status text not null check (review_status in ('not_required', 'unconfigured', 'pending', 'reviewed', 'resolved', 'false_positive')),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index support_events_conversation_idx on public.support_events(conversation_id, created_at desc);
create index support_events_review_idx on public.support_events(created_at) where review_status = 'pending';
alter table public.support_events enable row level security;
revoke all on public.support_events from anon, authenticated;
grant select, insert, update, delete on public.support_events to service_role;
-- No student policies: scores, matched rules and review metadata stay server-side.
-- Staff access must be provided through institution-approved server authorization.
