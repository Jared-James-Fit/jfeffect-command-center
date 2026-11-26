/**
 * Asked before a max a running block reads changes (max-change.ts): the
 * coach's fixed % loads never move mid-block without them saying so. Two
 * clear choices: use the new numbers there too, or keep the block on the old
 * ones (a row for that block only, keepBlockOnRow). A check that can't run
 * never blocks the save: it goes ahead as before.
 */
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { listUpcomingPercentRows, upsertClientMax, type ClientMaxRow } from "@/lib/pl-maxes";
import { blocksMovedByMaxChange, exampleWords, movedBlocksWords, type MovedBlock } from "@/lib/strength-intel/max-change";
import { keepBlockOnRow } from "@/lib/strength-intel/max-history";
import { todayLocalISO } from "@/lib/today";

const db = supabase as any;

export type MaxChangeCheck = { blocks: MovedBlock[]; old: ClientMaxRow | null };

async function allMaxes(clientId: string): Promise<ClientMaxRow[]> {
  const { data, error } = await db.from("pl_client_maxes").select("*").eq("client_id", clientId);
  if (error) throw error;
  return (data ?? []) as ClientMaxRow[];
}

/**
 * Which running blocks a save (`next`, a global row) or a removal (`next`
 * null, `removeId`) would move. Null when nothing would, or the check
 * couldn't run.
 */
export async function checkMaxChange(
  clientId: string,
  change: { next: Partial<ClientMaxRow> & { lift: string }; removeId?: undefined } | { next: null; removeId: string },
  unit: "kg" | "lb",
): Promise<MaxChangeCheck | null> {
  try {
    if (change.next && change.next.block_id) return null; // a block's own row is the coach's explicit choice
    const [before, rows] = await Promise.all([allMaxes(clientId), listUpcomingPercentRows(clientId)]);
    if (!rows.length) return null;
    let old: ClientMaxRow | null = null;
    let after: ClientMaxRow[];
    if (change.next === null) {
      old = before.find((m) => m.id === change.removeId) ?? null;
      if (!old || old.block_id) return null;
      after = before.filter((m) => m.id !== old!.id);
    } else {
      const next = change.next;
      const lift = next.lift.trim().toLowerCase();
      // upsertClientMax saves onto the global row of the same lift when there's one
      old = (next.id ? before.find((m) => m.id === next.id) : null)
        ?? before.find((m) => !m.block_id && m.lift.trim().toLowerCase() === lift)
        ?? null;
      const merged = { ...(old ?? {}), ...next, id: old?.id ?? "__new", client_id: clientId, block_id: null } as ClientMaxRow;
      after = old ? before.map((m) => (m.id === old!.id ? merged : m)) : [...before, merged];
    }
    const blocks = blocksMovedByMaxChange(rows, before, after, unit);
    return blocks.length ? { blocks, old } : null;
  } catch {
    return null;
  }
}

/** Copy the old numbers onto a row for each block, so those blocks don't move. */
export async function keepBlocksOnOld(clientId: string, check: MaxChangeCheck) {
  if (!check.old) return;
  const day = todayLocalISO();
  for (const b of check.blocks) {
    await upsertClientMax({ ...(keepBlockOnRow(check.old, b.blockId, day) as any), client_id: clientId, lift: check.old.lift });
  }
}

export function MaxChangeQuestion({
  check,
  removing = false,
  busy = false,
  onUseNew,
  onKeepOld,
  onCancel,
}: {
  check: MaxChangeCheck | null;
  removing?: boolean;
  busy?: boolean;
  onUseNew: () => void;
  onKeepOld: () => void;
  onCancel: () => void;
}) {
  if (!check) return null;
  const one = check.blocks.length === 1 ? check.blocks[0].name : null;
  const example = exampleWords(check.blocks[0]?.example ?? null);
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <DialogContent className="max-w-md" data-max-change-question>
        <DialogHeader>
          <DialogTitle>{one ? `${one} is running on this max` : "Running blocks read this max"}</DialogTitle>
          <DialogDescription>
            {removing ? "Deleting it" : "This change"} moves {movedBlocksWords(check.blocks)}
            {example ? ` (${example})` : ""}. Finished workouts keep what they were planned from either way.
          </DialogDescription>
        </DialogHeader>
        {/* the title names the block, so the choices stay short enough for a phone; the dialog's own Back cancels */}
        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button className="h-auto min-h-11 whitespace-normal py-2.5" onClick={onUseNew} disabled={busy} data-max-change-use-new>
            {removing ? "Delete it anyway" : one ? "Update the block too" : "Update those blocks too"}
          </Button>
          {check.old && (
            <Button variant="outline" className="h-auto min-h-11 whitespace-normal py-2.5" onClick={onKeepOld} disabled={busy} data-max-change-keep-old>
              {one ? "Keep the block on the old numbers" : "Keep those blocks on the old numbers"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
