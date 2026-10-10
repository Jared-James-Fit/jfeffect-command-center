/**
 * Server side of Cleo as the admin assistant: what she can see across the
 * app, hearing the owner (speech to text), her voice (text to speech) and the
 * shared answer path used by both the chat and voice calls.
 *
 * Every read goes through the caller's RLS-scoped client, so only an admin
 * ever gets rows back.
 */
import { BUSINESS_TZ, businessToday } from "@/lib/billing-schedule";
import { buildAppContext, clientLabel, EMPTY_APP_SNAPSHOT, type AppSnapshot, type LinkEntry } from "@/lib/summer-app";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";
/** Used when the main model refuses a tool step (see answerSummer). */
const CLEO_FALLBACK_MODEL = "google/gemini-2.5-flash";

function settle<T>(res: { data: T | null; error: any }, fallback: T): T {
  return res.error || res.data == null ? fallback : res.data;
}

export async function loadAppSnapshot(supabase: any): Promise<AppSnapshot> {
  const now = Date.now();
  const from = new Date(now - 86_400_000).toISOString();
  const to = new Date(now + 14 * 86_400_000).toISOString();
  const [clients, appts, reviews, apps, tasks, unread, alerts] = await Promise.all([
    supabase
      .from("clients")
      .select("id, full_name, preferred_name, first_name, last_name, email, phone, instagram, status, coaching_package, coaching_type, start_date, renewal_date, payment_status, last_active_at, needs_admin_help, compliance_status, archived, archived_at, deactivated_at")
      .order("full_name", { ascending: true })
      .limit(500),
    supabase
      .from("appointments")
      .select("starts_at, ends_at, title, appointment_type, external_name, client_id, location, meet_link, status, cancelled_at")
      .gte("starts_at", from)
      .lte("starts_at", to)
      .is("cancelled_at", null)
      .order("starts_at", { ascending: true })
      .limit(100),
    supabase
      .from("submission_reviews")
      .select("client_id, source_type, submitted_at, review_status, priority")
      .in("review_status", ["submitted", "processing", "draft_ready"])
      .order("submitted_at", { ascending: true })
      .limit(50),
    supabase
      .from("coaching_applications")
      .select("full_name, email, phone, application_status, lead_temperature, submitted_at, created_at, recommended_offer, call_status, follow_up_at, is_test")
      .or("is_test.is.null,is_test.eq.false")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("tasks")
      .select("id, title, due_at, priority_label, status_label, completed_at, archived_at")
      .is("completed_at", null)
      .is("archived_at", null)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(40),
    supabase
      .from("messages")
      .select("client_id, created_at")
      .eq("sender_role", "client")
      .is("read_by_admin_at", null)
      .is("deleted_at", null)
      .eq("is_internal_note", false)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("support_alerts")
      .select("error_type, error_message, created_at, status")
      .in("status", ["open", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const unreadMap = new Map<string, { count: number; lastAt: string }>();
  for (const m of settle<any[]>(unread, [])) {
    if (!m.client_id) continue;
    const cur = unreadMap.get(m.client_id);
    if (cur) cur.count += 1;
    else unreadMap.set(m.client_id, { count: 1, lastAt: m.created_at });
  }
  const alertRows = settle<any[]>(alerts, []);

  return {
    clients: settle<any[]>(clients, []).map((c) => ({
      id: c.id,
      name: clientLabel(c),
      email: c.email ?? null,
      phone: c.phone ?? null,
      status: c.status ?? null,
      plan: c.coaching_package || c.coaching_type || null,
      startDate: c.start_date ?? null,
      renewalDate: c.renewal_date ?? null,
      paymentStatus: c.payment_status ?? null,
      lastActiveAt: c.last_active_at ?? null,
      needsHelp: !!c.needs_admin_help,
      compliance: c.compliance_status ?? null,
      archived: !!(c.archived || c.archived_at || c.deactivated_at),
      instagram: c.instagram ?? null,
    })),
    appointments: settle<any[]>(appts, []).map((a) => ({
      startsAt: a.starts_at,
      endsAt: a.ends_at ?? null,
      title: a.title ?? null,
      type: a.appointment_type ?? null,
      who: a.external_name ?? null,
      clientId: a.client_id ?? null,
      location: a.location ?? null,
      meetLink: a.meet_link ?? null,
      status: a.status ?? null,
    })),
    reviews: settle<any[]>(reviews, []).map((r) => ({
      clientId: r.client_id ?? null,
      source: r.source_type ?? null,
      submittedAt: r.submitted_at ?? null,
      status: r.review_status ?? null,
      priority: r.priority ?? null,
    })),
    applications: settle<any[]>(apps, []).map((a) => ({
      name: a.full_name ?? null,
      email: a.email ?? null,
      phone: a.phone ?? null,
      status: a.application_status ?? null,
      temperature: a.lead_temperature ?? null,
      submittedAt: a.submitted_at ?? a.created_at ?? null,
      offer: a.recommended_offer ?? null,
      callStatus: a.call_status ?? null,
      followUpAt: a.follow_up_at ?? null,
    })),
    tasks: settle<any[]>(tasks, []).map((t) => ({
      id: t.id,
      title: t.title,
      dueAt: t.due_at ?? null,
      priority: t.priority_label ?? null,
      status: t.status_label ?? null,
    })),
    unread: [...unreadMap.entries()].map(([clientId, v]) => ({ clientId, ...v })),
    alerts: {
      open: alertRows.length,
      latest: alertRows.slice(0, 5).map((a) => ({ type: a.error_type ?? null, message: a.error_message ?? null, at: a.created_at })),
    },
  };
}

/** Pages from the admin route registry, for Cleo's link list. */
export async function summerLinkCatalog(): Promise<LinkEntry[]> {
  try {
    const { ADMIN_ROUTE_REGISTRY } = await import("@/lib/admin-route-registry");
    return ADMIN_ROUTE_REGISTRY
      .filter((e) => e.roles.includes("admin") && !e.isAction && e.to.startsWith("/admin"))
      .map((e) => ({ label: e.label, to: e.to, keywords: e.keywords }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Hearing: speech to text through the gateway (same model the voice-note
// transcripts use).

export function audioFormat(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "mp4";
  if (m.includes("wav")) return "wav";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("ogg")) return "ogg";
  return "webm";
}

/**
 * `names`: the people they might mention (clients), so they're spelled the
 * way the app spells them.
 */
export async function transcribeAudio(b64: string, mime: string, names: string[] = []): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("AI is not configured (LOVABLE_API_KEY missing).");
  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content:
            [
              "You transcribe what a strength and physique coach says to their assistant, Cleo: questions and instructions about clients, training, programs, the calendar and the business. It can be long, with pauses and restarts.",
              "Return every word spoken, in order, with normal punctuation and sentence breaks. Drop filler (um, uh) and false starts, but never shorten, summarize or skip content.",
              "Spell coaching terms the way coaches write them: RPE, RIR, e1RM, 1RM, AMRAP, PR, deload, high bar, low bar, RDL, SSB, top set, back-off sets, kg, lb. Business words: GST, HST, CRA, check-in, Stripe. Write numbers and dollar amounts as digits.",
              ...(names.length ? [`People they may mention (spell exactly like this): ${names.slice(0, 300).join(", ")}.`] : []),
              "If nothing intelligible was said, return an empty string.",
            ].join(" "),
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe this." },
            { type: "input_audio", input_audio: { data: b64, format: audioFormat(mime) } },
          ],
        },
      ],
    }),
  });
  if (res.status === 429) throw new Error("Cleo is getting too many requests. Try again in a minute.");
  if (res.status === 402) throw new Error("AI credits are used up. Add credits in Lovable to keep using Cleo.");
  if (!res.ok) throw new Error(`Couldn't hear that (${res.status}).`);
  const json: any = await res.json();
  const text = json?.choices?.[0]?.message?.content;
  return typeof text === "string" ? text.trim().replace(/^["']|["']$/g, "") : "";
}

// ---------------------------------------------------------------------------
// Voice: text to speech. Tries the server voices in order (ElevenLabs when
// a key is set, then OpenAI, then Gemini); the browser falls back to a device
// voice when none answers.

export const SUMMER_VOICE_STYLE =
  "Voice: a calm, clear, warm woman's voice with a neutral North American accent, like a polished voice assistant. Delivery: smooth and even, relaxed conversational pace, never rushed. Let sentences flow into each other with natural, short pauses; no dramatic pitch swings, no sing-song, no breathiness. Read numbers and dollar amounts clearly and naturally.";

/** OpenAI voices, best first. marin is the most natural; nova is the long-standing fallback. */
const OPENAI_VOICES = ["marin", "nova"];
/** Gemini's "smooth" prebuilt voice. */
const GEMINI_VOICE = "Despina";
/** ElevenLabs "Sarah": soft, calm, American. Override with ELEVENLABS_VOICE_ID. */
const ELEVENLABS_DEFAULT_VOICE = "EXAVITQu4vr4xnSDxMaL";
/** Their most natural model. eleven_flash_v2_5 trades a little quality for speed. */
const ELEVENLABS_DEFAULT_MODEL = "eleven_multilingual_v2";

/**
 * One piece of a reply. rate is the owner's speed setting; prev/next are the
 * text around this piece when a reply is spoken in parts, so the voice keeps
 * one intonation across the seam (ElevenLabs uses them; the others ignore them).
 */
export type SpeechRequest = { text: string; rate?: number; prev?: string; next?: string };

type SpeechOk = { ok: true; audio: string; mime: string; provider: string };
type SpeechFail = { ok: false; reason: string };
export type SpeechAttempt = { provider: string; ok: boolean; status?: number; detail?: string; bytes?: number };

type Provider = { name: string; run: (req: SpeechRequest) => Promise<{ audio: string; mime: string } | { error: string; status?: number }> };

async function toBase64(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * The speed setting as words. The voice itself paces the speech, which sounds
 * far cleaner than the browser time-stretching the audio afterwards.
 */
function styleFor(rate = 1): string {
  if (rate <= 0.95) return `${SUMMER_VOICE_STYLE} Pace: a little slower than usual, unhurried.`;
  if (rate >= 1.05) return `${SUMMER_VOICE_STYLE} Pace: a little brisker than usual, still clear.`;
  return SUMMER_VOICE_STYLE;
}

async function audioResponse(res: Response): Promise<{ audio: string; mime: string } | { error: string; status?: number }> {
  const type = res.headers.get("content-type") ?? "";
  if (res.ok && type.startsWith("audio")) {
    return { audio: await toBase64(await res.arrayBuffer()), mime: type.split(";")[0] || "audio/mpeg" };
  }
  const detail = (await res.text().catch(() => "")).slice(0, 160);
  return { error: detail || `HTTP ${res.status}`, status: res.status };
}

async function speechEndpoint(url: string, headers: Record<string, string>, model: string, req: SpeechRequest) {
  let last: { error: string; status?: number } = { error: "no voice" };
  for (const voice of OPENAI_VOICES) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ model, voice, input: req.text, instructions: styleFor(req.rate), response_format: "mp3" }),
    });
    const r = await audioResponse(res);
    if ("audio" in r) return r;
    last = r;
    // Only a rejected request is worth retrying with the next voice (an older
    // gateway may not know the newest one); auth, quota and outages aren't.
    if (res.status !== 400 && res.status !== 422) break;
  }
  return last;
}

