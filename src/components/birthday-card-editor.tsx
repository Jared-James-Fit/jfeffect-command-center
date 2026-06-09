import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BirthdayCardView } from "@/components/birthday-card-view";
import {
  BIRTHDAY_TEMPLATES,
  DEFAULT_TEMPLATE_KEY,
  getTemplate,
  resolveBirthdayCard,
  type BirthdayTemplateKey,
} from "@/lib/birthday-templates";
import { toast } from "sonner";
import { RotateCcw, Save } from "lucide-react";

interface Props {
  clientId: string;
  firstName: string | null | undefined;
  fullName?: string | null;
  avatarSrc?: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Open directly in preview-only mode (no editing controls). */
  previewOnly?: boolean;
}

export function BirthdayCardEditorDialog({
  clientId,
  firstName,
  fullName,
  avatarSrc,
  open,
  onOpenChange,
  previewOnly = false,
}: Props) {
  const qc = useQueryClient();

  const { data: stored } = useQuery({
    queryKey: ["birthday-card", clientId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_birthday_cards" as any)
        .select("*")
        .eq("client_id", clientId)
        .maybeSingle();
      if (error) throw error;
      return (data as any) ?? null;
    },
  });

  const [templateKey, setTemplateKey] = useState<BirthdayTemplateKey>(DEFAULT_TEMPLATE_KEY);
  const [headline, setHeadline] = useState("");
  const [message, setMessage] = useState("");
  const [quote, setQuote] = useState("");
  const [coachMessage, setCoachMessage] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [celebration, setCelebration] = useState(true);
  const [messageCoach, setMessageCoach] = useState(true);

  // Sync state when stored loads / dialog opens.
  useEffect(() => {
    if (!open) return;
    const t = getTemplate(stored?.template_key ?? DEFAULT_TEMPLATE_KEY);
    setTemplateKey(t.key);
    setHeadline(stored?.headline ?? t.headline);
    setMessage(stored?.message ?? t.message);
    setQuote(stored?.quote ?? t.quote);
    setCoachMessage(stored?.coach_message ?? t.coach_message);
    setEnabled(stored?.enabled ?? true);
    setCelebration(stored?.celebration_effect ?? true);
    setMessageCoach(stored?.show_message_coach_button ?? true);
  }, [open, stored]);

  const draft = useMemo(
    () =>
      resolveBirthdayCard({
        enabled,
        template_key: templateKey,
        headline,
        message,
        quote,
        coach_message: coachMessage,
        celebration_effect: celebration,
        show_message_coach_button: messageCoach,
      }),
    [enabled, templateKey, headline, message, quote, coachMessage, celebration, messageCoach],
  );

  const save = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const payload = {
        client_id: clientId,
        enabled,
        template_key: templateKey,
        headline: headline.trim() || null,
        message: message.trim() || null,
        quote: quote.trim() || null,
        coach_message: coachMessage.trim() || null,
        celebration_effect: celebration,
        show_message_coach_button: messageCoach,
        updated_by: u.user?.id ?? null,
      };
      const { error } = await supabase
        .from("client_birthday_cards" as any)
        .upsert(payload, { onConflict: "client_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Birthday card saved");
      qc.invalidateQueries({ queryKey: ["birthday-card", clientId] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Could not save"),
  });

  const applyTemplate = (key: BirthdayTemplateKey) => {
    const t = getTemplate(key);
    setTemplateKey(key);
    setHeadline(t.headline);
    setMessage(t.message);
    setQuote(t.quote);
    setCoachMessage(t.coach_message);
  };

  const reset = () => applyTemplate(DEFAULT_TEMPLATE_KEY);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>
            {previewOnly ? "Birthday Card Preview" : "Customize Birthday Card"}
          </DialogTitle>
          <DialogDescription>
            {previewOnly
              ? "This is exactly what the client will see on their birthday. Nothing is sent."
              : "Edit the message, pick a template, then save. The client sees this on their birthday."}
          </DialogDescription>
        </DialogHeader>

        {previewOnly ? (
          <div className="overflow-y-auto px-6 py-6">
            <PreviewFrame>
              <BirthdayCardView
                card={draft}
                firstName={firstName}
                fullName={fullName}
                avatarSrc={avatarSrc}
                compact
              />
            </PreviewFrame>
          </div>
        ) : (
          <Tabs defaultValue="edit" className="flex flex-col overflow-hidden">
            <TabsList className="mx-6 mt-3 grid w-fit grid-cols-2">
              <TabsTrigger value="edit">Edit</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>

            <TabsContent value="edit" className="overflow-y-auto px-6 pb-2">
              <div className="space-y-4 py-4">
                <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 px-3 py-2">
                  <div>
                    <Label className="text-sm font-semibold">Birthday card active</Label>
                    <p className="text-xs text-muted-foreground">
                      Off = client won't see anything on their birthday.
                    </p>
                  </div>
                  <Switch checked={enabled} onCheckedChange={setEnabled} />
                </div>

                <div>
                  <Label className="text-sm font-semibold">Template</Label>
                  <Select
                    value={templateKey}
                    onValueChange={(v) => applyTemplate(v as BirthdayTemplateKey)}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BIRTHDAY_TEMPLATES.map((t) => (
                        <SelectItem key={t.key} value={t.key}>
                          <div className="flex flex-col">
                            <span className="font-medium">{t.name}</span>
                            <span className="text-xs text-muted-foreground">{t.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Picking a template fills the fields below. You can still edit them.
                  </p>
                </div>

                <div>
                  <Label className="text-sm font-semibold">Headline</Label>
                  <Input
                    value={headline}
                    onChange={(e) => setHeadline(e.target.value)}
                    placeholder="Happy Birthday, [First Name] 🎉"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Use <code>[First Name]</code> to insert the client's name.
                  </p>
                </div>

                <div>
                  <Label className="text-sm font-semibold">Main Message</Label>
                  <Textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={2}
                  />
                </div>

                <div>
                  <Label className="text-sm font-semibold">Quote</Label>
                  <Textarea
                    value={quote}
                    onChange={(e) => setQuote(e.target.value)}
                    rows={2}
                  />
                </div>

                <div>
                  <Label className="text-sm font-semibold">Coach Message (optional)</Label>
                  <Textarea
                    value={coachMessage}
                    onChange={(e) => setCoachMessage(e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                    <Label className="text-sm">Celebration effect</Label>
                    <Switch checked={celebration} onCheckedChange={setCelebration} />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                    <Label className="text-sm">Message Coach button</Label>
                    <Switch checked={messageCoach} onCheckedChange={setMessageCoach} />
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="preview" className="overflow-y-auto px-6 pb-2">
              <PreviewFrame>
                <BirthdayCardView
                  card={draft}
                  firstName={firstName}
                  fullName={fullName}
                  avatarSrc={avatarSrc}
                  compact
                />
              </PreviewFrame>
            </TabsContent>
          </Tabs>
        )}

        {!previewOnly && (
          <DialogFooter className="border-t border-border px-6 py-3">
            <Button variant="ghost" onClick={reset} type="button">
              <RotateCcw className="mr-2 h-4 w-4" /> Reset to default
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              type="button"
            >
              <Save className="mr-2 h-4 w-4" />
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PreviewFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-center py-6">
      <div className="rounded-[2rem] border-4 border-border bg-background p-3 shadow-xl">
        <div className="rounded-[1.5rem] bg-background p-3">{children}</div>
        <div className="mt-2 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
          Client view
        </div>
      </div>
    </div>
  );
}