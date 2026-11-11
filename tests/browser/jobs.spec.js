import { test, expect } from "@playwright/test";
import { backend, login } from "./fixture.js";
const ROOT = "/Samra-portfolio";
import { readFile } from "node:fs/promises";
test("public portfolio, direct subpath refresh, legacy backup, no configured backend", async ({
  page,
}) => {
  await page.route("https://**/*", (r) => r.abort());
  await page.goto(ROOT + "/index.html");
  await expect(page).toHaveTitle(/Samra Ayele/);
  await expect(
    page.getByRole("link", { name: "Admin", exact: true }),
  ).toHaveAttribute("href", "admin/jobs/index.html");
  await expect(page.locator("#resume")).toContainText(
    "A downloadable resume file has not yet been added.",
  );
  for (const path of [
    "/commands.html",
    "/workspace.html",
    "/triage-cases.html",
  ]) {
    const response = await page.goto(ROOT + path);
    expect(response.status()).toBe(200);
  }
  await page.goto(ROOT + "/workspace.html");
  await page.evaluate(() =>
    localStorage.setItem(
      "samra-workspace-v1",
      JSON.stringify({
        tasks: [],
        jobs: [
          {
            company: "Synthetic",
            role: "Analyst",
            action: "Follow up",
            follow: "2026-11-11",
            status: "Applied",
          },
        ],
        journal: "",
        story: "",
      }),
    ),
  );
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Open Admin → Jobs" }),
  ).toBeVisible();
  await expect(page.locator("#job-form")).toHaveCount(0);
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download backup" }).click();
  const download = await dl;
  const saved = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(saved.jobs).toHaveLength(1);
  await page.goto(ROOT + "/admin/jobs/index.html#applications");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Sign in to your workspace" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue →" })).toBeDisabled();
  await expect(page.locator("#workspace")).toBeHidden();
});
test("non-owner with MFA and owner without MFA never open private workspace", async ({
  browser,
}) => {
  for (const options of [
    { owner: false, mfa: true },
    { owner: true, mfa: false },
  ]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await backend(page, options);
    await login(page);
    await expect(page.locator("#workspace")).toBeHidden();
    await expect(page.locator("#notice")).toContainText(
      options.owner ? "Invalid code" : "not the configured owner",
    );
    await context.close();
  }
});
test("sample alert → reviewed application → tailored document → applied → follow-up → private export", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const fixture = await backend(page);
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Find Jobs", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/jobs-find-desktop.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Alerts", exact: false }).click();
  await page.getByRole("button", { name: "Load synthetic digest" }).click();
  await page
    .getByRole("button", { name: "Preview leads", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("SOC Analyst I");
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
    .fill("Python and SIEM required. Columbus hybrid.");
  await page.getByLabel("Location", { exact: true }).fill("Columbus, Ohio");
  await page
    .getByRole("button", { name: "Save application", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Applications", exact: true }),
  ).toBeVisible();
  expect(fixture.records.applications).toHaveLength(1);
  expect(fixture.records.applications[0].status).toBe("Saved");
  await page.getByRole("button", { name: "View application" }).click();
  await expect(
    page.getByRole("link", { name: "Open Application" }),
  ).toHaveAttribute("href", "https://www.usajobs.gov/job/123456789");
  expect(fixture.records.applications[0].status).toBe("Saved");
  // A local popup intercept verifies navigation to the official URL without submitting.
  await page
    .context()
    .route("https://www.usajobs.gov/**", (r) =>
      r.fulfill({ body: "Official application test destination" }),
    );
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Open Application" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  expect(popup.url()).toBe("https://www.usajobs.gov/job/123456789");
  await popup.close();
  expect(fixture.records.applications[0].status).toBe("Saved");
  await page.getByRole("button", { name: "New draft or upload" }).click();
  await page.getByLabel("Version label").fill("Resume v1");
  await page
    .getByLabel("Editable draft text")
    .fill("Verified Python coursework.");
  await page.getByLabel("Finished PDF or DOCX").setInputFiles({
    name: "resume.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nsynthetic sample\n%%EOF"),
  });
  await page.getByRole("button", { name: "Save document version" }).click();
  await expect(page.locator("#notice")).toContainText(
    "Document version saved privately",
  );
  expect(fixture.records.documents).toHaveLength(1);
  expect(fixture.records.documents[0].uploaded).toBe(true);
  await page.getByRole("button", { name: "View application" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download privately" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("resume.pdf");
  expect(fixture.downloads()).toBe(1);
  await page.getByRole("button", { name: "Mark Applied", exact: true }).click();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Confirm submission & mark applied" })
    .click();
  await expect(page.locator("#notice")).toContainText("Submission recorded");
  expect(fixture.records.applications[0].status).toBe("Applied");
  expect(fixture.records.documents[0].state).toBe("Submitted");
  await page.getByRole("button", { name: "View application" }).click();
  await expect(page.getByRole("button", { name: "Edit draft" })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit details" }).click();
  await page.getByLabel("Next follow-up").fill("2026-11-11");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("button", { name: "Follow-ups due" }).click();
  await expect(
    page.getByRole("button", { name: "View application" }),
  ).toHaveCount(1);
  const exportPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const csv = await readFile(await (await exportPromise).path(), "utf8");
  expect(csv).toContain("Applied");
  expect(csv).toContain(fixture.records.documents[0].id);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator("#workspace")).toBeHidden();
  await expect(page.locator("#content")).toBeEmpty();
  expect(errors).toEqual([]);
});
test("keyboard and mobile layout, unsafe alert rendered only as text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await backend(page);
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Find Jobs", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement !== document.body),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
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
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Authorize dedicated inbox" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Only continue after privately configuring",
  );
});

