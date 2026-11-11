# Host the portfolio and Jobs interface on Netlify

Netlify can replace GitHub Pages for static hosting. Supabase still supplies
Auth, MFA, Postgres, private Storage and the Gmail importer. Netlify hosting
alone does not replace those backend services.

## Stage the feature branch

1. In Netlify, import `CyberSamliya/Samra-portfolio` from GitHub. For the initial
   staging site, select **`feature/owner-jobs-workspace`** as its branch. This
   creates a separate Netlify address without changing the public GitHub Pages
   site or a custom domain. Do not point a production domain at it yet.
2. Use the committed `netlify.toml`: Node **24**, build command
   **`npm run build:site`**, publish directory **`_site`**. Netlify installs the
   locked npm dependencies, including the build tool. Do not omit development
   dependencies during the build or set NODE_ENV=production for installation.
3. Inspect the generated Netlify deploy URL. The public portfolio lives at `/`,
   and Jobs lives at `/admin/jobs/` (or `/admin/jobs/index.html`). `/admin` redirects
   to Jobs. Existing HTML and PDF links remain relative. No SPA catch-all routes
   are configured, so unknown files retain normal 404 behavior.
4. The build is locked by default: `admin/jobs/config.js` contains no backend
   URL/key. Set its public URL and publishable key to a **separate staging
   Supabase project**, following [owner setup](jobs-workspace.md). Never include
   service keys, refresh tokens, personal samples or real documents in Git or
   the static build. Provision the owner privately and require MFA there.
5. For a live Gmail import on that staging site, set the Supabase Edge Function's
   `JOBS_WEB_ORIGIN` to the exact Netlify site origin (scheme and hostname only).
   Keep Gmail OAuth secrets in Supabase, not Netlify's frontend configuration.
   Do not use wildcard origins. The importer remains disconnected until the
   owner authorizes it. Password/TOTP login does not need an Auth callback URL;
   any later invitation/recovery feature must register the exact Netlify URL.
6. Recheck public routes/PDFs, sign-in/MFA, RLS and private downloads on the hosted
   staging site before using real data. Netlify applies no-store, noindex,
   nosniff, frame-denial and no-referrer headers to Jobs pages/assets.

## Deploy previews and production

After the Netlify site is connected, enable Deploy Previews for pull requests
in Netlify's build settings. Previews should remain unconfigured or use a
separate staging backend; they must not share production private data. Changing
preview hosts also requires explicitly updating the staging importer's allowed
origin if live Gmail testing is needed. Prefer synthetic alerts for previews.

Only after explicit approval, merge the feature and configure the production
Netlify site/branch and domain. Update the private backend's allowed origin for
that production host. Nothing in this branch automatically creates a Netlify
site, changes DNS, deploys a production site or merges a PR.

The included GitHub workflow continues to build/test and upload a review artifact;
Netlify handles hosting separately. A Netlify account/site connection is needed
to obtain a hosted preview. No Netlify credentials were available during this
implementation, so only the local build has been validated.
