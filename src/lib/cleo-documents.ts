/**
 * The business's own documents, as Cleo reads them: the Coaching Agreement
 * (its canonical text lives in code, coaching-agreement/content.ts), the
 * legal documents published from Admin → Legal (Terms, Privacy, Cancellation &
 * Refund, Membership Agreement, Recurring Billing), and the coach FAQs.
 *
 * Each document is split into sections so a question ("what does my policy
 * say about ending coaching?") gets the sections that answer it, quoted as
 * written, instead of the whole thing or a guess.
 */

export type DocSection = { title: string; text: string };
export type CleoDoc = {
  key: string;
  title: string;
  /** "v2.3, effective 2026-10-28", "published v3 (Oct 29, 2026)". */
  version: string;
  /** Who it's for or where it lives. */
  about: string;
  sections: DocSection[];
};

const plain = (s: string) => s.replace(/\*\*/g, "").replace(/\{\{coach\}\}/g, "[the client's coach]").trim();

type AgreementLike = {
  version: string;
  title: string;
  subtitle: string;
  effectiveDate: string;
  intro: { label?: string; text: string }[];
  keyTerms: { title: string; text: string }[];
  sections: { number: number; title: string; inShort: string; clauses: { label?: string; text: string }[] }[];
  acknowledgements: { short: string; text: string }[];
  optionalConsents: { label: string; text: string }[];
};

const clause = (c: { label?: string; text: string }) => plain(c.label ? `${c.label} ${c.text}` : c.text);

/** The Coaching Agreement every coaching client signs in the app, section by section. */
export function coachingAgreementDoc(a: AgreementLike): CleoDoc {
  return {
    key: "coaching-agreement",
    title: a.title,
    version: `v${a.version}, effective ${a.effectiveDate}`,
    about: `${a.subtitle}. Signed in the app by every coaching client (not JF members).`,
    sections: [
      { title: "Introduction", text: a.intro.map(clause).join("\n") },
      { title: "Key terms (the summary shown before signing)", text: a.keyTerms.map((k) => `${k.title}: ${plain(k.text)}`).join("\n") },
      ...a.sections.map((s) => ({
        title: `${s.number}. ${s.title}`,
        text: [`In short: ${plain(s.inShort)}`, ...s.clauses.map(clause)].join("\n"),
      })),
      { title: "What the client ticks when signing", text: a.acknowledgements.map((x) => `${x.short}: ${plain(x.text)}`).join("\n") },
      { title: "Optional consents", text: a.optionalConsents.map((x) => `${x.label}: ${plain(x.text)}`).join("\n") },
    ].filter((s) => s.text),
  };
}

const HEADING = /^(\d{1,2}(?:\.\d{1,2})?)[.)]?\s+\S.{0,90}$/;

/** A legal document's text, split at its numbered headings ("3. Refund Position"). */
export function textSections(body: string): DocSection[] {
  const out: DocSection[] = [];
  let cur: DocSection = { title: "Opening", text: "" };
  for (const raw of String(body ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (HEADING.test(line) && !/[.:;,]$/.test(line)) {
      if (cur.text.trim()) out.push({ title: cur.title, text: cur.text.trim() });
      cur = { title: line, text: "" };
    } else {
      cur.text += `${line}\n`;
    }
  }
  if (cur.text.trim()) out.push({ title: cur.title, text: cur.text.trim() });
  return out;
}

const STOP = new Set([
  "the", "and", "for", "what", "does", "did", "say", "says", "about", "with", "that", "this", "when", "how", "can",
  "are", "is", "my", "our", "your", "their", "they", "them", "put", "out", "any", "there", "from", "have", "has",
  "will", "would", "should", "policy", "agreement", "coaching", "client", "clients",
]);

/** The words worth matching, with light stemming ("ending" → "end", "refunds" → "refund"). */
export function searchTerms(query: string): string[] {
  const words = String(query ?? "").toLowerCase().match(/[a-z0-9$%]+/g) ?? [];
  const stem = (w: string) => w.replace(/(ings|ing|ed|es|s)$/, "") || w;
  return [...new Set(words.filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => (w.length > 4 ? stem(w) : w)))];
}

/** Sections that match the question, best first. */
export function matchingSections(doc: CleoDoc, query: string): Array<DocSection & { score: number }> {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  return doc.sections
    .map((s) => {
      const title = s.title.toLowerCase();
      const body = s.text.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (title.includes(t)) score += 4;
        score += Math.min(6, body.split(t).length - 1);
      }
      return { ...s, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}

const head = (d: CleoDoc) => `${d.title} (${d.version}) | ${d.about}`;

/** What Cleo gets back: the list, a whole document, or the sections that answer a question. */
export function readDocuments(docs: CleoDoc[], opts: { document?: string | null; search?: string | null; max: number }): string {
  const wanted = opts.document?.trim().toLowerCase();
  const pick = wanted
    ? docs.filter((d) => d.key === wanted || d.title.toLowerCase().includes(wanted) || wanted.includes(d.key.replace(/-/g, " ")))
    : docs;
  if (wanted && !pick.length) {
    return `No document called "${opts.document}". The documents are:\n${docs.map((d) => `- ${d.key}: ${head(d)}`).join("\n")}`;
  }
  const search = opts.search?.trim();
  if (search) {
    const hits = pick.flatMap((d) => matchingSections(d, search).map((s) => ({ d, s })));
    hits.sort((a, b) => b.s.score - a.s.score);
    if (!hits.length) {
      return `Nothing in ${pick.length === 1 ? pick[0]!.title : "the documents"} matches "${search}". Sections:\n${pick
        .map((d) => `${d.title}: ${d.sections.map((s) => s.title).join(" · ")}`)
        .join("\n")}`;
    }
    const out: string[] = [`Sections matching "${search}", best first (quoted as written):`];
    let size = out[0]!.length;
    for (const { d, s } of hits) {
      const block = `\n[${d.title} (${d.version}) → ${s.title}]\n${s.text}`;
      if (size + block.length > opts.max && out.length > 1) break;
      out.push(block);
      size += block.length;
    }
    return out.join("\n");
  }
  if (wanted && pick.length === 1) {
    const d = pick[0]!;
    const full = [head(d), ...d.sections.map((s) => `\n${s.title}\n${s.text}`)].join("\n");
    if (full.length <= opts.max) return full;
    return [
      `${head(d)}`,
      `It's long; here's every section. Ask again with \`search\` for the exact wording of the part you need.`,
      ...d.sections.map((s) => `- ${s.title}: ${s.text.split("\n")[0]!.slice(0, 220)}`),
    ].join("\n");
  }
  return [
    "The business's documents (read one with `document`, or find the wording with `search`):",
    ...pick.map((d) => `- ${d.key}: ${head(d)}\n  Sections: ${d.sections.map((s) => s.title).join(" · ")}`),
  ].join("\n");
}
