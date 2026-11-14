# Move MindMate to hosted Supabase

MindMate can use Supabase online while Next.js, Ollama and the classifier keep running on your laptop. Once `.env.local` points to the hosted project, `npm run dev`, `demo` and `prototype` skip Docker and the local Supabase CLI entirely. Internet access is required for sign-in and saved chat history.

These steps retain account IDs, password hashes, administrator roles, owner access, conversations, messages and support events. Browser sessions are not copied; sign in again using existing passwords. Keep the local database until the hosted copy has been verified.

## 1. Create the online project

1. Sign in at [Supabase Dashboard](https://supabase.com/dashboard) and create a project named **MindMate**. Choose your organization, plan and a nearby region, and save the database password privately.
2. Wait for the project to become ready. Do not create accounts or sample chat tables in it before importing your existing data.
3. Find its **Project URL**, **publishable key** and **secret key** in the project's Connect dialog or API settings. The URL looks like `https://YOUR_PROJECT_REF.supabase.co`. A legacy `anon` key and `service_role` key also work. Never put the secret/service-role key in a `NEXT_PUBLIC_` variable or send it in chat.

Creating a Supabase project does not publish the MindMate website. You will still open the app on localhost.

## 2. Export the current local data once

Do this **before changing the URL in `.env.local`**. Stop MindMate while exporting so no new records are written during the move.

If local Supabase is stopped, open Docker Desktop once, wait for its engine, then run these commands from `mindmate-chatbot`:

```powershell
npx.cmd --no-install supabase start
npm.cmd run backup:supabase
```

If the local database is already running, only the backup command is needed. The backup command also works from the repository root.

The command verifies that the running local Supabase project matches `.env.local`, then uses the database container's `pg_dump` to export a consistent snapshot of `auth.users`, `auth.identities`, `public.conversations`, `public.messages` and `public.support_events`. Password hashes and server-managed roles are included. No local records are modified or deleted.

It prints the path to `mindmate-chatbot/backups/supabase-<timestamp>/restore-data.sql`. That directory is excluded from Git. The export contains private account and conversation data; keep it private. If export fails, fix the reported issue before proceeding.

Record the local counts with this read-only query in local Studio's SQL editor (`http://127.0.0.1:55123`):

```sql
select
  (select count(*) from auth.users) as accounts,
  (select count(*) from auth.identities) as identities,
  (select count(*) from public.conversations) as conversations,
  (select count(*) from public.messages) as messages,
  (select count(*) from public.support_events) as support_events;
```

## 3. Apply the schema to the empty hosted project

From `mindmate-chatbot`, use the CLI already installed with this project:

```powershell
npx.cmd --no-install supabase login
npx.cmd --no-install supabase link --project-ref YOUR_PROJECT_REF
npx.cmd --no-install supabase db push --linked --dry-run
npx.cmd --no-install supabase db push --linked
```

Replace `YOUR_PROJECT_REF` with the reference from the hosted URL. Supply the saved database password if prompted. Verify the linked project and dry-run output before pushing. These operations connect to hosted Supabase and do not need Docker.

The three existing migrations create chat tables, student ownership policies, private support-event storage and staff read grants. Do not use `db reset` for this move. Migrations do not copy accounts or chat records; import the data next.

## 4. Import the records

1. Open the **SQL Editor in the new hosted project's dashboard**.
2. Run the entire generated `restore-data.sql` file as one script. If it exceeds the editor's text limit, use PostgreSQL's `psql` client with the hosted connection details and `ON_ERROR_STOP=1` instead.
3. The script refuses an occupied destination and uses one transaction. It preserves IDs and timestamps and checks related records before committing. Resolve any errors before proceeding; do not remove the guard or import only part of the file.
4. Run the count query from step 2 in the hosted SQL editor and compare every count with the local results.

Existing passwords, `app_metadata.mindmate_role` values and account UUIDs are retained. Do not create replacement accounts or reset passwords. The existing `MINDMATE_OWNER_USER_ID` can stay as it is.

## 5. Match authentication settings

In the hosted project's **Authentication** settings:

- Set **Site URL** to `http://localhost:3000` and allow `http://localhost:3000/**` and `http://127.0.0.1:3000/**` as redirect URLs. Add the actual port if different.
- Enable email/password sign-in and sign-ups. For this prototype's immediate-signup behavior, disable **Confirm email** in the email provider settings, matching `supabase/config.toml`. The current signup page expects an immediate session. An email-confirmation flow would require a separate app change.

Local `supabase/config.toml` is not automatically applied to hosted Auth; configure these settings in the hosted dashboard.

## 6. Connect MindMate

Edit the existing `mindmate-chatbot/.env.local`. Replace the two local Supabase values and add the hosted server key, keeping your owner UUID and other app settings:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SECRET_KEY

# Keep the existing value from your current .env.local:
MINDMATE_OWNER_USER_ID=YOUR_EXISTING_OWNER_UUID
```

Despite the existing variable name, `SUPABASE_SERVICE_ROLE_KEY` accepts a modern `sb_secret_...` key or a legacy service-role JWT. It remains server-only. All three connection values must come from the same hosted project. See [.env.example](.env.example); do not overwrite your existing owner UUID with an empty value.

From either project directory:

```powershell
npm.cmd run check:supabase
npm.cmd run dev
```

The check verifies public Auth, the server credential and access to all three app tables without modifying records. Hosted startup uses the same checks. It never discovers local keys, runs migrations, starts containers or falls back to Docker when the online project is unavailable. Apply migrations explicitly during setup.

Imported staff accounts should work immediately. `npm.cmd run setup:admin` checks hosted setup without changing accounts. If you intentionally need an additional administrator, use `npm.cmd run create:admin -- --email your-admin@example.com`; it does not overwrite existing accounts.

## 7. Verify and stop using Docker

1. Sign out of the old browser session and sign in with an existing student account and password. Confirm its saved conversations appear and a new reply is saved.
2. Sign in with the existing administrator and check the dashboard and saved support notices. If applicable, open `/model-lab` with the existing owner account.
3. Check hosted table privacy in its SQL editor:

```sql
select relname, relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and relname in ('conversations', 'messages', 'support_events');

select
  has_table_privilege('anon', 'public.support_events', 'SELECT') as anonymous_can_read_events,
  has_table_privilege('authenticated', 'public.support_events', 'SELECT') as students_can_read_events;
```

All three tables must have `relrowsecurity = true`; both event-read values must be `false`.

Once the hosted copy works, stop the local containers once, from `mindmate-chatbot`:

```powershell
npx.cmd --no-install supabase stop
```

Quit Docker Desktop and disable its **Start Docker Desktop when you sign in** setting. Keep local volumes and the private export until you are satisfied with the migration. Do not use `--no-backup`, prune volumes, reset the database or uninstall Docker as part of this move.

Daily startup remains `npm.cmd run dev`. Ollama and the classifier still use laptop memory; hosted Supabase removes the Docker database workload.

References: [Supabase migrations](https://supabase.com/docs/guides/local-development/database-migrations), [API keys](https://supabase.com/docs/guides/getting-started/api-keys), [migrating Auth users and password hashes](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects).