function providers(): Provider[] {
  const list: Provider[] = [];
  const eleven = process.env.ELEVENLABS_API_KEY;
  if (eleven) {
    const voice = process.env.ELEVENLABS_VOICE_ID || ELEVENLABS_DEFAULT_VOICE;
    const model = process.env.ELEVENLABS_MODEL || ELEVENLABS_DEFAULT_MODEL;
    list.push({
      name: `elevenlabs:${model}`,
      run: async (req) => {
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "audio/mpeg", "xi-api-key": eleven },
          body: JSON.stringify({
            text: req.text,
            model_id: model,
            ...(req.prev ? { previous_text: req.prev } : {}),
            ...(req.next ? { next_text: req.next } : {}),
            // Steady and clean: enough stability that she never wobbles, no
            // exaggerated style. Their natural speed range is 0.7 to 1.2.
            voice_settings: {
              stability: 0.55,
              similarity_boost: 0.75,
              style: 0,
              use_speaker_boost: true,
              speed: Math.min(1.2, Math.max(0.7, req.rate ?? 1)),
            },
          }),
        });
        return audioResponse(res);
      },
    });
  }
  const lovable = process.env.LOVABLE_API_KEY;
  if (lovable) {
    list.push({
      name: "lovable:openai/gpt-4o-mini-tts",
      run: (req) => speechEndpoint(`${GATEWAY}/audio/speech`, { "Lovable-API-Key": lovable }, "openai/gpt-4o-mini-tts", req),
    });
    list.push({
      name: "lovable:google/gemini-2.5-flash-preview-tts",
      run: async (req) => {
        const res = await fetch(`${GATEWAY}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Lovable-API-Key": lovable },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-preview-tts",
            modalities: ["audio"],
            audio: { voice: GEMINI_VOICE, format: "wav" },
            messages: [{ role: "user", content: `${styleFor(req.rate)}\n\nSay exactly this:\n${req.text}` }],
          }),
        });
        if (!res.ok) return { error: (await res.text().catch(() => "")).slice(0, 160) || `HTTP ${res.status}`, status: res.status };
        const json: any = await res.json().catch(() => null);
        const data = json?.choices?.[0]?.message?.audio?.data;
        if (typeof data !== "string" || !data) return { error: "no audio in response", status: res.status };
        return { audio: data, mime: "audio/wav" };
      },
    });
  }
  const openai = process.env.OPENAI_API_KEY;
  if (openai) {
    list.push({
      name: "openai:gpt-4o-mini-tts",
      run: (req) => speechEndpoint("https://api.openai.com/v1/audio/speech", { Authorization: `Bearer ${openai}` }, "gpt-4o-mini-tts", req),
    });
  }
  return list;
}

// Per server instance: remember what works so a reply doesn't wait on
// providers that already said no.
let workingProvider: string | null = null;
let noVoiceUntil = 0;

export async function synthesizeSpeech(req: SpeechRequest): Promise<SpeechOk | SpeechFail> {
  const input: SpeechRequest = {
    text: req.text.trim().slice(0, 1200),
    rate: req.rate,
    prev: req.prev?.trim().slice(-600) || undefined,
    next: req.next?.trim().slice(0, 600) || undefined,
  };
  if (!input.text) return { ok: false, reason: "nothing to say" };
  if (Date.now() < noVoiceUntil) return { ok: false, reason: "no voice provider available" };
  const all = providers();
  const ordered = workingProvider ? [...all.filter((p) => p.name === workingProvider), ...all.filter((p) => p.name !== workingProvider)] : all;
  for (const p of ordered) {
    try {
      const r = await p.run(input);
      if ("audio" in r) {
        workingProvider = p.name;
        return { ok: true, audio: r.audio, mime: r.mime, provider: p.name };
      }
    } catch {
      // try the next one
    }
    if (p.name === workingProvider) workingProvider = null;
  }
  noVoiceUntil = Date.now() + 10 * 60_000;
  return { ok: false, reason: "no voice provider available" };
}

/** For the health check: try every provider and report what each said. */
export async function probeSpeechProviders(sample = "Hi, it's Cleo. Your books are up to date, and you've got two check-ins waiting."): Promise<SpeechAttempt[]> {
  const out: SpeechAttempt[] = [];
  for (const p of providers()) {
    try {
      const r = await p.run({ text: sample });
      if ("audio" in r) out.push({ provider: p.name, ok: true, bytes: Math.round((r.audio.length * 3) / 4), detail: r.mime });
      else out.push({ provider: p.name, ok: false, status: r.status, detail: r.error });
    } catch (e: any) {
      out.push({ provider: p.name, ok: false, detail: e?.message ?? "error" });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// One answer path for chat and voice.

export type SummerMsg = { id: string; role: "user" | "assistant"; content: string; created_at: string };

/**
 * `supabase` is what she reads with (the finance login's read-only admin
 * view); `own` is the caller's own client, which proposals and their checks
 * use. Lookups and proposals are tools she calls mid-answer.
 */
export async function answerSummer(
  supabase: any,
  userId: string,
  input: { message: string; year?: number | null; voice?: boolean; route?: string | null; finance?: boolean; own?: any },
): Promise<{ user: SummerMsg; assistant: SummerMsg }> {
  const books = await import("@/lib/business-books.server");
  const { buildSummerContext, summerSystemPrompt } = await import("@/lib/summer-context");
  const { buildOpenSalesContext } = await import("@/lib/summer-app");

  const [owner, app, links, history, profile, me, ownerName] = await Promise.all([
    books.isBusinessOwner(supabase, userId),
    loadAppSnapshot(supabase).catch(() => EMPTY_APP_SNAPSHOT),
    summerLinkCatalog(),
    supabase
      .from("summer_messages")
      .select("role, content")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(16),
    supabase.from("summer_profiles").select("tone, instructions").eq("user_id", userId).maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    ownerFirstName(),
  ]);
  // His saved voice (Admin → My Voice), for anything she writes as him.
  const { loadCoachVoice } = await import("@/lib/coach-voice.functions");
  const { buildVoicePrompt } = await import("@/lib/coach-voice");
  const coachVoice = await loadCoachVoice(supabase);

  // The books (taxes, expenses, income) are the owner's, and the finance
  // login keeps them. Other admins get the rest of the app plus who still owes
  // money, which is operational.
  const finance = !!input.finance && !owner;
  let booksSection: string;
  if (owner || finance) {
    const data = await books.loadBooksData(supabase);
    const currentYear = Number(businessToday().slice(0, 4));
    const year = input.year && data.years.includes(input.year) ? input.year : currentYear;
    booksSection = ["BOOKS", buildSummerContext(data, year)].join("\n");
  } else {
    booksSection = ["OPEN SALES", buildOpenSalesContext(await books.loadOpenSales(supabase))].join("\n");
  }

  const system = [
    summerSystemPrompt({
      tone: profile.data?.tone,
      instructions: profile.data?.instructions,
      voice: input.voice,
      owner,
      finance,
      userName: firstName(me.data?.full_name),
      ownerName,
    }),
    "",
    booksSection,
    "",
    `WRITING AS ${ownerName ?? "THE COACH"}: when asked to write, draft or reword anything that goes out as him (community posts, captions, shout-outs, messages to clients, replies), write it in HIS voice below, not yours. Your own tone is only for talking to the person using the app. For a post to the whole community, keep it group-friendly (no nicknames, no edgy words).`,
    buildVoicePrompt(coachVoice, null, { group: true }),
    "",
    `NOW: ${new Date().toLocaleString("en-CA", { timeZone: BUSINESS_TZ, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} (${BUSINESS_TZ}). Today is ${businessToday()}.`,
    "",
    "APP",
    buildAppContext(app, links, { tz: BUSINESS_TZ, route: input.route ?? null }),
  ].join("\n");

  const past = ((history.data ?? []) as Array<{ role: string; content: string }>).reverse();
  const own = input.own ?? supabase;
  const { cleoReadTools } = await import("@/lib/cleo-tools.server");
  const { loadCaller, proposeAction } = await import("@/lib/cleo-actions.server");
  const { CLEO_ACTION_INFO, CLEO_ACTION_KINDS, CLEO_ACTION_PARAMS } = await import("@/lib/cleo-actions");
  const { generateText, stepCountIs, tool } = await import("ai");

  const caller = await loadCaller(own, userId);
  const boss = ownerName ?? "the owner";
  const proposed: string[] = [];
  const actionTools = Object.fromEntries(
    CLEO_ACTION_KINDS.map((kind) => [
      `propose_${kind}`,
      tool({
        description: `${CLEO_ACTION_INFO[kind].tool} Puts a card on screen; nothing happens until the person taps it.`,
        inputSchema: CLEO_ACTION_PARAMS[kind] as any,
        execute: async (params: unknown) => {
          if (proposed.length >= 3) return "Too many cards in one answer. Ask which one they want first.";
          try {
            const r = await proposeAction({ supabase: own, db: supabase, userId }, caller, kind, params);
            proposed.push(r.id);
            return r.route === "run"
              ? `Card is on screen: ${r.summary}\nTell them to tap Confirm. It hasn't happened yet.`
              : `Card is on screen: ${r.summary}\nThis isn't in their role, so it needs ${boss}'s OK. Tell them "I'll have to ask ${boss} for permission" and that tapping "Ask ${boss}" sends the request.`;
          } catch (e: any) {
            return `Couldn't set that up: ${String(e?.message ?? e).slice(0, 300)}`;
          }
        },
      }),
    ]),
  );
  const tz = BUSINESS_TZ;
  const { cleoProgramTools } = await import("@/lib/cleo-program.server");
  const tools = { ...cleoReadTools({ db: supabase, tz, today: businessToday() }), ...cleoProgramTools({ db: supabase, today: businessToday() }), ...actionTools };

  // Gemini 3 needs its "thought signature" echoed back on every tool step.
  // The SDK keeps it under the provider's name but only sends back what's
  // under "google", so Cleo's provider is named "google". If the gateway
  // still refuses, the answer is retried once on a model that doesn't need it.
  const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("AI is not configured (LOVABLE_API_KEY missing).");
  const gateway = createOpenAICompatible({ name: "google", baseURL: GATEWAY, headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" } });
  const run = (model: string) =>
    generateText({
      model: gateway(model),
      system,
      messages: [
        ...past.map((m) => ({ role: m.role === "assistant" ? ("assistant" as const) : ("user" as const), content: m.content })),
        { role: "user" as const, content: input.message },
      ],
      tools,
      stopWhen: stepCountIs(14),
    });

  let text = "";
  try {
    try {
      text = (await run(books.BOOKS_AI_MODEL)).text.trim();
    } catch (e: any) {
      const status = e?.statusCode ?? e?.status ?? e?.lastError?.statusCode;
      if (status !== 400) throw e;
      console.warn("[cleo] retrying on the fallback model", String(e?.message ?? e).slice(0, 200));
      const { discardProposals } = await import("@/lib/cleo-actions.server");
      await discardProposals(userId, proposed.splice(0));
      text = (await run(CLEO_FALLBACK_MODEL)).text.trim();
    }
  } catch (e: any) {
    const status = e?.statusCode ?? e?.status ?? e?.lastError?.statusCode;
    if (status === 429) throw new Error("Cleo is getting too many requests. Try again in a minute.");
    if (status === 402) throw new Error("AI credits are used up. Add credits in Lovable to keep using Cleo.");
    throw new Error(`AI request failed${status ? ` (${status})` : ""}: ${String(e?.message ?? e).slice(0, 200)}`);
  }
  if (!text) text = proposed.length ? "It's ready for you below. Tap to confirm." : "I couldn't come up with an answer to that. Try asking it another way.";

  // Saved only once there is an answer, so a failed call leaves no orphan question.
  const now = Date.now();
  const { data: saved, error } = await supabase
    .from("summer_messages")
    .insert([
      { user_id: userId, role: "user", content: input.message, created_at: new Date(now).toISOString() },
      { user_id: userId, role: "assistant", content: text, created_at: new Date(now + 1).toISOString() },
    ])
    .select("id, role, content, created_at");
  if (error) throw new Error(error.message);
  const rows = (saved ?? []) as SummerMsg[];
  const assistant = rows.find((r) => r.role === "assistant")!;
  if (proposed.length) {
    const { attachToMessage } = await import("@/lib/cleo-actions.server");
    await attachToMessage(userId, proposed, assistant.id);
  }
  return { user: rows.find((r) => r.role === "user")!, assistant };
}

function firstName(full: string | null | undefined): string | null {
  const f = (full ?? "").trim().split(/\s+/)[0];
  return f || null;
}

/** The owner's first name, for "that's private to Jared". Service role: other admins can't read owners. */
async function ownerFirstName(): Promise<string | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: o } = await (supabaseAdmin as any).from("business_owners").select("user_id").limit(1).maybeSingle();
    if (!o?.user_id) return null;
    const { data: p } = await (supabaseAdmin as any).from("profiles").select("full_name").eq("id", o.user_id).maybeSingle();
    return firstName(p?.full_name);
  } catch {
    return null;
  }
}
