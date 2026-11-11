# Samra Ayele portfolio and Jobs workspace

Jobs now works **without an account or backend** at `admin/jobs/index.html`.
It stores applications, profiles, alert leads and document files in IndexedDB
on the current browser/device. Anyone using that browser profile can access it.
There is no authentication, encryption guarantee or cloud sync.

```sh
npm ci
npm run build:site
python3 -m http.server 8011 --directory _site
```

The public portfolio and its existing PDFs remain independent of Jobs data.
[Owner walkthrough and backups](docs/jobs-workspace.md) ·
[Netlify staging](docs/netlify.md).

```sh
npm test                 # core parsers plus optional legacy cloud reference tests
npm run test:browser     # actual IndexedDB/files, no mocked backend
```

Browser tests use `/usr/bin/chromium`; override `CHROMIUM_PATH` if needed.
The `supabase/` directory remains as an unused future cloud reference. It does
not run or connect anywhere in this version. No credentials are required.
