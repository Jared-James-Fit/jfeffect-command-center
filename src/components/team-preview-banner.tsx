import { useNavigate } from "@tanstack/react-router";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { stopTeamPreview } from "@/lib/team-preview";

/**
 * While the owner views as a team member: an amber frame around the screen
 * (you are not in your own view) and a banner that names who, says changes
 * are off, and gets you back to the Team list in one tap.
 */
export function TeamPreviewBanner() {
  const { preview } = useAuth();
  const navigate = useNavigate();
  if (!preview) return null;

  const exit = () => {
    stopTeamPreview();
    navigate({ to: "/admin/clients", search: { kind: "team" } as any });
  };

  return (
    <>
      <div
        aria-hidden
        data-team-preview-frame
        className="pointer-events-none fixed inset-0 z-[70]"
        style={{ boxShadow: "inset 0 0 0 3px rgb(245 158 11), inset 0 0 28px 2px rgb(245 158 11 / 0.22)" }}
      />
      <div role="status" className="sticky top-0 z-50 flex items-center gap-2.5 border-b border-amber-500/40 bg-amber-100 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100 md:px-6">
        <Eye className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 leading-tight">
          <strong className="block truncate">Viewing as {preview.name}</strong>
          <span className="block truncate text-xs opacity-80">Finance view. Changes are off.</span>
        </span>
        <Button size="sm" className="h-9 shrink-0 bg-amber-600 px-4 text-white hover:bg-amber-700" onClick={exit}>
          Exit
        </Button>
      </div>
    </>
  );
}
