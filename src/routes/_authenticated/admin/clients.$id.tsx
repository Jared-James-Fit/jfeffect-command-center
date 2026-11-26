import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { LEGACY_WORKSPACE_TABS } from "@/components/clients/client-workspace-tab-model";
import { TAB_VALUES, type TabValue } from "@/components/clients/client-tab-values";
import { ClientDetailRoute } from "@/route-pages/_authenticated/admin/clients.$id";

export const Route = createFileRoute("/_authenticated/admin/clients/$id")({
  validateSearch: (s): { tab?: TabValue; competition?: string; assessment?: string; section?: string } => {
    const parsed = z.object({ tab: z.string().optional(), competition: z.string().uuid().optional().catch(undefined), assessment: z.string().uuid().optional().catch(undefined), section: z.string().regex(/^[a-z]{3,12}$/).optional().catch(undefined) }).parse(s);
    // Redirect deprecated tabs after the Client Profile / Nutrition consolidation.
    // "messages" now lives in the unified inbox, not the client workspace.
    const remap: Record<string, TabValue> = LEGACY_WORKSPACE_TABS;
    const t = parsed.tab ? (remap[parsed.tab] ?? parsed.tab) : undefined;
    return {
      tab: t && (TAB_VALUES as readonly string[]).includes(t) ? (t as TabValue) : undefined,
      // a competition push opens the exact assessment (competition-tab.tsx reads them)
      ...(parsed.competition ? { competition: parsed.competition } : {}),
      ...(parsed.assessment ? { assessment: parsed.assessment } : {}),
      // a competition section to open (Gameplan, Timeline, Checklist): competition-tab.tsx
      ...(parsed.section ? { section: parsed.section } : {}),
    };
  },
  component: ClientDetailRoute,
});
