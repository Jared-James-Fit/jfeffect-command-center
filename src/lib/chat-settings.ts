import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

export const DEFAULT_REACTION = "✅";
export const ALLOWED_REACTIONS = ["✅", "👍", "🔥", "💪", "❤️", "👀", "😂"] as const;

export type ChatSettings = {
  defaultReaction: string;
  clientsCanSendGifs: boolean;
  appMembersCanSendGifs: boolean;
  programMembersCanSendGifs: boolean;
  clientsCanSendSounds: boolean;
  clientsCanPlaySounds: boolean;
  appMembersCanSendSounds: boolean;
  programMembersCanSendSounds: boolean;
};

const KEYS = {
  reaction: "chat_default_reaction",
  clients: "chat_gifs_clients_send",
  app: "chat_gifs_app_members_send",
  program: "chat_gifs_program_members_send",
  sndClientsSend: "chat_sounds_clients_send",
  sndClientsPlay: "chat_sounds_clients_play",
  sndAppSend: "chat_sounds_app_members_send",
  sndProgramSend: "chat_sounds_program_members_send",
};

function parseBool(v: string | null | undefined, fallback: boolean) {
  if (v == null) return fallback;
  return v === "true" || v === "1";
}

export async function getChatSettings(): Promise<ChatSettings> {
  const { data, error } = await db
    .from("app_settings")
    .select("key,value")
    .in("key", [
      KEYS.reaction, KEYS.clients, KEYS.app, KEYS.program,
      KEYS.sndClientsSend, KEYS.sndClientsPlay, KEYS.sndAppSend, KEYS.sndProgramSend,
    ]);
  if (error) throw error;
  const map = new Map<string, string>((data ?? []).map((r: any) => [r.key, r.value]));
  return {
    defaultReaction: map.get(KEYS.reaction) || DEFAULT_REACTION,
    clientsCanSendGifs: parseBool(map.get(KEYS.clients), true),
    appMembersCanSendGifs: parseBool(map.get(KEYS.app), false),
    programMembersCanSendGifs: parseBool(map.get(KEYS.program), false),
    clientsCanSendSounds: parseBool(map.get(KEYS.sndClientsSend), true),
    clientsCanPlaySounds: parseBool(map.get(KEYS.sndClientsPlay), true),
    appMembersCanSendSounds: parseBool(map.get(KEYS.sndAppSend), false),
    programMembersCanSendSounds: parseBool(map.get(KEYS.sndProgramSend), false),
  };
}

async function upsertSetting(key: string, value: string) {
  const { error } = await db
    .from("app_settings")
    .upsert({ key, value }, { onConflict: "key" });
  if (error) throw error;
}

export async function setDefaultReaction(emoji: string) {
  if (!ALLOWED_REACTIONS.includes(emoji as any)) throw new Error("Invalid emoji");
  await upsertSetting(KEYS.reaction, emoji);
}

export async function setGifPermission(
  who: "clients" | "app" | "program",
  enabled: boolean,
) {
  const key = who === "clients" ? KEYS.clients : who === "app" ? KEYS.app : KEYS.program;
  await upsertSetting(key, enabled ? "true" : "false");
}

export async function setSoundPermission(
  who: "clients_send" | "clients_play" | "app_send" | "program_send",
  enabled: boolean,
) {
  const key =
    who === "clients_send" ? KEYS.sndClientsSend :
    who === "clients_play" ? KEYS.sndClientsPlay :
    who === "app_send" ? KEYS.sndAppSend : KEYS.sndProgramSend;
  await upsertSetting(key, enabled ? "true" : "false");
}