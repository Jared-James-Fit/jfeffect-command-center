/**
 * Conversions: the paths into JF Effect, where people stop, how long it takes, checkouts and
 * onboarding. Each path's steps count the people (or browsers, before there's a login) who reached
 * that step in the period, so it's a picture of the period, not one cohort walked through. The
 * main path, the free app, coaching, ready-to-start checkout and in-app upgrades are separate,
 * because people don't all come the same way.
 */
import { useState } from "react";
import { Definitions, Funnel, IntelSection, Kpi, RankRows } from "@/components/admin/intel/intel-ui";
import { biggestDrop, count, percent, type ConversionsView } from "@/lib/bi/model";
import { pct } from "@/lib/bi/period";
import { Segmented, SinceNote } from "./bi-ui";
import { useBiTab, type TabProps } from "./analytics-page";

type Path = "main" | "free" | "coaching" | "other";

export function ConversionsTab({ range }: TabProps) {
  const q = useBiTab<ConversionsView>("conversions", range);
  const [path, setPath] = useState<Path>("main");
  const v = q.data;
  if (!v) return <div />;
  const m = v.main;
  const steps =
    path === "main"
      ? [
          ...(m.siteVisitors != null ? [{ label: "Website visitors", value: m.siteVisitors }] : []),
          { label: "Saw the landing or coaching page", value: m.landing },
          { label: "Saw pricing", value: m.pricing },
          { label: "Started applying", value: m.started },
          { label: "Sent an application", value: m.submitted },
          { label: "New accounts", value: m.accounts, hint: "all ways in" },
          { label: "Started a checkout", value: m.checkout },
          { label: "Paid for the first time", value: m.paid },
          { label: "Still a client 60 days later", value: m.retained, base: m.retainedBase || undefined, hint: m.retainedBase ? `of ${m.retainedBase} who paid 60+ days ago` : "nobody paid 60+ days ago yet" },
        ]
      : path === "free"
        ? [
            { label: "Saw the landing page", value: v.freePath.landing },
            { label: "Tapped Get the free app", value: v.freePath.cta },
            { label: "Started the application", value: v.freePath.started },
            { label: "Sent it", value: v.freePath.sent },
            { label: "Applications received", value: v.freePath.applications },
            { label: "Approved", value: v.freePath.approved },
            { label: "Activated their account", value: v.freePath.activated },
            { label: "Trained in their first week", value: v.freePath.trainedWeek1 },
          ]
        : path === "coaching"
          ? [
              { label: "Saw the coaching page", value: v.coachingPath.coachingPage },
              { label: "Saw the prices", value: v.coachingPath.pricing },
              { label: "Tapped Apply or a package", value: v.coachingPath.cta },
              { label: "Started the application", value: v.coachingPath.started },
              { label: "Sent it", value: v.coachingPath.sent },
              { label: "Applications received", value: v.coachingPath.applications },
              { label: "Became paying clients", value: v.coachingPath.becameClients },
            ]
          : [
              { label: "Ready-to-start checkouts (applications)", value: v.directCheckout.applications },
              { label: "Paid", value: v.directCheckout.paid },
              { label: "Free members who started an upgrade", value: v.upgrades.started },
              { label: "Upgrades completed", value: v.upgrades.applied },
            ];
  const drop = path === "other" ? null : biggestDrop(steps, 3);
  const k = v.checkouts;
  const startedCk = k.planStarted + k.linksSent;
  const doneCk = k.planCompleted + k.linksPaid;
  const ob = v.onboarding;
  const stepRows = (obj: Record<string, number>) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .map(([key, n]) => ({ key, label: key.replace(/_/g, " "), values: [n] }));
  return (
    <div className="space-y-4">
      <SinceNote>
        The website's steps are recorded since Nov 19 2026 (anonymous, once per browser a day) and visits since {m.visitsSince ? m.visitsSince.slice(0, 10) : "Nov 23 2026"}
        {m.siteVisitors == null ? ", so this period starts at the landing page" : ""}. Accounts, applications, checkouts and payments come from their own records.
      </SinceNote>
      <IntelSection
        title="Paths into JF Effect"
        sub="People reaching each step in this period; the % is against the step before"
        action={
          <Segmented
            label="Path"
            value={path}
            onChange={setPath}
            options={[
              { value: "main", label: "Main" },
              { value: "free", label: "Free app" },
              { value: "coaching", label: "Coaching" },
              { value: "other", label: "Checkout & upgrades" },
            ]}
          />
        }
      >
        <Funnel steps={steps} />
        {drop && drop.keptPct < 100 && (
          <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-[13px]">
            Most are lost between <span className="font-medium">{drop.from}</span> and <span className="font-medium">{drop.to}</span>: {drop.keptPct}% carried on.
          </p>
        )}
      </IntelSection>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="First visit → account" value={v.timing.visitToAccountDays == null ? "–" : `${v.timing.visitToAccountDays} days`} sub={`median of ${v.timing.visitToAccountN} tracked`} />
        <Kpi label="Account → first payment" value={v.timing.accountToPaidDays == null ? "–" : `${v.timing.accountToPaidDays} days`} sub={`median of ${v.timing.accountToPaidN}`} />
        <Kpi label="Application → paying client" value={v.timing.applicationToClientDays == null ? "–" : `${v.timing.applicationToClientDays} days`} sub={`median of ${v.timing.applicationToClientN}`} />
        <Kpi label="Checkouts finished" value={percent(pct(doneCk, startedCk))} sub={`${doneCk} of ${startedCk} (plans ${k.planCompleted}/${k.planStarted}, links ${k.linksPaid}/${k.linksSent})`} tone={startedCk >= 3 && doneCk / startedCk < 0.5 ? "warn" : "neutral"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <IntelSection title="Onboarding" sub="New accounts in this period">
          <Funnel
            steps={[
              { label: "New accounts", value: ob.accounts },
              { label: "Came back another day", value: ob.cameBack },
              { label: "Trained in their first week", value: ob.trainedWeek1, base: ob.accounts || undefined },
              { label: "Active in their second week", value: ob.week2Active, base: ob.week2Base || undefined, hint: `of ${ob.week2Base} two weeks old` },
            ]}
          />
          {ob.members > 0 && <p className="mt-3 text-[12px] text-muted-foreground">Free members who finished setup: {ob.setupDone} of {ob.members}.</p>}
        </IntelSection>
        <IntelSection title="Where applications stop" sub="People reaching each question (the last ones reached are where they left)">
          <h3 className="mb-1 text-[13px] font-medium">Coaching application</h3>
          <RankRows rows={stepRows(v.applySteps)} format={(n) => count(n)} empty="No coaching application steps in this period." />
          <h3 className="mb-1 mt-4 text-[13px] font-medium">Free membership application</h3>
          <RankRows rows={stepRows(v.joinSteps)} format={(n) => count(n)} empty="No membership application steps in this period." />
        </IntelSection>
      </div>
      <Definitions
        items={[
          { term: "A step's count", text: "Distinct people (browsers, before an account) who reached it in the period. A later step can include someone who started before the period." },
          { term: "Saw pricing", text: "The pricing section, the price reveal or the free app's $0 came on screen." },
          { term: "Started a checkout", text: "A plan checkout or a sale's payment link created in the period." },
          { term: "Still a client 60 days later", text: "Of the clients who first paid 60+ days before the period's end, those not ended within 60 days of paying." },
          { term: "Time to convert", text: "Medians: from a browser's first visit to the account made on it, from an account to its first payment, from a coaching application to the first payment." },
        ]}
      />
    </div>
  );
}
