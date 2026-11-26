import { cn } from "@/lib/utils";

/** Format stored legal text without changing it, interpreting HTML, or hiding clauses.
 * Both legacy plain text and numbered/Markdown-style headings are supported. */
export type LegalTextLine = { kind: "heading" | "bullet" | "text" | "space"; text: string };
const PLAIN_HEADINGS = new Set([
  "Service providers and AI processing", "AI services (OpenAI and Google)", "Other service providers",
  "AI processing (optional)", "Account headshot", "Account headshots", "Crew profile picture",
  "Consent", "Contact us", "Privacy Policy", "Terms of Service",
]);

export function formatLegalText(body: string): LegalTextLine[] {
  return body.split(/\r?\n/).map((text) => {
    const line = text.trim();
    if (!line) return { kind: "space", text };
    if (/^[-*•]\s+/.test(line)) return { kind: "bullet", text };
    if (/^#{1,6}\s+/.test(line) || /^\d+(?:\.\d+)*[.)]?\s+[^.!?]{2,100}$/.test(line) || PLAIN_HEADINGS.has(line)) {
      return { kind: "heading", text };
    }
    return { kind: "text", text };
  });
}

export function LegalDocumentBody({ body, className }: { body: string; className?: string }) {
  return (
    <div data-legal-document-body className={cn("min-w-0 break-words text-[15px] leading-[1.7] text-foreground/90", className)}>
      {formatLegalText(body).map(({ kind, text }, i) => {
        if (kind === "space") return <div key={i} aria-hidden className="h-3" />;
        if (kind === "heading") return <h3 key={i} className="mb-2 mt-5 text-[16px] font-semibold leading-snug tracking-tight text-foreground first:mt-0">{text}</h3>;
        if (kind === "bullet") return <p key={i} className="my-1.5 whitespace-pre-wrap pl-4 -indent-4">{text}</p>;
        return <p key={i} className="whitespace-pre-wrap">{text}</p>;
      })}
    </div>
  );
}
