# Use Jobs now: device-local workspace

The current Jobs workspace uses a password-encrypted vault in this browser. It
requires no Supabase project, paid plan or server account. The portfolio remains
public; only local Jobs data is locked. This is not a shared owner identity:
other devices/browsers have their own empty vault and password.

## Password setup and storage

On first use, choose and confirm a strong password of at least 12 characters.
The browser derives a non-exportable AES-256-GCM key using PBKDF2/SHA-256, a
random 16-byte salt and 600,000 iterations. Every encrypted record/file uses a
fresh random 12-byte IV and authenticated context identifying its vault and
record. No password or key is persisted or sent to a server. Web Crypto requires
a secure context (HTTPS on Netlify; loopback is supported for local development).

Close other Jobs tabs before setup. Existing device-local Jobs data is encrypted
in place on first setup. IndexedDB
is upgraded to close old application connections. An atomic transaction replaces
the record and file stores with ciphertext plus public KDF metadata; failure or
a concurrent write leaves the prior database intact. Existing downloaded
plaintext backups and legacy Daily Workspace data are not retroactively encrypted.

Later visits require the same password. **Lock Jobs** clears the displayed records,
forms, dialog contents and active key reference. It also locks after 15 minutes
of inactivity and on page navigation; refresh/back navigation requires unlock.
It cannot revoke files already downloaded or protect against malicious scripts
on the same origin, an unlocked session, or a compromised device.

**There is no password reset.** Encrypted backups also require the password used
at export. Keep your password in a password manager. Losing it can make both the
vault and its backups unrecoverable. Do not clear site data to fix a password error.

Use your usual browser/profile, not incognito, for ongoing work. Clearing site data,
browser eviction, device loss or changing site address can remove/hide the vault.
Export encrypted backups regularly. Netlify project privacy is separate.

## Start using it

1. Open `/admin/jobs/` on the staging site. Create or unlock your vault; Find Jobs opens with five
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
uploaded PDF/DOCX bytes. The JSON envelope is encrypted with the current vault password, including all
record and file contents. Store it in a trusted location and retain that password. **CSV is not
a full backup** and cannot restore your documents or profiles.

To move to another device/browser/site address, open Jobs there, create/unlock a vault there, choose **Restore
backup**, select the JSON, enter the backup’s export password and choose **Read
encrypted backup**. Review its record/file counts, then explicitly choose
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

## Validation

Chromium tests exercise password setup/unlock, wrong/mismatched passwords, migration
of existing plaintext records/files, ciphertext at rest, encrypted backup restoration
in a separate browser context, backup tampering, manual and inactivity locking,
refresh locking, blocked storage, normal Jobs flows and public portfolio routes.
These are actual Web Crypto and IndexedDB tests, without a mocked backend.
Passkeys/WebAuthn are not implemented; this version uses a local vault password.

## Résumé file library

Documents → **Résumé file library → Upload résumés** saves files independently
of job applications. Select multiple PDFs, DOCX documents or ZIP archives (each
up to 8 MiB), review the list, then choose **Save résumés to vault**. A prepared
`samra-resume-library` JSON package can also be selected there; it includes file
bytes and SHA-256 checksums. Package imports add records, never replace your
vault or application history. Exact duplicate contents are skipped atomically.
ZIP archives are stored/downloaded as files, not automatically extracted by the
browser. A prepared package may include their extracted PDF files separately.

Saved files are encrypted with the same vault password, included in encrypted
backups, and can be downloaded with their original names. PDFs support local
preview. **Use for an application** creates an independent PDF/DOCX version on
an existing application while preserving the library original; ZIP archives
cannot be attached as application résumés. Record the submitted copy normally.

Prepared import packages contain readable base64 file contents, not encryption.
Keep them private and never commit them to Git or publish them with the static
site. Importing requires the owner to unlock their vault in their browser; the
assistant cannot directly modify a vault on another browser/device. No attached
résumé content is embedded in this repository or deployment.

## Recommendation letters

Documents → **Recommendation letters → Upload recommendation letters** saves
original PDF/DOCX letters in a separate encrypted library. A prepared
`samra-recommendation-library` JSON package imports multiple letters together,
with SHA-256 checks for the exact original bytes. Reimporting the same files
skips duplicates without affecting the résumé library or existing applications.
Download and PDF preview work after unlocking. **Use for an application** makes
an independent recommendation-letter version; original letter text is not made
editable. Letter originals and application copies are included in encrypted
backups and checked during restoration.

Prepared letter packages are readable import files and must be kept private.
The browser owner must unlock Jobs and import them; the assistant cannot insert
files directly into another device's vault. This feature does not remove or
change any recommendation PDFs already present in the public portfolio checkout.
