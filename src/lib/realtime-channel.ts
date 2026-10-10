import { supabase } from "@/integrations/supabase/client";

let seq = 0;

/**
 * A realtime channel that only listens for database changes
 * (`postgres_changes`), with a name no other mount shares.
 *
 * supabase.channel(name) hands back the SAME channel when the name is already
 * open, and adding `.on("postgres_changes")` to a channel that has already
 * subscribed throws ("cannot add postgres_changes callbacks ... after
 * subscribe()"). Two components (or the same hook mounted twice) using one
 * name took the whole page down that way. For listen-only channels the name
 * means nothing to the server, so each call gets its own.
 *
 * NOT for presence or broadcast channels (typing, who's online, comment
 * sync): those need the shared topic so people meet on the same channel.
 */
export function listenChannel(name: string) {
  seq += 1;
  return supabase.channel(`${name}#${seq}`);
}
