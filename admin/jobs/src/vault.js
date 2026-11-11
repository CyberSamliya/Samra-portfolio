import { openDatabase, readSnapshot, commitSnapshot } from "./local-store.js";
import { initialData } from "./local-api.js";
const ITERATIONS = 600000,
  DB = "samra-jobs-local-v1";
const b64 = (value) => {
  const array = new Uint8Array(value),
    chunks = [];
  for (let i = 0; i < array.length; i += 32768)
    chunks.push(String.fromCharCode(...array.subarray(i, i + 32768)));
  return btoa(chunks.join(""));
};
const bytes = (value) => {
  if (typeof value !== "string") throw Error("Invalid encrypted backup");
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
};
function validateMetadata(m) {
  if (
    m?.version !== 1 ||
    m.iterations !== ITERATIONS ||
    typeof m.id !== "string" ||
    !(m.salt instanceof Uint8Array) ||
    m.salt.length !== 16
  )
    throw Error("Unsupported vault format");
}
async function codecFor(metadata, password) {
  validateMetadata(metadata);
  let key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: metadata.salt,
      iterations: ITERATIONS,
    },
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"],
    ),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const assertOpen = () => {
    if (!key) throw Error("Vault is locked. Unlock Jobs to continue.");
  };
  const encrypt = async (data, label) => {
    assertOpen();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(metadata.id + ":" + label),
      },
      key,
      data,
    );
    assertOpen();
    return { encrypted: true, iv, ciphertext };
  };
  const decrypt = async (value, label) => {
    assertOpen();
    if (!value?.encrypted) throw Error("Invalid encrypted vault record");
    try {
      const result = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: value.iv,
          additionalData: new TextEncoder().encode(metadata.id + ":" + label),
        },
        key,
        value.ciphertext,
      );
      assertOpen();
      return result;
    } catch {
      assertOpen();
      throw Error("Incorrect password, or the encrypted data is damaged.");
    }
  };
  return {
    id: metadata.id,
    assertOpen,
    close() {
      key = null;
    },
    encryptJSON: (value, label) =>
      encrypt(new TextEncoder().encode(JSON.stringify(value)), label),
    async decryptJSON(value, label) {
      return JSON.parse(new TextDecoder().decode(await decrypt(value, label)));
    },
    async encryptBlob(blob, path) {
      return {
        ...(await encrypt(
          await blob.arrayBuffer(),
          "file:" + path + ":" + blob.type,
        )),
        type: blob.type,
      };
    },
    async decryptBlob(value, path) {
      return new Blob(
        [await decrypt(value, "file:" + path + ":" + value.type)],
        { type: value.type },
      );
    },
    async backup(value) {
      const payload = await this.encryptJSON(value, "backup");
      return JSON.stringify({
        format: "samra-jobs-encrypted-backup",
        version: 1,
        id: metadata.id,
        iterations: ITERATIONS,
        salt: b64(metadata.salt),
        iv: b64(payload.iv),
        ciphertext: b64(payload.ciphertext),
      });
    },
  };
}
export async function inspectVault() {
  const db = await openDatabase(DB);
  try {
    const s = await readSnapshot(db, true);
    return {
      exists: !!s.vault,
      hasLegacy: !s.vault && !!s.workspace,
      legacyCount: s.workspace?.applications?.length || 0,
    };
  } finally {
    db.close();
  }
}
export async function setupVault(password) {
  if (password.length < 12)
    throw Error("Use at least 12 characters for your vault password.");
  const db = await openDatabase(DB);
  let codec;
  try {
    const snapshot = await readSnapshot(db, true);
    if (snapshot.vault)
      throw Error("A vault was created in another tab. Reload and unlock it.");
    const metadata = {
      id: crypto.randomUUID(),
      version: 1,
      iterations: ITERATIONS,
      salt: crypto.getRandomValues(new Uint8Array(16)),
    };
    codec = await codecFor(metadata, password);
    const workspace = await codec.encryptJSON(
      snapshot.workspace || initialData(),
      "workspace",
    );
    const files = await Promise.all(
      snapshot.paths.map(async (path, i) => ({
        path,
        value: await codec.encryptBlob(snapshot.files[i], path),
      })),
    );
    if (
      !(await commitSnapshot(db, snapshot, workspace, files, {
        replace: true,
        metadata,
      }))
    )
      throw Error(
        "Data changed in another tab. Close other Jobs tabs and retry setup.",
      );
    return codec;
  } catch (e) {
    codec?.close();
    throw e;
  } finally {
    db.close();
  }
}
export async function unlockVault(password) {
  const db = await openDatabase(DB);
  let codec;
  try {
    const snapshot = await readSnapshot(db);
    if (!snapshot.vault) throw Error("Create a vault password first.");
    codec = await codecFor(snapshot.vault, password);
    await codec.decryptJSON(snapshot.workspace, "workspace");
    return codec;
  } catch (e) {
    codec?.close();
    throw e;
  } finally {
    db.close();
  }
}
export async function decryptBackup(value, password) {
  if (value?.format !== "samra-jobs-encrypted-backup" || value.version !== 1)
    throw Error("Unsupported encrypted backup");
  const metadata = {
    version: 1,
    id: value.id,
    iterations: value.iterations,
    salt: bytes(value.salt),
  };
  const codec = await codecFor(metadata, password);
  try {
    return await codec.decryptJSON(
      {
        encrypted: true,
        iv: bytes(value.iv),
        ciphertext: bytes(value.ciphertext),
      },
      "backup",
    );
  } finally {
    codec.close();
  }
}
