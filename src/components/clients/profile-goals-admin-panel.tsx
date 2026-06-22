import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Clock, User, Phone, Mail, MapPin, Calendar, Dumbbell, Apple } from "lucide-react";
import { GoalsSummaryCard } from "@/components/client-goals/GoalsSummaryCard";
import { getAdminClientProfileAndGoalsFn } from "@/lib/profile-goals.functions";
import { isBasicInfoComplete, calcAge, formatHeight, REQUIRED_BASIC_INFO_FIELDS } from "@/lib/basic-info";
import { isGoalsSetupComplete } from "@/lib/client-goals/schema";

function ProfileStatusBadge({ client, goals }: { client: any; goals: any }) {
  const basicOk = isBasicInfoComplete(client);
  const goalsOk = isGoalsSetupComplete(goals);
  const needsReview = client?.info_update_requested;

  if (needsReview) {
    return (
      <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400">
        <Clock className="h-3 w-3" /> Needs Review
      </Badge>
    );
  }
  if (!basicOk || !goalsOk) {
    return (
      <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400">
        <AlertTriangle className="h-3 w-3" /> Information Missing
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="h-3 w-3" /> Profile Complete
    </Badge>
  );
}

function MissingFieldsList({ client, goals }: { client: any; goals: any }) {
  const missing: string[] = [];

  for (const f of REQUIRED_BASIC_INFO_FIELDS) {
    const v = client?.[f];
    if (!v || String(v).trim() === "") {
      const labels: Record<string, string> = {
        first_name: "First name", last_name: "Last name", phone: "Phone",
        date_of_birth: "Date of birth", height_cm: "Height", address: "Address",
        city: "City", country: "Country", timezone: "Timezone",
        emergency_contact_name: "Emergency contact name",
        emergency_contact_phone: "Emergency contact phone",
      };
      missing.push(labels[f] ?? f);
    }
  }

  if (!goals?.main_goal) missing.push("Primary goal");
  if (!goals?.training_days_per_week) missing.push("Training days per week");
  if (!goals?.training_experience) missing.push("Training experience");
  if (!goals?.training_location) missing.push("Training location");
  if (!goals?.nutrition_goal) missing.push("Nutrition goal");

  if (missing.length === 0) return null;
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
        <AlertTriangle className="h-3 w-3" /> Missing information
      </div>
      <div className="flex flex-wrap gap-1">
        {missing.map((f) => (
          <span key={f} className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">{f}</span>
        ))}
      </div>
    </div>
  );
}

function BasicInfoSummary({ client, coach }: { client: any; coach: any }) {
  const age = calcAge(client?.date_of_birth);
  const height = formatHeight(client?.height_cm, client?.preferred_height_unit ?? "imperial");
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <User className="h-3.5 w-3.5" /> Basic Information
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <InfoRow label="Full name" value={client?.full_name} />
        <InfoRow label="Preferred name" value={client?.preferred_name} />
        <InfoRow label="Email" value={client?.email} icon={<Mail className="h-3 w-3" />} />
        <InfoRow label="Phone" value={client?.phone} icon={<Phone className="h-3 w-3" />} />
        <InfoRow label="Date of birth" value={client?.date_of_birth ? `${new Date(client.date_of_birth + "T00:00:00").toLocaleDateString()} (age ${age ?? "?"})` : null} icon={<Calendar className="h-3 w-3" />} />
        <InfoRow label="Height" value={height !== "—" ? height : null} />
        <InfoRow label="Timezone" value={client?.timezone} />
        <InfoRow
          label="Location"
          value={[client?.city, client?.province, client?.country].filter(Boolean).join(", ") || null}
          icon={<MapPin className="h-3 w-3" />}
        />
        <InfoRow label="Emergency contact" value={client?.emergency_contact_name} />
        <InfoRow label="Emergency phone" value={client?.emergency_contact_phone} icon={<Phone className="h-3 w-3" />} />
      </div>
      {client?.info_last_updated_at && (
        <p className="text-[10px] text-muted-foreground">
          Last updated: {new Date(client.info_last_updated_at).toLocaleDateString()}
          {client.info_last_updated_by ? ` by ${client.info_last_updated_by}` : ""}
        </p>
      )}
    </Card>
  );
}

function CoachingSetupSummary({ client, coach }: { client: any; coach: any }) {
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Dumbbell className="h-3.5 w-3.5" /> Coaching Setup
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <InfoRow label="Assigned coach" value={coach?.full_name ?? (client?.assigned_coach_id ? "Assigned (loading)" : null)} />
        <InfoRow label="Coaching type" value={client?.coaching_type} />
        <InfoRow label="Coaching package" value={client?.coaching_package} />
        <InfoRow label="Start date" value={client?.start_date ? new Date(client.start_date).toLocaleDateString() : null} icon={<Calendar className="h-3 w-3" />} />
        <InfoRow label="Status" value={client?.status} />
        <InfoRow label="Account status" value={client?.account_status} />
        {(client?.bodyweight_goal_value != null) && (
          <InfoRow
            label="Bodyweight goal"
            value={`${client.bodyweight_goal_value} ${client.bodyweight_goal_unit ?? "lb"}`}
          />
        )}
        {client?.goals && <InfoRow label="Additional goals" value={client.goals} />}
      </div>
    </Card>
  );
}

function InfoRow({ label, value, icon }: { label: string; value: string | null | undefined; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1 text-sm">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        {value ? value : <span className="text-amber-600 dark:text-amber-400 text-xs">Missing</span>}
      </span>
    </div>
  );
}

export function ProfileGoalsAdminPanel({ clientId }: { clientId: string }) {
  const fn = useServerFn(getAdminClientProfileAndGoalsFn);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-profile-goals", clientId],
    queryFn: () => fn({ data: { clientId } }),
    staleTime: 2 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  const { client, goals, coach } = data ?? {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ProfileStatusBadge client={client} goals={goals} />
        <span className="text-xs text-muted-foreground">
          Profile &amp; Goals overview — use the Personal Info and Goals &amp; Intake tabs for editing.
        </span>
      </div>

      <MissingFieldsList client={client} goals={goals} />

      <BasicInfoSummary client={client} coach={coach} />

      <GoalsSummaryCard clientId={clientId} />

      <CoachingSetupSummary client={client} coach={coach} />
    </div>
  );
}
