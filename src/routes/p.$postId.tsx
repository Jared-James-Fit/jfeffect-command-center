import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { AuthLogo, AuthShell } from "@/components/auth/auth-shell";
import { useAuth } from "@/lib/auth";
import { getViewMode } from "@/lib/view-mode";
import { postLinkTarget } from "@/lib/post-share";
import { shareMeta } from "@/lib/share-meta";

// /p/<id>: a Crew post's link (Copy link, and every app in the share sheet).
// Signed in, it opens the post on your Crew page (the feed decides whether
// you can see it). Signed out, it asks you to sign in or join, and never
// shows the post: crew posts are for the crew.
export const Route = createFileRoute("/p/$postId")({
  component: PostLinkPage,
  head: ({ params }) => ({
    meta: [
      { title: "A post on JF Effect" },
      { name: "robots", content: "noindex" },
      ...shareMeta({
        title: "A post on JF Effect",
        description: "See it in the JF Effect crew. Free to join.",
        path: `/p/${params.postId}`,
      }),
    ],
  }),
});

function PostLinkPage() {
  const { postId } = Route.useParams();
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const signedIn = !loading && !!user;

  useEffect(() => {
    if (!signedIn || !user) return;
    const target = postLinkTarget(postId, role, getViewMode(user.id));
    void navigate({ to: target.to as any, ...(target.hash ? { hash: target.hash } : {}), replace: true });
  }, [signedIn, user, role, postId, navigate]);

  if (loading || signedIn) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background text-muted-foreground" data-post-link-opening>
        <Loader2 className="h-6 w-6 animate-spin" aria-label="Opening the post" />
      </div>
    );
  }

  return (
    <AuthShell>
      <div className="text-center" data-post-link-signed-out>
        <AuthLogo />
        <h1 className="mt-6 text-[26px] font-semibold leading-tight tracking-[-0.02em]">This post is in the JF Effect crew</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">Join free to see it, follow the crew and log your training.</p>
      </div>
      <div className="mt-8 space-y-3">
        <Link to="/join" className="flex h-12 w-full items-center justify-center rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground active:opacity-90">
          Join free
        </Link>
        <Link
          to="/auth"
          search={{ next: `/p/${postId}` } as any}
          className="flex h-12 w-full items-center justify-center rounded-lg border border-border text-[15px] font-semibold active:bg-muted"
        >
          Sign in
        </Link>
      </div>
    </AuthShell>
  );
}
