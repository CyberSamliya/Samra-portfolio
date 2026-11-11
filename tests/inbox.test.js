import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
test("server inbox: guards, explicit connect, one account, read-only MIME import, retry and disconnect", async (t) => {
  const env = {
    JOBS_WEB_ORIGIN: "https://portfolio.example",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_ANON_KEY: "synthetic",
    GMAIL_CLIENT_ID: "synthetic",
    GMAIL_CLIENT_SECRET: "synthetic",
    GMAIL_REFRESH_TOKEN: "synthetic",
    GMAIL_INBOX_ADDRESS: "jobs@example.test",
  };
  let authorized = false,
    authenticated = true,
    handler;
  const state = { connected: false, cursor: null };
  const seen = new Set();
  const saved = [];
  const calls = [];
  let profile = "jobs@example.test";
  const stateQuery = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    single: async () => ({ data: { ...state } }),
    update(v) {
      Object.assign(state, v);
      return this;
    },
    then(resolve) {
      return Promise.resolve({ error: null }).then(resolve);
    },
  };
  globalThis.__jobsClient = () => ({
    auth: {
      getUser: async () => ({
        data: { user: authenticated ? { id: "owner" } : null },
        error: authenticated ? null : {},
      }),
    },
    rpc: async (name, args) => {
      if (name === "jobs_authorized") return { data: authorized };
      if (name === "jobs_ingest_alert") {
        saved.push(args);
        seen.add(args.message_key);
        return { data: args.leads.length };
      }
    },
    from: (table) =>
      table === "jobs_import_state"
        ? stateQuery
        : {
            select() {
              return this;
            },
            eq(k, v) {
              if (k === "external_id") this.key = v;
              return this;
            },
            maybeSingle: async function () {
              return { data: seen.has(this.key) ? { id: this.key } : null };
            },
          },
  });
  globalThis.Deno = {
    env: { get: (key) => env[key] },
    serve: (fn) => {
      handler = fn;
    },
  };
  const result = await build({
    entryPoints: ["supabase/functions/job-alert-import/index.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [
      {
        name: "synthetic-sdk",
        setup(b) {
          b.onResolve({ filter: /^npm:/ }, () => ({
            path: "sdk",
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: "export const createClient = globalThis.__jobsClient;",
          }));
        },
      },
    ],
  });
  await import(
    "data:text/javascript;base64," +
      Buffer.from(result.outputFiles[0].text).toString("base64")
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, method: opts?.method || "GET" });
    if (url === "https://oauth2.googleapis.com/token")
      return Response.json({
        access_token: "synthetic",
        scope: "https://www.googleapis.com/auth/gmail.readonly",
      });
    if (url.endsWith("/profile"))
      return Response.json({ emailAddress: profile });
    if (url.includes("/messages?"))
      return Response.json({ messages: [{ id: "m1" }] });
    if (url.includes("/messages/m1?"))
      return Response.json({
        internalDate: "1794400000000",
        payload: {
          parts: [
            {
              mimeType: "text/plain",
              body: {
                data: Buffer.from(
                  "SOC Analyst | Example\nhttps://www.usajobs.gov/job/123\nCI Specialist | Other\nhttps://careers.example.com/ci",
                ).toString("base64url"),
              },
            },
            {
              filename: "private.pdf",
              mimeType: "application/pdf",
              body: { attachmentId: "never-download" },
            },
          ],
        },
      });
    throw Error("Unexpected outbound URL " + url);
  };
  const req = (action, origin = env.JOBS_WEB_ORIGIN) =>
    handler(
      new Request("https://test.supabase.co/functions/v1/job-alert-import", {
        method: "POST",
        headers: {
          origin,
          authorization: "Bearer synthetic",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      }),
    );
  try {
    await t.test(
      "unauthenticated/non-owner/AAL1 cannot reach provider",
      async () => {
        authenticated = false;
        assert.equal((await req("run")).status, 401);
        authenticated = true;
        assert.equal((await req("run")).status, 403);
        assert.equal(
          (await req("run", "https://untrusted.example")).status,
          403,
        );
        assert.equal(calls.length, 0);
      },
    );
    authorized = true;
    await t.test(
      "disconnected run blocked, account identity checked on explicit authorization",
      async () => {
        assert.equal((await req("run")).status, 409);
        profile = "wrong@example.test";
        assert.equal((await req("connect")).status, 400);
        assert.equal(state.connected, false);
        profile = "jobs@example.test";
        assert.equal((await req("connect")).status, 200);
        assert.equal(state.connected, true);
      },
    );
    await t.test(
      "individual leads, no attachment fetches, idempotent retry and status",
      async () => {
        assert.equal((await req("run")).status, 200);
        assert.equal(saved.length, 1);
        assert.equal(saved[0].leads.length, 2);
        assert.equal(state.imported, 1);
        assert.equal(state.leads, 2);
        assert.ok(state.last_success);
        assert.equal((await req("run")).status, 200);
        assert.equal(saved.length, 1);
        assert.equal(
          calls.some((c) => c.url.includes("attachments")),
          false,
        );
        assert.equal(
          calls.some((c) => c.url.includes("careers.example.com")),
          false,
        );
      },
    );
    await t.test("disconnect blocks further imports", async () => {
      assert.equal((await req("disconnect")).status, 200);
      assert.equal(state.connected, false);
      assert.equal((await req("run")).status, 409);
    });
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.Deno;
    delete globalThis.__jobsClient;
  }
});
