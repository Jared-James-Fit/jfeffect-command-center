import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarPlus, Copy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getMyCalendarFeed } from "@/lib/schedule.functions";

/**
 * One-time setup so sessions show up in the client's own phone calendar and
 * stay current: a private feed they subscribe to from Google or Apple Calendar.
 */
export function CalendarFeedCard() {
  const qc = useQueryClient();
  const feedFn = useServerFn(getMyCalendarFeed);
  const [resetting, setResetting] = useState(false);
  const { data: feed } = useQuery({
    queryKey: ["my-calendar-feed"],
    queryFn: () => feedFn({ data: {} }),
    staleTime: Infinity,
    retry: false,
  });

  const copy = async () => {
    if (!feed) return;
    try {
      await navigator.clipboard.writeText(feed.httpsUrl);
      toast.success("Link copied. Paste it into your calendar app's \"Add calendar from URL\".");
    } catch {
      toast.error("Couldn't copy. Long-press the Apple button instead.");
    }
  };

  const reset = async () => {
    if (!confirm("Make a new link? The old one stops working, so you'll need to add your calendar again.")) return;
    setResetting(true);
    try {
      const next = await feedFn({ data: { reset: true } });
      qc.setQueryData(["my-calendar-feed"], next);
      toast.success("New link ready. Add it again with the buttons above.");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't reset");
    } finally {
      setResetting(false);
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary"><CalendarPlus className="h-5 w-5" /></div>
        <div className="min-w-0">
          <div className="text-sm font-bold">Put your sessions in your phone's calendar</div>
          <p className="text-xs text-muted-foreground">
            Set it up once. New, moved and cancelled sessions update on their own.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button asChild variant="outline" className="h-11" disabled={!feed}>
          <a href={feed?.googleUrl ?? "#"} target="_blank" rel="noreferrer">Google Calendar</a>
        </Button>
        <Button asChild variant="outline" className="h-11" disabled={!feed}>
          <a href={feed?.webcalUrl ?? "#"}>iPhone / Apple</a>
        </Button>
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>Google can take a few hours to show changes. Your text reminder always has the latest time.</span>
      </div>
      <div className="flex items-center gap-3 text-[11px]">
        <button type="button" onClick={copy} disabled={!feed} className="inline-flex items-center gap-1 font-semibold text-muted-foreground hover:text-foreground">
          <Copy className="h-3 w-3" /> Copy link
        </button>
        <button type="button" onClick={reset} disabled={!feed || resetting} className="font-semibold text-muted-foreground hover:text-foreground">
          Reset link
        </button>
      </div>
    </Card>
  );
}
