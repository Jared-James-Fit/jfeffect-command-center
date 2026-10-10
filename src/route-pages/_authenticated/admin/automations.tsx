import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bell, CalendarClock, Cake, ChevronRight, ClipboardList, CreditCard, Lock, Mail, Megaphone,
  MessageSquare, MessagesSquare, Smartphone, Sparkles, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { updateSmsSettings } from "@/lib/sms.functions";
import { smsSender } from "@/lib/sms-identity";
import { useSeriesAction, useSeriesOverview } from "@/lib/community.queries";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const db = supabase as any;
const TRIGGER_WHEN: Record<string, string> = {
  account_created: "When a new app account is made",
  subscription_purchased: "When someone buys a membership",
  subscription_cancelled: "When a membership is cancelled",
  subscription_trial_ending: "A few days before a trial ends",
  subscription_grace_warning: "When access is about to end over a failed payment",
  subscription_payment_recovered: "When a failed payment goes through",
  subscription_payment_failed: "When a payment fails",
  subscription_ended: "When a membership ends",
  subscription_restarted: "When a membership restarts",
  email_change_requested: "When someone asks to change their email",
};

type RowProps = {
  icon: React.ElementType;
  tone: string;
  title: string;
  when: string;
  /** Switch state; omit for rows that are on/off per client. */
  on?: boolean;
  onToggle?: (next: boolean) => void;
  /** Shown instead of a switch. */
  note?: string;
  to: string;
  hash?: string;
  search?: Record<string, unknown>;
  locked?: boolean;
};

