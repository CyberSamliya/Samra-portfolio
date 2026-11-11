import { createAPI } from "./api.js";
import {
  STATUSES,
  TRACKS,
  BOARD_LINKS,
  DEFAULT_SEARCHES,
  DEFAULT_EMPLOYERS,
  safeURL,
  normalizeURL,
  sourceIdentity,
  probableMatches,
  assessFit,
  parseDigest,
  digestKey,
  exportCSV,
  parseCSV,
} from "../../../supabase/functions/_shared/jobs-core.js";
const $ = (id) => document.getElementById(id);
const node = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
const div = (cls, ...children) => {
  const n = node("div", undefined, cls);
  n.append(...children.filter(Boolean));
  return n;
};
const say = (text, error = false) => {
  $("notice").textContent = text;
  $("notice").className = error ? "error" : "";
  if ($("editor").open) {
    $("dialog-notice").textContent = text;
    $("dialog-notice").className = error ? "danger" : "";
  }
};
function act(fn) {
  return async (event) => {
    const b = event?.currentTarget;
    b?.matches("button") && (b.disabled = true);
    try {
      await fn(event);
    } catch (e) {
      say(e.message, true);
    } finally {
      if (b?.matches("button")) b.disabled = false;
    }
  };
}
function button(text, fn, secondary = true) {
  const b = node("button", text, secondary ? "secondary" : "");
  b.type = "button";
  b.onclick = act(fn);
  return b;
}
function link(text, url, cls = "") {
  const u = safeURL(url);
  const a = node("a", text, cls);
  if (u) {
    a.href = u.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  } else a.setAttribute("aria-disabled", "true");
  return a;
}
const badge = (text, warn = false) =>
  node("span", text, "pill" + (warn ? " warn" : ""));
const today = () => new Date().toLocaleDateString("en-CA");
const localDateTime = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
let api,
  allowed = false,
  epoch = 0,
  state = {
    apps: [],
    profiles: [],
    documents: [],
    leads: [],
    settings: {},
    imports: [],
  };
