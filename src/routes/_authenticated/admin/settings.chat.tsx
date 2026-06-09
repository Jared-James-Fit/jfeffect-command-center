import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ALLOWED_REACTIONS, getChatSettings, setDefaultReaction, setGifPermission, setSoundPermission,
} from "@/lib/chat-settings";

export const Route = createFileRoute("/_authenticated/admin/settings/chat")({
  component: ChatSettingsPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">Couldn't load chat settings: {String(error)}</p>
        <Button onClick={() => { reset(); router.invalidate(); }}>Retry</Button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-6 text-sm">Not found.</div>,
});

function ChatSettingsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["chat-settings"], queryFn: getChatSettings });

  const updateReaction = async (emoji: string) => {
    try {
      await setDefaultReaction(emoji);
      qc.invalidateQueries({ queryKey: ["chat-settings"] });
      toast.success(`Default reaction set to ${emoji}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    }
  };

  const updatePermission = async (who: "clients" | "app" | "program", val: boolean) => {
    try {
      await setGifPermission(who, val);
      qc.invalidateQueries({ queryKey: ["chat-settings"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    }
  };

  const updateSoundPermission = async (
    who: "clients_send" | "clients_play" | "app_send" | "program_send",
    val: boolean,
  ) => {
    try {
      await setSoundPermission(who, val);
      qc.invalidateQueries({ queryKey: ["chat-settings"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="Chat Settings" subtitle="Reactions, GIFs, and communication preferences" />
      <div className="mt-4 grid gap-4">
        <Card className="p-4 sm:p-6">
          <h3 className="text-base font-semibold">Default Double-Tap Reaction</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose the emoji used when someone double-taps a message. Applies to admins, coaches, clients, and members.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {ALLOWED_REACTIONS.map((e) => {
              const active = data?.defaultReaction === e;
              return (
                <button
                  key={e}
                  type="button"
                  onClick={() => updateReaction(e)}
                  className={cn(
                    "rounded-full border px-4 py-2 text-2xl transition active:scale-95",
                    active ? "border-primary bg-primary/10 ring-2 ring-primary" : "border-border hover:bg-secondary",
                  )}
                  title={`Set default to ${e}`}
                >
                  {e}
                </button>
              );
            })}
          </div>
          {data?.defaultReaction && (
            <p className="mt-3 text-xs text-muted-foreground">
              Current: <span className="text-base">{data.defaultReaction}</span>
            </p>
          )}
        </Card>

        <Card className="p-4 sm:p-6">
          <h3 className="text-base font-semibold">GIF & Effects Permissions</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Control who can send GIFs from the chat composer. Admins and coaches can always send.
          </p>
          <div className="mt-4 space-y-3">
            {[
              { key: "clients" as const, label: "Coaching Clients", val: data?.clientsCanSendGifs },
              { key: "app" as const, label: "App Members", val: data?.appMembersCanSendGifs },
              { key: "program" as const, label: "Program-Only Members", val: data?.programMembersCanSendGifs },
            ].map((row) => (
              <div key={row.key} className="flex items-center justify-between">
                <Label htmlFor={`gifs-${row.key}`}>{row.label}</Label>
                <Switch
                  id={`gifs-${row.key}`}
                  checked={!!row.val}
                  onCheckedChange={(v) => updatePermission(row.key, v)}
                />
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4 sm:p-6">
          <h3 className="text-base font-semibold">Sound Effect Permissions</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Control who can send and play chat sound effects. Sounds never autoplay — users must tap play.
          </p>
          <div className="mt-4 space-y-3">
            {[
              { key: "clients_send" as const, label: "Coaching Clients can send sounds", val: data?.clientsCanSendSounds },
              { key: "clients_play" as const, label: "Coaching Clients can play sounds", val: data?.clientsCanPlaySounds },
              { key: "app_send" as const, label: "App Members can send sounds", val: data?.appMembersCanSendSounds },
              { key: "program_send" as const, label: "Program-Only Members can send sounds", val: data?.programMembersCanSendSounds },
            ].map((row) => (
              <div key={row.key} className="flex items-center justify-between">
                <Label htmlFor={`sounds-${row.key}`}>{row.label}</Label>
                <Switch
                  id={`sounds-${row.key}`}
                  checked={!!row.val}
                  onCheckedChange={(v) => updateSoundPermission(row.key, v)}
                />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}