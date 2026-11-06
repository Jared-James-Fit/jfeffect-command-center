import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { inviteClient } from "@/lib/clients.functions";
import { sendAuthLinkBySms } from "@/lib/sms-links.functions";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

const TYPES = ["Online Coaching", "In-Person Coaching", "Hybrid Coaching", "Powerlifting", "Bodybuilding", "Fat Loss", "Muscle Gain", "Lifestyle"];

export function AddClientDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated?: () => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [coachingType, setCoachingType] = useState("Online Coaching");
  const [sendNow, setSendNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const inviteFn = useServerFn(inviteClient);
  const textFn = useServerFn(sendAuthLinkBySms);

  const submit = async () => {
    const full_name = name.trim();
    if (!full_name) return toast.error("Name is required");
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("clients")
        .insert({
          full_name,
          email: email.trim() || null,
          phone: phone.trim() || null,
          coaching_type: coachingType,
          status: "Active",
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      // Their setup link goes out right away: a text (read within minutes) and/or
      // the email. One link, good for 14 days until they've signed in (setup-invite.ts).
      const sent: string[] = [];
      const failed: string[] = [];
      if (data?.id && sendNow) {
        const redirectTo = `${window.location.origin}/setup`;
        if (phone.trim()) {
          try {
            await textFn({ data: { clientId: data.id, redirectTo, kind: "setup" } });
            sent.push("texted");
          } catch (e: any) {
            failed.push(`text (${e?.message ?? "failed"})`);
          }
        }
        if (email.trim()) {
          try {
            await inviteFn({ data: { clientId: data.id, redirectTo } });
            sent.push("emailed");
          } catch (e: any) {
            failed.push(`email (${e?.message ?? "failed"})`);
          }
        }
      }
      if (failed.length) {
        toast.warning(`Client created, but the setup ${failed.join(" and ")} didn't go. Send it from their profile.`);
      } else if (sent.length) {
        toast.success(`Client created. Setup link ${sent.join(" and ")}.`);
      } else {
        toast.success("Client created. Text or copy their setup link from their profile.");
      }
      onOpenChange(false);
      setName(""); setEmail(""); setPhone("");
      onCreated?.();
      if (data?.id) navigate({ to: "/admin/clients/$id", params: { id: data.id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create client");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Client</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Full name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" autoFocus />
          </div>
          <div>
            <Label>Mobile <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input type="tel" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="204 555 0123" />
          </div>
          <div>
            <Label>Email <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input type="email" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
          </div>
          <div>
            <Label>Coaching type</Label>
            <Select value={coachingType} onValueChange={setCoachingType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <label className="flex min-h-10 cursor-pointer items-center gap-3 text-sm">
            <Checkbox checked={sendNow} onCheckedChange={(v) => setSendNow(v === true)} />
            <span>
              Send their setup link now
              <span className="block text-xs text-muted-foreground">
                {phone.trim() || email.trim()
                  ? `By ${[phone.trim() && "text", email.trim() && "email"].filter(Boolean).join(" and ")}. One tap and they pick a password.`
                  : "Add a mobile or email, or copy the link from their profile."}
              </span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create & open"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}