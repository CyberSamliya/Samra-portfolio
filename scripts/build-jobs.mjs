import { build } from "esbuild";
import { rm, mkdir, cp } from "node:fs/promises";
await rm("admin/jobs/dist", { recursive: true, force: true });
await mkdir("admin/jobs/dist", { recursive: true });
await build({
  entryPoints: { app: "admin/jobs/src/app.js" },
  bundle: true,
  splitting: true,
  format: "esm",
  minify: true,
  outdir: "admin/jobs/dist",
});
for (const [from, to] of [
  ["build/pdf.worker.mjs", "pdf.worker.mjs"],
  ["standard_fonts", "pdf-fonts"],
  ["cmaps", "pdf-cmaps"],
  ["wasm", "pdf-wasm"],
])
  await cp("node_modules/pdfjs-dist/" + from, "admin/jobs/dist/" + to, {
    recursive: true,
  });
