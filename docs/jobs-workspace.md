# Use Jobs now: device-local workspace

The user approved replacing the previous owner-login/MFA requirement with browser-local
storage. The Netlify staging site opens Jobs directly. No backend, signup, password,
Supabase account, Gmail authorization or paid plan is needed.

## Where your data lives

Records and exact PDF/DOCX file bytes are stored in **IndexedDB in your browser
profile**, at this site's origin. The site server receives none of them. There
is no owner authentication, cloud synchronization or encryption guarantee. Anyone
using your browser profile can open this workspace. Submitted-version restrictions
protect the normal editing workflow, not against someone controlling the browser.

Use your usual browser/profile, not incognito, for ongoing work. Clearing site data,
browser eviction, device loss or switching domain can remove or hide your records.
Export backups regularly. Netlify's project privacy settings are separate from
this storage model; they do not create a Jobs account or sync records.

## Start using it

1. Open `/admin/jobs/` on the staging site. Find Jobs opens immediately with five
   editable saved searches and local employer links. Job-board links open the
   original site; this app never scrapes or submits applications.
2. **Documents:** edit the starter Cybersecurity and Operational Excellence master
   profiles, or add another. Use only verified experience.
3. **Find Jobs → Add a job:** enter a title, company, official HTTPS URL and pasted
   description. Choose a profile. Review required skills, location, arrangement
   and experience. Any fit override needs a reason. Suggestions are prompts for
   human review, never invented qualifications.
4. **Alerts:** paste a digest from Gmail, Outlook or Yahoo, or import plain text/EML.
   Preview the leads, confirm import, then review and save an individual lead.
   Unknown formats and suspicious links are flagged. Multipart EML needs visible
   text pasted manually; attachments/images are skipped. Identical imports are
   idempotent. The synthetic sample button is optional; no sample data is seeded
   into your applications automatically. Automatic inbox connections are unavailable.
5. **Applications:** search, filter/group statuses, and view follow-ups due. Dates
   do not send notifications. Exact normalized URLs/source IDs are deduplicated;
   similar company/title records remain separate with a review notice. CSV imports
   show a preview. CSV export contains job fields and selected document version IDs.
6. Open an application to edit details or see its timestamped history. Open Teal
   for a manual tailoring handoff. Copy the selected résumé and job description
   yourself; no content is sent automatically and no AI integration is connected.
7. Save a text draft or attach a finished PDF/DOCX up to 8 MiB with a version label.
   Downloads/previews read the saved file from this browser. Uploaded bytes cannot
   be replaced through the interface; create a new version to change a file.
8. **Open Application** opens the posting and leaves status unchanged. Submit there
   yourself. Then use **Mark Applied**, confirm the date and exact document versions.
   Submitted versions stay read-only in the interface. Edit the next follow-up date.

## Export backup / Restore backup

**Export backup** in the header downloads one JSON file containing all applications,
change history, leads, searches, employer settings, master profiles, drafts and
uploaded PDF/DOCX bytes. It contains personal data in readable form (file bytes
are base64 encoded, not encrypted). Store it in a trusted location. **CSV is not
a full backup** and cannot restore your documents or profiles.

To move to another device/browser/site address, open Jobs there, choose **Restore
backup**, select the JSON, review its record/file counts, then explicitly choose
**Replace this browser’s Jobs data**. Export the current browser's backup first.
Restore replaces the Jobs database only; it does not affect the daily workspace.
Validation and an atomic IndexedDB transaction keep current records if restoration
fails. Incomplete backups missing document files or invalid relationships are rejected.
Very large backups need sufficient browser memory and storage; a failed restore
leaves the existing database intact.

If browser storage is blocked/full, the app reports a storage error rather than
pretending unsaved memory is durable. Allow site storage/free space and retry.
Use refresh to pick up changes from another tab. Concurrent writes use database
transactions, but avoid editing the same application simultaneously in two tabs.

## Existing data and deployment

Old `samra-workspace-v1` Daily Workspace backups/storage remain untouched. To
migrate old job entries, export that workspace backup and privately map job title,
company, verified posting URL and optional status/follow-up into CSV, then use CSV
preview. Do not invent missing URLs. This Jobs backup format is separate.

Only the feature branch/staging site changes. The GitHub Pages production portfolio
and existing applications remain unchanged. No backend or inbox has been connected.
The former cloud implementation's migrations/functions are retained solely as a
future reference; [archived cloud notes](cloud-backend-reference.md) are not the
current setup instructions. No Supabase SDK or credentials are used by the browser.
