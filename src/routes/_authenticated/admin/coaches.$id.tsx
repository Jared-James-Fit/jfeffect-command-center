import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Search, UserPlus, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { assignClientToCoach, setCoachStatus } from "@/lib/coaches.functions";
import { useAuth } from "@/lib/auth";
import { UserAvatar } from "@/components/user-avatar";
import { ProfilePictureCapture } from "@/components/profile-picture-capture";
import { Camera, X, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/coaches/$id")({
  component: CoachDetailPage,
});

function CoachDetailPage() {
  const { id } = useParams({ from: "/_authenticated/admin/coaches/$id" });
  const { role } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editingPic, setEditingPic] = useState(false);
  const assignFn = useServerFn(assignClientToCoach);
  const statusFn = useServerFn(setCoachStatus);

  if (role !== "admin") {
    return <div className="p-8 text-sm text-muted-foreground">Admin only.</div>;
  }

  const { data: coach } = useQuery({
    queryKey: ["coach", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("coaches").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: allClients = [] } = useQuery({
    queryKey: ["clients-assignable"],
    queryFn: async () => {
      const { data } = await supabase.from("clients")
        .select("id, full_name, email, status, assigned_coach_id, profile_picture_url")
        .eq("archived", false)
        .order("full_name");
      return data ?? [];
    },
  });

  const assigned = allClients.filter((c) => c.assigned_coach_id === id);
  const unassignedOrOther = allClients.filter((c) => c.assigned_coach_id !== id);
  const filteredOther = useMemo(() => {
    if (!search.trim()) return unassignedOrOther.slice(0, 20);
    const q = search.toLowerCase();
    return unassignedOrOther.filter((c) =>
      c.full_name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q),
    ).slice(0, 20);
  }, [unassignedOrOther, search]);

  const assign = async (clientId: string) => {
    try {
      await assignFn({ data: { clientId, coachId: id } });
      toast.success("Client assigned");
      qc.invalidateQueries({ queryKey: ["clients-assignable"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const unassign = async (clientId: string) => {
    try {
      await assignFn({ data: { clientId, coachId: null } });
      toast.success("Client unassigned");
      qc.invalidateQueries({ queryKey: ["clients-assignable"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const changeStatus = async (status: string) => {
    try {
      await statusFn({ data: { coachId: id, status: status as any } });
      toast.success("Status updated");
      qc.invalidateQueries({ queryKey: ["coach", id] });
      qc.invalidateQueries({ queryKey: ["coaches"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  if (!coach) return <div className="p-8 text-sm text-muted-foreground">Loading coach…</div>;

  const onPicUploaded = async (storagePath: string) => {
    const { error } = await supabase
      .from("coaches")
      .update({ profile_picture_url: storagePath })
      .eq("id", id);
    if (error) return toast.error(error.message);
    // Also mirror to profiles.avatar_url so the coach sees it in their own sidebar.
    if (coach.user_id) {
      await supabase.from("profiles").update({ avatar_url: storagePath }).eq("id", coach.user_id);
    }
    setEditingPic(false);
    toast.success("Profile picture updated");
    qc.invalidateQueries({ queryKey: ["coach", id] });
  };

  const removePic = async () => {
    if (!coach.profile_picture_url) return;
    if (!confirm("Remove this coach's profile picture?")) return;
    const path = coach.profile_picture_url;
    const { error } = await supabase
      .from("coaches")
      .update({ profile_picture_url: null })
      .eq("id", id);
    if (error) return toast.error(error.message);
    if (coach.user_id) {
      await supabase.from("profiles").update({ avatar_url: null }).eq("id", coach.user_id);
    }
    await supabase.storage.from("avatars").remove([path]).catch(() => {});
    toast.success("Removed");
    qc.invalidateQueries({ queryKey: ["coach", id] });
  };

  return (
    <>
      <PageHeader
        backTo="/admin/coaches"
        backLabel="Back to Coaches"
        breadcrumbs={[{ label: "Coaches", to: "/admin/coaches" }, { label: coach.full_name }]}
        title={
          <span className="flex items-center gap-3">
            <UserAvatar src={coach.profile_picture_url} name={coach.full_name} size={44} ring />
            <span>{coach.full_name}</span>
          </span>
        }
        subtitle={coach.email}
        actions={
          <Link to="/admin/coaches"><Button variant="outline" size="sm"><ArrowLeft className="mr-2 h-3 w-3" />All coaches</Button></Link>
        }
      />
      <div className="grid gap-4 p-6 md:grid-cols-3 md:p-8">
        <Card className="p-5">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Profile</h3>
          <div className="mt-3 flex items-center gap-3">
            <UserAvatar src={coach.profile_picture_url} name={coach.full_name} size={56} ring />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditingPic((v) => !v)}>
                <Camera className="mr-1.5 h-3 w-3" />
                {coach.profile_picture_url ? "Replace" : "Upload"}
              </Button>
              {coach.profile_picture_url && (
                <Button size="sm" variant="ghost" onClick={removePic} className="text-destructive hover:text-destructive">
                  <Trash2 className="mr-1.5 h-3 w-3" /> Remove
                </Button>
              )}
            </div>
          </div>
          {editingPic && coach.user_id && (
            <div className="mt-3 space-y-2 rounded-lg border border-border bg-secondary/30 p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold">Upload new picture</div>
                <Button size="sm" variant="ghost" onClick={() => setEditingPic(false)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <ProfilePictureCapture
                userId={coach.user_id}
                currentUrl={coach.profile_picture_url}
                onUploaded={onPicUploaded}
                allowFileUpload
                mode="admin"
                hidePreviewThumbnail
              />
            </div>
          )}
          {editingPic && !coach.user_id && (
            <p className="mt-3 text-xs text-muted-foreground">
              Coach hasn't accepted the invite yet — they can upload their own picture once signed in.
            </p>
          )}
          <div className="mt-4 space-y-2 text-sm">
            <div><span className="text-muted-foreground">Name: </span>{coach.full_name}</div>
            <div><span className="text-muted-foreground">Email: </span>{coach.email}</div>
            {coach.phone ? <div><span className="text-muted-foreground">Phone: </span>{coach.phone}</div> : null}
            <div><span className="text-muted-foreground">Started: </span>{coach.start_date ?? "—"}</div>
            <div><span className="text-muted-foreground">Last login: </span>{coach.last_login_at ? new Date(coach.last_login_at).toLocaleString() : "—"}</div>
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Status</h3>
          <div className="mt-3">
            <Badge variant="outline">{coach.status}</Badge>
          </div>
          <div className="mt-3">
            <Select value={coach.status} onValueChange={changeStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Active", "Inactive", "Pending Invite", "Suspended", "Archived"].map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Workload</h3>
          <div className="mt-3 flex gap-4">
            <div><div className="text-2xl font-black">{assigned.length}</div><div className="text-xs uppercase text-muted-foreground">Clients</div></div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 p-6 md:grid-cols-2 md:p-8">
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-bold">Assigned clients ({assigned.length})</h3>
          {assigned.length === 0 ? (
            <p className="text-xs text-muted-foreground">No clients assigned to this coach yet.</p>
          ) : (
            <ul className="space-y-2">
              {assigned.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-md border border-border p-2">
                <div className="flex items-center gap-2 min-w-0">
                  <UserAvatar src={(c as any).profile_picture_url} name={c.full_name} size={32} />
                  <div className="min-w-0">
                    <Link to="/admin/clients/$id" params={{ id: c.id }} className="text-sm font-semibold hover:underline truncate block">{c.full_name}</Link>
                    <div className="text-[11px] text-muted-foreground truncate">{c.email}</div>
                  </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => unassign(c.id)}>
                    <UserMinus className="mr-1 h-3 w-3" />Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 text-sm font-bold">Assign clients</h3>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search clients…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <ul className="space-y-2 max-h-96 overflow-auto">
            {filteredOther.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-md border border-border p-2">
                <div className="flex items-center gap-2 min-w-0">
                  <UserAvatar src={(c as any).profile_picture_url} name={c.full_name} size={32} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{c.full_name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {c.email}{c.assigned_coach_id ? " · currently assigned to another coach" : ""}
                    </div>
                  </div>
                </div>
                <Button size="sm" onClick={() => assign(c.id)}>
                  <UserPlus className="mr-1 h-3 w-3" />Assign
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}