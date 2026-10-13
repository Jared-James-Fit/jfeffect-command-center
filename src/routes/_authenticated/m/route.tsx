import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { FullPageLoader } from "@/components/full-page-loader";
import { memberPathToPortal } from "@/lib/member-redirect";

/**
 * JF Membership moved into the portal (one app, the service tier decides the
 * coach's screens). Every /m link (old emails, Stripe returns, bookmarks)
 * lands on the same screen there, query string kept. Only the Fillout
 * completion landing still renders here.
 */
function MemberLayout() {
  const { pathname, searchStr } = useLocation();
  const navigate = useNavigate();
  const target = memberPathToPortal(pathname);
  useEffect(() => {
    if (target) navigate({ href: `${target}${searchStr ?? ""}`, replace: true });
  }, [target, searchStr, navigate]);
  if (target) return <FullPageLoader />;
  return <Outlet />;
}

export const Route = createFileRoute("/_authenticated/m")({ component: MemberLayout });
