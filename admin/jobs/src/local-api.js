import { prepareResume, RESUME_TYPES } from "./resume-library.js";
import { openLocalStore } from "./local-store.js";
import {
  STATUSES,
  normalizeURL,
} from "../../../supabase/functions/_shared/jobs-core.js";
const TABLES = [
  "applications",
  "profiles",
  "documents",
  "history",
  "settings",
  "leads",
  "alert_messages",
  "import_state",
];
const TYPES = RESUME_TYPES;
const now = () => new Date().toISOString();
export function initialData() {
  return Object.fromEntries(
    TABLES.map((n) => [
      n,
      n === "profiles"
        ? ["Cybersecurity", "Operational Excellence"].map((name) => ({
            id: crypto.randomUUID(),
            name,
            track: name,
            content: "",
            created_at: now(),
          }))
        : [],
    ]),
  );
}
function audit(data, record, before) {
  data.history.push({
    id: crypto.randomUUID(),
    application_id: record.id,
    actor: "this-browser",
    occurred_at: now(),
    before_record: before || null,
    after_record: structuredClone(record),
  });
}
function validateApplication(record, data) {
  if (
    !record.title?.trim() ||
    !record.company?.trim() ||
    !STATUSES.includes(record.status)
  )
    throw Error("Title, company and a valid status are required.");
  record.normalized_url = normalizeURL(record.posting_url);
  if (
    data.applications.some(
      (a) =>
        a.id !== record.id &&
        (a.normalized_url === record.normalized_url ||
          (record.source_id &&
            a.source.toLowerCase() === record.source.toLowerCase() &&
            a.source_id === record.source_id)),
    )
  )
    throw Error("Exact duplicate: this job is already saved.");
  if (record.status === "Applied" && !record.date_applied)
    throw Error("Date applied is required.");
  if (
    record.profile_id &&
    !data.profiles.some((p) => p.id === record.profile_id)
  )
    throw Error("Master profile not found.");
}
export async function createLocalAPI(dbName = "samra-jobs-local-v1", codec) {
  const store = await openLocalStore(dbName, codec, initialData);
  const transaction = store.transaction;
  if (!codec) {
    try {
      await transaction("readwrite", () => {});
    } catch (e) {
      store.close();
      throw e;
    }
  }
  const api = {
    list: (n) =>
      transaction("readonly", (d) => {
        if (!TABLES.includes(n)) throw Error("Unknown table");
        return structuredClone(d[n]);
      }),
    settings: () => transaction("readonly", (d) => structuredClone(d.settings)),
    saveSetting: (key, value) =>
      transaction("readwrite", (d) => {
        const row = d.settings.find((s) => s.key === key);
        if (row) row.value = value;
        else d.settings.push({ key, value });
      }),
    insert: (table, values) =>
      transaction("readwrite", (d) => {
        if (!["applications", "profiles", "documents"].includes(table))
          throw Error("Unsupported insert");
        const record = {
          id: crypto.randomUUID(),
          created_at: now(),
          ...values,
        };
        if (d[table].some((r) => r.id === record.id))
          throw Error("Duplicate record ID");
        if (table === "applications") {
          Object.assign(record, {
            status: "Saved",
            notes: "",
            description: "",
            submitted_document_ids: [],
            source: "Manual",
            source_id: null,
            arrangement: "Unknown",
            career_track: "Cybersecurity",
            location: "",
            fit: {},
            date_found: now().slice(0, 10),
            ...record,
            updated_at: now(),
          });
          validateApplication(record, d);
          audit(d, record);
        }
        if (table === "documents") {
          record.state = "Draft";
          record.uploaded = false;
          if (!d.applications.some((a) => a.id === record.application_id))
            throw Error("Application not found");
        }
        d[table].push(record);
        return structuredClone(record);
      }),
    update: (table, id, values) =>
      transaction("readwrite", (d) => {
        if (!["applications", "profiles", "documents", "leads"].includes(table))
          throw Error("Unsupported update");
        const record = d[table].find((r) => r.id === id);
        if (!record) throw Error("Record not found");
        const before = structuredClone(record);
        if (table === "documents") {
          if (record.state === "Submitted")
            throw Error(
              "Submitted versions cannot be edited. Create a new version.",
            );
          if (
            record.uploaded &&
            [
              "object_path",
              "filename",
              "mime_type",
              "application_id",
              "uploaded",
            ].some((k) => k in values && values[k] !== record[k])
          )
            throw Error("Uploaded file versions cannot be replaced.");
          if (values.state === "Submitted" && !record.uploaded)
            throw Error("Upload a finished file first.");
        }
        Object.assign(record, values, { id });
        if (table === "applications") {
          record.updated_at = now();
          validateApplication(record, d);
          audit(d, record, before);
        }
        return structuredClone(record);
      }),
    upload: (path, file) =>
      transaction("readwrite", (d, files) => {
        if (
          !(file instanceof Blob) ||
          file.size > 8388608 ||
          !TYPES.includes(file.type)
        )
          throw Error("Choose a PDF or DOCX up to 8 MB.");
        const doc = d.documents.find(
          (r) => r.object_path === path && !r.uploaded && r.state === "Draft",
        );
        if (!doc) throw Error("Document version not found");
        files.add(file, path);
      }),
    importResumes: async (files, category = "Resume") => {
      if (!["Resume", "Recommendation letter"].includes(category))
        throw Error("Invalid library category");
      if (!files.length || files.length > 100)
        throw Error("Choose 1–100 files per batch.");
      const prepared = await Promise.all(
        files.map((f) => prepareResume(f.blob, f.filename, f.hash)),
      );
      if (
        category === "Recommendation letter" &&
        prepared.some((f) => f.mime_type === "application/zip")
      )
        throw Error("Recommendation letters must be PDF or DOCX files.");
      return transaction("readwrite", (d, store) => {
        let added = 0,
          skipped = 0;
        for (const f of prepared) {
          if (
            d.documents.some(
              (doc) =>
                doc.library &&
                (doc.library_category || "Resume") === category &&
                doc.hash === f.hash,
            )
          ) {
            skipped++;
            continue;
          }
          const id = crypto.randomUUID(),
            path = "device/library/" + id;
          d.documents.push({
            id,
            library: true,
            library_category: category,
            application_id: null,
            kind:
              category === "Recommendation letter"
                ? "Recommendation letter"
                : f.mime_type === "application/zip"
                  ? "Resume archive"
                  : "Resume",
            version: f.filename,
            filename: f.filename,
            mime_type: f.mime_type,
            hash: f.hash,
            size: f.size,
            object_path: path,
            state: "Draft",
            draft_text: "",
            uploaded: true,
            created_at: now(),
          });
          store.add(f.blob, path);
          added++;
        }
        return { added, skipped };
      });
    },
    copyResume: async (libraryId, applicationId) => {
      const snapshot = await store.snapshot();
      const source = snapshot.data.documents.find(
        (d) =>
          d.id === libraryId &&
          d.library &&
          d.uploaded &&
          d.mime_type !== "application/zip",
      );
      const file = snapshot.files.find((f) => f.path === source?.object_path);
      if (!source || !file) throw Error("Choose a saved PDF or DOCX résumé.");
      return transaction("readwrite", (d, files) => {
        if (!d.applications.some((a) => a.id === applicationId))
          throw Error("Application not found");
        const existing = d.documents.find(
          (doc) =>
            doc.application_id === applicationId &&
            doc.origin_library_id === libraryId,
        );
        if (existing) return structuredClone(existing);
        const id = crypto.randomUUID(),
          path = "device/" + applicationId + "/" + id;
        const copy = {
          ...source,
          id,
          library: false,
          application_id: applicationId,
          origin_library_id: libraryId,
          object_path: path,
          created_at: now(),
          state: "Draft",
        };
        d.documents.push(copy);
        files.add(file.blob, path);
        return structuredClone(copy);
      });
    },
    download: (path) => store.download(path),
    rpc: (name, args) =>
      transaction("readwrite", (d) => {
        if (name === "ingest_alert") {
          if (
            d.alert_messages.some(
              (m) =>
                m.source === args.source_name &&
                m.external_id === args.message_key,
            )
          )
            return 0;
          const message = {
            id: crypto.randomUUID(),
            source: args.source_name,
            external_id: args.message_key,
            received_at: args.received,
            format: args.format_name,
            lead_count: args.leads.length,
          };
          d.alert_messages.push(message);
          for (const lead of args.leads)
            d.leads.push({
              id: crypto.randomUUID(),
              message_id: message.id,
              title: lead.title,
              company: lead.company || "",
              posting_url: lead.url,
              source: message.source,
              received_at: message.received_at,
              warning: lead.warning || "",
              state: "Review",
            });
          return args.leads.length;
        }
        if (name === "mark_applied") {
          const app = d.applications.find((a) => a.id === args.application);
          if (!app || !args.applied_on)
            throw Error("Application and date required");
          const docs = args.documents.map((id) => {
            const doc = d.documents.find(
              (x) => x.id === id && x.application_id === app.id && x.uploaded,
            );
            if (!doc) throw Error("Invalid document version");
            return doc;
          });
          const before = structuredClone(app);
          for (const doc of docs) doc.state = "Submitted";
          Object.assign(app, {
            status: "Applied",
            date_applied: args.applied_on,
            submitted_document_ids: args.documents,
            updated_at: now(),
          });
          audit(d, app, before);
          return;
        }
        throw Error(
          "This action requires a cloud backend and is not available in device-local mode.",
        );
      }),
    snapshot: () => store.snapshot(),
    backup: async () => {
      const { data, files } = await api.snapshot();
      const encoded = await Promise.all(
        files.map(async ({ path, blob }) => ({
          path,
          type: blob.type,
          base64: await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result.split(",")[1]);
            r.onerror = reject;
            r.readAsDataURL(blob);
          }),
        })),
      );
      return JSON.stringify({
        format: "samra-jobs-local",
        version: 1,
        exported_at: now(),
        data,
        files: encoded,
      });
    },
    restore: (backup) => store.replace(validateBackup(backup)),
    close: () => store.close(),
  };
  return api;
}
export function validateBackup(backup) {
  if (
    backup?.format !== "samra-jobs-local" ||
    backup.version !== 1 ||
    !backup.data ||
    !Array.isArray(backup.files)
  )
    throw Error("Not a supported Jobs backup.");
  const data = backup.data;
  for (const table of TABLES) {
    if (!Array.isArray(data[table]) || data[table].length > 50000)
      throw Error("Invalid backup table: " + table);
    const ids = new Set();
    for (const row of data[table]) {
      if (
        !row ||
        typeof row !== "object" ||
        Array.isArray(row) ||
        typeof (table === "settings" ? row.key : row.id) !== "string"
      )
        throw Error("Invalid backup record");
      const id = table === "settings" ? row.key : row.id;
      if (ids.has(id)) throw Error("Duplicate backup record");
      ids.add(id);
    }
  }
  for (const setting of data.settings) {
    if (
      !["searches", "employers"].includes(setting.key) ||
      !Array.isArray(setting.value) ||
      setting.value.length > 1000
    )
      throw Error("Invalid settings");
    for (const item of setting.value) {
      if (
        !item ||
        typeof item !== "object" ||
        (setting.key === "searches"
          ? typeof item.title !== "string" || typeof item.location !== "string"
          : typeof item.name !== "string" || typeof item.url !== "string")
      )
        throw Error("Invalid saved search or employer");
    }
  }
  for (const lead of data.leads)
    if (
      typeof lead.title !== "string" ||
      typeof lead.company !== "string" ||
      typeof lead.posting_url !== "string" ||
      !["Review", "Saved", "Dismissed"].includes(lead.state) ||
      !data.alert_messages.some((m) => m.id === lead.message_id)
    )
      throw Error("Invalid alert lead");
  for (const p of data.profiles)
    if (typeof p.name !== "string" || typeof p.content !== "string")
      throw Error("Invalid résumé profile");
  for (const a of data.applications) {
    if (
      typeof a.source !== "string" ||
      typeof a.title !== "string" ||
      typeof a.company !== "string" ||
      typeof a.notes !== "string" ||
      typeof a.description !== "string" ||
      !Array.isArray(a.submitted_document_ids)
    )
      throw Error("Invalid application data");
    validateApplication(a, data);
  }
  for (const doc of data.documents) {
    if (
      doc.library_category !== undefined &&
      !["Resume", "Recommendation letter"].includes(doc.library_category)
    )
      throw Error("Invalid library category");
    if (doc.library !== undefined && typeof doc.library !== "boolean")
      throw Error("Invalid library record");
    if (
      doc.library &&
      (doc.application_id !== null ||
        !doc.uploaded ||
        doc.state !== "Draft" ||
        typeof doc.filename !== "string" ||
        !TYPES.includes(doc.mime_type))
    )
      throw Error("Invalid résumé library record");
    if (
      (doc.library !== true &&
        !data.applications.some((a) => a.id === doc.application_id)) ||
      !["Draft", "Submitted"].includes(doc.state) ||
      typeof doc.draft_text !== "string"
    )
      throw Error("Invalid document reference");
  }
  const paths = new Set();
  const files = backup.files.map((f) => {
    if (
      typeof f.path !== "string" ||
      paths.has(f.path) ||
      !TYPES.includes(f.type) ||
      typeof f.base64 !== "string" ||
      f.base64.length > 11200000
    )
      throw Error("Invalid file in backup");
    paths.add(f.path);
    let bytes;
    try {
      bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
    } catch {
      throw Error("Corrupt backup file");
    }
    if (bytes.length > 8388608) throw Error("Backup file exceeds 8 MB");
    return { path: f.path, blob: new Blob([bytes], { type: f.type }) };
  });
  for (const doc of data.documents)
    if (doc.uploaded && !paths.has(doc.object_path))
      throw Error("Backup is missing an uploaded document");
  for (const a of data.applications)
    for (const id of a.submitted_document_ids)
      if (
        !data.documents.some(
          (d) =>
            d.id === id &&
            d.application_id === a.id &&
            d.state === "Submitted" &&
            d.uploaded,
        )
      )
        throw Error("Invalid submitted document reference");
  return { data, files };
}
