export const STATUSES = [
  "Saved",
  "Preparing",
  "Applied",
  "Screening",
  "Interview",
  "Offer",
  "Rejected",
  "Withdrawn",
  "Archived",
];
export const TRACKS = ["Cybersecurity", "Operational Excellence"];
export const BOARD_LINKS = [
  ["LinkedIn Jobs", "https://www.linkedin.com/jobs/"],
  ["Indeed", "https://www.indeed.com/"],
  ["OhioMeansJobs", "https://ohiomeansjobs.ohio.gov/job-seekers"],
  ["USAJOBS", "https://www.usajobs.gov/"],
];
export const DEFAULT_SEARCHES = [
  "SOC Analyst I",
  "Junior Security Analyst",
  "Cybersecurity Analyst",
  "Operational Excellence Specialist",
  "Continuous Improvement Specialist",
].map((title) => ({
  id: title,
  title,
  location: "Columbus, Ohio · nearby hybrid · U.S. remote",
}));
export const DEFAULT_EMPLOYERS = [
  {
    name: "Nationwide",
    url: "https://www.nationwide.com/personal/about-us/careers/",
  },
  { name: "The Ohio State University", url: "https://hr.osu.edu/careers/" },
  { name: "State of Ohio", url: "https://careers.ohio.gov/" },
];
export function safeURL(value) {
  try {
    const u = new URL(String(value).trim());
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      !u.hostname.includes(".") ||
      /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/.test(u.hostname) ||
      /^[\d.]+$/.test(u.hostname) ||
      u.hostname.includes(":")
    )
      return null;
    return u;
  } catch {
    return null;
  }
}
export function normalizeURL(value) {
  const u = safeURL(value);
  if (!u)
    throw Error(
      "Use an HTTPS posting URL without credentials or a private address.",
    );
  u.hash = "";
  for (const k of [...u.searchParams.keys()])
    if (/^utm_|^(ref|refId|trackingId|trk|source|campaign)$/i.test(k))
      u.searchParams.delete(k);
  u.searchParams.sort();
  u.pathname = u.pathname.replace(/\/+$/, "") || "/";
  return u.href;
}
export function sourceIdentity(value) {
  const u = safeURL(value);
  if (!u) return { source: "Manual", source_id: null };
  const h = u.hostname.replace(/^www\./, "");
  if (h === "linkedin.com")
    return {
      source: "LinkedIn",
      source_id:
        u.pathname.match(/\/jobs\/view\/(\d+)/)?.[1] ||
        u.searchParams.get("currentJobId"),
    };
  if (h === "indeed.com")
    return {
      source: "Indeed",
      source_id: u.searchParams.get("jk") || u.searchParams.get("vjk"),
    };
  if (h === "usajobs.gov")
    return {
      source: "USAJOBS",
      source_id: u.pathname.match(/\/job\/(\d+)/i)?.[1],
    };
  return { source: h, source_id: null };
}
export function probableMatches(app, records) {
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  return records.filter(
    (r) =>
      r.id !== app.id &&
      norm(r.company) === norm(app.company) &&
      norm(r.title) === norm(app.title),
  );
}
export function assessFit(description, profile = "") {
  const skills = [
    "SIEM",
    "Splunk",
    "Wazuh",
    "incident response",
    "Python",
    "SQL",
    "NIST",
    "Lean",
    "Six Sigma",
    "5S",
    "continuous improvement",
  ];
  const text = description.toLowerCase(),
    base = profile.toLowerCase();
  return skills
    .filter((s) => text.includes(s.toLowerCase()))
    .map((skill) => ({
      skill,
      result: base.includes(skill.toLowerCase())
        ? "Evidence to review"
        : "Not documented — review required",
    }));
}
export function textFromHTML(html) {
  return String(html)
    .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(
      /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      "$2\n$1\n",
    )
    .replace(/<\/?(?:p|div|br|li|tr|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
export function parseDigest(input) {
  if (typeof input !== "string" || input.length > 200000)
    throw Error("Alert must be text under 200 KB.");
  const text = /<(?:html|body|a|div|p)\b/i.test(input)
    ? textFromHTML(input)
    : input;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const leads = [],
    seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const links =
      lines[i].match(/(?:https?:\/\/|javascript:|data:)[^\s<>"']+/gi) || [];
    for (let raw of links) {
      raw = raw.replace(/[),.;]+$/, "");
      const u = safeURL(raw);
      const url = u ? normalizeURL(raw) : raw;
      if (seen.has(url)) continue;
      seen.add(url);
      const label =
        lines[i].replace(raw, "").trim() || lines[i - 1] || "Untitled lead";
      const [title, company = ""] = label.split(/\s+\|\s+/);
      const host = u?.hostname.replace(/^www\./, "");
      const known = [
        "linkedin.com",
        "indeed.com",
        "usajobs.gov",
        "ohiomeansjobs.ohio.gov",
      ];
      const warning = !u
        ? "Blocked link: use an official HTTPS posting."
        : known.includes(host)
          ? ""
          : "Unverified destination: confirm the official employer posting. Links in alerts may be tracking or phishing links.";
      leads.push({
        title: title.slice(0, 250),
        company: company.slice(0, 250),
        url,
        warning,
      });
      if (leads.length >= 100)
        throw Error("Too many links; split this digest into smaller imports.");
    }
  }
  if (!leads.length)
    leads.push({
      title: "Unknown alert format — review manually",
      company: "",
      url: "",
      warning:
        "No usable job URL found. Paste the official URL and title after review.",
    });
  return leads;
}
export async function digestKey(text) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export const CSV_FIELDS = [
  "title",
  "company",
  "requisition_id",
  "posting_url",
  "source",
  "source_id",
  "career_track",
  "location",
  "arrangement",
  "pay_range",
  "date_found",
  "deadline",
  "date_applied",
  "next_follow_up",
  "status",
  "notes",
  "description",
  "submitted_document_ids",
];
export function exportCSV(rows) {
  const escape = (v) =>
    '"' +
    String(Array.isArray(v) ? v.join(";") : (v ?? ""))
      .replace(/^[=+\-@\t\r]/, "'$&")
      .replace(/"/g, '""') +
    '"';
  return [
    CSV_FIELDS.map(escape).join(","),
    ...rows.map((r) => CSV_FIELDS.map((f) => escape(r[f])).join(",")),
  ].join("\r\n");
}
export function parseCSV(text) {
  if (text.length > 2000000) throw Error("CSV must be under 2 MB.");
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    let c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (!field || quoted) quoted = !quoted;
      else throw Error("Malformed CSV quote.");
    } else if (!quoted && (c === "," || c === "\n" || c === "\r")) {
      row.push(field);
      field = "";
      if (c !== ",") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else field += c;
  }
  if (quoted) throw Error("Unclosed CSV quote.");
  row.push(field);
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2 || rows.length > 1001)
    throw Error("CSV needs a header and 1–1000 records.");
  const headers = rows.shift();
  if (new Set(headers).size !== headers.length)
    throw Error("Duplicate CSV columns.");
  for (const f of ["title", "company", "posting_url"])
    if (!headers.includes(f)) throw Error("CSV missing " + f);
  return rows.map((r, index) => {
    const app = {};
    headers.forEach((f, i) => {
      if (CSV_FIELDS.includes(f) && !["submitted_document_ids"].includes(f))
        app[f] = (r[i] || "").replace(/^'(?=[=+\-@\t\r])/, "");
    });
    const errors = [];
    if (r.length !== headers.length) errors.push("Column count mismatch");
    if (!app.title?.trim() || !app.company?.trim())
      errors.push("Title and company required");
    if (!safeURL(app.posting_url)) errors.push("Official HTTPS URL required");
    if (app.status && !STATUSES.includes(app.status))
      errors.push("Unknown status");
    if (
      app.arrangement &&
      !["On-site", "Hybrid", "Remote", "Unknown"].includes(app.arrangement)
    )
      errors.push("Unknown work arrangement");
    for (const f of [
      "date_found",
      "deadline",
      "date_applied",
      "next_follow_up",
    ])
      if (
        app[f] &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(app[f]) ||
          !Number.isFinite(Date.parse(app[f])) ||
          new Date(app[f]).toISOString().slice(0, 10) !== app[f])
      )
        errors.push("Invalid " + f);
    if (app.status === "Applied" && !app.date_applied)
      errors.push("Date applied required");
    for (const f of ["deadline", "date_applied", "next_follow_up"])
      if (!app[f]) app[f] = null;
    if (!app.date_found) delete app.date_found;
    if (!app.source_id) app.source_id = null;
    for (const f of ["status", "career_track", "source", "arrangement"])
      if (!app[f]) delete app[f];
    return { row: index + 2, app, errors };
  });
}
