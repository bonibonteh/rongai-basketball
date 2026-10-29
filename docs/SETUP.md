# Rongai Basketball League: backend setup

**Status:** the database, security rules, edge function and tests are done. The portal screens in `index.html`
still show the old demo console and are NOT yet connected to Supabase (see "What is not done yet").

## 1. Use a NEW Supabase project
Do not use the student-council (asatuk) project. Create an empty project in your own organization.

## 2. Apply the migrations (in order)
Supabase dashboard > SQL Editor, run each file in `supabase/migrations/` in filename order, or use the CLI:
`supabase link --project-ref <ref>` then `supabase db push`.
1. `..090000_rbt_core_schema.sql` tables, guards, append-only audit
2. `..090100_rbt_functions.sql` scoring, lifecycle, approvals, standings
3. `..090200_rbt_policies.sql` grants, RLS, realtime
4. `..090300_rbt_storage.sql` private avatar bucket

## 3. Auth settings (dashboard > Authentication)
- Sign In / Providers > Email: on. **Disable "Allow new users to sign up"** so only invited users get accounts.
- URL Configuration: set Site URL to your website address and add it to Redirect URLs.
- Turn on "Confirm email" and set a minimum password length of 10.

## 4. Create the first Director
Follow the steps at the top of `supabase/bootstrap_first_director.sql`. It works once and refuses if a Director exists.

## 5. Deploy the edge function
`supabase functions deploy official-admin` and `supabase secrets set SITE_URL=https://your-site`.
Keep "Verify JWT" on. The service-role key is only ever used inside this function, never in the website.

## 6. Run the tests (local Postgres 16, no Supabase needed)
`bash supabase/tests/run_tests.sh`. Last run: 90 checks passed, 0 failed.

## How it works
- **Requests:** visitors call `submit_account_request` (no passwords stored, role `director` refused). The Director
  approves through the edge function, which sends the Auth invitation; the database creates the profile.
- **Access:** no profile = no official access. Every policy re-checks the profile status, so suspension works at once.
- **Scoring:** `record_match_event` locks the match row, ignores a repeated `client_event_id`, and rejects a stale `expected_version`.
- **Lifecycle:** scheduled > ready > live > final, plus postponed, cancelled, under_review. Scores, clocks and status
  cannot be written directly. Live games cannot be deleted by anyone, even the table owner (trigger). Cancelling a live game,
  correcting a final result, archiving and restoring are Director-only and need a reason. Events and audit rows are append-only.
- **Standings:** `get_standings()` is computed from published final games (win 2, loss 1).

| Role | Can |
|---|---|
| Director | everything, including approvals, role permissions, corrections, archive and restore |
| Fixture manager | create, reschedule, cancel (not live) fixtures, assign officials, suspend live games |
| Scorekeeper | score and finalise games they are assigned to |
| Referee | submit reports for assigned games |
| Registration officer | review teams |
| Stats officer | read all matches and reports |
| Media officer | draft announcements (Director publishes) |
| Read-only | view all matches |

## What is not done yet
- The Official Portal screens (sign-in, request account, eye icons, dashboards, courtside console, Director controls)
  and the public live-sync wiring are not built. The page still shows demo data.
- The edge function has not been run (no Deno here). The database tests do not cover Realtime delivery or Storage uploads.
- Nothing has been applied to any Supabase project.
