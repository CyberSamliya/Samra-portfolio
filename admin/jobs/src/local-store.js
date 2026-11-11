// IndexedDB persistence shared by legacy migration/tests and the encrypted vault.
export function openDatabase(name) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 2);
    r.onupgradeneeded = () => {
      for (const s of ["records", "files"])
        if (!r.result.objectStoreNames.contains(s))
          r.result.createObjectStore(s);
    };
    r.onsuccess = () => {
      r.result.onversionchange = () => r.result.close();
      resolve(r.result);
    };
    r.onerror = () =>
      reject(
        Error("Browser storage is unavailable. Allow site storage and reload."),
      );
    r.onblocked = () =>
      reject(
        Error("Close other Jobs tabs and reload to upgrade browser storage."),
      );
  });
}
export function readSnapshot(db, includeFiles = false) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["records", "files"]);
    const result = {};
    for (const key of ["workspace", "revision", "vault"]) {
      const r = tx.objectStore("records").get(key);
      r.onsuccess = () => (result[key] = r.result);
    }
    if (includeFiles) {
      const k = tx.objectStore("files").getAllKeys();
      k.onsuccess = () => (result.paths = k.result);
      const f = tx.objectStore("files").getAll();
      f.onsuccess = () => (result.files = f.result);
    }
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(Error("Could not read browser storage"));
  });
}
export function commitSnapshot(
  db,
  snapshot,
  workspace,
  files = [],
  { replace = false, metadata } = {},
) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["records", "files"], "readwrite"),
      store = tx.objectStore("records");
    let conflict = false;
    const r = store.get("revision");
    r.onsuccess = () => {
      if ((r.result || 0) !== (snapshot.revision || 0)) {
        conflict = true;
        tx.abort();
        return;
      }
      store.put(workspace, "workspace");
      store.put((r.result || 0) + 1, "revision");
      if (metadata) store.put(metadata, "vault");
      const f = tx.objectStore("files");
      if (replace) f.clear();
      for (const item of files) f.add(item.value, item.path);
    };
    tx.oncomplete = () => resolve(true);
    tx.onabort = () =>
      conflict
        ? resolve(false)
        : reject(
            Error(
              tx.error?.name === "QuotaExceededError"
                ? "Browser storage is full. Free space and retry."
                : "Could not save browser data; existing records were kept.",
            ),
          );
    tx.onerror = () => {};
  });
}
export async function openLocalStore(name, codec, initial) {
  const db = await openDatabase(name);
  let closed = false;
  const check = () => {
    if (closed) throw Error("Vault is locked. Unlock Jobs to continue.");
    codec?.assertOpen();
  };
  const decode = async (snapshot) => {
    check();
    if (snapshot.vault && !codec)
      throw Error("This Jobs vault is password-protected.");
    if (codec && snapshot.vault?.id !== codec.id)
      throw Error("Vault changed in another tab. Reload and unlock again.");
    const data = codec
      ? await codec.decryptJSON(snapshot.workspace, "workspace")
      : snapshot.workspace || initial();
    check();
    return data;
  };
  const encode = (data) =>
    codec ? codec.encryptJSON(data, "workspace") : data;
  const fileValue = (blob, path) =>
    codec ? codec.encryptBlob(blob, path) : blob;
  async function transaction(mode, change) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const snapshot = await readSnapshot(db);
      const data = await decode(snapshot);
      const queued = [];
      const result = change(data, {
        add: (blob, path) => {
          if (queued.some((f) => f.path === path))
            throw Error("Duplicate file");
          queued.push({ path, blob });
        },
      });
      if (mode === "readonly") return result;
      const workspace = await encode(data);
      const files = await Promise.all(
        queued.map(async (f) => ({
          path: f.path,
          value: await fileValue(f.blob, f.path),
        })),
      );
      check();
      if (await commitSnapshot(db, snapshot, workspace, files)) return result;
    }
    throw Error("Another tab is changing Jobs. Wait a moment and retry.");
  }
  return {
    transaction,
    close() {
      closed = true;
      db.close();
    },
    async snapshot() {
      const raw = await readSnapshot(db, true);
      const data = await decode(raw);
      const files = await Promise.all(
        raw.paths.map(async (path, i) => ({
          path,
          blob: codec
            ? await codec.decryptBlob(raw.files[i], path)
            : raw.files[i],
        })),
      );
      check();
      return { data, files };
    },
    async download(path) {
      const { data, files } = await this.snapshot();
      if (!data.documents.some((d) => d.object_path === path && d.uploaded))
        throw Error("Document not found");
      const file = files.find((f) => f.path === path);
      if (!file) throw Error("File missing. Restore a complete backup.");
      return file.blob;
    },
    async replace(prepared) {
      const snapshot = await readSnapshot(db);
      await decode(snapshot);
      const workspace = await encode(prepared.data);
      const files = await Promise.all(
        prepared.files.map(async (f) => ({
          path: f.path,
          value: await fileValue(f.blob, f.path),
        })),
      );
      check();
      if (
        !(await commitSnapshot(db, snapshot, workspace, files, {
          replace: true,
        }))
      )
        throw Error("Another tab changed Jobs. Review the backup and retry.");
    },
  };
}
