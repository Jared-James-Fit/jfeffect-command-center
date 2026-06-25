import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MediaHeader } from "@/components/media/media-header";
import { toast } from "sonner";

const TABS = ["workspace", "notifications", "account"] as const;
type Tab = (typeof TABS)[number];

const KEY = "media_manager_settings";

type MMSettings = {
  platforms: string[];
  contentTypes: string[];
  productionStatuses: string[];
  templateCategories: string[];
  defaultFolder: string;
  approvalRequiredBeforePublish: boolean;
  autoNotifyOnAssign: boolean;
  autoNotifyOnComment: boolean;
  autoNotifyOnOverdue: boolean;
  emailDigestDaily: boolean;
};

const DEFAULTS: MMSettings = {
  platforms: ["Instagram", "TikTok", "YouTube", "X", "LinkedIn", "Newsletter", "Podcast"],
  contentTypes: ["Reel", "Post", "Story", "Long-form video", "Carousel", "Newsletter", "Podcast"],
  productionStatuses: ["Idea", "Scripting", "Ready to Film", "Filmed", "Editing", "Review", "Approved", "Scheduled", "Published", "Blocked"],
  templateCategories: ["Hook templates", "Caption templates", "Email templates", "Thumbnail templates"],
  defaultFolder: "Inbox",
  approvalRequiredBeforePublish: true,
  autoNotifyOnAssign: true,
  autoNotifyOnComment: true,
  autoNotifyOnOverdue: true,
  emailDigestDaily: false,
};

export const Route = createFileRoute("/_authenticated/media/settings")({
  validateSearch: (s) => z.object({ tab: z.enum(TABS).optional() }).parse(s),
  component: SettingsPage,
});

function SettingsPage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const active: Tab = tab ?? "workspace";
  const { user, role, signOut } = useAuth();
  const canEdit = role === "admin" || role === "media_manager";

  return (
    <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
      <MediaHeader
        title="Media Settings"
        description="Workspace defaults, notification preferences, and account settings."
      />
      <Tabs value={active} onValueChange={(v) => navigate({ to: "/media/settings", search: { tab: v as Tab }, replace: true })}>
        <TabsList>
          <TabsTrigger value="workspace">Workspace</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>
        <TabsContent value="workspace" className="mt-4">
          <WorkspaceSettings canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="notifications" className="mt-4">
          <NotificationSettings canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="account" className="mt-4 space-y-3">
          <Card className="space-y-2 p-4">
            <div className="text-sm"><span className="font-medium">Email:</span> {user?.email}</div>
            <div className="text-sm capitalize"><span className="font-medium">Role:</span> {role ?? "Not assigned"}</div>
          </Card>
          <Button variant="outline" onClick={() => signOut()}>Sign out</Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function useMediaSettings() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["media-settings"],
    queryFn: async (): Promise<MMSettings> => {
      const { data } = await supabase.from("app_settings").select("value").eq("key", KEY).maybeSingle();
      if (!data?.value) return DEFAULTS;
      try { return { ...DEFAULTS, ...JSON.parse(data.value) }; } catch { return DEFAULTS; }
    },
  });

  async function save(next: MMSettings) {
    const { error } = await (supabase.from("app_settings") as any)
      .upsert({ key: KEY, value: JSON.stringify(next) }, { onConflict: "key" });
    if (error) { toast.error(error.message); return; }
    qc.setQueryData(["media-settings"], next);
    toast.success("Settings saved");
  }

  return { settings: data ?? DEFAULTS, isLoading, save };
}

function WorkspaceSettings({ canEdit }: { canEdit: boolean }) {
  const { settings, save } = useMediaSettings();
  const [local, setLocal] = useState<MMSettings>(settings);
  useEffect(() => { setLocal(settings); }, [settings]);

  function listField<K extends "platforms" | "contentTypes" | "productionStatuses" | "templateCategories">(key: K, label: string) {
    return (
      <div className="space-y-1">
        <Label>{label}</Label>
        <Textarea
          value={local[key].join("\n")}
          onChange={(e) => setLocal({ ...local, [key]: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
          rows={5}
          disabled={!canEdit}
          placeholder="One per line"
        />
        <p className="text-xs text-muted-foreground">One per line.</p>
      </div>
    );
  }

  return (
    <Card className="space-y-4 p-4">
      {listField("platforms", "Platforms")}
      {listField("contentTypes", "Content Types")}
      {listField("productionStatuses", "Production Statuses")}
      {listField("templateCategories", "Template Categories")}
      <div className="space-y-1">
        <Label>Default Folder</Label>
        <Input value={local.defaultFolder} disabled={!canEdit}
          onChange={(e) => setLocal({ ...local, defaultFolder: e.target.value })} />
      </div>
      <div className="flex items-center justify-between rounded border border-border p-3">
        <div>
          <div className="text-sm font-medium">Approval required before publish</div>
          <p className="text-xs text-muted-foreground">Content must be approved before it can move to the publishing queue.</p>
        </div>
        <Switch checked={local.approvalRequiredBeforePublish} disabled={!canEdit}
          onCheckedChange={(v) => setLocal({ ...local, approvalRequiredBeforePublish: v })} />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setLocal(DEFAULTS)} disabled={!canEdit}>Reset</Button>
        <Button onClick={() => save(local)} disabled={!canEdit}>Save</Button>
      </div>
    </Card>
  );
}

function NotificationSettings({ canEdit }: { canEdit: boolean }) {
  const { settings, save } = useMediaSettings();
  const [local, setLocal] = useState<MMSettings>(settings);
  useEffect(() => { setLocal(settings); }, [settings]);

  const toggle = (label: string, desc: string, key: keyof MMSettings) => (
    <div className="flex items-center justify-between rounded border border-border p-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={!!local[key]} disabled={!canEdit}
        onCheckedChange={(v) => setLocal({ ...local, [key]: v } as MMSettings)} />
    </div>
  );

  return (
    <Card className="space-y-3 p-4">
      {toggle("Notify on task assignment", "Send a notification when a task is assigned to someone.", "autoNotifyOnAssign")}
      {toggle("Notify on comment", "Send a notification when someone is mentioned or a comment is added.", "autoNotifyOnComment")}
      {toggle("Notify on overdue", "Alert assignees when an item becomes overdue.", "autoNotifyOnOverdue")}
      {toggle("Daily email digest", "Send a once-a-day summary of approvals, comments, and overdue items.", "emailDigestDaily")}
      <div className="flex justify-end">
        <Button onClick={() => save(local)} disabled={!canEdit}>Save</Button>
      </div>
    </Card>
  );
}