# Athlete Intelligence

How information about an athlete that lives outside the app gets into competition
preparation: their own coach's program and logs, meet results, attempt plans,
warm-ups, cues and notes, as spreadsheets, PDFs, Word files, screenshots, footage
or typed notes. Built Nov 26 2026 for athletes coached by someone else (a handled
athlete whose program is written by their own coach), and used the same way for
the coach's own clients.

## Where it lives

- **Coach**: the client's Competition tab → Athlete Intelligence card
  (`src/components/athlete-intel/athlete-intel-card.tsx`). Add information opens
  `AddInfoSheet`: drop, paste or pick files, or type notes; who it's from; what
  it's for (detected unless picked); optional context; the rights tick; Upload &
  analyze. Under it: the one question that matters (if any), key findings,
  recommendations for an approved gameplan, and the files with their status.
- **Contributor** (the athlete's own coach, or the athlete): `/share/<token>`
  (`src/routes/share.$token.tsx`), no account. Created from the sheet; offered
  for their coach only when the athlete said their coach may be contacted
  (`competition_handling.share_with_coach = 'yes'`).

## The pipeline

1. **Upload** (`startUploadFn` → server-signed URL → `finishUploadFn`). Files go
   to the private `athlete-intel` bucket under the client's folder. Sheets, Word
   and text are also read on the phone and their text sent with them, so most
   files never need the original downloaded again. A file already on file (same
   SHA-256) isn't read twice.
2. **Read** (`runIntelTick`, the `athlete-intel-tick` hook; woken by the queue
   trigger, pg_cron catches the rest). Code first (`readSource`: tables with
   prescribed / actual columns, set shorthand, dates, openers, warm-ups, racks,
   cues, pain, bodyweight, meets). AI only for what code can't place
   (`needsAiRead`), on route `athlete_intel` (OpenAI key only), in the background,
   and only with the athlete's AI permission. The model only copies;
   `readAiAnswer` keeps what's written in the source.
3. **Store** (`storeFacts`). Deduped by `dedupeKey`; a repeat is credited to both
   uploads (`also_sources`). Every slot's current answer is worked out again from
   every live source (`recompute` → `resolveFacts`).
4. **Re-evaluate** (`afterChange`): every upcoming meet's live read
   (`refreshLive`), then questions (`syncQuestions`). The file's summary says
   what it moved.

## Rules that matter

- A written set is never assumed done: `completed`, `prescribed` or `unknown`.
- A competition lift is kept apart from its variations; high bar is unclear.
- A number the source doesn't contain never becomes a fact. Instructions inside
  an upload are data, never followed.
- A provider read from inside a file never makes an attempt plan "their coach's".
- An approved gameplan is never changed; differences are recommendations the
  coach approves into a new draft version.
- Corrections keep the original (restorable); a replaced file keeps its old
  version; a deleted one waits 30 days.
- Nothing contacts anyone by itself. Asking the athlete is a chat message on the
  coach's tap; asking their coach is a link the coach sends.

## When it asks

Default: nothing. `decideQuestions` raises a question only when the answer could
change an attempt, safety or a meet logistic, nothing on file settles it, both
answers lead somewhere different, and the meet is close enough:

| Question | Raised when | Window |
| --- | --- | --- |
| Which attempt plan is current | two plans nothing tells apart | 6 weeks out |
| Their answer vs their coach's opener | they differ by an increment | 6 weeks out |
| Rack settings | two disagree | 2 weeks out |
| Is the pain still there | recent pain on a competition lift | 4 weeks out |
| Were these sets done | they'd be the best evidence and attempts aren't set | 10 weeks out |
| kg or lb | same, and nothing on file says | 10 weeks out |
| When did week 1 start | undated completed work is the only evidence | 8 weeks out |
| Was the prescribed single done | it would be the heaviest recent evidence | 6 weeks out |

One is shown at a time. An answer is applied as facts so the condition is gone;
a skip holds until what prompted it changes. Only a question for a meet within a
week pushes the handler.

## Downstream

| Engine | What it takes |
| --- | --- |
| Forecast strength line | completed competition-standard sets (`strengthRows`) |
| Meet record | uploaded meets (`meetRows`) |
| Bodyweight | a weigh-in in the last 3 weeks |
| Watch list | current pain (`currentRisks`) |
| Gameplan draft | attempts, warm-ups (% from the opener), racks, gear, cues, instructions (`gameplanIntel`) |
| Cleo's competition calls | numbered evidence `U-*` (`intelEvidence`) |
| Client brief | findings and notes (`intelText`) |

## Tests

- `src/test/athlete-intel.test.ts`: reader, grounding, resolution, question
  policy (zero questions when sufficient or nonessential, no repeats, windows,
  contact rules), engine inputs, gameplan, brief evidence.
- `src/test/athlete-intel-worker.test.ts`: the real worker on an in-memory
  database (`src/test/helpers/fake-supabase.ts`): a log read, duplicates merged,
  a conflict asked once and answered, a material single asked once, notes kept,
  AI permission waiting, deletion.
