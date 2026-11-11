// Synthetic Supabase HTTP fixture. Real authorization is tested separately against Postgres RLS.
export const OWNER = "11111111-1111-4111-8111-111111111111";
export const OTHER = "22222222-2222-4222-8222-222222222222";
export async function backend(page, { owner = true, mfa = true } = {}) {
  const records = {
    applications: [],
    profiles: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Cybersecurity",
        track: "Cybersecurity",
        content: "",
      },
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        name: "Operational Excellence",
        track: "Operational Excellence",
        content: "",
      },
    ],
    documents: [],
    history: [],
    settings: [],
    leads: [],
    alert_messages: [],
    import_state: [{ id: true, connected: false, imported: 0, leads: 0 }],
  };
  let level = "aal1";
  const id = owner ? OWNER : OTHER;
  const user = () => ({
    id,
    aud: "authenticated",
    role: "authenticated",
    email: "owner@example.test",
    created_at: new Date().toISOString(),
    app_metadata: {},
    user_metadata: {},
    factors: [
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        factor_type: "totp",
        status: "verified",
        friendly_name: "Jobs",
      },
    ],
  });
  const encode = (s) => Buffer.from(s).toString("base64url");
  const jwt = () =>
    [
      encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
      encode(
        JSON.stringify({
          sub: id,
          role: "authenticated",
          aal: level,
          amr: [],
          iss: "https://test.supabase.co/auth/v1",
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ),
      encode("synthetic-test-signature"),
    ].join(".");
  const session = () => ({
    access_token: jwt(),
    refresh_token: "synthetic-refresh",
    expires_in: 3600,
    token_type: "bearer",
    user: user(),
  });
  let downloads = 0;
  await page.route("**/admin/jobs/config.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: "window.JOBS_CONFIG={supabaseUrl:'https://test.supabase.co',publishableKey:'synthetic-publishable-key'};",
    }),
  );
  await page.route("https://test.supabase.co/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      method = req.method();
    let body = {};
    try {
      body = req.postDataJSON() || {};
    } catch {}
    const send = (value, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(value),
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    if (method === "OPTIONS") return send({});
    if (url.pathname.includes("/auth/v1/token")) return send(session());
    if (url.pathname === "/auth/v1/user") return send(user());
    if (url.pathname.endsWith("/challenge"))
      return send({
        id: "challenge-id",
        expires_at: Math.floor(Date.now() / 1000) + 300,
      });
    if (url.pathname.endsWith("/verify")) {
      if (!mfa) return send({ message: "Invalid code" }, 400);
      level = "aal2";
      return send(session());
    }
    if (url.pathname.endsWith("/logout")) return send({});
    if (url.pathname.endsWith("/rpc/jobs_authorized"))
      return send(owner && level === "aal2");
    if (!owner || level !== "aal2")
      return send({ message: "Owner and MFA required" }, 403);
    if (url.pathname.endsWith("/rpc/jobs_ingest_alert")) {
      if (
        records.alert_messages.some(
          (m) =>
            m.external_id === body.message_key && m.source === body.source_name,
        )
      )
        return send(0);
      const message_id = crypto.randomUUID();
      records.alert_messages.push({
        id: message_id,
        source: body.source_name,
        external_id: body.message_key,
      });
      for (const l of body.leads)
        records.leads.push({
          id: crypto.randomUUID(),
          message_id,
          title: l.title,
          company: l.company,
          posting_url: l.url,
          source: body.source_name,
          received_at: body.received,
          warning: l.warning,
          state: "Review",
        });
      return send(body.leads.length);
    }
    if (url.pathname.endsWith("/rpc/jobs_mark_applied")) {
      const app = records.applications.find((a) => a.id === body.application);
      app.status = "Applied";
      app.date_applied = body.applied_on;
      app.submitted_document_ids = body.documents;
      for (const d of records.documents)
        if (body.documents.includes(d.id)) d.state = "Submitted";
      return send(null);
    }
    if (url.pathname.includes("/functions/"))
      return send(
        { error: "Dedicated Gmail OAuth configuration is missing." },
        409,
      );
    if (url.pathname.includes("/storage/v1/object/")) {
      if (method === "POST") return send({ Key: "uploaded" });
      downloads++;
      return route.fulfill({
        contentType: "application/pdf",
        body: Buffer.from("%PDF-1.4\nsynthetic\n%%EOF"),
      });
    }
    const name = url.pathname
      .split("/")
      .pop()
      ?.replace(/^jobs_/, "");
    const list = records[name];
    if (!list) return send({ message: "Fixture route not found" }, 404);
    if (method === "GET") return send(list);
    if (method === "POST") {
      const created = {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...body,
      };
      if (name === "applications") {
        created.status ||= "Saved";
        created.submitted_document_ids ||= [];
        created.notes ||= "";
        created.description ||= "";
        records.history.push({
          id: crypto.randomUUID(),
          application_id: created.id,
          occurred_at: created.created_at,
          after_record: { ...created },
        });
      }
      if (name === "documents") {
        created.state ||= "Draft";
        created.uploaded ||= false;
      }
      if (name === "settings") {
        const old = list.find((r) => r.key === created.key);
        if (old) {
          old.value = created.value;
          return send(old);
        }
      }
      list.push(created);
      return send(created, 201);
    }
    if (method === "PATCH") {
      const id = url.searchParams.get("id")?.replace("eq.", "");
      const old = list.find((r) => String(r.id) === id);
      if (!old) return send({ message: "Not found" }, 404);
      Object.assign(old, body);
      return send(old);
    }
    return send({ message: "Unexpected operation" }, 400);
  });
  return { records, downloads: () => downloads };
}
export async function login(page) {
  await page.goto("/Samra-portfolio/admin/jobs/index.html");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
  await page.getByLabel("Authenticator code").fill("123456");
  await page.getByRole("button", { name: "Verify & open Jobs" }).click();
}
