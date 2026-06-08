import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { getProductGrant, upsertProductGrant, deleteProductGrant, listAccessLevels } from "@/lib/product-access.functions";
import { updateCoachingProduct } from "@/lib/coaching-products.functions";
import { Input } from "@/components/ui/input";

type Props = {
  productId: string | null;
  productName?: string;
  initialIsMemberFacing?: boolean;
  initialMemberTierLabel?: string | null;
  onClose: () => void;
};

const ACCOUNT_TYPES = [
  { v: "app_member", l: "App Member (full app access)" },
  { v: "program_only", l: "Program-Only Buyer" },
  { v: "coaching_client", l: "Coaching Client (1-on-1)" },
] as const;

export function ProductAccessGrantDialog({ productId, productName, initialIsMemberFacing, initialMemberTierLabel, onClose }: Props) {
  const open = !!productId;
  const qc = useQueryClient();
  const fetchGrant = useServerFn(getProductGrant);
  const fetchLevels = useServerFn(listAccessLevels);
  const upsertFn = useServerFn(upsertProductGrant);
  const deleteFn = useServerFn(deleteProductGrant);
  const updateProductFn = useServerFn(updateCoachingProduct);

  const { data: grantData } = useQuery({
    queryKey: ["product-grant", productId],
    queryFn: () => fetchGrant({ data: { productId: productId! } }),
    enabled: open,
  });
  const { data: lvls } = useQuery({ queryKey: ["access-levels"], queryFn: () => fetchLevels(), enabled: open });
  const levels: any[] = lvls?.levels ?? [];

  const [accountType, setAccountType] = useState<"app_member"|"program_only"|"coaching_client">("app_member");
  const [keys, setKeys] = useState<string[]>([]);
  const [isSub, setIsSub] = useState(false);
  const [memberFacing, setMemberFacing] = useState(!!initialIsMemberFacing);
  const [tierLabel, setTierLabel] = useState(initialMemberTierLabel ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (grantData?.grant) {
      setAccountType(grantData.grant.account_type_granted as any);
      setKeys(grantData.grant.access_level_keys ?? []);
      setIsSub(grantData.grant.is_subscription);
    } else if (open) {
      setAccountType("app_member"); setKeys(["app_membership"]); setIsSub(false);
    }
    if (open) {
      setMemberFacing(!!initialIsMemberFacing);
      setTierLabel(initialMemberTierLabel ?? "");
    }
  }, [grantData, open, initialIsMemberFacing, initialMemberTierLabel]);

  const toggle = (k: string) => setKeys((cur) => cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]);

  const save = async () => {
    if (!productId || busy) return;
    setBusy(true);
    try {
      await upsertFn({ data: { productId, account_type_granted: accountType, access_level_keys: keys, is_subscription: isSub } });
      await updateProductFn({ data: { id: productId, isMemberFacing: memberFacing, memberTierLabel: tierLabel || null } });
      toast.success("Access grant saved");
      qc.invalidateQueries({ queryKey: ["product-grant", productId] });
      qc.invalidateQueries({ queryKey: ["coaching-products"] });
      onClose();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!productId || busy) return;
    if (!confirm("Remove membership access from this product?")) return;
    setBusy(true);
    try {
      await deleteFn({ data: { productId } });
      toast.success("Removed");
      qc.invalidateQueries({ queryKey: ["product-grant", productId] });
      onClose();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Membership Access</DialogTitle>
          <DialogDescription>
            When someone buys <b>{productName ?? "this product"}</b>, the Stripe webhook will grant the access below.
          </DialogDescription>
        </DialogHeader>
        {grantData && grantData.offerId === null && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            This product isn't linked to an Offer yet. Open the product editor and set its Offer first, then return here.
          </div>
        )}
        <div className="space-y-4">
          <div>
            <Label>Account type granted</Label>
            <Select value={accountType} onValueChange={(v) => setAccountType(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPES.map((a) => <SelectItem key={a.v} value={a.v}>{a.l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Access levels</Label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {levels.map((l: any) => (
                <label key={l.key} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                  <Checkbox checked={keys.includes(l.key)} onCheckedChange={() => toggle(l.key)} className="mt-0.5" />
                  <div className="min-w-0">
                    <div className="font-medium">{l.label}</div>
                    <div className="text-[11px] text-muted-foreground">{l.key}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={isSub} onCheckedChange={setIsSub} />
            <Label>Subscription product (recurring)</Label>
          </div>
          <div className="rounded-md border bg-muted/40 p-3">
            <div className="flex items-center gap-3">
              <Switch checked={memberFacing} onCheckedChange={setMemberFacing} />
              <Label>Show on member Upgrade page</Label>
            </div>
            {memberFacing && (
              <div className="mt-3">
                <Label className="text-xs">Tier label (optional)</Label>
                <Input value={tierLabel} onChange={(e) => setTierLabel(e.target.value)} placeholder="e.g. Premium, App Member" maxLength={60} />
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 flex justify-between gap-2">
          {grantData?.grant ? (
            <Button variant="ghost" className="text-destructive" onClick={remove} disabled={busy}>Remove grant</Button>
          ) : <div />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={busy || keys.length === 0 || !grantData?.offerId}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}