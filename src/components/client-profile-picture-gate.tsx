import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { ProfilePictureCapture } from "@/components/profile-picture-capture";
import { Card } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { useClientImpersonation } from "@/lib/client-impersonation";

/**
 * Blocks the client portal until a real-time profile picture has been captured.
 * Also re-blocks when admin marks the picture as needing an update.
 */
export function ClientProfilePictureGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { isImpersonating } = useClientImpersonation();

  // Admin in client-POV mode bypasses the gate — they're inspecting, not setting up.
  if (isImpersonating) return <>{children}</>;

  const { data: client, isLoading } = useQuery({
    queryKey: ["my-client-picture-gate", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, profile_picture_url, profile_picture_needs_update, profile_picture_needs_update_reason")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // No client record (admin/coach viewing portal) — skip the gate.
  if (!user || isLoading || !client) return <>{children}</>;

  const missing = !client.profile_picture_url;
  const needsUpdate = !!client.profile_picture_needs_update;
  if (!missing && !needsUpdate) return <>{children}</>;

  const handleUploaded = async (path: string) => {
    await supabase
      .from("clients")
      .update({
        profile_picture_url: path,
        profile_picture_updated_at: new Date().toISOString(),
        profile_picture_updated_by: "client",
        profile_picture_source: "camera",
        profile_picture_needs_update: false,
        profile_picture_needs_update_at: null,
        profile_picture_needs_update_reason: null,
      })
      .eq("id", client.id);
    qc.invalidateQueries({ queryKey: ["my-client-picture-gate"] });
    qc.invalidateQueries({ queryKey: ["my-client-account"] });
    qc.invalidateQueries({ queryKey: ["my-client"] });
  };

  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-6">
      <Card className="w-full max-w-md border-border bg-card p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/15 text-primary">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-black tracking-tight">
              {missing ? "Profile picture required" : "Please update your profile picture"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {missing
                ? "Please take a clear headshot to finish your account setup."
                : client.profile_picture_needs_update_reason ||
                  "Coach Jared asked you to take a new headshot."}
            </p>
          </div>
        </div>
        <ProfilePictureCapture
          mode="client"
          userId={user.id}
          currentUrl={client.profile_picture_url}
          onUploaded={handleUploaded}
        />
        <p className="text-[11px] text-muted-foreground">
          Use good lighting. Face the camera. Make sure your face is visible.
        </p>
      </Card>
    </div>
  );
}