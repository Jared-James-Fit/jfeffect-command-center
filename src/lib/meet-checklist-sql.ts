/**
 * The seed migration for the Meet Day checklist, written from
 * meet-checklist-template.ts (scripts/forms/write-meet-checklist-migration.ts).
 * Never hand-edit the migration: meet-checklist.test.ts compares the two.
 * Fixed ids and ON CONFLICT DO NOTHING, so a coach's later edits are never
 * overwritten and running it twice adds nothing.
 */
import { MEET_CHECKLIST_TEMPLATE, type TemplateForm } from "@/lib/meet-checklist-template";

export const MEET_CHECKLIST_MIGRATION = "supabase/migrations/20270401091000_meet_day_checklist.sql";

const lit = (s: string | null) => (s == null ? "null" : `'${s.replace(/'/g, "''")}'`);
const json = (v: unknown) => `${lit(JSON.stringify(v))}::jsonb`;

function formSql(f: TemplateForm): string {
  const head = `insert into public.nf_forms (id, title, description, form_type, recurrence, active, archived, kind, visibility, button_label, requires_client_identity, category, is_template, allow_updates, settings)
values (
  ${lit(f.id)},
  ${lit(f.title)},
  ${lit(f.description)},
  ${lit(f.form_type)},
  'none',
  true,
  false,
  'native',
  'selected',
  ${lit(f.button_label)},
  true,
  ${lit(f.category)},
  true,
  ${f.allow_updates},
  ${json(f.settings)}
)
on conflict (id) do nothing;`;
  const rows = f.questions.map(
    (q, i) =>
      `  (${lit(q.id)}, ${lit(f.id)}, ${i}, ${lit(q.question_type)}, ${lit(q.label)}, ${lit(q.help_text)}, ${q.required}, ${json(q.options)}, ${json(q.validation)}, ${json(q.conditional_logic)})`,
  );
  const qs = `insert into public.nf_questions (id, form_id, order_index, question_type, label, help_text, required, options, validation, conditional_logic)
values
${rows.join(",\n")}
on conflict (id) do nothing;`;
  return `${head}\n\n${qs}`;
}

export function meetChecklistSql(): string {
  return `-- GENERATED from src/lib/meet-checklist-template.ts by
-- scripts/forms/write-meet-checklist-migration.ts. Do not edit by hand:
-- src/test/meet-checklist.test.ts fails when the two disagree.
--
-- Meet Day — Final Preparation Checklist: a template in the coach's form
-- library (category Powerlifting & Competitions), editable in the form
-- builder like any form. Checklist questions (Ready / Still need / N/A by
-- item, each item critical, important or optional), readiness by area for
-- the coach (form-checklist.ts, meet-checklist.ts) and updates after it's
-- sent (allow_updates, every change kept in nf_answer_history).

${formSql(MEET_CHECKLIST_TEMPLATE)}

-- Meet-day reminders (meet-checklist-reminders.server.ts): once a day at 9:11
-- in Winnipeg (14:11 UTC; Manitoba is a fixed UTC-5 from Nov 1, 2026). A push
-- to the athlete two weeks out if they haven't started, and two days and one
-- day out while something critical or important is still open; each one once.
-- Free (push only, never a text). The coach turns them off per send or per form.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'meet-checklist-reminders';
  perform cron.schedule(
    'meet-checklist-reminders',
    '11 14 * * *',
    $cmd$
    select net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/meet-checklist-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    ) as request_id;
    $cmd$
  );
exception
  when undefined_table or undefined_function or invalid_schema_name then
    null;
end
$$;
`;
}