function Row({ icon: Icon, tone, title, when, on, onToggle, note, to, hash, search, locked }: RowProps) {
  return (
    <div className="flex items-center gap-3 px-3 py-3 md:px-4">
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", tone)}><Icon className="h-4 w-4" /></span>
      <Link to={to as any} hash={hash} search={search as any} className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 text-sm font-semibold leading-tight">{title}</span>
          {on !== undefined && (
            <span className={cn("shrink-0 rounded px-1.5 text-[10px] font-bold leading-4", on ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
              {on ? "ON" : "OFF"}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{when}</div>
        {note && <div className="mt-0.5 text-[11px] font-medium text-foreground/60">{note}</div>}
      </Link>
      {on !== undefined && onToggle && (
        locked
          ? <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Admin only" />
          : <Switch checked={on} onCheckedChange={onToggle} aria-label={`Turn ${title} ${on ? "off" : "on"}`} />
      )}
      <Link to={to as any} hash={hash} search={search as any} aria-label={`Edit ${title}`}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary">
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="px-1">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground/80">{hint}</p>
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">{children}</div>
    </section>
  );
}

/**
 * Settings → Automations: every message, post and text the app sends on its own, in one
 * list. Flip a switch to stop one; tap it to change the wording.
 */
export function AutomationsHub() {
  const qc = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const saveSms = useServerFn(updateSmsSettings);
  const series = useSeriesOverview(true);
  const seriesAction = useSeriesAction();

  const { data } = useQuery({
    queryKey: ["automations-hub"],
    queryFn: async () => {
      const [sms, autos, checkin, nutrition, email] = await Promise.all([
        db.from("sms_settings").select("enabled, brand_name, default_coach_name, reminder_steps, from_phone").eq("singleton", true).maybeSingle(),
        db.from("sms_automations").select("*").order("created_at", { ascending: true }),
        db.from("coach_task_definitions").select("id, enabled").eq("task_type", "weekly_checkin").maybeSingle(),
        db.from("nf_forms").select("active").eq("id", "b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d").maybeSingle(),
        db.from("membership_onboarding_email_settings").select("enabled").limit(1).maybeSingle(),
      ]);
      return {
        sms: sms.data as any,
        autos: (autos.data ?? []) as any[],
        checkin: checkin.data as { id: string; enabled: boolean } | null,
        nutritionOn: nutrition.data?.active ?? null,
        emailOn: email.data?.enabled ?? null,
      };
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["automations-hub"] });
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast.success(ok); } catch (e: any) { toast.error(e?.message ?? "Couldn't change that"); }
    finally { refresh(); }
  };

  const sms = data?.sms;
  const smsOn = !!sms?.enabled && !!sms?.from_phone;
  const steps: Array<{ delay_minutes: number; enabled: boolean; template: string }> = Array.isArray(sms?.reminder_steps) ? sms.reminder_steps : [];
  const unreadOn = steps.some((s) => s.enabled);
  const smsNote = !sms?.enabled ? "Paused — all texts are off" : !sms?.from_phone ? "Needs a Twilio number" : undefined;

  return (
    <>
      <SettingsTabs />
      <div className="mx-auto max-w-3xl space-y-6 p-4 pb-32 md:p-6">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-black tracking-tight"><Zap className="h-5 w-5 text-primary" />Automations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything the app sends on its own. Flip a switch to stop one. Tap it to change what it says.
          </p>
          {!isAdmin && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" /> Only an admin can switch these on or off.
            </p>
          )}
        </div>

        <Section title="Texts (SMS)" hint={`Every text introduces itself as "${smsSender(sms?.default_coach_name, sms?.brand_name)}" — using each client's own coach.`}>
          <Row icon={MessageSquare} tone="bg-sky-500/15 text-sky-500" title="All texts" to="/admin/settings/sms"
            when="Master switch. Off pauses every text below." note={smsNote}
            on={!!sms?.enabled} locked={!isAdmin}
            onToggle={(v) => run(() => saveSms({ data: { enabled: v } }), v ? "Texts are on" : "All texts paused")} />
          <Row icon={Sparkles} tone="bg-primary/15 text-primary" title="Who texts are from" to="/admin/settings/sms"
            when={`"Hi Alex, this is ${smsSender(sms?.default_coach_name, sms?.brand_name)}…" — change the business or fallback coach name.`} />
          <Row icon={Bell} tone="bg-sky-500/15 text-sky-500" title="Unread message reminder" to="/admin/settings/sms"
            when={`Texts a client when they haven't read your message (${steps.filter((s) => s.enabled).map((s) => `${Math.round(s.delay_minutes / 60)}h`).join(" + ") || "no steps"}). 9am–8pm their time, max 1 a day.`}
            note={smsOn ? undefined : smsNote}
            on={unreadOn} locked={!isAdmin}
            onToggle={(v) => run(() => saveSms({ data: { reminder_steps: steps.map((s) => ({ ...s, enabled: v })) } }), v ? "Unread reminders on" : "Unread reminders off")} />
          <Row icon={CalendarClock} tone="bg-sky-500/15 text-sky-500" title="Session reminder" to="/admin/calendar"
            when="Evening before a PT session, plus a text if it's moved or cancelled last minute." note="On per session (in the session editor)" />
          <Row icon={CreditCard} tone="bg-sky-500/15 text-sky-500" title="Payment setup text" to="/admin/clients"
            when="One text ~3 days after a payment link if they still haven't set up payment." note="Pause per sale from the client's Sales tab" />
          {(data?.autos ?? []).map((a) => (
            <Row key={a.id} icon={Zap} tone="bg-sky-500/15 text-sky-500" title={a.name.replace(/\s*\(draft\)\s*$/i, "")} to="/admin/settings/sms"
              when={TRIGGER_WHEN[a.trigger_type] ?? a.trigger_type}
              on={!!a.active} locked={!isAdmin}
              onToggle={(v) => run(async () => {
                const { error } = await db.from("sms_automations").update({ active: v }).eq("id", a.id);
                if (error) throw error;
              }, v ? "Automation on" : "Automation off")} />
          ))}
        </Section>

        <Section title="In-app messages" hint="Sent into the client's chat as you.">
          <Row icon={ClipboardList} tone="bg-violet-500/15 text-violet-500" title="Weekly check-in request" to="/admin/coaching" search={{ tab: "schedules" }}
            when="Sends the check-in form on each client's check-in day. Change day/time per client in Schedules."
            on={data?.checkin ? !!data.checkin.enabled : undefined} locked={!isAdmin}
            onToggle={data?.checkin ? (v) => run(async () => {
              const { error } = await db.from("coach_task_definitions").update({ enabled: v }).eq("id", data.checkin!.id);
              if (error) throw error;
            }, v ? "Check-in requests on" : "Check-in requests off") : undefined} />
          <Row icon={ClipboardList} tone="bg-violet-500/15 text-violet-500" title="Monthly nutrition update" to="/admin/forms" search={{ tab: "builder" }}
            when="Last week of the month, 9am their time — clients with an active nutrition plan."
            note={data?.nutritionOn === false ? "Off — the form is switched off" : "Turn off by switching the form off in Forms"} />
          <Row icon={CreditCard} tone="bg-violet-500/15 text-violet-500" title="Payment setup reminders" to="/admin/clients"
            when="Chat reminders on day 1, 6 and 12 after a payment link until they pay." note="Pause per sale from the client's Sales tab" />
          <Row icon={Cake} tone="bg-violet-500/15 text-violet-500" title="Birthday message" to="/admin/community" hash="tab=birthdays"
            when="Drafted the night before. Nothing sends until you approve it." note="You approve each one" />
        </Section>

        <Section title="Community posts" hint="Posted to the community feed as you.">
          <Row icon={Megaphone} tone="bg-amber-500/15 text-amber-500" title="Daily posts" to="/admin/community" hash="tab=daily"
            when="Mon Motivation · Tue Tips · Wed Wins · Thu Try-it · Fri Finish Strong · Sat Spirit · Sun Recap."
            on={series.data ? !series.data.paused : undefined}
            onToggle={(v) => seriesAction.mutate({ kind: "pause", paused: !v }, {
              onSuccess: () => toast.success(v ? "Daily posts back on" : "Daily posts paused"),
              onError: (e: any) => toast.error(e?.message ?? "Couldn't change that"),
            })} />
          <Row icon={Cake} tone="bg-amber-500/15 text-amber-500" title="Birthday post" to="/admin/community" hash="tab=birthdays"
            when="A birthday shout-out at 8am their time, after you approve the draft." note="You approve each one" />
        </Section>

        <Section title="Popups, email & push" hint="Everything else that reaches clients on its own.">
          <Row icon={Smartphone} tone="bg-emerald-500/15 text-emerald-500" title="Popups" to="/admin/popups"
            when="Events, birthday cards, install prompt and setup gates." />
          <Row icon={Mail} tone="bg-emerald-500/15 text-emerald-500" title="Membership welcome email" to="/admin/membership/onboarding-email"
            when="Emailed when someone buys a membership." on={data?.emailOn ?? undefined} />
          <Row icon={MessagesSquare} tone="bg-emerald-500/15 text-emerald-500" title="Push notifications" to="/notifications"
            when="Morning game plan, monthly recap, new messages and reviews." note="Each person picks theirs in their notification settings" />
        </Section>
      </div>
    </>
  );
}
