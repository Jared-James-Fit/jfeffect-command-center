/**
 * A lifter's competition profile (competition-profile.ts): the weight class
 * they compete in and the age classes they enter. The same editor for the
 * athlete (Account → Competition) and their coach (Training → Athlete setup);
 * every tap saves, and every powerlifting form starts from what's here.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { PREVIEW_ONLY_MESSAGE } from "@/lib/community";
import { seasonYear } from "@/lib/form-prefill";
import {
  AGE_CLASS_KEYS,
  ageClassLabelOf,
  allowedAgeKeys,
  profileSummary,
  sortAgeKeys,
  weightClassesFor,
  weightClassLabel,
  type CompetitionProfile,
} from "@/lib/competition-profile";

export const competitionProfileKey = (clientId: string) => ["competition-profile", clientId] as const;

type Row = { weight_class: string | null; age_classes: string[] | null; source: "form" | "client" | "coach" | null; updated_at: string | null };

/** Their competition profile, or null when nothing's on file. */
export function useCompetitionProfile(clientId: string | null | undefined) {
  return useQuery({
    queryKey: competitionProfileKey(clientId ?? ""),
    enabled: !!clientId,
    queryFn: async (): Promise<CompetitionProfile | null> => {
      const { data } = await (supabase as any)
        .from("athlete_competition_profiles")
        .select("weight_class, age_classes, source, updated_at")
        .eq("client_id", clientId)
        .maybeSingle();
      const r = data as Row | null;
      return r ? { weightClass: r.weight_class, ageClasses: r.age_classes ?? [], source: r.source, updatedAt: r.updated_at } : null;
    },
  });
}

/**
 * Whether competing is part of their picture, so the profile only shows where it means something:
 * anything on file, a meet prep, a competition plan, or a goal or style that's powerlifting.
 */
export function useCompetes(clientId: string | null | undefined) {
  const { data: profile } = useCompetitionProfile(clientId);
  const { data: other } = useQuery({
    queryKey: ["competes", clientId],
    enabled: !!clientId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const db = supabase as any;
      const [preps, goals, plans] = await Promise.all([
        db.from("pl_preps").select("id").eq("client_id", clientId).limit(1),
        db.from("client_goals_setup").select("main_goal, training_styles").eq("client_id", clientId).maybeSingle(),
        // staff only (a client reads none): the competition form sent before
        db.from("athlete_competition_plans").select("id").eq("client_id", clientId).limit(1),
      ]);
      const g = goals?.data as { main_goal?: string | null; training_styles?: unknown } | null;
      const styles = Array.isArray(g?.training_styles) ? (g!.training_styles as unknown[]).join(" ") : String(g?.training_styles ?? "");
      return (preps?.data ?? []).length > 0 || (plans?.data ?? []).length > 0 || /powerlift|compet|meet/i.test(`${g?.main_goal ?? ""} ${styles}`);
    },
  });
  return !!profile || !!other;
}

export { profileSummary };

