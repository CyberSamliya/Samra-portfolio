import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const ROOT = "/Samra-portfolio";
const PASSWORD = "synthetic-vault-password-2026";
async function enter(page) {
  await expect(
    page.getByLabel("Vault password", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Vault password", { exact: true }).fill(PASSWORD);
  if (
    await page
      .getByRole("button", { name: "Create password & open Jobs" })
      .isVisible()
  ) {
    await page.getByLabel("Confirm password", { exact: true }).fill(PASSWORD);
    await page
      .getByRole("button", { name: "Create password & open Jobs" })
      .click();
  } else
    await page
      .getByRole("button", { name: "Unlock Jobs", exact: true })
      .click();
  await expect(page.locator("#workspace")).toBeVisible();
}
async function open(page) {
  await page.goto(ROOT + "/admin/jobs/index.html");
  await enter(page);
}
async function data(page) {
  return page.evaluate(async (password) => {
    const { createLocalAPI } =
      await import("/Samra-portfolio/admin/jobs/src/local-api.js");
    const { unlockVault } =
      await import("/Samra-portfolio/admin/jobs/src/vault.js");
    const codec = await unlockVault(password);
    const api = await createLocalAPI(undefined, codec);
    try {
      return (await api.snapshot()).data;
    } finally {
      api.close();
      codec.close();
    }
  }, PASSWORD);
}
test("real browser-local workflow persists files and records, backs up and restores on another browser", async ({
  page,
  browser,
}) => {
  const errors = [];
  const outbound = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:8011")) outbound.push(r.url());
  });
  await open(page);
  await expect(page.getByLabel("Browser storage notice")).toContainText(
    "no cloud account or sync",
  );
  await expect(
    page.getByRole("textbox", { name: "Password", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Alerts", exact: false }).click();
  await expect(
    page.getByRole("button", { name: "Authorize dedicated inbox" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Load synthetic digest" }).click();
  await page
    .getByRole("button", { name: "Preview leads", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm import to review queue" })
    .click();
  await expect(page.locator(".alert-lead")).toHaveCount(2);
  await page
    .locator(".alert-lead")
    .first()
    .getByRole("button", { name: "Review & save" })
    .click();
  await page
    .getByLabel("Pasted job description")
    .fill("Python and SIEM required.");
  await page.getByLabel("Next follow-up").fill("2026-11-11");
  await page
    .getByRole("button", { name: "Save application", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "View application" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "View application" }).click();
  await expect(
    page.getByRole("link", { name: "Open Application" }),
  ).toHaveAttribute("href", "https://www.usajobs.gov/job/123456789");
  expect((await data(page)).applications[0].status).toBe("Saved");
  await page.getByRole("button", { name: "New draft or upload" }).click();
  await page.getByLabel("Version label").fill("Resume v1");
  await page.getByLabel("Editable draft text").fill("Verified coursework.");
  const bytes = Buffer.from("%PDF-1.4\nsynthetic exact file bytes\n%%EOF");
  await page.getByLabel("Finished PDF or DOCX").setInputFiles({
    name: "resume.pdf",
    mimeType: "application/pdf",
    buffer: bytes,
  });
  await page.getByRole("button", { name: "Save document version" }).click();
  await expect(page.locator("#notice")).toContainText(
    "Document version saved in this browser",
  );
  await page.reload();
  await enter(page);
  await expect(
    page.getByRole("button", { name: "View application" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "View application" }).click();
  const dl = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download file", exact: true })
    .click();
  expect(await readFile(await (await dl).path())).toEqual(bytes);
  await page.getByRole("button", { name: "Mark Applied", exact: true }).click();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Confirm submission & mark applied" })
    .click();
  await expect(page.locator("#notice")).toContainText("Submission recorded");
  expect((await data(page)).documents[0].state).toBe("Submitted");
  await page.getByRole("button", { name: "Follow-ups due" }).click();
  await expect(
    page.getByRole("button", { name: "View application" }),
  ).toHaveCount(1);
  const csvWait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect(await readFile(await (await csvWait).path(), "utf8")).toContain(
    "Applied",
  );
  const backupWait = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export backup", exact: true })
    .click();
  const file = await (await backupWait).path();
  const encrypted = JSON.parse(await readFile(file, "utf8"));
  expect(encrypted.format).toBe("samra-jobs-encrypted-backup");
  expect(encrypted.data).toBeUndefined();
  const backup = await page.evaluate(
    async ({ encrypted, password }) => {
      const { decryptBackup } =
        await import("/Samra-portfolio/admin/jobs/src/vault.js");
      return decryptBackup(encrypted, password);
    },
    { encrypted, password: PASSWORD },
  );
  expect(backup.files).toHaveLength(1);
  expect(Buffer.from(backup.files[0].base64, "base64")).toEqual(bytes);
  expect(backup.data.history.length).toBeGreaterThanOrEqual(2);
  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    await open(second);
    expect((await data(second)).applications).toHaveLength(0);
    await second
      .getByRole("button", { name: "Restore backup", exact: true })
      .click();
    await second.getByLabel("Jobs backup JSON").setInputFiles(file);
    await second.getByLabel("Backup password", { exact: true }).fill(PASSWORD);
    await second.getByRole("button", { name: "Read encrypted backup" }).click();
    await expect(second.getByRole("dialog")).toContainText("1 applications");
    await second
      .getByRole("button", { name: "Replace this browser’s Jobs data" })
      .click();
    await expect(second.locator("#notice")).toContainText("Backup restored");
    await second
      .getByRole("link", { name: "Applications", exact: false })
      .click();
    await second.getByRole("button", { name: "View application" }).click();
    const restoredWait = second.waitForEvent("download");
    await second
      .getByRole("button", { name: "Download file", exact: true })
      .click();
    expect(await readFile(await (await restoredWait).path())).toEqual(bytes);
    await expect(
      second.getByRole("button", { name: "Edit draft" }),
    ).toHaveCount(0);
  } finally {
    await other.close();
  }
  expect(errors).toEqual([]);
  expect(outbound).toEqual([]);
});
test("local transactions deduplicate, preserve submitted versions, handle concurrent tabs and reject invalid backups atomically", async ({
  page,
  context,
}) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const { createLocalAPI } =
      await import("/Samra-portfolio/admin/jobs/src/local-api.js");
    const a = await createLocalAPI("local-test"),
      b = await createLocalAPI("local-test");
    try {
      const record = {
        title: "Analyst",
        company: "Synthetic",
        posting_url: "https://example.com/jobs/1",
      };
      const app = await a.insert("applications", record);
      let duplicate = false;
      try {
        await b.insert("applications", {
          ...record,
          posting_url: record.posting_url + "?utm_source=email",
        });
      } catch {
        duplicate = true;
      }
      await Promise.all([
        a.insert("applications", {
          ...record,
          posting_url: "https://example.com/jobs/2",
        }),
        b.insert("applications", {
          ...record,
          posting_url: "https://example.com/jobs/3",
        }),
      ]);
      const doc = await a.insert("documents", {
        application_id: app.id,
        kind: "Resume",
        version: "v1",
        draft_text: "",
        object_path: "device/test/file",
        filename: "sample.pdf",
        mime_type: "application/pdf",
      });
      await a.upload(
        doc.object_path,
        new Blob(["%PDF-1.4 exact"], { type: "application/pdf" }),
      );
      await a.update("documents", doc.id, { uploaded: true });
      await a.rpc("mark_applied", {
        application: app.id,
        documents: [doc.id],
        applied_on: "2026-11-11",
      });
      let immutable = false;
      try {
        await a.update("documents", doc.id, { draft_text: "changed" });
      } catch {
        immutable = true;
      }
      const original = await a.backup();
      const invalid = JSON.parse(original);
      invalid.data.applications[0].posting_url = "javascript:alert(1)";
      let rejected = false;
      try {
        await a.restore(invalid);
      } catch {
        rejected = true;
      }
      return {
        immutable,
        duplicate,
        rejected,
        count: (await a.list("applications")).length,
        unchanged:
          original === (await a.backup()) ||
          JSON.stringify(JSON.parse(original).data) ===
            JSON.stringify((await a.snapshot()).data),
      };
    } finally {
      a.close();
      b.close();
    }
  });
  expect(result).toMatchObject({
    immutable: true,
    duplicate: true,
    rejected: true,
    count: 3,
    unchanged: true,
  });
  const second = await context.newPage();
  await open(second);
  await page.getByRole("button", { name: "＋ Add a job", exact: true }).click();
  await page.getByLabel("Job title", { exact: true }).fill("Saved across tabs");
  await page.getByLabel("Company", { exact: true }).fill("Synthetic");
  await page
    .getByLabel("Posting URL", { exact: true })
    .fill("https://example.com/shared");
  await page
    .getByRole("button", { name: "Save application", exact: true })
    .click();
  await expect(page.locator("#notice")).toContainText("Application saved");
  await second.reload();
  await enter(second);
  await second
    .getByRole("link", { name: "Applications", exact: false })
    .click();
  await expect(
    second.getByText("Saved across tabs", { exact: true }),
  ).toBeVisible();
});
test("CSV review, profile tailoring and malformed email work without authentication", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("link", { name: "Documents", exact: false }).click();
  await page.getByRole("button", { name: "Edit profile" }).first().click();
  await page.getByLabel("Verified résumé content").fill("Python coursework.");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.locator("#notice")).toContainText("Master profile saved");
  await page.getByRole("link", { name: "Applications", exact: false }).click();
  await page.getByRole("button", { name: "Import CSV" }).click();
  await page.getByLabel("CSV file").setInputFiles({
    name: "jobs.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "title,company,posting_url\nAnalyst,Synthetic,https://example.com/jobs/1\nAnalyst,Synthetic,https://example.com/jobs/1?utm_source=email\nAnalyst,Synthetic,https://example.com/jobs/2",
    ),
  });
  await expect(page.getByRole("dialog")).toContainText("3 records to review");
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(page.locator("#notice")).toContainText(
    "2 imported; 1 exact duplicates skipped",
  );
  await page.getByRole("button", { name: "View application" }).first().click();
  await page.getByRole("button", { name: "Edit details" }).click();
  await page
    .getByLabel("Master résumé")
    .selectOption({ label: "Cybersecurity" });
  await page
    .getByLabel("Pasted job description")
    .fill("Python and SIEM required");
  await page
    .getByRole("button", { name: "Review requirement evidence" })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Python: Evidence to review",
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("link", { name: "Alerts", exact: false }).click();
  await page
    .getByLabel("Paste alert text or HTML")
    .fill(
      '<script>window.injected=true</script><img src="https://evil.example/pixel"><a href="javascript:alert(1)">Apply</a>',
    );
  await page
    .getByRole("button", { name: "Preview leads", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Blocked link");
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
});
test("blocked storage fails visibly, public routes and mobile layout remain usable", async ({
  browser,
  page,
}) => {
  const context = await browser.newContext();
  try {
    const blocked = await context.newPage();
    await blocked.addInitScript(() => {
      Object.defineProperty(window, "indexedDB", {
        get() {
          throw Error("Storage blocked");
        },
      });
    });
    await blocked.goto(ROOT + "/admin/jobs/index.html");
    await expect(blocked.locator("#gate")).toContainText(
      "could not open browser storage",
    );
    await expect(
      blocked.getByRole("button", { name: "Export backup", exact: true }),
    ).toBeDisabled();
  } finally {
    await context.close();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement !== document.body),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/jobs-local-mobile.png",
    fullPage: true,
  });
  await page.route("https://**/*", (r) => r.abort());
  for (const path of [
    "/index.html",
    "/workspace.html",
    "/commands.html",
    "/triage-cases.html",
  ])
    expect((await page.goto(ROOT + path)).status()).toBe(200);
  await expect(page.locator("#job-form")).toHaveCount(0);
  expect(
    (await page.request.get(ROOT + "/franklin-dewin-andujar.pdf")).status(),
  ).toBe(200);
});

test("vault migrates existing plaintext atomically, rejects wrong passwords, encrypts files, and clears the UI on lock", async ({
  page,
}) => {
  await page.goto(ROOT + "/index.html");
  await page.evaluate(async () => {
    const { createLocalAPI } =
      await import("/Samra-portfolio/admin/jobs/src/local-api.js");
    const api = await createLocalAPI();
    const app = await api.insert("applications", {
      title: "Confidential role sentinel",
      company: "Synthetic",
      posting_url: "https://example.com/private",
    });
    const doc = await api.insert("documents", {
      application_id: app.id,
      kind: "Resume",
      version: "v1",
      draft_text: "",
      filename: "private.pdf",
      object_path: "device/migration/file",
      mime_type: "application/pdf",
    });
    await api.upload(
      doc.object_path,
      new Blob(["%PDF-1.4 confidential file sentinel"], {
        type: "application/pdf",
      }),
    );
    await api.update("documents", doc.id, { uploaded: true });
    const legacy = await api.snapshot();
    api.close();
    await new Promise((resolve, reject) => {
      const r = indexedDB.deleteDatabase("samra-jobs-local-v1");
      r.onsuccess = resolve;
      r.onerror = reject;
    });
    const old = await new Promise((resolve, reject) => {
      const r = indexedDB.open("samra-jobs-local-v1", 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("records");
        r.result.createObjectStore("files");
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = reject;
    });
    await new Promise((resolve, reject) => {
      const tx = old.transaction(["records", "files"], "readwrite");
      tx.objectStore("records").put(legacy.data, "workspace");
      for (const f of legacy.files) tx.objectStore("files").put(f.blob, f.path);
      tx.oncomplete = resolve;
      tx.onabort = reject;
    });
    old.close();
  });
  await page.goto(ROOT + "/admin/jobs/index.html");
  await expect(page.locator("#gate-help")).toContainText(
    "existing 1 applications",
  );
  await enter(page);
  const raw = await page.evaluate(async () => {
    const { openDatabase, readSnapshot } =
      await import("/Samra-portfolio/admin/jobs/src/local-store.js");
    const db = await openDatabase("samra-jobs-local-v1");
    try {
      const s = await readSnapshot(db, true);
      return {
        encrypted: s.workspace.encrypted,
        fileEncrypted: s.files[0].encrypted,
        recordsText: new TextDecoder().decode(s.workspace.ciphertext),
        fileText: new TextDecoder().decode(s.files[0].ciphertext),
      };
    } finally {
      db.close();
    }
  });
  expect(raw.encrypted).toBe(true);
  expect(raw.fileEncrypted).toBe(true);
  expect(raw.recordsText).not.toContain("Confidential role sentinel");
  expect(raw.fileText).not.toContain("confidential file sentinel");
  expect((await data(page)).applications[0].title).toBe(
    "Confidential role sentinel",
  );
  await page.getByRole("link", { name: "Applications", exact: false }).click();
  await page.getByRole("button", { name: "View application" }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Lock Jobs", exact: true }).click();
  await expect(page.locator("#content")).toBeEmpty();
  await expect(page.locator("#workspace")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Export backup", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Vault password", { exact: true })
    .fill("wrong-password-123");
  await page.getByRole("button", { name: "Unlock Jobs", exact: true }).click();
  await expect(page.locator("#notice")).toContainText("Incorrect password");
  await expect(page.locator("#workspace")).toBeHidden();
  await enter(page);
  await page.getByRole("link", { name: "Applications", exact: false }).click();
  await expect(
    page.getByText("Confidential role sentinel", { exact: true }),
  ).toBeVisible();
  const rejected = await page.evaluate(async () => {
    const { createLocalAPI } =
      await import("/Samra-portfolio/admin/jobs/src/local-api.js");
    try {
      await createLocalAPI();
      return false;
    } catch {
      return true;
    }
  });
  expect(rejected).toBe(true);
  await page.reload();
  await expect(page.locator("#workspace")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Unlock Jobs", exact: true }),
  ).toBeVisible();
});

test("vault rejects mismatched setup passwords, detects tampered backups, and auto-locks after inactivity", async ({
  page,
}) => {
  await page.goto(ROOT + "/admin/jobs/index.html");
  await page.getByLabel("Vault password", { exact: true }).fill(PASSWORD);
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("not-the-same-password");
  await page
    .getByRole("button", { name: "Create password & open Jobs" })
    .click();
  await expect(page.locator("#notice")).toContainText("Passwords do not match");
  await expect(page.locator("#workspace")).toBeHidden();
  await enter(page);
  const results = await page.evaluate(async (password) => {
    const { unlockVault, decryptBackup } =
      await import("/Samra-portfolio/admin/jobs/src/vault.js");
    const codec = await unlockVault(password);
    try {
      const backup = JSON.parse(
        await codec.backup({ sentinel: "private backup content" }),
      );
      let wrong = false,
        tampered = false;
      try {
        await decryptBackup(backup, "a-wrong-password");
      } catch {
        wrong = true;
      }
      const c = atob(backup.ciphertext);
      backup.ciphertext = btoa(
        String.fromCharCode(c.charCodeAt(0) ^ 1) + c.slice(1),
      );
      try {
        await decryptBackup(backup, password);
      } catch {
        tampered = true;
      }
      return { wrong, tampered };
    } finally {
      codec.close();
    }
  }, PASSWORD);
  expect(results).toEqual({ wrong: true, tampered: true });
  // Trigger the inactivity check without waiting fifteen minutes in a test.
  await page.evaluate(() => {
    const old = Date.now;
    Date.now = () => old() + 16 * 60 * 1000;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#workspace")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Unlock Jobs", exact: true }),
  ).toBeVisible();
});

test("failed IndexedDB commit rolls back both records and files", async ({
  page,
}) => {
  await page.goto(ROOT + "/index.html");
  const unchanged = await page.evaluate(async () => {
    const { createLocalAPI } =
      await import("/Samra-portfolio/admin/jobs/src/local-api.js");
    const { openDatabase, readSnapshot, commitSnapshot } =
      await import("/Samra-portfolio/admin/jobs/src/local-store.js");
    const api = await createLocalAPI("rollback-test");
    const db = await openDatabase("rollback-test");
    try {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").add(new Blob(["original"]), "existing");
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onabort = reject;
      });
      const before = await readSnapshot(db, true);
      let failed = false;
      try {
        await commitSnapshot(db, before, { shouldNotPersist: true }, [
          { path: "existing", value: new Blob(["replacement"]) },
        ]);
      } catch {
        failed = true;
      }
      const after = await readSnapshot(db, true);
      return (
        failed &&
        JSON.stringify(before.workspace) === JSON.stringify(after.workspace) &&
        before.revision === after.revision &&
        (await after.files[0].text()) === "original"
      );
    } finally {
      api.close();
      db.close();
    }
  });
  expect(unchanged).toBe(true);
});

test("résumé library stores independent PDF/DOCX/ZIP originals, deduplicates packages, and copies files to an application", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("link", { name: "Documents", exact: false }).click();
  await page
    .getByRole("button", { name: "Upload résumés", exact: true })
    .click();
  const pdf = Buffer.from("%PDF-1.4 synthetic library original\n%%EOF");
  const docx = Buffer.from("PK\x03\x04synthetic DOCX original");
  const zip = Buffer.from("PK\x03\x04synthetic ZIP original");
  await page.getByLabel("Résumé files or import package").setInputFiles([
    { name: "library.pdf", mimeType: "application/pdf", buffer: pdf },
    {
      name: "library.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: docx,
    },
    { name: "archive.zip", mimeType: "application/zip", buffer: zip },
  ]);
  await expect(page.getByRole("dialog")).toContainText("3 files ready");
  await page.getByRole("button", { name: "Save résumés to vault" }).click();
  await expect(page.locator("#notice")).toContainText("3 résumé files saved");
  let snapshot = await data(page);
  expect(snapshot.applications).toHaveLength(0);
  expect(snapshot.documents.filter((d) => d.library)).toHaveLength(3);
  const row = page.locator(".document").filter({
    has: page.getByRole("heading", { name: "library.pdf", exact: true }),
  });
  const dl = page.waitForEvent("download");
  await row.getByRole("button", { name: "Download file", exact: true }).click();
  expect(await readFile(await (await dl).path())).toEqual(pdf);
  await row.getByRole("button", { name: "Preview file", exact: true }).click();
  await expect(page.getByRole("dialog").locator("iframe")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  // A prepared import package is additive and hashes exact binary contents.
  const { createHash } = await import("node:crypto");
  const newPdf = Buffer.from("%PDF-1.4 another library original");
  const pack = {
    format: "samra-resume-library",
    version: 1,
    files: [
      {
        name: "same-bytes-new-name.pdf",
        sha256: createHash("sha256").update(pdf).digest("hex"),
        base64: pdf.toString("base64"),
      },
      {
        name: "new.pdf",
        sha256: createHash("sha256").update(newPdf).digest("hex"),
        base64: newPdf.toString("base64"),
      },
    ],
  };
  await page
    .getByRole("button", { name: "Upload résumés", exact: true })
    .click();
  await page.getByLabel("Résumé files or import package").setInputFiles({
    name: "import.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(pack)),
  });
  await expect(page.getByRole("dialog")).toContainText(
    "Exact duplicate: skipped",
  );
  await page.getByRole("button", { name: "Save résumés to vault" }).click();
  await expect(page.locator("#notice")).toContainText(
    "1 résumé files saved; 1 exact duplicates skipped",
  );
  await page.evaluate(async (password) => {
    const { unlockVault } =
      await import("/Samra-portfolio/admin/jobs/src/vault.js");
    const { createLocalAPI } =
      await import("/Samra-portfolio/admin/jobs/src/local-api.js");
    const codec = await unlockVault(password),
      api = await createLocalAPI(undefined, codec);
    try {
      await api.insert("applications", {
        title: "Synthetic role",
        company: "Example",
        posting_url: "https://example.com/library-job",
      });
    } finally {
      api.close();
      codec.close();
    }
  }, PASSWORD);
  await page.reload();
  await enter(page);
  await page.getByRole("link", { name: "Documents", exact: false }).click();
  await page
    .locator(".document")
    .filter({
      has: page.getByRole("heading", { name: "library.pdf", exact: true }),
    })
    .getByRole("button", { name: "Use for an application" })
    .click();
  await page.getByRole("button", { name: "Attach résumé version" }).click();
  await expect(page.locator("#notice")).toContainText("Résumé attached");
  snapshot = await data(page);
  expect(snapshot.documents.filter((d) => d.library)).toHaveLength(4);
  const copy = snapshot.documents.find((d) => !d.library);
  expect(copy.application_id).toBe(snapshot.applications[0].id);
  expect(copy.hash).toBe(createHash("sha256").update(pdf).digest("hex"));
  // All originals and the application copy survive an encrypted backup round-trip.
  const backupWait = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export backup", exact: true })
    .click();
  const exported = JSON.parse(
    await readFile(await (await backupWait).path(), "utf8"),
  );
  const summary = await page.evaluate(
    async ({ exported, password }) => {
      const { decryptBackup } =
        await import("/Samra-portfolio/admin/jobs/src/vault.js");
      const { validateBackup } =
        await import("/Samra-portfolio/admin/jobs/src/local-api.js");
      const backup = await decryptBackup(exported, password);
      const prepared = validateBackup(backup);
      return {
        files: prepared.files.length,
        library: prepared.data.documents.filter((d) => d.library).length,
      };
    },
    { exported, password: PASSWORD },
  );
  expect(summary).toEqual({ files: 5, library: 4 });
});
test("résumé package integrity failures preserve the existing vault", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("link", { name: "Documents", exact: false }).click();
  await page
    .getByRole("button", { name: "Upload résumés", exact: true })
    .click();
  await page.getByLabel("Résumé files or import package").setInputFiles({
    name: "corrupt.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "samra-resume-library",
        version: 1,
        files: [
          {
            name: "corrupt.pdf",
            sha256: "0".repeat(64),
            base64: Buffer.from("%PDF-1.4 wrong hash").toString("base64"),
          },
        ],
      }),
    ),
  });
  await expect(page.getByRole("dialog")).toContainText(
    "Import integrity check failed",
  );
  await page.getByRole("button", { name: "Save résumés to vault" }).click();
  await expect(page.getByRole("dialog")).toContainText("Choose and review");
  expect((await data(page)).documents).toHaveLength(0);
});

