import { parseDigest } from "./jobs-core.js";
// Gmail API full messages only: no attachment fetches, no images, no navigation to email URLs.
export function bodyText(message) {
  const decode = (value) => {
    try {
      return new TextDecoder().decode(
        Uint8Array.from(
          atob(value.replace(/-/g, "+").replace(/_/g, "/")),
          (c) => c.charCodeAt(0),
        ),
      );
    } catch {
      return "";
    }
  };
  const plain = [],
    html = [];
  function walk(part) {
    if (part.filename || part.body?.attachmentId) return;
    if (part.mimeType === "text/plain" && part.body?.data)
      plain.push(decode(part.body.data));
    else if (part.mimeType === "text/html" && part.body?.data)
      html.push(decode(part.body.data));
    for (const child of part.parts || []) walk(child);
  }
  walk(message.payload || {});
  const body = (plain.length ? plain : html).join("\n");
  return body.length > 200000
    ? "Unknown format: message exceeds safe import size."
    : body;
}
export function parseGmailMessage(message) {
  return parseDigest(bodyText(message));
}
