/**
 * How Cleo's words are drawn: a small, safe Markdown subset (bold, links,
 * lists, tables, headings) as React elements; the model's text is never
 * injected as HTML. In-app links open with the router; a line that's only an
 * in-app link shows as a chip under the message instead.
 */
import { Fragment, useCallback, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { tokenizeInline } from "@/lib/summer-voice-text";

/** Opens an in-app link from Cleo: router navigation, query string kept. */
export function useOpenLink(onNavigated?: () => void) {
  const navigate = useNavigate();
  return useCallback(
    (href: string, internal: boolean) => {
      if (!internal) {
        window.open(href, "_blank", "noopener,noreferrer");
        return;
      }
      const u = new URL(href, window.location.origin);
      navigate({ to: u.pathname as any, search: Object.fromEntries(u.searchParams) as any });
      onNavigated?.();
    },
    [navigate, onNavigated],
  );
}

function Inline({ text, onLink }: { text: string; onLink: (href: string, internal: boolean) => void }) {
  return (
    <>
      {tokenizeInline(text).map((t, i) =>
        t.type === "bold" ? (
          <strong key={i} className="font-semibold">{t.text}</strong>
        ) : t.type === "link" ? (
          <button
            key={i}
            type="button"
            onClick={() => onLink(t.href, t.internal)}
            className="inline cursor-pointer font-medium underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground"
          >
            {t.label}
          </button>
        ) : (
          <Fragment key={i}>{t.text}</Fragment>
        ),
      )}
    </>
  );
}

export function CleoText({ text, onLink, hideLinkOnlyLines = true }: { text: string; onLink: (href: string, internal: boolean) => void; hideLinkOnlyLines?: boolean }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={blocks.length} className="-mx-1 overflow-x-auto px-1">
          <table className="w-full text-[13px]">
            {head && (
              <thead>
                <tr>{head.map((c, j) => <th key={j} className="border-b border-border px-2 py-1 text-left font-semibold"><Inline text={c} onLink={onLink} /></th>)}</tr>
              </thead>
            )}
            <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} className="border-b border-border/50 px-2 py-1 align-top"><Inline text={c} onLink={onLink} /></td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={blocks.length} className={cn("space-y-1 pl-5", ordered ? "list-decimal" : "list-disc")}>
          {items.map((it, j) => <li key={j}><Inline text={it} onLink={onLink} /></li>)}
        </List>,
      );
      continue;
    }
    if (hideLinkOnlyLines && /^\s*\[[^\]]+\]\(\/admin[^)]*\)\s*$/.test(line)) {
      i++;
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    blocks.push(
      <p key={blocks.length} className={heading ? "font-semibold" : undefined}>
        <Inline text={heading ? heading[1] : line} onLink={onLink} />
      </p>,
    );
    i++;
  }
  return <div className="space-y-2.5">{blocks}</div>;
}

/** What's copied: the words without Markdown link syntax or bold marks. */
export function plainText(text: string): string {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1");
}