function clearPrivate() {
  epoch++;
  allowed = false;
  state = {
    apps: [],
    profiles: [],
    documents: [],
    leads: [],
    settings: {},
    imports: [],
  };
  $("workspace").hidden = true;
  $("gate").hidden = false;
  $("signout").hidden = true;
  $("content").replaceChildren();
  $("stats").replaceChildren();
  $("dialog-content").replaceChildren();
  $("editor").close();
  $("alert-count").textContent = "—";
  $("mfa-qr").src = "";
  $("mfa-qr").hidden = true;
  $("signin-form").reset();
  $("mfa-form").reset();
}
async function refresh() {
  const ticket = epoch;
  const authorized = await api.rpc("authorized");
  if (!authorized) {
    clearPrivate();
    throw Error("Owner verification and MFA are required. Sign in again.");
  }
  const data = await Promise.all(
    ["applications", "profiles", "documents", "leads", "import_state"].map(
      (n) => api.list(n),
    ),
  );
  const settings = await api.settings();
  if (ticket !== epoch) return;
  [state.apps, state.profiles, state.documents, state.leads, state.imports] =
    data;
  state.settings = Object.fromEntries(settings.map((x) => [x.key, x.value]));
}
function field(label, name, value = "", options) {
  const wrap = node("label", label);
  let input;
  if (Array.isArray(options)) {
    input = node("select");
    options.forEach((o) => {
      const option = node("option", typeof o === "string" ? o : o.label);
      option.value = typeof o === "string" ? o : o.value;
      input.append(option);
    });
  } else if (options === "textarea") input = node("textarea");
  else {
    input = node("input");
    input.type = options || "text";
  }
  input.name = name;
  input.value = value ?? "";
  if (input.tagName === "INPUT" && ["text", "url"].includes(input.type))
    input.maxLength = 1000;
  wrap.append(input);
  return wrap;
}
function required(f) {
  f.lastChild.required = true;
  return f;
}
function formSubmit(form, label, fn) {
  const b = node("button", label);
  b.type = "submit";
  form.append(div("row", b));
  form.onsubmit = act(async (e) => {
    e.preventDefault();
    b.disabled = true;
    try {
      await fn(Object.fromEntries(new FormData(form)), form);
    } finally {
      b.disabled = false;
    }
  });
}
function modal(title, ...contents) {
  if (!allowed) return;
  $("dialog-title").textContent = title;
  $("dialog-notice").textContent = "";
  $("dialog-content").replaceChildren(...contents);
  if (!$("editor").open) $("editor").showModal();
}
$("close-dialog").onclick = () => $("editor").close();
const empty = (title, text) => div("empty", node("h3", title), node("p", text));
const savedSearches = () => state.settings.searches || DEFAULT_SEARCHES;
const employers = () => state.settings.employers || DEFAULT_EMPLOYERS;
function stats() {
  const open = state.apps.filter(
    (a) => !["Rejected", "Withdrawn", "Archived"].includes(a.status),
  );
  const due = open.filter(
    (a) => a.next_follow_up && a.next_follow_up <= today(),
  );
  $("stats").replaceChildren(
    ...[
      ["Active applications", open.length],
      [
        "In conversation",
        open.filter((a) => ["Screening", "Interview"].includes(a.status))
          .length,
      ],
      ["Follow-ups due", due.length],
      [
        "Leads to review",
        state.leads.filter((a) => a.state === "Review").length,
      ],
    ].map(([label, count]) =>
      div("stat", node("span", label), node("strong", String(count))),
    ),
  );
  $("alert-count").textContent = state.leads.filter(
    (a) => a.state === "Review",
  ).length;
}
const views = {
  find: ["Find Jobs", "Good opportunities start with a focused search."],
  alerts: ["Alerts", "A quieter inbox. A clearer next step."],
  applications: ["Applications", "Every application, and what comes next."],
  documents: ["Documents", "Your experience, thoughtfully presented."],
};
function render() {
  if (!allowed) return;
  const view = location.hash.slice(1) || "find";
  const key = views[view] ? view : "find";
  $("view-title").textContent = views[key][0];
  $("view-subtitle").textContent = views[key][1];
  document.querySelectorAll("[data-view]").forEach((a) => {
    if (a.dataset.view === key) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  stats();
  $("content").replaceChildren(
    {
      find: findView,
      alerts: alertsView,
      applications: applicationsView,
      documents: documentsView,
    }[key](),
  );
}
window.addEventListener("hashchange", render);
function searchLinks(search) {
  const row = div("row");
  const q = encodeURIComponent(search.title),
    where = encodeURIComponent(search.location.split("·")[0].trim());
  row.append(
    link(
      "LinkedIn ↗",
      `https://www.linkedin.com/jobs/search/?keywords=${q}&location=${where}`,
    ),
    link(
      "Nearby hybrid ↗",
      `https://www.linkedin.com/jobs/search/?keywords=${q}&location=${where}&f_WT=3`,
    ),
    link("Indeed ↗", `https://www.indeed.com/jobs?q=${q}&l=${where}`),
    link(
      "U.S. remote ↗",
      `https://www.linkedin.com/jobs/search/?keywords=${q}&location=United%20States&f_WT=2`,
    ),
    link("USAJOBS ↗", `https://www.usajobs.gov/Search/Results?k=${q}`),
  );
  return row;
}
function findView() {
  const searches = node("section", undefined, "card");
  searches.append(
    div(
      "section-top",
      div(
        "",
        node("h2", "Your saved searches"),
        node("p", "Built around your two career paths.", "fine"),
      ),
      button("Edit searches", editSearches),
    ),
  );
  savedSearches().forEach((s) =>
    searches.append(
      div(
        "search-item",
        node("h3", s.title),
        node("p", s.location),
        searchLinks(s),
      ),
    ),
  );
  const manual = div(
    "card",
    node("span", "＋", "search-icon"),
    node("h2", "Found a role worth exploring?"),
    node(
      "p",
      "Bring the posting and job description here. Review the fit before you take the next step.",
      "fine",
    ),
    button("＋ Add a job", () => editApplication(), false),
  );
  const boards = div(
    "card",
    node("h2", "Search the source"),
    node("p", "Open the original job board.", "fine"),
  );
  BOARD_LINKS.forEach(([name, url]) =>
    boards.append(link(name + " ↗", url, "board")),
  );
  boards.append(node("p", "LOCAL EMPLOYERS", "mini-label"));
  employers().forEach((e) =>
    boards.append(link(e.name + " ↗", e.url, "board")),
  );
  boards.append(button("Edit employer links", editEmployers));
  return div(
    "two-col",
    div(
      "stack",
      searches,
      div(
        "note",
        node("h3", "A search with room for both strengths."),
        node(
          "p",
          "Cybersecurity and operational excellence. Start in Columbus, explore nearby hybrid roles, and keep U.S. remote opportunities in view.",
        ),
      ),
    ),
    div("stack", manual, boards),
  );
}
function editSearches() {
  const f = node("form");
  const rows = node("div");
  savedSearches().forEach((s, i) =>
    rows.append(
      field("Search title " + (i + 1), "title" + i, s.title),
      field("Location / arrangement " + (i + 1), "location" + i, s.location),
    ),
  );
  f.append(rows);
  formSubmit(f, "Save searches", async (values) => {
    const searches = savedSearches().map((s, i) => ({
      ...s,
      title: values["title" + i].trim(),
      location: values["location" + i].trim(),
    }));
    if (searches.some((s) => !s.title))
      throw Error("Search titles cannot be empty.");
    await api.saveSetting("searches", searches);
    await refresh();
    $("editor").close();
    render();
  });
  modal("Edit saved searches", f);
}
function editEmployers() {
  const f = node("form");
  const rows = node("div");
  [...employers(), { name: "", url: "" }].forEach((s, i) =>
    rows.append(
      field("Employer " + (i + 1), "name" + i, s.name),
      field("Official careers URL " + (i + 1), "url" + i, s.url, "url"),
    ),
  );
  f.append(
    rows,
    node(
      "p",
      "Clear a name and URL to remove an entry. Add more after saving.",
      "fine",
    ),
  );
  formSubmit(f, "Save employer links", async (values) => {
    const list = Array.from({ length: employers().length + 1 }, (_, i) => ({
      name: values["name" + i].trim(),
      url: values["url" + i].trim(),
    })).filter((e) => e.name || e.url);
    if (list.some((e) => !e.name || !safeURL(e.url)))
      throw Error("Use an employer name and official HTTPS careers URL.");
    await api.saveSetting("employers", list);
    await refresh();
    $("editor").close();
    render();
  });
  modal("Local employer career pages", f);
}
function applicationValues(values) {
  const data = { ...values };
  for (const k of ["deadline", "date_applied", "next_follow_up", "profile_id"])
    data[k] = data[k] || null;
  if (!data.date_found) data.date_found = today();
  data.normalized_url = normalizeURL(data.posting_url);
  const identity = sourceIdentity(data.posting_url);
  data.source = data.source || identity.source;
  data.source_id = data.source_id || identity.source_id || null;
  return data;
}
async function saveApp(record, id) {
  const matches = state.apps.find(
    (a) =>
      a.id !== id &&
      (a.normalized_url === record.normalized_url ||
        (record.source_id &&
          a.source.toLowerCase() === record.source.toLowerCase() &&
          a.source_id === record.source_id)),
  );
  if (matches)
    throw Error(
      "Exact duplicate already exists: " +
        matches.company +
        " — " +
        matches.title,
    );
  return id
    ? api.update("applications", id, record)
    : api.insert("applications", record);
}
function editApplication(existing = {}, lead) {
  const f = node("form");
  const fields = div("fields");
  const inputSpecs = [
    ["Job title", "title", "text"],
    ["Company", "company", "text"],
    ["Posting URL", "posting_url", "url"],
    ["Requisition ID", "requisition_id", "text"],
    ["Source", "source", "text"],
    ["Source job ID", "source_id", "text"],
    ["Career track", "career_track", TRACKS],
    ["Location", "location", "text"],
    [
      "Work arrangement",
      "arrangement",
      ["Unknown", "On-site", "Hybrid", "Remote"],
    ],
    ["Pay range, if known", "pay_range", "text"],
    ["Date found", "date_found", "date"],
    ["Application deadline", "deadline", "date"],
    ["Date applied", "date_applied", "date"],
    ["Next follow-up", "next_follow_up", "date"],
    [
      "Status",
      "status",
      STATUSES.filter((s) => s !== "Applied" || existing.status === "Applied"),
    ],
    [
      "Master résumé",
      "profile_id",
      [
        { label: "Choose a profile", value: "" },
        ...state.profiles.map((p) => ({ label: p.name, value: p.id })),
      ],
    ],
  ];
  inputSpecs.forEach(([label, name, type]) => {
    let value =
      existing[name] ??
      (name === "date_found"
        ? today()
        : name === "career_track"
          ? TRACKS[0]
          : name === "status"
            ? "Saved"
            : name === "arrangement"
              ? "Unknown"
              : "");
    let item = field(label, name, value, type);
    if (["title", "company", "posting_url"].includes(name)) required(item);
    fields.append(item);
  });
  const description = field(
    "Pasted job description",
    "description",
    existing.description,
    "textarea",
  );
  description.className = "wide";
  description.lastChild.maxLength = 100000;
  fields.append(description);
  const notes = field("Notes", "notes", existing.notes, "textarea");
  notes.className = "wide";
  notes.lastChild.maxLength = 50000;
  fields.append(notes);
  f.append(fields);
  const fitCard = div("note", node("h3", "Fit checklist · your decision"));
  const fitFields = div("fields");
  ["required_skills", "location", "work_arrangement", "experience"].forEach(
    (key) =>
      fitFields.append(
        field(
          key.replaceAll("_", " "),
          "fit_" + key,
          existing.fit?.[key] || "Review",
          ["Review", "Meets", "Gap", "Override"],
        ),
      ),
  );
  fitCard.append(
    fitFields,
    field(
      "Evidence or override reason",
      "fit_reason",
      existing.fit?.reason || "",
      "textarea",
    ),
  );
  const skillList = node("div");
  const assess = () => {
    const d = new FormData(f);
    const p = state.profiles.find((p) => p.id === d.get("profile_id"));
    const skills = assessFit(d.get("description") || "", p?.content || "");
    skillList.replaceChildren(
      ...skills.map((s) => node("p", s.skill + ": " + s.result, "fine")),
    );
    if (!skills.length)
      skillList.append(
        node(
          "p",
          "Read the requirements and compare them with your selected résumé. No fit score or qualifications are assumed.",
          "fine",
        ),
      );
  };
  fitCard.append(button("Review requirement evidence", assess), skillList);
  f.append(fitCard);
  assess();
  const possible = node("p", undefined, "fine");
  f.append(possible);
  f.oninput = () => {
    const values = Object.fromEntries(new FormData(f));
    possible.textContent = probableMatches(values, state.apps).filter(
      (x) => x.id !== existing.id,
    ).length
      ? "Possible similar role found. Compare requisition IDs and locations; it will remain separate unless the URL or source ID is an exact match."
      : "";
  };
  formSubmit(
    f,
    existing.id ? "Save changes" : "Save application",
    async (values) => {
      const fit = {};
      for (const k of [
        "required_skills",
        "location",
        "work_arrangement",
        "experience",
        "reason",
      ]) {
        fit[k] = values["fit_" + k];
        delete values["fit_" + k];
      }
      if (Object.values(fit).includes("Override") && !fit.reason.trim())
        throw Error("Add a reason for the fit override.");
      const record = applicationValues(values);
      record.fit = fit;
      const app = await saveApp(record, existing.id);
      if (lead)
        await api.update("leads", lead.id, {
          state: "Saved",
          application_id: app.id,
        });
      await refresh();
      $("editor").close();
      location.hash = "applications";
      render();
      say("Application saved. Opening a posting does not mark it applied.");
    },
  );
  modal(existing.id ? "Edit application" : "Add an opportunity", f);
}
function applicationsView() {
  const section = div("card");
  const top = div(
    "section-top",
    div(
      "",
      node("h2", "Your application record"),
      node("p", "A clear view of every next step.", "fine"),
    ),
    div(
      "row",
      button("Import CSV", importCSV),
      button("Export CSV", async () => {
        await refresh();
        downloadBlob(
          new Blob([exportCSV(state.apps)], { type: "text/csv;charset=utf-8" }),
          "applications-private.csv",
        );
        say("Private export started. Store it securely.");
      }),
      button("＋ Add job", () => editApplication(), false),
    ),
  );
  section.append(top);
  const filters = div("filters");
  const search = node("input");
  search.type = "search";
  search.placeholder = "Search title, company, notes…";
  search.setAttribute("aria-label", "Search applications");
  const status = node("select");
  status.setAttribute("aria-label", "Filter status");
  ["All statuses", ...STATUSES].forEach((s) => {
    const o = node("option", s);
    o.value = s;
    status.append(o);
  });
  const track = node("select");
  track.setAttribute("aria-label", "Filter career track");
  ["Both career tracks", ...TRACKS].forEach((s) =>
    track.append(node("option", s)),
  );
  let due = false,
    grouped = false;
  const dueBtn = button("Follow-ups due", () => {
    due = !due;
    dueBtn.setAttribute("aria-pressed", String(due));
    draw();
  });
  dueBtn.setAttribute("aria-pressed", "false");
  const groupBtn = button("Group by status", () => {
    grouped = !grouped;
    groupBtn.setAttribute("aria-pressed", String(grouped));
    draw();
  });
  groupBtn.setAttribute("aria-pressed", "false");
  filters.append(search, status, track, dueBtn, groupBtn);
  section.append(filters);
  const results = node("div");
  section.append(results);
  function draw() {
    let apps = state.apps
      .filter((a) =>
        (a.title + " " + a.company + " " + a.notes + " " + a.requisition_id)
          .toLowerCase()
          .includes(search.value.toLowerCase()),
      )
      .filter(
        (a) => status.value === "All statuses" || a.status === status.value,
      )
      .filter(
        (a) =>
          track.value === "Both career tracks" ||
          a.career_track === track.value,
      )
      .filter(
        (a) =>
          !due ||
          (a.next_follow_up &&
            a.next_follow_up <= today() &&
            !["Rejected", "Withdrawn", "Archived", "Offer"].includes(a.status)),
      );
    results.replaceChildren();
    if (!apps.length) {
      results.append(
        empty(
          "Space for your next opportunity",
          "Save a role from Find Jobs or review a lead in Alerts.",
        ),
      );
      return;
    }
    const groups = grouped
      ? STATUSES.map((s) => [s, apps.filter((a) => a.status === s)])
      : [["", apps]];
    groups
      .filter(([, rows]) => rows.length)
      .forEach(([label, rows]) => {
        if (label) results.append(node("h3", label));
        const table = node("table");
        const head = node("thead");
        const hr = node("tr");
        ["Opportunity", "Status", "Follow-up", "Next step"].forEach((x) =>
          hr.append(node("th", x)),
        );
        head.append(hr);
        const body = node("tbody");
        rows.forEach((a) => {
          const r = node("tr");
          const role = node("td");
          role.append(
            node("strong", a.title),
            node("p", a.company + " · " + (a.location || "Location to review")),
            node("p", a.career_track),
          );
          const stat = node("td");
          stat.append(badge(a.status));
          const follow = node("td", a.next_follow_up || "—");
          const actions = node("td");
          actions.append(
            button("View application", () => applicationDetail(a)),
          );
          r.append(role, stat, follow, actions);
          body.append(r);
        });
        table.append(head, body);
        results.append(div("table-wrap", table));
      });
  }
  search.oninput = draw;
  status.onchange = draw;
  track.onchange = draw;
  draw();
  return section;
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = node("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function applicationDetail(app) {
  const docs = state.documents.filter((d) => d.application_id === app.id);
  const summary = div(
    "stack",
    div(
      "row spread",
      div(
        "",
        node("h3", app.company),
        node("p", app.location + " · " + app.arrangement, "fine"),
      ),
      badge(app.status),
    ),
    div(
      "row",
      link("Open Application ↗", app.posting_url, "button secondary"),
      button("Edit details", () => editApplication(app)),
      button("Mark Applied", () => markApplied(app), false),
    ),
    node(
      "p",
      "Open Application only opens the original posting. Confirm submission separately.",
      "fine",
    ),
  );
  summary.append(
    div(
      "note",
      node("h3", "Fit review"),
      node(
        "p",
        Object.entries(app.fit || {})
          .map(([k, v]) => k.replaceAll("_", " ") + ": " + v)
          .join(" · ") || "Not assessed yet.",
      ),
    ),
  );
  if (app.description)
    summary.append(
      div(
        "",
        node("h3", "Job description"),
        node("p", app.description, "draft"),
      ),
    );
  if (app.notes) summary.append(node("p", app.notes));
  summary.append(
    div(
      "row",
      button("Prepare documents / Teal", () => handoff(app)),
      button("New draft or upload", () => documentEditor(app)),
    ),
  );
  docs.forEach((d) => summary.append(documentRow(d)));
  const history = await api.list("history");
  const timeline = div("", node("h3", "Change history"));
  history
    .filter((h) => h.application_id === app.id)
    .forEach((h) => {
      const changed = Object.keys(h.after_record).filter(
        (k) =>
          k !== "updated_at" &&
          JSON.stringify(h.before_record?.[k]) !==
            JSON.stringify(h.after_record[k]),
      );
      timeline.append(
        div(
          "history",
          node("time", new Date(h.occurred_at).toLocaleString()),
          node(
            "p",
            (h.before_record
              ? "Changed: " + changed.join(", ")
              : "Application saved") +
              " · " +
              h.after_record.status,
          ),
        ),
      );
    });
  summary.append(timeline);
  modal(app.title, summary);
}
function markApplied(app) {
  const f = node("form");
  const select = node("div");
  state.documents
    .filter((d) => d.application_id === app.id && d.uploaded)
    .forEach((d) => {
      const l = node("label", undefined, "check");
      const c = node("input");
      c.type = "checkbox";
      c.name = "document";
      c.value = d.id;
      c.checked = app.submitted_document_ids?.includes(d.id);
      l.append(
        c,
        node("span", d.kind + " · " + d.version + " · " + d.filename),
      );
      select.append(l);
    });
  f.append(
    node(
      "p",
      "Confirm that you submitted on the official site. Select the exact finished files you used. Submitted versions cannot be edited or replaced.",
    ),
    required(
      field("Date applied", "date", app.date_applied || today(), "date"),
    ),
    select,
  );
  formSubmit(f, "Confirm submission & mark applied", async (values, form) => {
    const documents = new FormData(form).getAll("document");
    await api.rpc("mark_applied", {
      application: app.id,
      documents,
      applied_on: values.date,
    });
    await refresh();
    $("editor").close();
    render();
    say("Submission recorded with selected document versions.");
  });
  modal("Record a submitted application", f);
}
function handoff(app) {
  const profile = state.profiles.find((p) => p.id === app.profile_id);
  const box = div(
    "stack",
    node(
      "p",
      "Open Teal separately, copy the job description and your selected profile, then upload the finished files back here. Nothing is sent automatically.",
    ),
    link("Open Teal ↗", "https://www.tealhq.com/", "button"),
    node("h3", "Job description"),
    node("pre", app.description || "Add the job description first.", "draft"),
    button("Copy job description", async () => {
      await navigator.clipboard.writeText(app.description);
      say("Job description copied.");
    }),
    node("h3", "Requirement checklist"),
  );
  const skills = assessFit(app.description, profile?.content || "");
  skills.forEach((s) =>
    box.append(node("p", s.skill + " — " + s.result, "fine")),
  );
  if (!skills.length)
    box.append(node("p", "Review all listed requirements manually.", "fine"));
  box.append(
    node(
      "p",
      "Check required skills, location, work arrangement and experience. Flag missing evidence; never invent qualifications, certifications, dates, titles or results.",
      "note",
    ),
    node("h3", "Selected master résumé"),
    node(
      "pre",
      profile?.content ||
        "Select and complete a private master résumé in Documents.",
      "draft",
    ),
    button("Copy selected résumé", async () => {
      if (!profile) throw Error("Select a profile first.");
      await navigator.clipboard.writeText(profile.content);
      say("Selected résumé copied.");
    }),
    button("Upload finished résumé or cover letter", () => documentEditor(app)),
  );
  modal("Tailor with Teal", box);
}
function documentsView() {
  const section = div("stack");
  const profiles = div(
    "card",
    div(
      "section-top",
      div(
        "",
        node("h2", "Private master résumés"),
        node(
          "p",
          "Start with verified experience. Nothing is copied from the public portfolio automatically.",
          "fine",
        ),
      ),
      button("＋ Add profile", () => profileEditor(), false),
    ),
  );
  if (!state.profiles.length)
    profiles.append(
      node(
        "p",
        "Create a Cybersecurity profile and an Operational Excellence profile, or add your own.",
        "fine",
      ),
    );
  state.profiles.forEach((p) =>
    profiles.append(
      div(
        "search-item",
        div(
          "row spread",
          div("", node("h3", p.name), node("p", p.track, "fine")),
          button("Edit profile", () => profileEditor(p)),
        ),
      ),
    ),
  );
  const versions = div(
    "card",
    node("h2", "Application document versions"),
    node(
      "p",
      "Drafts remain editable. Finished uploaded bytes are immutable; record the files actually used when you mark an application applied.",
      "fine",
    ),
  );
  if (!state.documents.length)
    versions.append(
      empty(
        "A fresh page",
        "Open an application to create a draft or upload a tailored PDF or DOCX.",
      ),
    );
  state.documents.forEach((d) => versions.append(documentRow(d)));
  section.append(
    profiles,
    versions,
    div(
      "note",
      node("h3", "You control the handoff"),
      node(
        "p",
        "There is no AI drafting connection. Opening Teal sends no résumé or job description from this workspace. Any future AI integration must ask for opt-in before sharing selected content.",
      ),
    ),
  );
  return section;
}
function profileEditor(profile = {}) {
  const f = node("form");
  f.append(
    required(field("Profile name", "name", profile.name || "Cybersecurity")),
    field("Career track", "track", profile.track || TRACKS[0], TRACKS),
    field(
      "Verified résumé content",
      "content",
      profile.content || "",
      "textarea",
    ),
  );
  formSubmit(f, "Save private profile", async (values) => {
    await (profile.id
      ? api.update("profiles", profile.id, values)
      : api.insert("profiles", values));
    await refresh();
    $("editor").close();
    render();
    say("Private master profile saved.");
  });
  modal("Master résumé profile", f);
}
function documentRow(doc) {
  const row = div(
    "document",
    div(
      "row spread",
      div(
        "",
        node("h3", doc.kind + " · " + doc.version),
        node(
          "p",
          (state.apps.find((a) => a.id === doc.application_id)?.company || "") +
            " · " +
            (doc.filename || "Text draft"),
          "fine",
        ),
      ),
      badge(doc.state),
    ),
  );
  const actions = div("row");
  if (doc.state === "Draft")
    actions.append(
      button("Edit draft", () =>
        documentEditor(
          state.apps.find((a) => a.id === doc.application_id),
          doc,
        ),
      ),
    );
  if (doc.uploaded) {
    actions.append(
      button("Download privately", async () => {
        const blob = await api.download(doc.object_path);
        downloadBlob(blob, doc.filename);
      }),
      button("Preview privately", async () => {
        if (doc.mime_type !== "application/pdf") {
          say(
            "DOCX preview is available by private download in your document editor.",
          );
          return;
        }
        const blob = await api.download(doc.object_path);
        const url = URL.createObjectURL(
          new Blob([blob], { type: "application/pdf" }),
        );
        const frame = node("iframe", undefined, "preview");
        frame.title = "Private PDF preview";
        frame.setAttribute("sandbox", "");
        frame.src = url;
        modal(
          "Private document preview",
          frame,
          node(
            "p",
            "This preview uses an authorized download, never a public or signed link.",
            "fine",
          ),
        );
        $("editor").addEventListener("close", () => URL.revokeObjectURL(url), {
          once: true,
        });
      }),
    );
  }
  row.append(actions);
  return row;
}
function documentEditor(app, doc = {}) {
  if (!app) throw Error("Choose an application first.");
  const f = node("form");
  f.append(
    field("Document type", "kind", doc.kind || "Resume", [
      "Resume",
      "Cover letter",
    ]),
    required(field("Version label", "version", doc.version || "")),
    field(
      "Editable draft text",
      "draft_text",
      doc.draft_text || "",
      "textarea",
    ),
  );
  if (!doc.uploaded) {
    const input = field(
      "Finished PDF or DOCX (up to 8 MB)",
      "file",
      "",
      "file",
    );
    input.lastChild.accept = ".pdf,.docx";
    f.append(input);
  }
  f.append(
    node(
      "p",
      "New uploaded files create immutable versions. Keep editing text drafts separately; submitted versions are locked.",
      "fine",
    ),
  );
  formSubmit(f, "Save document version", async (values, form) => {
    const file = new FormData(form).get("file");
    const record = {
      application_id: app.id,
      kind: values.kind,
      version: values.version.trim(),
      draft_text: values.draft_text,
    };
    if (file?.size) {
      if (file.size > 8388608) throw Error("File exceeds 8 MB.");
      const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      const pdf =
        file.name.toLowerCase().endsWith(".pdf") &&
        new TextDecoder().decode(bytes).startsWith("%PDF-");
      const docx =
        file.name.toLowerCase().endsWith(".docx") &&
        bytes[0] === 0x50 &&
        bytes[1] === 0x4b;
      if (!pdf && !docx) throw Error("Choose a valid PDF or DOCX.");
      if (doc.object_path)
        throw Error("Create a new version for a different file.");
      const user = (await api.unwrap(api.client.auth.getUser())).user;
      record.id = doc.id || crypto.randomUUID();
      record.object_path = [user.id, app.id, record.id].join("/");
      record.filename = file.name;
      record.mime_type = pdf
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      const saved = await (doc.id
        ? api.update("documents", doc.id, record)
        : api.insert("documents", record));
      await api.upload(
        record.object_path,
        new Blob([file], { type: record.mime_type }),
      );
      await api.update("documents", saved.id, { uploaded: true });
    } else
      await (doc.id
        ? api.update("documents", doc.id, record)
        : api.insert("documents", record));
    await refresh();
    $("editor").close();
    render();
    say("Document version saved privately.");
  });
  modal("Document for " + app.title, f);
}
function importCSV() {
  const f = node("form");
  const input = required(field("CSV file", "csv", "", "file"));
  input.lastChild.accept = ".csv,text/csv";
  const preview = node("div");
  let rows = [];
  input.lastChild.onchange = act(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    rows = [];
    preview.replaceChildren();
    if (file.size > 2000000) throw Error("CSV exceeds 2 MB.");
    rows = parseCSV(await file.text());
    preview.replaceChildren(node("h3", rows.length + " records to review"));
    rows.forEach((r) => {
      const exact = state.apps.find(
        (a) =>
          safeURL(r.app.posting_url) &&
          a.normalized_url === normalizeURL(r.app.posting_url),
      );
      preview.append(
        node(
          "p",
          "Row " +
            r.row +
            ": " +
            r.app.company +
            " — " +
            r.app.title +
            (r.errors.length
              ? " · " + r.errors.join(", ")
              : exact
                ? " · Exact duplicate: skipped"
                : probableMatches(r.app, state.apps).length
                  ? " · Similar role: retained separately"
                  : " · Ready"),
          "fine",
        ),
      );
    });
  });
  f.append(
    input,
    preview,
    node(
      "p",
      "Import creates records only. It never submits applications or changes existing statuses. Submitted document IDs are never trusted from CSV.",
      "fine",
    ),
  );
  formSubmit(f, "Confirm import", async () => {
    if (!rows.length || rows.some((r) => r.errors.length))
      throw Error("Resolve all CSV errors before importing.");
    let added = 0,
      skipped = 0;
    for (const row of rows) {
      const record = applicationValues(row.app);
      try {
        const saved = await saveApp(record);
        state.apps.push(saved);
        added++;
      } catch (e) {
        if (/duplicate/i.test(e.message)) skipped++;
        else {
          await refresh();
          throw Error(added + " imported before error: " + e.message);
        }
      }
    }
    await refresh();
    $("editor").close();
    render();
    say(added + " imported; " + skipped + " exact duplicates skipped.");
  });
  modal("Preview CSV import", f);
}
function alertsView() {
  const outer = div("stack");
  const f = node("form", undefined, "card");
  f.append(
    div(
      "section-top",
      div(
        "",
        node("h2", "Bring your alerts together"),
        node(
          "p",
          "Paste a digest from Gmail, Outlook or Yahoo. Every lead waits for your review.",
          "fine",
        ),
      ),
      badge("Manual import"),
    ),
  );
  f.append(
    field("Source", "source", "Gmail", ["Gmail", "Outlook", "Yahoo", "Other"]),
    field("Received at", "received", localDateTime(), "datetime-local"),
    field("Paste alert text or HTML", "text", "", "textarea"),
  );
  const upload = field("Or import a text / EML file", "email", "", "file");
  upload.lastChild.accept = ".txt,.eml,text/plain,message/rfc822";
  f.append(
    upload,
    button("Load synthetic digest", () => {
      f.elements.text.value =
        "SOC Analyst I | Example Security\nhttps://www.usajobs.gov/job/123456789\n\nContinuous Improvement Specialist | Example Manufacturing\nhttps://careers.example.com/jobs/ci-101";
      f.elements.source.value = "Other";
    }),
  );
  formSubmit(f, "Preview leads", async (values, form) => {
    let text = values.text;
    const file = new FormData(form).get("email");
    if (file?.size) {
      if (file.size > 200000) throw Error("Alert exceeds 200 KB.");
      text = await file.text();
      if (/content-type:\s*multipart\//i.test(text))
        throw Error(
          "Multipart EML is not imported automatically. Paste the visible alert text; attachments are skipped.",
        );
    }
    if (!text.trim()) throw Error("Paste alert text first.");
    const leads = parseDigest(text);
    const preview = div(
      "stack",
      node(
        "p",
        "Review extracted links before saving. These are leads, never automatic status changes.",
      ),
    );
    leads.forEach((l) =>
      preview.append(
        div(
          "note",
          node("h3", l.title),
          node("p", l.company),
          node("p", l.url),
          node(
            "p",
            l.warning ||
              "Recognized board destination. Confirm this is a job posting.",
            "fine",
          ),
        ),
      ),
    );
    preview.append(
      button(
        "Confirm import to review queue",
        async () => {
          const key = await digestKey(text);
          const count = await api.rpc("ingest_alert", {
            source_name: values.source,
            message_key: key,
            received: new Date(values.received).toISOString(),
            format_name: "Manual digest",
            leads,
          });
          text = "";
          await refresh();
          $("editor").close();
          render();
          say(count + " leads imported. Repeated messages are ignored.");
        },
        false,
      ),
    );
    modal("Review extracted leads", preview);
  });
  outer.append(f);
  const imp = state.imports[0] || {};
  const status = div(
    "card",
    div(
      "section-top",
      node("h2", "Dedicated inbox import"),
      badge(imp.connected ? "Connected" : "Disconnected"),
    ),
    node(
      "p",
      "Gmail API · one dedicated job-alert inbox · read-only · manual runs",
      "fine",
    ),
    node(
      "p",
      "Last successful run: " +
        (imp.last_success
          ? new Date(imp.last_success).toLocaleString()
          : "Never") +
        " · Last run: " +
        (imp.imported || 0) +
        " messages / " +
        (imp.leads || 0) +
        " leads",
      "fine",
    ),
  );
  if (imp.error) status.append(node("p", imp.error, "danger"));
  status.append(
    node(
      "p",
      "Live access requires your authorization and private server configuration. No inbox is connected by default.",
      "fine",
    ),
    div(
      "row",
      button("Authorize dedicated inbox", () => {
        const box = div(
          "stack",
          node(
            "p",
            "Only continue after privately configuring the dedicated Gmail account and read-only OAuth grant. This enables imports from that account; it does not connect your personal mail automatically.",
          ),
          button(
            "I authorize this dedicated inbox",
            async () => {
              await api.inbox("connect");
              await refresh();
              $("editor").close();
              render();
              say("Dedicated inbox authorized. Run an import when ready.");
            },
            false,
          ),
        );
        modal("Authorize a live inbox connection", box);
      }),
      button("Import / Retry", async () => {
        const result = await api.inbox("run");
        await refresh();
        render();
        say(result.message || "Import complete.");
      }),
      button("Disconnect", async () => {
        await api.inbox("disconnect");
        await refresh();
        render();
        say(
          "Inbox disabled. Revoke the OAuth grant in Google Account settings to remove provider authorization.",
        );
      }),
    ),
  );
  outer.append(status);
  const queue = div(
    "card",
    node("h2", "Review queue"),
    node(
      "p",
      "Check the original posting, then save the lead as an application. Email never marks a job applied.",
      "fine",
    ),
  );
  const leads = state.leads.filter((l) => l.state === "Review");
  if (!leads.length)
    queue.append(
      empty(
        "You’re all caught up",
        "Paste a job alert above to gather your next opportunities.",
      ),
    );
  leads.forEach((l) => {
    const row = div(
      "alert-lead",
      div("row spread", node("h3", l.title), badge(l.source)),
      node(
        "p",
        l.company + " · Received " + new Date(l.received_at).toLocaleString(),
        "fine",
      ),
    );
    if (l.warning) row.append(node("p", l.warning, "note"));
    row.append(
      node("p", l.posting_url, "fine"),
      div(
        "row",
        button("Review & save", () =>
          editApplication(
            {
              title: l.title,
              company: l.company,
              posting_url: safeURL(l.posting_url) ? l.posting_url : "",
              source: l.source,
            },
            l,
          ),
        ),
        button("Dismiss lead", async () => {
          await api.update("leads", l.id, { state: "Dismissed" });
          await refresh();
          render();
        }),
      ),
    );
    queue.append(row);
  });
  outer.append(queue);
  return outer;
}
async function unlock() {
  const ticket = epoch;
  const yes = await api.rpc("authorized");
  if (ticket !== epoch) return;
  if (!yes)
    throw Error(
      "This account is not the configured owner, or MFA is incomplete.",
    );
  allowed = true;
  await refresh();
  if (ticket !== epoch || !allowed) return;
  $("gate").hidden = true;
  $("workspace").hidden = false;
  $("signout").hidden = false;
  $("mfa-form").hidden = true;
  $("mfa-form").reset();
  $("mfa-qr").src = "";
  $("mfa-qr").hidden = true;
  render();
  say("Owner verified. Your workspace is private.");
}
let factorId;
async function startMFA() {
  const { currentLevel } = await api.unwrap(
    api.client.auth.mfa.getAuthenticatorAssuranceLevel(),
  );
  if (currentLevel === "aal2") {
    await unlock();
    return;
  }
  const { all, totp } = await api.unwrap(api.client.auth.mfa.listFactors());
  const verified = totp.find((f) => f.status === "verified");
  if (verified) {
    factorId = verified.id;
    $("mfa-instructions").textContent =
      "Enter the current code from your authenticator.";
  } else {
    const pending = all.find(
      (f) => f.factor_type === "totp" && f.status === "unverified",
    );
    if (pending)
      await api.unwrap(api.client.auth.mfa.unenroll({ factorId: pending.id }));
    const enrollment = await api.unwrap(
      api.client.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Samra Jobs",
      }),
    );
    factorId = enrollment.id;
    $("mfa-qr").src = enrollment.totp.qr_code;
    $("mfa-qr").hidden = false;
    $("mfa-instructions").textContent =
      "Scan this QR code with your authenticator, then enter the code to finish enrollment.";
  }
  $("signin-form").hidden = true;
  $("mfa-form").hidden = false;
  $("signout").hidden = false;
}
$("signin-form").onsubmit = act(async (e) => {
  e.preventDefault();
  if (!api) throw Error("The private backend has not been configured yet.");
  const f = new FormData(e.currentTarget);
  await api.unwrap(
    api.client.auth.signInWithPassword({
      email: f.get("email"),
      password: f.get("password"),
    }),
  );
  $("signin-form").reset();
  await startMFA();
});
$("mfa-form").onsubmit = act(async (e) => {
  e.preventDefault();
  const code = new FormData(e.currentTarget).get("code");
  const { id } = await api.unwrap(api.client.auth.mfa.challenge({ factorId }));
  await api.unwrap(
    api.client.auth.mfa.verify({ factorId, challengeId: id, code }),
  );
  await unlock();
});
$("signout").onclick = act(async () => {
  clearPrivate();
  $("signin-form").hidden = false;
  $("mfa-form").hidden = true;
  await api.unwrap(api.client.auth.signOut());
  say("Signed out. Private records cleared from this page.");
});
$("today").textContent = new Date().toLocaleDateString(undefined, {
  month: "long",
  day: "numeric",
  year: "numeric",
});
const config = window.JOBS_CONFIG;
if (config?.supabaseUrl && config?.publishableKey) {
  try {
    const url = new URL(config.supabaseUrl);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co"))
      throw Error("Use your hosted Supabase HTTPS URL.");
    api = createAPI(config);
    api.client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clearPrivate();
        $("signin-form").hidden = false;
        $("mfa-form").hidden = true;
      }
    });
  } catch (e) {
    say(e.message, true);
  }
}
if (!api) {
  $("setup-message").textContent =
    "Private sign-in is not configured yet. The public portfolio is available; no Jobs data is stored on this site.";
  $("signin-form").querySelector("button").disabled = true;
}
