/**
 * Posts "Your new nutrition plan is live" (with the plan card) in the
 * client's coach chat when their plan is published or changed, from the
 * coach who did it. Once per plan version, and a burst of saves posts once
 * (PLAN_MESSAGE_QUIET_MS). Never throws: a plan is live whether or not the
 * message went.
 */
import { splitPlans, type PlanRow } from "@/lib/nutrition-targets/plan-history";
import { PLAN_MESSAGE_KIND, PLAN_MESSAGE_QUIET_MS, planMessageBody, planMessageCard } from "@/lib/nutrition-targets/plan-message";

export async function postPlanMessage(
  sb: any,
  input: { clientId: string; actorUserId?: string | null; now?: number },
): Promise<{ posted: boolean; messageId?: string; reason?: string }> {
  try {
    const now = input.now ?? Date.now();
    const { data: client } = await sb
      .from("clients")
      .select("id, first_name, full_name, user_id, assigned_coach_id")
      .eq("id", input.clientId)
      .maybeSingle();
    if (!client?.user_id) return { posted: false, reason: "no_login" };

    const { data: rows } = await sb
      .from("nutrition_targets")
      .select("*, nutrition_target_days(*)")
      .eq("client_id", input.clientId)
      .order("start_date", { ascending: false });
    const { current, previous } = splitPlans((rows ?? []) as PlanRow[]);
    const plan = current[0];
    if (!plan || plan.visible_to_client === false) return { posted: false, reason: "no_plan" };

    const { data: earlier } = await sb
      .from("messages")
      .select("id, created_at, attachments")
      .eq("client_id", input.clientId)
      .contains("attachments", [{ kind: PLAN_MESSAGE_KIND, target_id: plan.id }])
      .order("created_at", { ascending: false })
      .limit(1);
    const last = earlier?.[0];
    if (last) {
      const card = ((last.attachments ?? []) as any[]).find((a) => a?.kind === PLAN_MESSAGE_KIND);
      if ((card?.version ?? null) === (plan.last_updated_at ?? null)) return { posted: false, reason: "already_sent" };
      if (now - Date.parse(last.created_at) < PLAN_MESSAGE_QUIET_MS) return { posted: false, reason: "recent" };
    }
    const update = last ? "changed" : "new";

    // From the coach who published it, else theirs, else an admin.
    let sender = input.actorUserId ?? null;
    if (!sender && client.assigned_coach_id) {
      const { data: coach } = await sb.from("coaches").select("user_id").eq("id", client.assigned_coach_id).maybeSingle();
      sender = coach?.user_id ?? null;
    }
    if (!sender) {
      const { data: admin } = await sb.from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
      sender = admin?.user_id ?? null;
    }
    if (!sender) return { posted: false, reason: "no_sender" };

    const at = new Date(now).toISOString();
    const { data: msg, error } = await sb
      .from("messages")
      .insert({
        client_id: input.clientId,
        sender_id: sender,
        sender_role: "admin",
        body: planMessageBody(client.first_name || client.full_name, update),
        attachments: [planMessageCard(plan, previous[0] ?? null, update)],
        message_type: "Nutrition",
        is_internal_note: false,
        // automated: it doesn't count as the coach replying (check-ins stay open for review)
        is_automated: true,
        delivery_status: "sent",
        sent_at: at,
        read_by_admin_at: at,
      })
      .select("id")
      .single();
    if (error) return { posted: false, reason: error.message };
    return { posted: true, messageId: msg.id };
  } catch (e: any) {
    return { posted: false, reason: e?.message ?? "failed" };
  }
}