/** "Updated from their form, Nov 17" in the viewer's words. */
function updatedLine(p: CompetitionProfile | null | undefined, as: "client" | "coach"): string | null {
  if (!p?.updatedAt) return null;
  const when = new Date(p.updatedAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  const who =
    p.source === "form"
      ? as === "client" ? "from a form you sent" : "from a form they sent"
      : p.source === "coach"
        ? as === "client" ? "by your coach" : "by you or another coach"
        : as === "client" ? "by you" : "by them";
  return `Updated ${who}, ${when}`;
}

const chip = (on: boolean) =>
  cn(
    "inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3.5 text-[15px] font-medium transition-colors active:scale-[0.97] disabled:opacity-60",
    on ? "border-foreground bg-foreground text-background" : "border-border bg-background text-foreground",
  );

export function CompetitionProfileEditor({ clientId, as, preview = false }: { clientId: string; as: "client" | "coach"; preview?: boolean }) {
  const qc = useQueryClient();
  const { data: profile, isLoading } = useCompetitionProfile(clientId);
  const { data: person } = useQuery({
    queryKey: ["competition-profile-person", clientId],
    queryFn: async () => (await (supabase as any).from("clients").select("sex, date_of_birth").eq("id", clientId).maybeSingle()).data as { sex: string | null; date_of_birth: string | null } | null,
  });
  const [cls, setCls] = useState<string | null>(null);
  const [ages, setAges] = useState<string[]>([]);
  const [shownSex, setShownSex] = useState<"male" | "female">("male");
  useEffect(() => {
    setCls(profile?.weightClass ?? null);
    setAges(profile?.ageClasses ?? []);
  }, [profile?.weightClass, profile?.ageClasses]);
  const sex = String(person?.sex ?? "").toLowerCase();
  const knownSex: "male" | "female" | null = sex.startsWith("m") ? "male" : sex.startsWith("f") || sex.startsWith("w") ? "female" : null;
  useEffect(() => {
    if (knownSex) setShownSex(knownSex);
    else if (cls) setShownSex(weightClassLabel(cls)?.startsWith("Women") ? "female" : "male");
  }, [knownSex, cls]);

  const season = seasonYear();
  const allowed = allowedAgeKeys(person?.date_of_birth, season);
  const junior = allowed.some((k) => k === "junior" || k === "sub-junior") || !person?.date_of_birth;
  const classes = weightClassesFor(shownSex, junior);
  const ageChoices = allowed.length ? allowed : [...AGE_CLASS_KEYS];

  const save = async (next: { weight_class?: string | null; age_classes?: string[] }) => {
    if (preview) return void toast(PREVIEW_ONLY_MESSAGE);
    const { error } = await (supabase as any)
      .from("athlete_competition_profiles")
      .upsert({ client_id: clientId, source: as, weight_class: cls, age_classes: ages, ...next }, { onConflict: "client_id" });
    if (error) {
      toast.error("Couldn't save: " + error.message);
      void qc.invalidateQueries({ queryKey: competitionProfileKey(clientId) });
      return;
    }
    void qc.invalidateQueries({ queryKey: competitionProfileKey(clientId) });
    void qc.invalidateQueries({ queryKey: ["form-prefill-profile"] });
  };
  const pickClass = (c: string) => {
    const next = cls === c ? null : c;
    setCls(next);
    void save({ weight_class: next });
  };
  const toggleAge = (k: string) => {
    const next = sortAgeKeys(ages.includes(k) ? ages.filter((x) => x !== k) : [...ages, k]);
    setAges(next);
    void save({ age_classes: next });
  };

  if (isLoading) return <div className="h-40 animate-pulse rounded-xl bg-muted" aria-hidden />;
  const updated = updatedLine(profile, as);
  return (
    <div className="space-y-5" data-competition-profile>
      <section>
        <h4 className="text-[15px] font-semibold">Weight class</h4>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {as === "client" ? "The class you compete in. Forms start from it, and you can change it on any form." : "The class they compete in. Their forms start from it."}
        </p>
        {!knownSex && (
          <div className="mt-2.5 inline-flex rounded-full border border-border p-0.5" role="radiogroup" aria-label="Classes">
            {(["male", "female"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={shownSex === s}
                onClick={() => setShownSex(s)}
                className={cn("h-9 rounded-full px-4 text-[14px] font-medium", shownSex === s ? "bg-secondary text-foreground" : "text-muted-foreground")}
              >
                {s === "male" ? "Men" : "Women"}
              </button>
            ))}
          </div>
        )}
        <div className="mt-2.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Weight class">
          {classes.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={cls === c} className={chip(cls === c)} onClick={() => pickClass(c)} data-weight-class={c}>
              {c.replace("+", "")} kg{c.endsWith("+") ? "+" : ""}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h4 className="text-[15px] font-semibold">Age classes</h4>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {allowed.length
            ? `${as === "client" ? "Your" : "Their"} birth year allows ${allowed.map(ageClassLabelOf).join(" and ")} in ${season}. Pick every one ${as === "client" ? "you" : "they"} enter.`
            : `Pick every class ${as === "client" ? "you" : "they"} enter.`}
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2" role="group" aria-label="Age classes">
          {ageChoices.map((k) => {
            const on = ages.includes(k);
            return (
              <button key={k} type="button" role="checkbox" aria-checked={on} className={chip(on)} onClick={() => toggleAge(k)} data-age-class={k}>
                {on && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />}
                {ageClassLabelOf(k)}
              </button>
            );
          })}
        </div>
      </section>

      {updated && <p className="text-[12px] text-muted-foreground" data-competition-updated>{updated}</p>}
    </div>
  );
}
