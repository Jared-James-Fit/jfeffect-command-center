/**
 * Copying a roster or a competitor's training post into rows the coach
 * confirms (server only; route `competition_extract`, OpenAI key only, never
 * Lovable credits). The model copies; extract.ts drops anything not in the
 * source. A picture (a screenshot of a post or a start list) goes to the model
 * as an image; its rows come back low confidence for the coach to check.
 */
import {
  cleanRoster,
  cleanTraining,
  ROSTER_SYSTEM,
  TRAINING_SYSTEM,
  type RosterRow,
} from "./extract";
import type { Observation } from "./types";

type Db = any;

async function ask(
  sb: Db,
  system: string,
  prompt: string,
  image: { mime: string; base64: string } | null,
): Promise<string> {
  const { resolveRoute } = await import("@/lib/ai/routing");
  const { readRouteOverride } = await import("@/lib/ai/route-call.server");
  const { callModelNow } = await import("@/lib/ai/model-client.server");
  const route = resolveRoute("competition_extract", await readRouteOverride(sb), {
    openaiOnly: true,
  });
  let last = "no answer";
  for (const model of route.models) {
    try {
      const r = await callModelNow(model, {
        system,
        prompt,
        effort: route.effort,
        maxOutputTokens: route.maxOutputTokens,
        timeoutMs: 60_000,
        tag: "competition_extract",
        files: image
          ? [{ kind: "image", name: "source", mime: image.mime, base64: image.base64 }]
          : undefined,
      });
      if (r.text?.trim()) return r.text;
    } catch (e: any) {
      last = e?.message ?? String(e);
    }
  }
  throw new Error(`Couldn't read it (${last})`);
}

const json = (t: string) => {
  const m = t.match(/\{[\s\S]*\}/);
  try {
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
};

export async function extractRoster(
  sb: Db,
  input: { text: string | null; image: { mime: string; base64: string } | null },
): Promise<RosterRow[]> {
  const prompt = input.text
    ? `ROSTER:\n${input.text.slice(0, 40_000)}`
    : "The roster is in the picture.";
  return cleanRoster(json(await ask(sb, ROSTER_SYSTEM, prompt, input.image)), input.text);
}

export async function extractTraining(
  sb: Db,
  input: {
    text: string | null;
    image: { mime: string; base64: string } | null;
    today: string;
    url: string | null;
  },
): Promise<Observation[]> {
  const prompt = `${input.text ? `CAPTION / TEXT:\n${input.text.slice(0, 8000)}` : "The post is in the picture."}\nToday is ${input.today}.`;
  return cleanTraining(
    json(await ask(sb, TRAINING_SYSTEM, prompt, input.image)),
    input.text,
    input.today,
  ).map((o) => ({ ...o, url: input.url, source: input.url ? "link" : o.source }));
}
