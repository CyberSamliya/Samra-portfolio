import { mkdir, readdir, cp, rm } from "node:fs/promises";
await rm("_site", { recursive: true, force: true });
await mkdir("_site/admin/jobs", { recursive: true });
for (const item of await readdir("."))
  if (/\.(html|pdf)$/.test(item)) await cp(item, "_site/" + item);
await cp("letters", "_site/letters", { recursive: true });
for (const item of ["index.html", "jobs.css", "dist"])
  await cp("admin/jobs/" + item, "_site/admin/jobs/" + item, {
    recursive: true,
  });
