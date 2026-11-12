import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf.mjs";
import mammoth from "mammoth/mammoth.browser.js";
GlobalWorkerOptions.workerSrc = new URL(
  "./pdf.worker.mjs",
  import.meta.url,
).href;
const element = (tag, text) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
};
export function startPreview(blob, filename, container) {
  let closed = false,
    loadingTask,
    pdf,
    renderTask,
    busy = false,
    pageNumber = 0;
  container.replaceChildren();
  const status = element("p", "Opening document…");
  status.setAttribute("role", "status");
  container.append(status);
  const pages = element("div");
  pages.className = "preview-pages";
  container.append(pages);
  const next = element("button", "Show next page");
  next.type = "button";
  next.className = "secondary";
  next.hidden = true;
  container.append(next);
  const fail = () => {
    if (!closed) {
      status.textContent =
        "This file could not be previewed here. Use Download original to open it in your PDF reader or Word.";
      next.hidden = true;
    }
  };
  async function renderNext() {
    if (closed || busy || !pdf || pageNumber >= pdf.numPages) return;
    busy = true;
    next.disabled = true;
    try {
      const page = await pdf.getPage(pageNumber + 1);
      if (closed) return;
      const base = page.getViewport({ scale: 1 }),
        width = Math.min(1000, Math.max(320, container.clientWidth - 24));
      const viewport = page.getViewport({
        scale: (Math.min(2, devicePixelRatio || 1) * width) / base.width,
      });
      if (viewport.width * viewport.height > 16000000)
        throw Error("Page too large");
      const section = element("section"),
        title = element(
          "h3",
          "Page " + (pageNumber + 1) + " of " + pdf.numPages,
        ),
        canvas = element("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.className = "pdf-page";
      canvas.setAttribute("aria-label", title.textContent + " of " + filename);
      section.append(title, canvas);
      pages.append(section);
      renderTask = page.render({
        canvasContext: canvas.getContext("2d"),
        viewport,
      });
      await renderTask.promise;
      if (closed) return;
      const text = await page.getTextContent();
      if (closed) return;
      const details = element("details"),
        summary = element("summary", "Selectable page text"),
        pre = element("pre", text.items.map((t) => t.str || "").join(" "));
      pre.className = "document-text";
      details.append(summary, pre);
      section.append(details);
      pageNumber++;
      status.textContent =
        "Showing " + pageNumber + " of " + pdf.numPages + " pages.";
      next.hidden = pageNumber >= pdf.numPages;
    } catch {
      fail();
    } finally {
      busy = false;
      next.disabled = false;
    }
  }
  next.onclick = renderNext;
  void (async () => {
    try {
      if (blob.type === "application/pdf") {
        loadingTask = getDocument({
          data: new Uint8Array(await blob.arrayBuffer()),
          isEvalSupported: false,
          enableXfa: false,
          useWasm: false,
          cMapUrl: new URL("./pdf-cmaps/", import.meta.url).href,
          cMapPacked: true,
          standardFontDataUrl: new URL("./pdf-fonts/", import.meta.url).href,
          wasmUrl: new URL("./pdf-wasm/", import.meta.url).href,
        });
        pdf = await loadingTask.promise;
        if (closed) {
          await pdf.destroy();
          return;
        }
        await renderNext();
      } else if (filename.toLowerCase().endsWith(".docx")) {
        const result = await mammoth.extractRawText({
          arrayBuffer: await blob.arrayBuffer(),
        });
        if (closed) return;
        const pre = element(
          "pre",
          result.value ||
            "No readable text was found. Download the original to view the full document.",
        );
        pre.className = "document-text";
        pages.append(pre);
        status.textContent =
          "DOCX text preview. Formatting and images are omitted; download the original for the Word layout.";
      } else
        status.textContent =
          "ZIP archives need to be downloaded and extracted on your device. Use Download original above.";
    } catch {
      fail();
    }
  })();
  return () => {
    closed = true;
    renderTask?.cancel();
    void loadingTask?.destroy().catch(() => {});
    container.replaceChildren();
  };
}
