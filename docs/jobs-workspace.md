# Jobs workspace handoff

Branch: `feature/owner-jobs-workspace`. This is a review build, with no production
deployment or merge. The existing public site uses GitHub Pages; the review build
can use [Netlify](netlify.md). Supabase supplies Auth,
Postgres and private Storage. No infrastructure is provisioned automatically.

## Baseline

The checkout contained static HTML, inline CSS/JS and public recommendation PDFs,
with no AGENTS.md, package manifest, authentication or deployment workflow.
The current résumé section explicitly says a downloadable résumé has not been
added. Its public career-background links and all existing PDFs are preserved;
we did not invent a new recruiter résumé. `workspace.html` previously stored jobs
in localStorage with other daily-workspace data. Legacy jobs remain in that
storage and in downloadable JSON backups, but new job actions now live in Admin.

The live portfolio request returned a proxy HTTP 403 during implementation.
The repository, not an unverified live version, is the baseline. Supabase's docs
website was also blocked; its current official documentation source on GitHub
was reachable and inspected. Canonical board/employer URLs are provided, but
external job-board pages and Teal were not live-account validated here.

## Private project setup (required before real use)

1. Create or select a dedicated Supabase project. In Authentication settings,
   **disable public signup** and enable TOTP enrollment and verification. Do not
   enable anonymous sign-ins. The included `supabase/config.toml` sets these for
   local development; hosted projects must also be configured in the dashboard.
2. Run `supabase/migrations/202611110001_jobs.sql` through the private SQL editor
   or the authenticated Supabase CLI migration workflow. Keep `jobs_private`
   OUT of Data API exposed schemas. The migration creates no real personal data.
3. In the private Auth dashboard, create one confirmed owner user with a password
   set securely. Verify the user's UUID against that account; do not trust email
   submitted by a browser or user metadata. Privately run
   `insert into jobs_private.owner(singleton,user_id) values(true,'VERIFIED_UUID');`
   or use `scripts/provision-owner.sql` with psql's `owner_id` variable. The owner
   table holds only one row and is inaccessible to browser roles. This is the
   only owner provisioning path. Never put a populated provisioning script in Git.
4. Set `supabaseUrl` and `publishableKey` in `admin/jobs/config.js` for the staging
   project. These are public configuration. Never put a service-role key or OAuth
   token there. The client accepts hosted `https://<ref>.supabase.co` projects.
   No Supabase project/key is embedded in this branch. Auth redirect allowlists
   should include the exact staging/production Admin URL if future recovery or
   invitation flows require redirects. Password/TOTP login here needs no redirect.
5. Run `npm ci && npm run build:site`. Serve the `_site` directory on a staging
   host. Use `/<repository>/admin/jobs/index.html` when under a project prefix.
   Both direct URL loads and refresh work without a history-router fallback.
6. Sign in as the owner and scan the authenticator QR code. Verify the code to
   reach AAL2. Fill in the empty private master profiles **Cybersecurity** and
   **Operational Excellence**, using only verified résumé content. Additional
   profiles are supported. No qualifications are prefilled or inferred.
7. Repeat live authorization checks with a signed-out request, a non-owner test
   user, owner at AAL1, then owner at AAL2. Test REST reads/writes, RPCs, exports,
   authenticated Storage downloads and overwrites. The local policy tests cover
   these conditions; they do not prove the hosted project is configured correctly.
8. Review the staging build and request explicit approval before production
   deployment or merge. Deploy `_site` only. The supplied GitHub workflow creates
   a review artifact and never deploys to Pages. Netlify build configuration is
   included; a hosted preview requires connecting a Netlify site.

Auth tokens are held in memory, not localStorage. A page refresh requires
sign-in and MFA again. Sign-out clears private UI state. Use Supabase's private
Auth dashboard for password/MFA recovery; do not add a public signup/recovery
backdoor. Disable the project/user or revoke sessions if the device is lost.

## Security and document model

Every Jobs table has RLS that calls a fixed-search-path predicate comparing
`auth.uid()` with the privately configured owner UUID and requiring
`auth.jwt()->>'aal' = 'aal2'`. JWT validation is supplied by Supabase Auth / Data
API. Client roles and metadata cannot grant access. No owner UUID is supplied
in browser configuration. The audit table is append-only through a database
trigger with timestamps, actor and before/after records. Edits to status, notes,
fit reviews, document selections and follow-up dates enter that history.

