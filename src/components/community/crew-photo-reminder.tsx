/**
 * "Make your Crew profile yours!": a screen of the feed, right after the first
 * post, for someone with no Crew picture, at the admin's moments (7 days, 14,
 * then every 30, rules.ts crewReminderDue). Once a visit at most, never twice in
 * one app session, never on the Following tab, the coach's page or while
 * previewing a client, and never on top of an outstanding account headshot
 * reminder (the server says no then). "Not now" is remembered on the server, so
 * it doesn't come back on another phone until the next moment. Any picture is
 * fine; it never asks for a face.
 */
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { CREW_PHOTO_COPY } from "@/lib/headshots/rules";
import { dismissCrewPhotoReminder, getCrewPhotoReminder } from "@/lib/headshots/headshots.functions";
import { useCrewPhotoPicker } from "@/components/community/crew-photo-picker";

const KEY = ["crew-photo-reminder"] as const;
/** Shown once in this app session at most (a reload or a new launch starts over; the server decides the rest). */
let shownThisSession = false;
export function crewPhotoShownThisSession(): boolean {
  return shownThisSession;
}

export function useCrewPhotoReminder(enabled: boolean) {
  const fn = useServerFn(getCrewPhotoReminder);
  return useQuery({
    queryKey: KEY,
    enabled: enabled && !shownThisSession,
    staleTime: 30 * 60_000,
    queryFn: () => fn() as Promise<{ show: boolean }>,
  });
}

export function CrewPhotoReminderScreen({ onDone }: { onDone?: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const dismiss = useServerFn(dismissCrewPhotoReminder);
  const ref = useRef<HTMLDivElement | null>(null);
  const done = useRef(false);
  useEffect(() => {
    shownThisSession = true;
  }, []);
  const finish = (dismissed: boolean) => {
    if (done.current) return;
    done.current = true;
    if (dismissed) void dismiss().catch(() => undefined);
    qc.setQueryData(KEY, { show: false });
    onDone?.();
    // on to the next post
    const page = ref.current?.closest(".feed-page") as HTMLElement | null;
    const next = page?.nextElementSibling as HTMLElement | null;
    if (next) window.scrollTo({ top: window.scrollY + next.getBoundingClientRect().top, behavior: "smooth" });
  };
  const picker = useCrewPhotoPicker(user?.id ?? null, { onSaved: () => finish(false) });
  return (
    <div ref={ref} className="mx-auto flex w-full max-w-[420px] flex-col items-center px-8 text-center text-white" data-crew-photo-reminder>
      <button type="button" onClick={picker.open} className="grid h-28 w-28 place-items-center rounded-full border-2 border-dashed border-white/40 bg-white/5 active:scale-95" aria-label={CREW_PHOTO_COPY.action}>
        <Camera className="h-9 w-9 text-white/80" />
      </button>
      <h2 className="mt-6 text-[24px] font-bold leading-tight">{CREW_PHOTO_COPY.title}</h2>
      <p className="mt-2 text-[15px] leading-snug text-white/75">{CREW_PHOTO_COPY.body}</p>
      <div className="mt-6 flex w-full flex-col gap-2">
        <Button size="lg" className="h-12 rounded-full" onClick={picker.open} disabled={picker.pending} data-crew-photo-add>
          {CREW_PHOTO_COPY.action}
        </Button>
        <button type="button" onClick={() => finish(true)} className="h-11 text-[14px] font-semibold text-white/70" data-crew-photo-later>
          {CREW_PHOTO_COPY.later}
        </button>
      </div>
      {picker.element}
    </div>
  );
}
