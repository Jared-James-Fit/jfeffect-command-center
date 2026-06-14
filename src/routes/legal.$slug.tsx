import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { getPublicLegalDocument } from "@/lib/legal.functions";
import { ArrowLeft, ShieldAlert, FileText } from "lucide-react";

export const Route = createFileRoute("/legal/$slug")({
  loader: async ({ params }) => {
    const doc = await getPublicLegalDocument({ data: { slug: params.slug } });
    if (!doc) throw notFound();
    return { doc };
  },
  head: ({ loaderData }) => {
    const title = loaderData?.doc?.title ?? "Legal";
    const desc = loaderData?.doc?.version?.summary ?? "Legal document";
    return {
      meta: [
        { title: `${title} — JF Effect` },
        { name: "description", content: desc },
        { property: "og:title", content: `${title} — JF Effect` },
        { property: "og:description", content: desc },
        { name: "robots", content: "index,follow" },
      ],
    };
  },
  errorComponent: ({ reset }) => (
    <div className="mx-auto max-w-2xl px-4 py-12 text-center">
      <p className="text-sm text-muted-foreground">Could not load this document.</p>
      <button className="mt-3 text-sm underline" onClick={reset}>Try again</button>
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-2xl px-4 py-12 text-center">
      <h1 className="text-xl font-semibold">Document not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">This legal document is not published or is not publicly available.</p>
      <Link to="/" className="mt-4 inline-block text-sm underline">Back to home</Link>
    </div>
  ),
  component: PublicLegalPage,
});

function PublicLegalPage() {
  const { doc } = Route.useLoaderData();
  const v = doc.version;
  const isMembershipTerms = doc.slug === "membership-agreement";
  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <Link to="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Back to JF Effect
      </Link>
      <header className="mt-4 border-b border-border pb-4">
        <h1 className="text-2xl font-semibold">{doc.title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Version {v.version_number}
          {v.effective_date ? ` · Effective ${new Date(v.effective_date).toLocaleDateString()}` : ""}
          {v.published_at ? ` · Published ${new Date(v.published_at).toLocaleDateString()}` : ""}
        </p>
        {v.summary ? <p className="mt-2 text-sm text-muted-foreground">{v.summary}</p> : null}
        {v.needs_legal_review ? (
          <div className="mt-3 inline-flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>This document is a starter template and still requires professional legal review.</span>
          </div>
        ) : null}
      </header>
      {isMembershipTerms ? (
        <aside className="mt-4 rounded-md border border-border bg-muted/30 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            JF Membership Terms include
          </div>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            <li>
              <Link
                to="/legal/$slug"
                params={{ slug: "membership-agreement" }}
                className="inline-flex items-center gap-2 text-sm font-medium text-foreground hover:underline"
              >
                <FileText className="h-4 w-4" /> JF Membership Agreement (this page)
              </Link>
            </li>
            <li>
              <Link
                to="/legal/$slug"
                params={{ slug: "terms-of-service" }}
                className="inline-flex items-center gap-2 text-sm font-medium text-foreground hover:underline"
              >
                <FileText className="h-4 w-4" /> Terms of Service
              </Link>
            </li>
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Both documents apply to your JF Effect membership.
          </p>
        </aside>
      ) : null}
      <div
        className="prose prose-sm dark:prose-invert mt-6 max-w-none whitespace-pre-wrap"
        // Body is plain text/markdown stored server-side; rendered as preformatted
        // text to avoid HTML injection. Markdown rendering can be layered on later.
      >{v.body}</div>
      {isMembershipTerms ? (
        <div className="mt-8 border-t border-border pt-4 text-sm">
          <Link
            to="/legal/$slug"
            params={{ slug: "terms-of-service" }}
            className="font-medium underline underline-offset-2 hover:text-foreground"
          >
            Read the Terms of Service →
          </Link>
        </div>
      ) : null}
    </article>
  );
}