test("recommendation letters import separately, retain exact originals, copy to applications and back up", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("link", { name: "Documents", exact: false }).click();
  const { createHash } = await import("node:crypto");
  const files = Array.from({ length: 4 }, (_, i) => ({
    name: "Recommendation " + (i + 1) + ".pdf",
    buffer: Buffer.from("%PDF-1.4 synthetic recommendation " + i + "\n%%EOF"),
  }));
  const pack = {
    format: "samra-recommendation-library",
    version: 1,
    files: files.map((f) => ({
      name: f.name,
      sha256: createHash("sha256").update(f.buffer).digest("hex"),
      base64: f.buffer.toString("base64"),
    })),
  };
  // Identical bytes in the résumé section must not hide a recommendation letter.
  await page
    .getByRole("button", { name: "Upload résumés", exact: true })
    .click();
  await page
    .getByLabel("Résumé files or import package")
    .setInputFiles({
      name: "same.pdf",
      mimeType: "application/pdf",
      buffer: files[0].buffer,
    });
  await page.getByRole("button", { name: "Save résumés to vault" }).click();
  await expect(page.locator("#notice")).toContainText("1 résumé files saved");
  async function importLetters() {
    await page
      .getByRole("button", {
        name: "Upload recommendation letters",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Recommendation letter files or import package")
      .setInputFiles({
        name: "letters.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(pack)),
      });
    await expect(page.getByRole("dialog")).toContainText(
      "4 files ready to save",
    );
    await page.getByRole("button", { name: "Save letters to vault" }).click();
  }
  await importLetters();
  await expect(page.locator("#notice")).toContainText(
    "4 recommendation letters saved",
  );
  const letterSection = page
    .locator(".card")
    .filter({
      has: page.getByRole("heading", {
        name: "Recommendation letters",
        exact: true,
      }),
    });
  const resumeSection = page
    .locator(".card")
    .filter({
      has: page.getByRole("heading", {
        name: "Résumé file library",
        exact: true,
      }),
    });
  await expect(letterSection.locator(".document")).toHaveCount(4);
  await expect(resumeSection.locator(".document")).toHaveCount(1);
  const row = letterSection
    .locator(".document")
    .filter({
      has: page.getByRole("heading", {
        name: "Recommendation 1.pdf",
        exact: true,
      }),
    });
  const dl = page.waitForEvent("download");
  await row.getByRole("button", { name: "Download file", exact: true }).click();
  expect(await readFile(await (await dl).path())).toEqual(files[0].buffer);
  await row.getByRole("button", { name: "Preview file", exact: true }).click();
  await expect(page.getByRole("dialog").locator("iframe")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await importLetters();
  await expect(page.locator("#notice")).toContainText(
    "0 recommendation letters saved; 4 exact duplicates skipped",
  );
  await page.evaluate(async (password) => {
    const { unlockVault } =
      await import("/Samra-portfolio/admin/jobs/src/vault.js");
    const { createLocalAPI } =
      await import("/Samra-portfolio/admin/jobs/src/local-api.js");
    const codec = await unlockVault(password),
      api = await createLocalAPI(undefined, codec);
    try {
      await api.insert("applications", {
        title: "Synthetic role",
        company: "Example",
        posting_url: "https://example.com/letter-job",
      });
    } finally {
      api.close();
      codec.close();
    }
  }, PASSWORD);
  await page.reload();
  await enter(page);
  await page.getByRole("link", { name: "Documents", exact: false }).click();
  await row.getByRole("button", { name: "Use for an application" }).click();
  await page.getByRole("button", { name: "Attach letter version" }).click();
  await expect(page.locator("#notice")).toContainText(
    "Recommendation letter attached",
  );
  const snapshot = await data(page);
  expect(
    snapshot.documents.filter(
      (d) => d.library && d.library_category === "Recommendation letter",
    ),
  ).toHaveLength(4);
  const copy = snapshot.documents.find((d) => !d.library);
  expect(copy.kind).toBe("Recommendation letter");
  expect(copy.hash).toBe(pack.files[0].sha256);
  await expect(
    page.getByRole("button", { name: "Edit draft", exact: true }),
  ).toHaveCount(0);
  const backupWait = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export backup", exact: true })
    .click();
  const exported = JSON.parse(
    await readFile(await (await backupWait).path(), "utf8"),
  );
  const summary = await page.evaluate(
    async ({ exported, password }) => {
      const { decryptBackup } =
        await import("/Samra-portfolio/admin/jobs/src/vault.js");
      const { validateBackup } =
        await import("/Samra-portfolio/admin/jobs/src/local-api.js");
      const prepared = validateBackup(await decryptBackup(exported, password));
      return {
        letters: prepared.data.documents.filter(
          (d) => d.library_category === "Recommendation letter" && d.library,
        ).length,
        files: prepared.files.length,
      };
    },
    { exported, password: PASSWORD },
  );
  expect(summary).toEqual({ letters: 4, files: 6 });
});
