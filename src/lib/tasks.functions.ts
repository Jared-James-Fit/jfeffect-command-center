/**
 * Telling someone a team task was shared with them. The caller names the
 * tasks and who was just added; the server re-reads the tasks as the caller
 * (so only tasks they can see), keeps only the people actually on them and
 * sends one push per person. Content-free on the lockscreen (no task titles:
 * they can be private, "Cancel Goodlife membership"), once per task per person.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { firstName, taskPeople } from "@/lib/tasks";

const Input = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(50),
  to: z.array(z.string().uuid()).min(1).max(20),
});

/** The push for one person: what they were given, and where it opens. */
export function taskSharedPush(sender: string, taskIds: string[]) {
  const who = firstName(sender) || "Your team";
  const one = taskIds.length === 1;
  return {
    title: one ? `${who} shared a task with you` : `${who} shared ${taskIds.length} tasks with you`,
    body: one ? "Open Tasks to see it." : "Open Tasks to see them.",
    url: one ? `/admin/content#task=${taskIds[0]}` : "/admin/content",
  };
}

export const notifyTaskSharedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    // Read as the caller: a task they can't see is never announced.
    const { data: rows } = await (supabase as any)
      .from("tasks")
      .select("id, owner_user_id, assigned_to, assignees")
      .in("id", data.taskIds);
    const tasks = ((rows ?? []) as any[]).filter((t) => !t.owner_user_id);
    if (!tasks.length) return { sent: 0 };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendWebPushToUser } = await import("@/lib/push/push.server");
    const { data: me } = await (supabaseAdmin as any).from("profiles").select("full_name").eq("id", userId).maybeSingle();

    let sent = 0;
    for (const uid of new Set(data.to)) {
      if (uid === userId) continue;
      const theirs = tasks.filter((t) => taskPeople(t).includes(uid)).map((t) => String(t.id)).sort();
      if (!theirs.length) continue;
      const push = taskSharedPush(me?.full_name ?? "", theirs);
      const r = await sendWebPushToUser(
        supabaseAdmin as any,
        uid,
        { ...push, tag: `task_shared:${uid}`, data: { kind: "task_shared", taskIds: theirs } },
        {
          category: "reminders",
          eventKey: `task_shared:${theirs.join(",")}:${uid}`,
          rateKey: `task_shared:${userId}:${uid}`,
          rateWindowMinutes: 2,
          priority: "normal",
        },
      );
      sent += r.sent;
    }
    return { sent };
  });