The `jobs-private` bucket is private. Its SELECT and INSERT policies require
owner+MFA and matching document metadata. Reads use authenticated download
requests, never public URLs or long-lived signed URLs. There are no object
UPDATE or DELETE policies: uploaded bytes cannot be overwritten or deleted by
the client. PDF previews use a sandboxed Blob iframe after an authorized fetch;
DOCX uses a private download. Browser PDF support can vary. Draft text remains
editable, uploaded files remain separate versions, and submitted metadata is
immutable. Selected finished version IDs are captured atomically by
`jobs_mark_applied`. New versions do not overwrite old ones. Bucket size limit:
8 MiB; PDF and DOCX MIME types only. Client signature checks catch obvious file
mismatches, but are not malware scanning. Open downloaded documents in a trusted
viewer. Administrative cleanup/retention is a separate private database/storage
maintenance action; no destructive cleanup runs automatically.

Job descriptions, email text and filenames are rendered as text. No email HTML
is inserted into the page. Email attachments and remote images are never fetched.
HTTP, javascript, data, credential-bearing and local-address posting links are
rejected. Unknown HTTPS destinations are flagged for manual verification. There
is no server fetch of posting URLs. No scraping, application submission, AI
provider call, email sending or Teal API integration is implemented.

## Owner walkthrough

1. **Find Jobs:** edit the five saved searches and local employer links. Open
   LinkedIn Jobs, Indeed, OhioMeansJobs, USAJOBS or employer pages yourself.
   Save a posting URL and paste its description. Choose a private master profile.
   Review required skills, location, arrangement and experience; record evidence
   or an override reason. Keyword evidence is only a prompt for review, never a
   score or invented qualification. Similar company/title records are flagged;
   normalized URLs and source IDs are exact-deduplication keys.
2. **Alerts:** paste text/HTML from Gmail, Outlook or Yahoo, or import a plain
   text/EML file. Preview the individual leads, then confirm import into the
   review queue. Multipart EML requires copying the visible text instead; it is
   flagged rather than accidentally importing attachments. Synthetic digest
   button demonstrates two jobs. Unknown formats and suspicious links require
   manual review. Save a reviewed lead as a new application or dismiss it.
   Existing application status is never changed by an email import.
3. **Applications:** search/filter by status and track, group by status or select
   follow-ups due. Open a record to edit every job field and see timestamped
   history. Dates track work; they do not send notifications. CSV import previews
   all rows, blocks invalid rows, skips exact duplicates and retains distinct
   jobs. Partial failure reports completed imports; repeating is safe via exact
   keys. Private CSV export includes document version IDs and neutralizes
   spreadsheet formula prefixes. It contains personal data; store it securely.
4. **Documents:** create/edit private master profiles. In an application, open
   the Teal handoff: copy the selected profile, job description and requirement
   checklist yourself. Opening Teal does not upload any content. Upload a finished
   résumé or cover letter with a version label, or keep an editable text draft.
5. **Open Application** opens the original posting and leaves status unchanged.
   After YOU submit there, use **Mark Applied**, confirm the date and select the
   exact uploaded files used. Schedule the next follow-up via Edit details.
6. Sign out when finished. Application data is not stored in browser storage.

Legacy Daily Workspace JSON backups are preserved. To migrate old entries,
export the backup, privately map its job entries to CSV fields `title`, `company`,
`posting_url` (required), `status`, `next_follow_up`, `notes`, then use CSV preview.
Old entries have no posting URL, so no automatic migration can invent one.

## Dedicated Gmail inbox: optional, requires explicit authorization

The server importer uses Gmail's official read-only API with one dedicated
mailbox. There is no live connection or credential in this branch. The UI stays
disconnected until the owner explicitly authorizes and server configuration is
present. Each import is owner-triggered at AAL2; there is no unattended cron
with a service key that bypasses MFA. Run daily from Alerts; optionally configure
a personal reminder outside the app. A production scheduling service would need
its own separately approved authorization design.

1. Create a dedicated Gmail mailbox for job alerts. In Google Cloud, enable Gmail
   API and configure an OAuth client/consent screen. Authorize that mailbox for
   **`https://www.googleapis.com/auth/gmail.readonly`**, with offline access to
   obtain a refresh token using Google's supported OAuth flow. OAuth testing
   mode may expire refresh tokens; configure the consent application appropriately
   before relying on daily use. This branch does not host a public OAuth callback.
