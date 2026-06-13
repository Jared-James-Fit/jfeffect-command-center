import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyLegalStatus } from "@/lib/legal.functions";
import { ShieldAlert } from "lucide-react";
import { Link } from "@tanstack/react-router";

/**
 * Contextual legal/disclaimer notice. Shows a lightweight inline notice
 * tied to a specific document slug (e.g. "medical-injury-disclaimer").
 *
 * Designed to be subtle — used inline above injury forms, nutrition
 * workflows, AI-assisted messages, upload fields, etc. Never a blocking
 * banner unless the caller wraps it in their own gate.
 */
export function LegalNotice({
  slug,
  tone = "info",
  className = "",
  fallback,
}: {
  slug: string;
  tone?: "info" | "warn";
  className?: string;
  fallback?: string;
}) {
  const fn = useServerFn(listMyLegalStatus);
  const { data } = useQuery({
    queryKey: ["legal-status"],
    queryFn: () => fn(),
    staleTime: 5 * 60 * 1000,
  });
  const doc = data?.find((d: any) => d.slug === slug);
  if (!doc && !fallback) return null;
  const text = doc?.version?.summary ?? fallback ?? "";
  if (!text) return null;

  const toneCls =
    tone === "warn"
      ? "border-amber-500/40 bg-amber-500/5 text-amber-900 dark:text-amber-200"
      : "border-border bg-muted/30 text-muted-foreground";

  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${toneCls} ${className}`}>
      <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0 opacity-70" />
      <div className="flex-1">
        <span>{text}</span>{" "}
        {doc && (
          <Link to="/portal/account" hash="legal" className="underline underline-offset-2 hover:text-foreground">
            Read full {doc.title}
          </Link>
        )}
      </div>
    </div>
  );
}

/** Subtle "Prepared with AI assistance and reviewed by your coach." label. */
export function AiAssistanceLabel({ reviewed = true, className = "" }: { reviewed?: boolean; className?: string }) {
  if (!reviewed) {
    return (
      <span className={`text-[10px] uppercase tracking-wider text-muted-foreground/70 ${className}`}>
        Prepared with AI assistance
      </span>
    );
  }
  return (
    <span className={`text-[10px] uppercase tracking-wider text-muted-foreground/70 ${className}`}>
      Prepared with AI assistance · Reviewed by your coach
    </span>
  );
}