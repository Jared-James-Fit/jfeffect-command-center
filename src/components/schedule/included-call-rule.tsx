import { useQuery } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cancelRuling } from "@/lib/coaching-packages/call-period";
import { wallTimeToUtc } from "@/lib/schedule-time";

const db = supabase as any;

/**
 * Whether a session is one of a package's included calls (Coaching Plus), and
 * the package's cancel window. Staff read both tables; null for anything else.
 */
export function useIncludedCallPackage(sessionId: string | null | undefined, enabled = true) {
  return useQuery<{ name: string; cancelHours: number } | null>({
    queryKey: ["included-call-package", sessionId],
    enabled: enabled && !!sessionId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: s } = await db.from("pt_sessions").select("booking_card_id").eq("id", sessionId).maybeSingle();
      if (!s?.booking_card_id) return null;
      const { data: p } = await db
        .from("coaching_packages")
        .select("name, call_cancel_hours")
        .eq("call_booking_card_id", s.booking_card_id)
        .limit(1)
        .maybeSingle();
      return p ? { name: p.name as string, cancelHours: Number(p.call_cancel_hours ?? 24) } : null;
    },
  });
}

/**
 * What the 24-hour rule says about a client's "can't make it" on an included
 * call, for the coach answering it: one line, and which answer it points to
 * ("bank" gives the call back, "use" counts it). Null when it isn't an
 * included call, so every other session reads as before.
 */
export function useIncludedCallRuling(
  session: { id: string; session_date: string; start_time: string; timezone: string | null } | null | undefined,
  request: { kind: string; created_at?: string | null } | null | undefined,
  first: string,
): { line: string; suggest: "bank" | "use"; name: string } | null {
  const cancel = request?.kind === "cancel" && !!request.created_at;
  const { data: pkg } = useIncludedCallPackage(session?.id, cancel);
  if (!cancel || !session || !pkg) return null;
  const starts = wallTimeToUtc(session.session_date, session.start_time.slice(0, 5), session.timezone).toISOString();
  const r = cancelRuling(starts, request!.created_at!, pkg.cancelHours, first);
  return { line: r.line, suggest: r.timely ? "bank" : "use", name: pkg.name };
}

export function IncludedCallRulingLine({ ruling }: { ruling: { line: string; name: string } }) {
  return (
    <p className="flex items-start gap-1.5 text-[12px] leading-snug text-muted-foreground" data-included-call-ruling>
      <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        One of their {ruling.name} calls. {ruling.line}
      </span>
    </p>
  );
}
