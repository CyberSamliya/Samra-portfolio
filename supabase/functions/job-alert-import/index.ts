import { createClient } from "npm:@supabase/supabase-js@2.95.3";
import { parseGmailMessage } from "../_shared/gmail.js";
const env = (key: string) => Deno.env.get(key) || "";
const origin = env("JOBS_WEB_ORIGIN");
const headers = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
};
const response = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers });
async function jsonRequest(url: string, options: RequestInit = {}) {
  const r = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok)
    throw Error(
      "Provider request failed (" +
        r.status +
        "). Check the private OAuth grant and retry.",
    );
  return r.json();
}
Deno.serve(async (req) => {
  if (!origin || req.headers.get("origin") !== origin)
    return response(403, { error: "Origin not allowed" });
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return response(405, { error: "POST required" });
  const authorization = req.headers.get("authorization") || "";
  const client = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  // Verify identity with Auth, then verify owner/AAL2 in Postgres. Never use service-role access here.
  const { data: user, error: authError } = await client.auth.getUser();
  if (authError || !user.user)
    return response(401, { error: "Sign in required" });
  const { data: authorized, error: permissionError } =
    await client.rpc("jobs_authorized");
  if (permissionError || !authorized)
    return response(403, { error: "Owner and completed MFA required" });
  const state = client.from("jobs_import_state");
  try {
    const text = await req.text();
    if (text.length > 1024)
      return response(413, { error: "Request too large" });
    const { action } = JSON.parse(text);
    if (action === "disconnect") {
      const { error } = await state
        .update({
          connected: false,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (error) throw Error("Could not disconnect.");
      return response(200, {
        message: "Import disabled. Revoke the Gmail OAuth grant separately.",
      });
    }
    const required = [
      "GMAIL_CLIENT_ID",
      "GMAIL_CLIENT_SECRET",
      "GMAIL_REFRESH_TOKEN",
      "GMAIL_INBOX_ADDRESS",
    ];
    if (required.some((k) => !env(k)))
      return response(409, {
        error:
          "Dedicated Gmail OAuth configuration is missing. Configure it privately before connecting.",
      });
    if (!["connect", "run"].includes(action))
      return response(400, { error: "Unknown action" });
    const { data: setting, error: settingError } = await state
      .select("*")
      .eq("id", true)
      .single();
    if (settingError) throw Error("Import settings unavailable.");
    if (action === "run" && !setting.connected)
      return response(409, { error: "Authorize the dedicated inbox first." });
    const token = await jsonRequest("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env("GMAIL_CLIENT_ID"),
        client_secret: env("GMAIL_CLIENT_SECRET"),
        refresh_token: env("GMAIL_REFRESH_TOKEN"),
        grant_type: "refresh_token",
      }),
    });
    const scopes = String(token.scope || "").split(" ");
    if (
      !scopes.includes("https://www.googleapis.com/auth/gmail.readonly") ||
      scopes.some(
        (s: string) => s.includes("gmail.") && !s.endsWith("gmail.readonly"),
      ) ||
      scopes.includes("https://mail.google.com/")
    )
      throw Error("Use a Gmail read-only OAuth grant.");
    const options = {
      headers: { Authorization: "Bearer " + token.access_token },
    };
    const base = "https://gmail.googleapis.com/gmail/v1/users/me";
    const profile = await jsonRequest(base + "/profile", options);
    if (
      profile.emailAddress?.toLowerCase() !==
      env("GMAIL_INBOX_ADDRESS").toLowerCase()
    )
      throw Error(
        "OAuth account does not match the configured dedicated inbox.",
      );
    if (action === "connect") {
      const { error } = await state
        .update({
          connected: true,
          cursor: null,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (error) throw Error("Could not authorize inbox.");
      return response(200, {
        message: "Dedicated read-only inbox authorized.",
      });
    }
    const query = new URLSearchParams({
      maxResults: "25",
      labelIds: env("GMAIL_LABEL_ID") || "INBOX",
    });
    if (setting.cursor) query.set("pageToken", setting.cursor);
    const list = await jsonRequest(base + "/messages?" + query, options);
    let imported = 0,
      leads = 0;
    for (const item of list.messages || []) {
      const { data: seen, error: seenError } = await client
        .from("jobs_alert_messages")
        .select("id")
        .eq("source", "Gmail API")
        .eq("external_id", item.id)
        .maybeSingle();
      if (seenError) throw Error("Could not check previous imports.");
      if (seen) continue;
      const message = await jsonRequest(
        base + "/messages/" + encodeURIComponent(item.id) + "?format=full",
        options,
      );
      const parsed = parseGmailMessage(message);
      const { data: count, error } = await client.rpc("jobs_ingest_alert", {
        source_name: "Gmail API",
        message_key: item.id,
        received: new Date(Number(message.internalDate)).toISOString(),
        format_name: "Gmail API",
        leads: parsed,
      });
      if (error) throw Error("Could not save review queue. Retry is safe.");
      imported++;
      leads += count;
    }
    const { error } = await state
      .update({
        last_success: new Date().toISOString(),
        imported,
        leads,
        error: null,
        cursor: list.nextPageToken || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", true);
    if (error) throw Error("Could not save import status. Retry is safe.");
    return response(200, {
      message: `${imported} messages imported, ${leads} leads queued.${list.nextPageToken ? " Run again for the next page." : ""}`,
    });
  } catch (error) {
    // Never expose provider response bodies, tokens, raw messages or unexpected SDK errors.
    const safe =
      error instanceof Error &&
      /^(Provider request failed|Use a Gmail|OAuth account|Could not |Import settings)/.test(
        error.message,
      )
        ? error.message
        : "Import failed. Check private configuration and retry.";
    await state
      .update({ error: safe, updated_at: new Date().toISOString() })
      .eq("id", true);
    return response(400, { error: safe });
  }
});
