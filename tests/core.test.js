import test from "node:test";
import assert from "node:assert/strict";
import {
  safeURL,
  normalizeURL,
  sourceIdentity,
  probableMatches,
  parseDigest,
  digestKey,
  parseCSV,
  exportCSV,
  assessFit,
} from "../supabase/functions/_shared/jobs-core.js";
import {
  bodyText,
  parseGmailMessage,
} from "../supabase/functions/_shared/gmail.js";
test("only public HTTPS links, preserve distinct jobs and deduplicate tracking URLs", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,x",
    "http://example.com",
    "https://user:pass@example.com",
    "https://127.0.0.1/a",
    "https://[::1]",
    "https://localhost",
    "https://x.local",
    "https://example.com:444/a",
  ])
    assert.equal(safeURL(url), null, url);
  assert.equal(
    normalizeURL("https://EXAMPLE.com/jobs/1/?utm_source=email&b=2&a=1#apply"),
    "https://example.com/jobs/1?a=1&b=2",
  );
  assert.notEqual(
    normalizeURL("https://example.com/jobs/1"),
    normalizeURL("https://example.com/jobs/2"),
  );
  assert.deepEqual(sourceIdentity("https://www.indeed.com/viewjob?jk=123"), {
    source: "Indeed",
    source_id: "123",
  });
  assert.equal(
    sourceIdentity("https://www.linkedin.com/jobs/view/1234").source_id,
    "1234",
  );
  assert.equal(
    probableMatches({ company: "Example, Inc.", title: "SOC Analyst I" }, [
      { id: "1", company: "Example Inc", title: "SOC Analyst I" },
    ]).length,
    1,
  );
});
test("untrusted multi-job digests become individual review leads; unsafe and unknown formats flagged", async () => {
  const body =
    "SOC Analyst I | Example\nhttps://www.usajobs.gov/job/123\nJunior Analyst | Other\nhttps://careers.example.com/2";
  const leads = parseDigest(body);
  assert.equal(leads.length, 2);
  assert.equal(leads[0].title, "SOC Analyst I");
  assert.equal(leads[1].company, "Other");
  assert.match(leads[1].warning, /Unverified/);
  assert.match(parseDigest("hello")[0].warning, /No usable/);
  const html =
    '<script>alert(1)</script><img src="https://tracker.example/x"><p>Analyst | Example</p><a href="javascript:alert(1)">Apply</a>';
  assert.equal(parseDigest(html).length, 1);
  assert.match(parseDigest(html)[0].warning, /Blocked/);
  assert.equal(await digestKey(body), await digestKey(body));
  assert.notEqual(await digestKey(body), await digestKey(body + "!"));
  assert.throws(() => parseDigest("x".repeat(200001)), /200 KB/);
});
test("Gmail MIME bodies skip attachments and prefer plain text over HTML", () => {
  const data = (s) => Buffer.from(s).toString("base64url");
  const msg = {
    payload: {
      parts: [
        {
          mimeType: "text/plain",
          body: {
            data: data("SOC Analyst | Example\nhttps://www.usajobs.gov/job/5"),
          },
        },
        {
          mimeType: "text/html",
          body: { data: data('<img src="https://tracker.example">') },
        },
        {
          mimeType: "text/plain",
          filename: "secret.txt",
          body: { data: data("SECRET") },
        },
        { mimeType: "application/pdf", body: { attachmentId: "never-fetch" } },
      ],
    },
  };
  assert.doesNotMatch(bodyText(msg), /SECRET|tracker/);
  assert.equal(parseGmailMessage(msg).length, 1);
});
test("CSV round trip, quoted newlines, formula neutralization, invalid and duplicate headers", () => {
  const a = {
    title: "SOC, Analyst",
    company: '=HYPERLINK("bad")',
    posting_url: "https://example.com/jobs/1",
    notes: 'Line one\n"Line two"',
    status: "Saved",
  };
  const csv = exportCSV([a]);
  assert.match(csv, /'=HYPERLINK/);
  const [row] = parseCSV(csv);
  assert.deepEqual(row.errors, []);
  assert.equal(row.app.company, a.company);
  assert.equal(row.app.notes, a.notes);
  assert.throws(() => parseCSV('title,company,posting_url\n"oops'), /Unclosed/);
  assert.throws(
    () => parseCSV("title,title,company,posting_url\na,b,c,d"),
    /Duplicate/,
  );
  assert.ok(
    parseCSV(
      "title,company,posting_url,date_found,status\nA,B,javascript:x,2026-99-99,Applied",
    )[0].errors.length >= 3,
  );
});
test("fit assessment reports evidence to review, never invents experience", () => {
  assert.deepEqual(assessFit("Python and SIEM required", "Python coursework"), [
    { skill: "SIEM", result: "Not documented — review required" },
    { skill: "Python", result: "Evidence to review" },
  ]);
  assert.deepEqual(assessFit("No recognized skill keywords", ""), []);
});

test("document import packages require valid checksums and the correct library type", async () => {
  const { readResumePackage, readRecommendationPackage } =
    await import("../admin/jobs/src/resume-library.js");
  const bytes = Buffer.from("%PDF-1.4 synthetic letter");
  const { createHash } = await import("node:crypto");
  const file = {
    name: "letter.pdf",
    base64: bytes.toString("base64"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const pack = {
    format: "samra-recommendation-library",
    version: 1,
    files: [file],
  };
  assert.equal((await readRecommendationPackage(pack)).length, 1);
  await assert.rejects(readResumePackage(pack), /supported document import/);
  await assert.rejects(
    readRecommendationPackage({ ...pack, files: [{ ...file, sha256: "" }] }),
    /Invalid document import/,
  );
  await assert.rejects(
    readRecommendationPackage({
      ...pack,
      files: [{ ...file, sha256: "0".repeat(64) }],
    }),
    /integrity/,
  );
});
