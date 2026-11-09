/**
 * Which AI models this deployment can really reach, checked live (never assumed):
 * the Lovable AI gateway (LOVABLE_API_KEY), OpenAI directly (OPENAI_API_KEY) and
 * Anthropic (ANTHROPIC_API_KEY, when set). Lists each provider's models, sends a
 * tiny prompt to each candidate (latency, error), checks that a reasoning-effort
 * setting is accepted, and that OpenAI's background mode works (a long run that
 * no request has to wait on). Server only; no key ever leaves it.
 */

type Probe = { provider: string; model: string; ok: boolean; ms: number; reply?: string; error?: string; note?: string };
export type ModelCheck = {
  at: string;
  keys: { lovable: boolean; openai: boolean; anthropic: boolean };
  lists: { gateway: string[] | string; openai: string[] | string; anthropic: string[] | string | null };
  probes: Probe[];
  background: Probe | null;
};

const GATEWAY = "https://ai.gateway.lovable.dev/v1";
const PROMPT = 'Reply with exactly this JSON and nothing else: {"ok":true}';

/** Candidates worth probing on the gateway (only ones it lists, plus the ones the app already uses). */
const GATEWAY_CANDIDATES = [
  "openai/gpt-5.5",
  "openai/gpt-5.5-pro",
  "openai/gpt-5.2",
  "openai/gpt-5.1",
  "openai/gpt-5",
  "openai/gpt-5-mini",
  "google/gemini-3.1-pro-preview",
  "google/gemini-3-pro-preview",
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-pro",
];

async function timed<T>(f: () => Promise<T>): Promise<{ v?: T; e?: string; ms: number }> {
  const t0 = Date.now();
  try {
    return { v: await f(), ms: Date.now() - t0 };
  } catch (err: any) {
    return { e: String(err?.message ?? err).slice(0, 300), ms: Date.now() - t0 };
  }
}

