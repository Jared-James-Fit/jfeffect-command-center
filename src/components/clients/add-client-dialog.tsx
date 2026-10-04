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
  const [email, setEmail] = useState("");
  const [coachingType, setCoachingType] = useState("Online Coaching");
  const [busy, setBusy] = useState(false);
  const inviteFn = useServerFn(inviteClient);

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
          coaching_type: coachingType,
          status: "Active",
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      // New account → send the setup / access email right away.
      if (data?.id && email.trim()) {
        try {
          await inviteFn({ data: { clientId: data.id, redirectTo: `${window.location.origin}/setup` } });
          toast.success(`Client created — setup email sent to ${email.trim()}`);
        } catch (e: any) {
          toast.warning(`Client created, but the setup email failed: ${e?.message ?? "unknown error"}. Use “Send setup link” on their profile.`);
        }
      } else {
        toast.success("Client created — add an email to send their setup link");
      }
      onOpenChange(false);
      setName(""); setEmail("");
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
            <Label>Email <span className="font-normal text-muted-foreground">(setup email is sent automatically)</span></Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create & open"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}