test("CSV preview skips exact duplicates, flags similar roles, supports private profiles", async ({
  page,
}) => {
  const fixture = await backend(page);
  fixture.records.applications.push({
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    title: "SOC Analyst I",
    company: "Synthetic",
    posting_url: "https://example.com/jobs/1",
    normalized_url: "https://example.com/jobs/1",
    source: "example.com",
    source_id: null,
    status: "Saved",
    career_track: "Cybersecurity",
    notes: "",
    submitted_document_ids: [],
  });
  await login(page);
  await page.getByRole("link", { name: "Documents", exact: false }).click();
  await page.getByRole("button", { name: "Edit profile" }).first().click();
  await page
    .getByLabel("Verified résumé content")
    .fill("Verified Python coursework and Wazuh lab.");
  await page.getByRole("button", { name: "Save private profile" }).click();
  await expect(page.locator("#notice")).toContainText(
    "Private master profile saved",
  );

  await page.getByRole("link", { name: "Applications", exact: false }).click();
  await page.getByRole("button", { name: "Import CSV" }).click();
  await page.getByLabel("CSV file").setInputFiles({
    name: "synthetic.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "title,company,posting_url\nSOC Analyst I,Synthetic,https://example.com/jobs/1\nSOC Analyst I,Synthetic,https://example.com/jobs/2",
    ),
  });
  await expect(page.getByRole("dialog")).toContainText(
    "Exact duplicate: skipped",
  );
  await expect(page.getByRole("dialog")).toContainText(
    "Similar role: retained separately",
  );
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(page.locator("#notice")).toContainText(
    "1 imported; 1 exact duplicates skipped",
  );
  expect(fixture.records.applications).toHaveLength(2);
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
  await expect(page.getByRole("dialog")).toContainText("SIEM: Not documented");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "View application" }).first().click();
  await page.getByRole("button", { name: "Prepare documents / Teal" }).click();
  await expect(page.getByRole("link", { name: "Open Teal" })).toHaveAttribute(
    "href",
    "https://www.tealhq.com/",
  );
  await expect(page.getByRole("dialog")).toContainText(
    "Verified Python coursework",
  );
});

test("first-time MFA enrollment cleans up an unfinished factor and remains gated until verification", async ({
  page,
}) => {
  const fixture = await backend(page, { enrolled: false, pending: true });
  await page.goto(ROOT + "/admin/jobs/index.html");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
  await expect(
    page.getByAltText("Authenticator enrollment QR code"),
  ).toBeVisible();
  await expect(page.locator("#workspace")).toBeHidden();
  expect(fixture.removedFactors()).toBe(1);
  await page.getByLabel("Authenticator code").fill("123456");
  await page.getByRole("button", { name: "Verify & open Jobs" }).click();
  await expect(page.locator("#workspace")).toBeVisible();
  await expect(
    page.getByAltText("Authenticator enrollment QR code"),
  ).toBeHidden();
});