2. Privately set Edge Function secrets `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`,
   `GMAIL_REFRESH_TOKEN`, `GMAIL_INBOX_ADDRESS`, `JOBS_WEB_ORIGIN` (origin only,
   e.g. `https://cybersamliya.github.io`) and optionally `GMAIL_LABEL_ID` (defaults
   to INBOX). Supabase supplies `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Do not use
   a service-role key. Never put values in Git, static builds, logs or chat.
3. Deploy `supabase/functions/job-alert-import` with the supported Supabase CLI.
   Keep JWT verification enabled; the function additionally verifies the user
   through Auth and calls the owner+MFA predicate. Allow server HTTPS access to
   `oauth2.googleapis.com` and `gmail.googleapis.com` in the chosen host/network.
4. In Jobs → Alerts, choose **Authorize dedicated inbox**, review the authorization
   text, then explicitly confirm. The function checks the grant is read-only and
   verifies `/users/me/profile` matches `GMAIL_INBOX_ADDRESS` before enabling it.
5. **Import / Retry** processes 25 messages per page and stores only message ID,
   source, receipt time and extracted leads, not raw MIME or attachments. Pagination
   is retained; retries deduplicate by Gmail message ID. Run again for more pages.
   When the mailbox scan ends the cursor clears so the next daily scan finds new
   messages. Last success, per-run counts and safe errors appear in Alerts.
   Long-running or expired page tokens can be reset by authorizing the dedicated
   inbox again; no mailbox messages are deleted or marked read.
6. **Disconnect** disables future runs in Postgres. Revoke the OAuth grant in the
   dedicated Google account and remove the server refresh-token secret to fully
   revoke provider access. Already queued leads remain private until archived.

Retarget job-board alert delivery to the dedicated address using each board's
alert settings, where supported. For existing Gmail alerts, create filters for
specific verified senders/subjects, confirm the dedicated forwarding address,
then apply forwarding only to those filters. Outlook rules can forward selected
job-alert senders/subjects to the dedicated mailbox when tenant policy allows;
check Outlook's forwarding restrictions before relying on a rule. Yahoo accounts
can manually forward selected alerts, or paste them here; do not assume automatic
forwarding is available. Validate forwarding once using a synthetic alert and
check the review queue. No access to personal Gmail, Outlook or Yahoo is needed
for paste/import. Outlook API ingestion is not implemented in this version.

## Verification scope

`npm test` runs pure parser/CSV/fit tests and executes the migration against
PGlite's PostgreSQL engine with modeled Auth claims and Storage tables. It tests
signed-out, non-owner with spoofed role metadata, owner AAL1 and owner AAL2,
private-table reads/writes, Storage access, file immutability, append-only audit,
atomic submission and retry-safe multi-job import. This tests SQL policies, not
Supabase's hosted JWT signature verification or Storage service deployment.

`npm run test:browser` uses Chromium and synthetic Supabase HTTP responses to
exercise sign-in gating, legacy backups, public routes, the multi-job alert →
review → document upload/download → official posting → mark applied → follow-up
→ export workflow, unsafe email text, keyboard focus and mobile overflow.
It is not a live account integration test. No Gmail, Teal, job-board, private
Supabase or real application-submission integration has been tested with a live
account. Complete the hosted checks after configuring a staging project.

Official references inspected during implementation (2026-11-11):
- [Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa) and [TOTP](https://supabase.com/docs/guides/auth/auth-mfa/totp), including enrollment/challenge/verify.
- [Postgres RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), including AAL2 and fixed-search-path security-definer guidance.
- [Storage access control](https://supabase.com/docs/guides/storage/security/access-control).
- Reachable official source: `supabase/supabase`, `apps/docs/content/guides/` on GitHub.
- [Google Gmail discovery definition](https://github.com/googleapis/google-api-nodejs-client/blob/main/discovery/gmail-v1.json), including full messages, profile and read-only scopes.

Local validation result: **16 Node/Postgres/importer tests passed; 6 Chromium
scenarios passed**. The browser fixture uses synthetic Auth tokens and API
responses. The importer is exercised against synthetic Gmail responses, including
wrong-account rejection, disconnect, attachment skipping and retry deduplication.
No live account integration is claimed.
