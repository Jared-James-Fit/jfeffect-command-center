import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getSetupLink, inviteClient } from "@/lib/clients.functions";
import { sendAuthLinkBySms } from "@/lib/sms-links.functions";
import { SetupSentPanel, type SetupOutcome } from "./setup-sent-panel";
import { normalizePhoneToE164 } from "@/lib/phone-e164";
import { toast } from "sonner";

const TYPES = ["Online Coaching", "In-Person Coaching", "Hybrid Coaching", "Powerlifting", "Bodybuilding", "Fat Loss", "Muscle Gain", "Lifestyle"];

type Outcome = SetupOutcome;
type Sent = {
  clientId: string;
  firstName: string;
  email: string;
  phone: string;
  emailed: Outcome;
  texted: Outcome;
  /** The setup link to copy: the one that was texted, so copying never cancels it. */
  url: string | null;
  linkError?: string;
};

const errorText = (e: any) => (typeof e?.message === "string" && e.message) || "unknown error";

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
  const [phone, setPhone] = useState("");
  const [coachingType, setCoachingType] = useState("Online Coaching");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const inviteFn = useServerFn(inviteClient);
  const textFn = useServerFn(sendAuthLinkBySms);
  const linkFn = useServerFn(getSetupLink);

  // Start clean every time the dialog opens.
  useEffect(() => {
    if (!open) {
      setName(""); setEmail(""); setPhone(""); setSent(null);
    }
  }, [open]);

  const submit = async () => {
    const full_name = name.trim().replace(/\s+/g, " ");
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = normalizePhoneToE164(phone);
    if (!full_name) return toast.error("Name is required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return toast.error("Enter a valid email");
    if (!cleanPhone) return toast.error("Enter a valid mobile number");
    setBusy(true);
    try {
      const [first, ...rest] = full_name.split(" ");
      const { data, error } = await supabase
        .from("clients")
        .insert({
          full_name,
          first_name: first,
          last_name: rest.join(" ") || null,
          email: cleanEmail,
          phone: cleanPhone,
          coaching_type: coachingType,
          status: "Active",
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      onCreated?.();

      const redirectTo = `${window.location.origin}/setup`;
      // Email first: it creates their login. The text then carries its own link, which is
      // also the one shown to copy, so every channel works at once.
      let emailed: Outcome = { ok: true };
      try { await inviteFn({ data: { clientId: data.id, redirectTo } }); }
      catch (e) { emailed = { ok: false, error: errorText(e) }; }

      let texted: Outcome = { ok: true };
      let url: string | null = null;
      try { url = (await textFn({ data: { clientId: data.id, redirectTo, kind: "setup" } })).url; }
      catch (e) { texted = { ok: false, error: errorText(e) }; }

      let linkError: string | undefined;
      if (!url) {
        try { url = (await linkFn({ data: { clientId: data.id, redirectTo } })).url; }
        catch (e) { linkError = errorText(e); }
      }

      setSent({ clientId: data.id, firstName: first, email: cleanEmail, phone: cleanPhone, emailed, texted, url, linkError });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create client");
    } finally {
      setBusy(false);
    }
  };

  const openClient = () => {
    if (!sent) return;
    onOpenChange(false);
    navigate({ to: "/admin/clients/$id", params: { id: sent.clientId } });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {!sent ? (
          <>
            <DialogHeader>
              <DialogTitle>Add Client</DialogTitle>
              <DialogDescription>They get their setup link by email and text straight away.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="add-client-name">Full name</Label>
                <Input id="add-client-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" autoFocus />
              </div>
              <div>
                <Label htmlFor="add-client-email">Email</Label>
                <Input id="add-client-email" type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
              </div>
              <div>
                <Label htmlFor="add-client-phone">Mobile number</Label>
                <Input id="add-client-phone" type="tel" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(204) 555-0123" />
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
              <Button onClick={submit} disabled={busy}>{busy ? "Creating & sending…" : "Create & send setup"}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Send {sent.firstName}'s setup</DialogTitle>
              <DialogDescription>Their account is ready. Here's how the setup link went out.</DialogDescription>
            </DialogHeader>
            <SetupSentPanel
              firstName={sent.firstName}
              email={sent.email}
              phone={sent.phone}
              emailed={sent.emailed}
              texted={sent.texted}
              url={sent.url}
              linkError={sent.linkError}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
              <Button onClick={openClient}>Open client</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

