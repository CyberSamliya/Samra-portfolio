import { createClient } from "@supabase/supabase-js";
export function createAPI(config) {
  const client = createClient(config.supabaseUrl, config.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  const unwrap = async (p) => {
    const { data, error } = await p;
    if (error)
      throw Error(
        error.code === "23505"
          ? "Exact duplicate: this URL or source job ID is already saved."
          : error.message,
      );
    return data;
  };
  const table = (n) => client.from("jobs_" + n);
  return {
    client,
    unwrap,
    list: async (n) => {
      const order =
        n === "applications"
          ? "updated_at"
          : ["profiles", "documents"].includes(n)
            ? "created_at"
            : n === "history"
              ? "occurred_at"
              : "id";
      const rows = [];
      for (let offset = 0; ; offset += 1000) {
        let query = table(n).select("*").order(order, { ascending: false });
        if (order !== "id") query = query.order("id", { ascending: false });
        const page = await unwrap(query.range(offset, offset + 999));
        rows.push(...page);
        if (page.length < 1000) return rows;
      }
    },
    settings: () => unwrap(table("settings").select("*")),
    saveSetting: (key, value) =>
      unwrap(table("settings").upsert({ key, value })),
    insert: (n, record) => unwrap(table(n).insert(record).select().single()),
    update: (n, id, record) =>
      unwrap(table(n).update(record).eq("id", id).select().single()),
    rpc: (name, args) => unwrap(client.rpc("jobs_" + name, args)),
    upload: (path, file) =>
      unwrap(
        client.storage
          .from("jobs-private")
          .upload(path, file, { upsert: false, contentType: file.type }),
      ),
    download: (path) =>
      unwrap(client.storage.from("jobs-private").download(path)),
    inbox: (action) =>
      unwrap(client.functions.invoke("job-alert-import", { body: { action } })),
  };
}