async function getJson(url: string, headers: Record<string, string>, body?: unknown, timeoutMs = 60_000): Promise<any> {
  const res = await fetch(url, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : {};
}

const wanted = (id: string) => /gpt-5|gpt-6|gpt-4\.1|^o\d|o\d-|claude|gemini/i.test(id);

export async function checkModels(opts: { probe?: boolean; extra?: string[] } = {}): Promise<ModelCheck> {
  const lovable = process.env.LOVABLE_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  const anthropic = process.env.ANTHROPIC_API_KEY;
  const gw = { "Lovable-API-Key": lovable ?? "", "X-Lovable-AIG-SDK": "vercel-ai-sdk" };
  const oa = { Authorization: `Bearer ${openai ?? ""}` };

  const [gList, oList, aList] = await Promise.all([
    lovable ? timed(() => getJson(`${GATEWAY}/models`, gw, undefined, 20_000)) : Promise.resolve({ e: "no key", ms: 0 }),
    openai ? timed(() => getJson("https://api.openai.com/v1/models", oa, undefined, 20_000)) : Promise.resolve({ e: "no key", ms: 0 }),
    anthropic ? timed(() => getJson("https://api.anthropic.com/v1/models", { "x-api-key": anthropic, "anthropic-version": "2023-06-01" }, undefined, 20_000)) : Promise.resolve(null),
  ]);
  const ids = (r: any) => (Array.isArray(r?.v?.data) ? (r.v.data as any[]).map((m) => String(m.id)).filter(wanted).sort() : r?.e ?? "unreadable");
  const lists = { gateway: ids(gList), openai: ids(oList), anthropic: aList ? ids(aList) : null };

  const probes: Probe[] = [];
  let background: Probe | null = null;
  if (opts.probe) {
    const gwListed = Array.isArray(lists.gateway) ? lists.gateway : [];
    const gwModels = [...new Set([...GATEWAY_CANDIDATES.filter((m) => !gwListed.length || gwListed.includes(m) || m === "openai/gpt-5.5"), ...gwListed.filter((m) => /claude|gpt-6/i.test(m)), ...(opts.extra ?? []).filter((m) => m.includes("/"))])];
    const oaListed = Array.isArray(lists.openai) ? lists.openai : [];
    const oaModels = [...new Set([...oaListed.filter((m) => /^(gpt-5\.5|gpt-5\.5-pro|gpt-6[\w.-]*|gpt-5\.2|gpt-5\.1|gpt-5|gpt-5-mini|o3|o3-pro)$/.test(m)), ...(opts.extra ?? []).filter((m) => !m.includes("/"))])];
    const tasks: Array<Promise<Probe>> = [];
    if (lovable)
      for (const model of gwModels)
        tasks.push(
          // Claude answers only on the native Messages route (as model-client.server.ts calls it)
          (/^anthropic\//.test(model)
            ? timed(() => getJson(`${GATEWAY}/messages`, { ...gw, "anthropic-version": "2023-06-01" }, { model, max_tokens: 2000, thinking: { type: "adaptive" }, output_config: { effort: "low" }, messages: [{ role: "user", content: PROMPT }] }, 90_000))
            : timed(() => getJson(`${GATEWAY}/chat/completions`, gw, { model, messages: [{ role: "user", content: PROMPT }] }, 90_000))
          ).then((r) => ({
            provider: "gateway",
            model,
            ok: !r.e,
            ms: r.ms,
            reply: (r.v?.choices?.[0]?.message?.content ?? (Array.isArray(r.v?.content) ? r.v.content.find((c: any) => c?.type === "text")?.text : undefined))?.slice(0, 40),
            error: r.e,
          })),
        );
    if (lovable)
      tasks.push(
        timed(() => getJson(`${GATEWAY}/chat/completions`, gw, { model: "openai/gpt-5.5", reasoning_effort: "high", messages: [{ role: "user", content: PROMPT }] }, 90_000)).then((r) => ({
          provider: "gateway",
          model: "openai/gpt-5.5",
          note: "reasoning_effort=high accepted?",
          ok: !r.e,
          ms: r.ms,
          reply: r.v?.choices?.[0]?.message?.content?.slice(0, 40),
          error: r.e,
        })),
      );
    if (openai)
      for (const model of oaModels)
        tasks.push(
          timed(() => getJson("https://api.openai.com/v1/responses", oa, { model, input: PROMPT, reasoning: /^(gpt-5|gpt-6|o\d)/.test(model) ? { effort: "low" } : undefined }, 90_000)).then((r) => ({
            provider: "openai",
            model,
            ok: !r.e && r.v?.status === "completed",
            ms: r.ms,
            reply: String(r.v?.output_text ?? (r.v?.output ?? []).flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? "").join("")).slice(0, 40),
            error: r.e ?? (r.v?.status !== "completed" ? `status ${r.v?.status}` : undefined),
          })),
        );
    if (anthropic && Array.isArray(lists.anthropic))
      for (const model of lists.anthropic.filter((m) => /opus|sonnet/i.test(m)).slice(0, 4))
        tasks.push(
          timed(() => getJson("https://api.anthropic.com/v1/messages", { "x-api-key": anthropic, "anthropic-version": "2023-06-01" }, { model, max_tokens: 20, messages: [{ role: "user", content: PROMPT }] }, 90_000)).then((r) => ({
            provider: "anthropic",
            model,
            ok: !r.e,
            ms: r.ms,
            reply: r.v?.content?.[0]?.text?.slice(0, 40),
            error: r.e,
          })),
        );
    probes.push(...(await Promise.all(tasks)));

    // Background mode: submit, then poll; nothing waits on the model itself.
    const bgModel = oaModels.find((m) => m === "gpt-5.5") ?? oaModels.find((m) => /^gpt-5/.test(m));
    if (openai && bgModel) {
      const t0 = Date.now();
      try {
        const sub = await getJson("https://api.openai.com/v1/responses", oa, { model: bgModel, input: PROMPT, background: true, reasoning: { effort: "low" } }, 30_000);
        let r = sub;
        while (r?.status && !["completed", "failed", "cancelled", "incomplete"].includes(r.status) && Date.now() - t0 < 80_000) {
          await new Promise((res) => setTimeout(res, 2000));
          r = await getJson(`https://api.openai.com/v1/responses/${sub.id}`, oa, undefined, 20_000);
        }
        background = { provider: "openai", model: bgModel, note: "background mode", ok: r?.status === "completed", ms: Date.now() - t0, reply: String(r?.output_text ?? "").slice(0, 40), error: r?.status === "completed" ? undefined : `status ${r?.status}` };
      } catch (e: any) {
        background = { provider: "openai", model: bgModel, note: "background mode", ok: false, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 300) };
      }
    }
  }
  return { at: new Date().toISOString(), keys: { lovable: !!lovable, openai: !!openai, anthropic: !!anthropic }, lists, probes, background };
}
