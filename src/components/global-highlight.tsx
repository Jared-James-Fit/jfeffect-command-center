import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";

/**
 * Reads `?highlight=<term>` from the URL and, after the destination page
 * renders, walks the DOM for the first matching text node, scrolls it into
 * view, and flashes a yellow highlight on the containing element.
 *
 * Mounted once at the root so every navigation gets the effect.
 */
export function GlobalHighlight() {
  const search = useRouterState({
    select: (s) => s.location.search as Record<string, unknown> | undefined,
  });
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const raw = typeof search?.highlight === "string" ? (search.highlight as string).trim() : "";

  useEffect(() => {
    if (!raw) return;
    const needle = raw.toLowerCase();
    let cancelled = false;
    let attempts = 0;

    const tryHighlight = () => {
      if (cancelled) return;
      attempts += 1;
      const root = document.querySelector("main, [role=main], body") as HTMLElement | null;
      if (!root) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName;
          if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return NodeFilter.FILTER_REJECT;
          if (parent.closest("[data-gh-skip]")) return NodeFilter.FILTER_REJECT;
          return node.nodeValue.toLowerCase().includes(needle)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      });
      const matches: Text[] = [];
      let n: Node | null;
      // eslint-disable-next-line no-cond-assign
      while ((n = walker.nextNode())) matches.push(n as Text);

      if (!matches.length) {
        if (attempts < 8) setTimeout(tryHighlight, 250);
        return;
      }

      const wraps: HTMLElement[] = [];
      for (const text of matches.slice(0, 25)) {
        const value = text.nodeValue ?? "";
        const lower = value.toLowerCase();
        const frag = document.createDocumentFragment();
        let cursor = 0;
        let idx = lower.indexOf(needle, cursor);
        while (idx !== -1) {
          if (idx > cursor) frag.appendChild(document.createTextNode(value.slice(cursor, idx)));
          const mark = document.createElement("mark");
          mark.className = "gh-mark";
          mark.setAttribute("data-gh-mark", "");
          mark.textContent = value.slice(idx, idx + needle.length);
          frag.appendChild(mark);
          wraps.push(mark);
          cursor = idx + needle.length;
          idx = lower.indexOf(needle, cursor);
        }
        if (cursor < value.length) frag.appendChild(document.createTextNode(value.slice(cursor)));
        text.parentNode?.replaceChild(frag, text);
      }

      const first = wraps[0];
      if (first) {
        first.scrollIntoView({ behavior: "smooth", block: "center" });
        first.classList.add("gh-flash");
        const container = first.closest("article, section, li, tr, [data-card], .card") as HTMLElement | null;
        container?.classList.add("gh-flash-container");
      }
    };

    const t = window.setTimeout(tryHighlight, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      document.querySelectorAll("mark[data-gh-mark]").forEach((el) => {
        const parent = el.parentNode;
        if (!parent) return;
        parent.replaceChild(document.createTextNode(el.textContent ?? ""), el);
        parent.normalize?.();
      });
      document.querySelectorAll(".gh-flash-container").forEach((el) =>
        el.classList.remove("gh-flash-container"),
      );
    };
  }, [raw, pathname]);

  return null;
}