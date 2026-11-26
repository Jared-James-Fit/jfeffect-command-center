/** Stored competition-file evidence. No storage URLs, new model calls or unchecked summaries. */
type Source = { id: string; competition_id: string; file_name: string | null; status: string };
type Evidence = Source & { evidence: string[] };

const compact = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();
const normalized = (s: string) => compact(s).toLocaleLowerCase("en-CA");
const words = (s: string) => normalized(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function containsCompetitionName(quote: string, first: string, last: string): boolean {
  const text = ` ${words(quote)} `;
  return text.includes(` ${words(first + " " + last)} `) || text.includes(` ${words(last + " " + first)} `);
}

export function competitionQuoteIsGrounded(evidence: string[], quote: string): boolean {
  const q = normalized(quote);
  return q.length >= 3 && evidence.some(s => normalized(s).includes(q));
}

export function matchingCompetitionExcerpts(evidence: string[], terms: unknown[]): string[] {
  const needles = [...new Set(terms.filter((t): t is string => typeof t === "string").map(normalized).filter(t => t.length >= 3))];
  const out = new Set<string>();
  for (const item of evidence) {
    for (const line of item.split(/\r?\n/)) {
      const clean = compact(line);
      const lower = normalized(clean);
      const idx = needles.map(n => lower.indexOf(n)).filter(i => i >= 0).sort((a,b) => a-b)[0];
      if (idx === undefined) continue;
      const start = Math.max(0, idx - 100);
      out.add(clean.slice(start, start + 400).trim());
      if (out.size >= 12) return [...out];
    }
  }
  return [...out];
}

export async function listCompetitionEvidenceSources(db: any, clientId: string, competitionId?: string): Promise<Source[]> {
  let q = db.from("athlete_intel_sources").select("id, competition_id, file_name, status")
    .eq("client_id", clientId).not("competition_id", "is", null)
    .in("status", ["ready", "queued", "reading", "waiting_consent", "waiting_ai", "stored", "failed"])
    .order("created_at", { ascending: false }).limit(20);
  if (competitionId) q = q.eq("competition_id", competitionId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Call only after the caller's client access and AI consent have been checked. */
export async function loadCompetitionEvidence(db: any, clientId: string, sourceId: string, competitionId?: string): Promise<Evidence> {
  let q = db.from("athlete_intel_sources").select("id, competition_id, file_name, status, source_text")
    .eq("client_id", clientId).eq("id", sourceId).not("competition_id", "is", null).eq("status", "ready");
  if (competitionId) q = q.eq("competition_id", competitionId);
  const { data: source, error } = await q.maybeSingle();
  if (error || !source) throw new Error("That competition file is not available or is not ready for this client.");
  const { data: facts, error: factError } = await db.from("athlete_intel_facts").select("quote")
    .eq("client_id", clientId).eq("competition_id", source.competition_id).eq("source_id", source.id)
    .eq("status", "active").eq("basis", "source").limit(250);
  if (factError) throw new Error(factError.message);
  const evidence = [source.source_text, ...(facts ?? []).map((f: any) => f.quote)].filter((v): v is string => typeof v === "string" && !!v.trim());
  return { id: source.id, competition_id: source.competition_id, file_name: source.file_name, status: source.status, evidence };
}

export async function verifyCompetitionNameEvidence(db: any, p: { client_id: string; source_id: string; source_quote: string; first_name?: string; last_name?: string }): Promise<Evidence> {
  const file = await loadCompetitionEvidence(db, p.client_id, p.source_id);
  if (!p.first_name || !p.last_name || !containsCompetitionName(p.source_quote, p.first_name, p.last_name)
      || !competitionQuoteIsGrounded(file.evidence, p.source_quote)) {
    throw new Error("The saved competition file does not support that exact name. Review the source or provide the correct name directly.");
  }
  return file;
}
