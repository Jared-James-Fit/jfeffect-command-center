import { CalendarCheck, CheckCircle2, Dumbbell, Flame, Trophy } from "lucide-react";
import type { WorkoutWin } from "@/lib/community";

// Small on purpose: Home's Crew Pulse card loads this with the app.

/** How each kind of real win looks: a PR gold, a milestone sky, a streak orange, a top set red. */
export const WIN_STYLE: Record<WorkoutWin["kind"], { tint: string; text: string; Icon: typeof Trophy }> = {
  pr: { tint: "bg-[radial-gradient(120%_100%_at_100%_0%,rgba(245,158,11,0.32),transparent_60%)]", text: "text-amber-400", Icon: Trophy },
  month: { tint: "bg-[radial-gradient(120%_100%_at_100%_0%,rgba(56,189,248,0.24),transparent_60%)]", text: "text-sky-400", Icon: CalendarCheck },
  week: { tint: "bg-[radial-gradient(120%_100%_at_100%_0%,rgba(249,115,22,0.28),transparent_60%)]", text: "text-orange-400", Icon: Flame },
  top: { tint: "bg-[radial-gradient(120%_100%_at_100%_0%,rgba(239,51,64,0.28),transparent_60%)]", text: "text-red-400", Icon: Dumbbell },
  done: { tint: "bg-[radial-gradient(120%_100%_at_100%_0%,rgba(255,255,255,0.08),transparent_60%)]", text: "text-white/70", Icon: CheckCircle2 },
};
