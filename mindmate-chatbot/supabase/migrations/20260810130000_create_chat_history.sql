create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index conversations_user_updated_idx
  on public.conversations (user_id, updated_at desc);

create index messages_conversation_created_idx
  on public.messages (conversation_id, created_at asc);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy "Students can view their conversations"
  on public.conversations
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Students can create their conversations"
  on public.conversations
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Students can update their conversations"
  on public.conversations
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Students can delete their conversations"
  on public.conversations
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Students can view messages in their conversations"
  on public.messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.conversations
      where conversations.id = messages.conversation_id
        and conversations.user_id = (select auth.uid())
    )
  );

create policy "Students can add messages to their conversations"
  on public.messages
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.conversations
      where conversations.id = messages.conversation_id
        and conversations.user_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert on public.messages to authenticated;

create function public.touch_conversation_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.conversations
  set updated_at = now()
  where id = new.conversation_id;

  return new;
end;
$$;

create trigger touch_conversation_after_message
after insert on public.messages
for each row
execute function public.touch_conversation_updated_at();
