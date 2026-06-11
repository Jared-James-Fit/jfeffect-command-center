import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { listWarmupProtocols } from "@/lib/warmups";

/**
 * Reusable warm-up mode + protocol selector.
 *
 * `mode` values:
 *   - "default"        → use resolver default (client/block/day cascade)
 *   - "general"        → force default general
 *   - "powerlifting"   → force default powerlifting
 *   - "custom"         → use protocolId
 *   - "none"           → explicitly no warm-up
 *   - "auto"           → day-level only (auto-detect by exercises) — included when `includeAuto`
 *   - "block"          → day-level only (inherit block) — included when `includeInheritBlock`
 */
export type WarmupMode =
  | "default"
  | "auto"
  | "block"
  | "general"
  | "powerlifting"
  | "custom"
  | "none";

export function WarmupPicker({
  label = "Warm-Up Protocol",
  mode,
  protocolId,
  onChange,
  includeAuto,
  includeInheritBlock,
  description,
}: {
  label?: string;
  mode: WarmupMode;
  protocolId: string | null;
  onChange: (next: { mode: WarmupMode; protocolId: string | null }) => void;
  includeAuto?: boolean;
  includeInheritBlock?: boolean;
  description?: string;
}) {
  const { data: protocols = [] } = useQuery({
    queryKey: ["warmup-protocols-min"],
    queryFn: () => listWarmupProtocols(),
    staleTime: 60_000,
  });

  return (
    <div className="space-y-2">
      <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Select
        value={mode}
        onValueChange={(v) => {
          const m = v as WarmupMode;
          onChange({ mode: m, protocolId: m === "custom" ? protocolId : null });
        }}
      >
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {includeAuto && <SelectItem value="auto">Auto-detect (by exercises)</SelectItem>}
          {includeInheritBlock && <SelectItem value="block">Use Block Warm-Up</SelectItem>}
          {!includeAuto && <SelectItem value="default">Use default</SelectItem>}
          <SelectItem value="general">Default General Warm-Up</SelectItem>
          <SelectItem value="powerlifting">Default Powerlifting Warm-Up</SelectItem>
          <SelectItem value="custom">Custom Warm-Up Protocol</SelectItem>
          <SelectItem value="none">No Warm-Up</SelectItem>
        </SelectContent>
      </Select>

      {mode === "custom" && (
        <Select
          value={protocolId ?? ""}
          onValueChange={(v) => onChange({ mode: "custom", protocolId: v || null })}
        >
          <SelectTrigger><SelectValue placeholder="Choose a custom protocol…" /></SelectTrigger>
          <SelectContent>
            {protocols.length === 0 ? (
              <div className="px-2 py-1 text-xs text-muted-foreground">No protocols yet.</div>
            ) : (
              protocols.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      )}

      {description && <p className="text-[11px] text-muted-foreground">{description}</p>}
    </div>
  );
}

export const WARMUP_PRIORITY_NOTE =
  "Priority: Client → Block → Day → Exercise → Default protocol.";