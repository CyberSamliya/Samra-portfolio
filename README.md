# Samra Ayele portfolio

The public portfolio remains a static GitHub Pages site. The owner workspace is
at **Admin → Jobs**, `admin/jobs/index.html`. Public career background, technical
references, and existing PDFs remain independent of private application files.

```sh
npm ci
npm run build:site
python3 -m http.server 8011 --directory _site
```

Open the served site locally. The unconfigured Jobs page is locked and stores no
private records. Configure a separate Supabase backend before real use; see
[setup, security model and owner walkthrough](docs/jobs-workspace.md).

```sh
npm test                 # parser/CSV/fit tests and real Postgres policy tests via PGlite
npm run test:browser     # Chromium UI flows with synthetic Supabase HTTP fixtures
```

Browser tests use `/usr/bin/chromium` by default; set `CHROMIUM_PATH` to another
installed Chromium executable. For CI, install with `npx playwright install --with-deps chromium`.
The review workflow uploads `_site` as an artifact and does not deploy it.

Existing Daily Workspace backups retain legacy job entries. That workspace no
longer offers public job-search actions. No automatic upload of legacy data occurs.

## Netlify hosting

Import this repository in Netlify and select `feature/owner-jobs-workspace` for
a staging site. `netlify.toml` sets Node 24, `npm run build:site`, and `_site` as
the publish directory. The Jobs route is `/admin/jobs/`; public pages and PDFs
keep their relative links. Netlify hosts the frontend; Supabase remains the
private backend. See [Netlify setup](docs/netlify.md) before connecting real data.
