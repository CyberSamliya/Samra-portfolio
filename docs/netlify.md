# Netlify staging: device-local Jobs

The staging site uses `feature/owner-jobs-workspace`, Node 24,
`npm run build:site`, and publish directory `_site`. No environment variables,
Supabase project, login or paid service is needed for the current browser-local
Jobs workspace. Existing Netlify builds redeploy when this branch is pushed.

Jobs lives at `/admin/jobs/`. `/admin` redirects there. It opens directly and
stores records and files only in IndexedDB in the visitor's own browser profile.
Netlify hosts only static code and public portfolio assets, never these records.
Site visibility is separate; no public domain or production branch is changed.

Changing the scheme, hostname, port, browser or profile creates a different
storage location. Export a complete Jobs backup BEFORE changing domains. Restore
it on the new address. Avoid incognito mode for lasting work and back up regularly.
No custom password gate or owner-only security is claimed.

The GitHub workflow tests the build and produces a static artifact. No automatic
merge or production portfolio deployment is configured. A future cloud backend
would need a separate explicit design/setup step.
