// Lightweight client-side helpers around pdfjs-dist.
// Renders PDF pages to canvases and extracts text positions for auto-suggest.

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const lib = await import("pdfjs-dist");
      // Use the worker bundled with pdfjs-dist
      const workerSrc = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
      lib.GlobalWorkerOptions.workerSrc = workerSrc;
      return lib;
    })();
  }
  return pdfjsPromise;
}

export async function loadPdf(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  const lib = await getPdfjs();
  const task = lib.getDocument({ data: bytes });
  return task.promise;
}

export async function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale = 1.5,
) {
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return { width: viewport.width, height: viewport.height };
}

export interface DetectedField {
  page: number;
  x: number; y: number; width: number; height: number;  // normalized 0..1, y from top
  label: string;
  field_type: "signature" | "initial" | "date" | "text" | "email" | "phone" | "address";
  signer_role: "client" | "coach" | "payor" | "parent_guardian";
  internal_name: string;
}

const LABEL_PATTERNS: Array<{ re: RegExp; type: DetectedField["field_type"]; role: DetectedField["signer_role"]; name: string }> = [
  { re: /client\s+signature|signature.*client/i, type: "signature", role: "client", name: "client_signature" },
  { re: /^signature$|signature\s*:/i, type: "signature", role: "client", name: "client_signature" },
  { re: /client\s+initials|initials.*client|^initials$/i, type: "initial", role: "client", name: "client_initial" },
  { re: /payor\s+signature|payer\s+signature/i, type: "signature", role: "payor", name: "payor_signature" },
  { re: /parent.*signature|guardian.*signature/i, type: "signature", role: "parent_guardian", name: "guardian_signature" },
  { re: /coach\s+signature|admin\s+signature/i, type: "signature", role: "coach", name: "coach_signature" },
  { re: /date\s+signed|signed\s+on|^date\s*:?$/i, type: "date", role: "client", name: "date_signed" },
  { re: /full\s+legal\s+name|legal\s+name|full\s+name/i, type: "text", role: "client", name: "client_full_name" },
  { re: /date\s+of\s+birth|^dob$/i, type: "date", role: "client", name: "client_dob" },
  { re: /^email$|email\s+address|client\s+email/i, type: "email", role: "client", name: "client_email" },
  { re: /^phone$|phone\s+number|cell|mobile/i, type: "phone", role: "client", name: "client_phone" },
  { re: /mailing\s+address|^address$/i, type: "address", role: "client", name: "client_address" },
  { re: /emergency\s+contact/i, type: "text", role: "client", name: "emergency_contact" },
];

export async function detectFields(doc: PDFDocumentProxy): Promise<DetectedField[]> {
  const out: DetectedField[] = [];
  const counters = new Map<string, number>();
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const text = await page.getTextContent();
    for (const item of text.items as any[]) {
      const str = item.str?.trim();
      if (!str || str.length < 3 || str.length > 60) continue;
      const match = LABEL_PATTERNS.find((pat) => pat.re.test(str));
      if (!match) continue;
      // pdf.js transform: [a, b, c, d, e, f] where e,f is x,y from BOTTOM-LEFT
      const tx = item.transform as number[];
      const x = tx[4];
      const yFromBottom = tx[5];
      const itemH = item.height || 10;
      const itemW = item.width || 80;
      // Place a field UNDER the label (where signature lines typically go)
      const fieldYFromTop = (viewport.height - yFromBottom + 4) / viewport.height;
      const fx = x / viewport.width;
      const fw = Math.max(0.25, (itemW * 2) / viewport.width);
      const fh = Math.max(0.025, itemH / viewport.height + 0.012);
      const key = match.name;
      const n = (counters.get(key) ?? 0) + 1;
      counters.set(key, n);
      out.push({
        page: p,
        x: Math.max(0, Math.min(1, fx)),
        y: Math.max(0, Math.min(0.98, fieldYFromTop)),
        width: Math.min(0.7, fw),
        height: Math.min(0.05, fh),
        label: str,
        field_type: match.type,
        signer_role: match.role,
        internal_name: n === 1 ? key : `${key}_${n}`,
      });
    }
  }
  return out;
}