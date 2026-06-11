import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Play, CheckCircle2, Share, Plus, Smartphone, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

const sb = supabase as any;

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // @ts-ignore
  if (window.navigator.standalone) return true;
  return window.matchMedia?.("(display-mode: standalone)").matches ?? false;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
}

const SESSION_KEY = "jf-setup-prompts-shown";

type Prompt = {
  id: string;
  title: string;
  body: string | null;
  video_embed_url: string | null;
  video_url: string | null;
  link_url: string | null;
  link_label: string | null;
  ios_steps: string[];
  android_steps: string[];
  enabled: boolean;
  sort_order: number;
};

export function HomeScreenSetupGate() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const standalone = useMemo(() => isStandalone(), []);
  const ios = useMemo(() => isIOS(), []);
  const [open, setOpen] = useState(false);
  const [showVideo, setShowVideo] = useState(false);

  const { data: prompts = [] } = useQuery({
    queryKey: ["setup-prompts-active", user?.id],
    enabled: !!user?.id && !standalone,
    queryFn: async () => {
      const { data: rows } = await sb
        .from("setup_prompts")
        .select("*")
        .eq("enabled", true)
        .order("sort_order", { ascending: true });
      const { data: dismissed } = await sb
        .from("setup_prompt_dismissals")
        .select("prompt_id, status, remind_after")
        .eq("user_id", user!.id);
      const now = Date.now();
      const skipIds = new Set(
        (dismissed ?? [])
          .filter((d: any) =>
            d.status === "done" ||
            (d.status === "remind" && d.remind_after && new Date(d.remind_after).getTime() > now)
          )
          .map((d: any) => d.prompt_id),
      );
      return ((rows ?? []) as Prompt[]).filter((p) => !skipIds.has(p.id));
    },
    staleTime: 60_000,
  });

  const current = prompts[0];

  useEffect(() => {
    if (!current || standalone) return;
    if (sessionStorage.getItem(SESSION_KEY + ":" + current.id)) return;
    setOpen(true);
    try { sessionStorage.setItem(SESSION_KEY + ":" + current.id, "1"); } catch {}
  }, [current, standalone]);

  async function upsertDismissal(status: "done" | "remind") {
    if (!current || !user?.id) return;
    const remind = status === "remind"
      ? (() => { const d = new Date(); d.setDate(d.getDate() + 3); return d.toISOString(); })()
      : null;
    const { error } = await sb
      .from("setup_prompt_dismissals")
      .upsert(
        { prompt_id: current.id, user_id: user.id, status, remind_after: remind },
        { onConflict: "prompt_id,user_id" },
      );
    if (error) { toast.error(error.message); return; }
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["setup-prompts-active", user.id] });
  }

  if (!current) return null;

  const steps = ios ? current.ios_steps : current.android_steps;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) upsertDismissal("remind"); else setOpen(true); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="mb-1 flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/15 text-primary">
                <Smartphone className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <DialogTitle className="text-base">{current.title}</DialogTitle>
                {current.body && <DialogDescription className="text-xs">{current.body}</DialogDescription>}
              </div>
            </div>
          </DialogHeader>

          {steps && steps.length > 0 && (
            <ol className="space-y-2 py-1">
              {steps.map((s, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{i + 1}</span>
                  <div className="text-sm leading-relaxed">{s}</div>
                </li>
              ))}
            </ol>
          )}

          {ios && (
            <div className="rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground">
              Look for <Share className="inline h-3 w-3" /> Share and <Plus className="inline h-3 w-3" /> Add to Home Screen.
            </div>
          )}

          <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-end">
            {current.video_embed_url && (
              <Button variant="outline" size="sm" onClick={() => setShowVideo(true)}>
                <Play className="mr-1 h-3.5 w-3.5" /> Watch Video
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => upsertDismissal("remind")}>
              Remind Me Later
            </Button>
            <Button size="sm" onClick={() => upsertDismissal("done")} className="bg-gradient-primary font-bold">
              <CheckCircle2 className="mr-1 h-4 w-4" /> Mark as Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {current.video_embed_url && (
        <Dialog open={showVideo} onOpenChange={setShowVideo}>
          <DialogContent className="max-w-2xl p-0 overflow-hidden">
            <DialogHeader className="sr-only"><DialogTitle>{current.title} video</DialogTitle></DialogHeader>
            <button
              onClick={() => setShowVideo(false)}
              className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-background/80 text-foreground shadow"
              aria-label="Close"
            ><X className="h-4 w-4" /></button>
            <div className="aspect-video w-full bg-black">
              <iframe
                src={current.video_embed_url}
                title={current.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="h-full w-full"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}