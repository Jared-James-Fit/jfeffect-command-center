import { CalendarCheck, CheckCircle2, Dumbbell, Flame, Trophy } from "lucide-react";
import type { WorkoutWin } from "@/lib/community";

// Small on purpose: Home's Crew Pulse card loads this with the app.

/**
 * How each kind of real win looks: an icon and one colour, never a glow or
 * gradient (`tint` is kept for older call sites and is always empty). `tone`
 * is the colour on the app's own surfaces (light or dark with the theme): a
 * PR amber, a milestone or streak green, a top set or a finished session
 * neutral. `text` is the same on the always-dark story frame.
 */
export const WIN_STYLE: Record<WorkoutWin["kind"], { tint: string; tone: string; text: string; Icon: typeof Trophy }> = {
  pr: { tint: "", tone: "text-warning", text: "text-amber-400", Icon: Trophy },
  month: { tint: "", tone: "text-success", text: "text-emerald-400", Icon: CalendarCheck },
  week: { tint: "", tone: "text-success", text: "text-emerald-400", Icon: Flame },
  top: { tint: "", tone: "text-foreground", text: "text-white", Icon: Dumbbell },
  done: { tint: "", tone: "text-success", text: "text-emerald-400", Icon: CheckCircle2 },
};
