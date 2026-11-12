export const RESUME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/zip",
];
export async function prepareResume(blob, filename, expectedHash) {
  if (
    typeof filename !== "string" ||
    !filename.trim() ||
    filename.length > 250 ||
    /[\\/\x00-\x1f]/.test(filename)
  )
    throw Error("Use a valid document filename.");
  if (!(blob instanceof Blob) || !blob.size || blob.size > 8388608)
    throw Error("Each file must be between 1 byte and 8 MB.");
  const ext = filename.split(".").pop().toLowerCase();
  const mime_type =
    ext === "pdf"
      ? RESUME_TYPES[0]
      : ext === "docx"
        ? RESUME_TYPES[1]
        : ext === "zip"
          ? RESUME_TYPES[2]
          : null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (
    !mime_type ||
    (ext === "pdf"
      ? !new TextDecoder().decode(bytes.slice(0, 5)).startsWith("%PDF-")
      : !(bytes[0] === 0x50 && bytes[1] === 0x4b))
  )
    throw Error("Choose PDF, DOCX or ZIP files with matching file contents.");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (expectedHash && expectedHash !== hash)
    throw Error("Import integrity check failed for " + filename);
  return {
    filename,
    mime_type,
    hash,
    blob: new Blob([bytes], { type: mime_type }),
    size: bytes.length,
  };
}
export async function readResumePackage(
  value,
  expectedFormat = "samra-resume-library",
) {
  if (
    value?.format !== expectedFormat ||
    value.version !== 1 ||
    !Array.isArray(value.files) ||
    !value.files.length ||
    value.files.length > 100
  )
    throw Error("Choose a supported document import file.");
  return Promise.all(
    value.files.map(async (f) => {
      if (
        typeof f.base64 !== "string" ||
        f.base64.length > 11200000 ||
        typeof f.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(f.sha256)
      )
        throw Error("Invalid document import file.");
      let bytes;
      try {
        bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
      } catch {
        throw Error("Corrupt document import file.");
      }
      return prepareResume(new Blob([bytes]), f.name, f.sha256);
    }),
  );
}

export const readRecommendationPackage = (value) =>
  readResumePackage(value, "samra-recommendation-library");
