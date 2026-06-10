## What you'll get

A single **+** button in every chat composer (1:1 client messenger, group chats, coach-internal DMs) opens a menu with:

- **Form request** — pick a Native Form, sends to that client (or every client in a group). The bubble shows their name and a live chip: *Sent → Opened → Submitted*.
- **Signature request** — pick an agreement template, sends via SignNow. Chip: *Sent → Opened → Signed → Verified*.
- **Recipe** — pick a recipe, grants access, drops a recipe card in chat.
- **Client action request** — your existing "Action Needed" composer, now reachable from the same menu.

In group chats the request fans out: every client member gets their own assignment/agreement/access, and the bubble shows a roll-up ("3 of 5 submitted") that expands to per-client status.

## How it works

```text
[+]──▶ Form request   ─▶ pick form    ─▶ assign to client(s)  ─▶ chat card (live)
       Signature      ─▶ pick template─▶ create agreement     ─▶ chat card (live)
       Recipe         ─▶ pick recipe  ─▶ grant access         ─▶ chat card
       Action request ─▶ existing composer prefilled w/ client
```

The card itself is just a new chat attachment `kind`, so it flows through your existing message + realtime pipeline.

## Build steps

1. **Shared attachment kinds** — extend `SharedAttachment` in `src/components/chat-shared.tsx` with `kind: "form_request" | "signature_request" | "recipe_share"` and the IDs they need (form_id / assignment_ids, agreement_id(s), recipe_id, target_client_ids, sender_role).
2. **Send menu component** — new `src/components/chat-send-menu.tsx` (the **+** button + dropdown). Three picker dialogs:
   - `FormRequestPicker` — lists `nf_forms` (active, not archived) with search.
   - `SignatureRequestPicker` — lists `agreement_templates`.
   - `RecipePicker` — lists `recipes` you can share.
3. **Server functions** in new `src/lib/chat-requests.functions.ts` (auth-gated to coach/admin):
   - `sendFormRequest({ form_id, client_ids })` → upserts `nf_assignments`, returns assignment IDs.
   - `sendSignatureRequest({ template_id, client_ids })` → creates draft `agreements` rows + kicks off SignNow via existing `signnow.server.ts` helper.
   - `sendRecipeShare({ recipe_id, client_ids })` → inserts `recipe_client_access` (sets `access_scope='selected_clients'` if needed).
   Each returns the IDs needed for the chat attachment payload.
4. **Wire into composers** — `message-thread.tsx` (1:1) and `group-message-thread.tsx` (group). Group chat resolves "client members" via `chat_group_members` → `clients.user_id`; non-client members are skipped with a toast count.
5. **Status cards + live updates** — render in `chat-shared.tsx`'s `AttachmentView`:
   - `FormRequestCard` — subscribes to `nf_submissions` for its assignment IDs; chip Sent/Opened/Submitted; click opens form (client) or submission (coach).
   - `SignatureRequestCard` — subscribes to `agreements` row(s); chip Sent/Opened/Signed/Verified; click opens signing URL or PDF.
   - `RecipeShareCard` — recipe thumb, title, "Open recipe" CTA.
   - Group roll-up: "n of m" + expandable list of `{client name, status}`.
6. **Coach-to-coach DMs** — same menu shows up; "Recipe" and the three request types still work because target picker lets you choose any client (not just chat participants) when the conversation isn't with a client.
7. **Permissions** — RLS already gates `nf_assignments`, `agreements`, `recipe_client_access`. The new server fns use `requireSupabaseAuth` + `has_role('admin'|'coach')` check before writing. No new tables, no migration needed.

## Technical notes

- No DB migration: reuses `nf_forms`/`nf_assignments`/`nf_submissions`, `agreement_templates`/`agreements`, `recipes`/`recipe_client_access`, and the existing `messages.attachments` JSONB.
- Realtime: subscribe per visible card via `supabase.channel('chat-req:'+id).on('postgres_changes', { table: 'nf_submissions' | 'agreements', filter: 'id=in.(...)' })`. Unsubscribe on unmount.
- SignNow send reuses `src/lib/signnow.server.ts` (already configured); no new secrets.
- For group fan-out we store the full `client_ids[]` and `assignment_ids[]` on the attachment so the card can render the roll-up without re-querying chat membership.
- "Client name & info" tracking: form/agreement records already carry `client_id`; the card shows `clients.full_name` resolved via a small `useQuery` keyed on the ID list.

## Out of scope (say the word if you want them)

- A separate "Requests Sent" inbox view (per-coach dashboard of every request sent from chat).
- SMS / email nudge when a request goes unanswered for N days.
- Re-send / cancel actions on the chat card (would just call the same server fn).
