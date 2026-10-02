from pathlib import Path
import re

path = Path("src/components/workout-day/WorkoutDayView.tsx")
text = path.read_text()

# Already patched: make this script idempotent for the follow-up build triggered by its commit.
if "const preferenceKey = exId ? `exercise:${exId}` : rowKey;" in text:
    raise SystemExit(0)

replacements = [
    (
        "() => Array.from(new Set((rows as any[]).map((r) => r.exercises?.id).filter(Boolean) as string[])),",
        "() => Array.from(new Set((rows as any[]).map((r) => r.exercises?.id ?? r.exercise_id).filter(Boolean) as string[])),",
    ),
    (
        "      const exId = r.exercises?.id;\n      const rowKey = `row:${r.id}`;\n      // Per-row override only — two cards with the same exerciseId (e.g.\n      // a primary + secondary backoff of the same lift) must toggle\n      // independently. The persisted client/member preference (saved by\n      // exerciseId) still seeds future workouts via resolveExerciseUnit.\n      const local = unitOverrides[rowKey];",
        "      const exId = r.exercises?.id ?? r.exercise_id ?? null;\n      const rowKey = `row:${r.id}`;\n      // Unit choice belongs to the canonical exercise, not the program row.\n      // Repeated cards for the same exercise switch together immediately.\n      const preferenceKey = exId ? `exercise:${exId}` : rowKey;\n      const local = unitOverrides[preferenceKey];",
    ),
    (
        "onUnitChange={(u) => setExerciseUnit(r.exercises?.id ?? null, r.id, u)}",
        "onUnitChange={(u) => setExerciseUnit(r.exercises?.id ?? r.exercise_id ?? null, r.id, u)}",
    ),
]

for old, new in replacements:
    if old not in text:
        raise SystemExit(f"Expected unit-sync patch target not found: {old[:100]}")
    text = text.replace(old, new)

pattern = re.compile(
    r"  const setExerciseUnit = async \(exerciseId: string \| null, rowId: string, next: WUnit\) => \{.*?\n  \};\n\n  const unitForRow",
    re.S,
)
replacement = '''  const setExerciseUnit = async (exerciseId: string | null, rowId: string, next: WUnit) => {
    const rowKey = `row:${rowId}`;
    const key = exerciseId ? `exercise:${exerciseId}` : rowKey;
    const previousOverride = unitOverrides[key];
    const prevUnit = resolvedUnitMap[rowKey] ?? unit;

    // One optimistic override per exercise so top sets/backoffs stay in sync.
    setUnitOverrides((m) => ({ ...m, [key]: next }));

    if (client?.id && exerciseId) {
      try {
        if (adapter) await adapter.saveExerciseUnitPref({ exerciseId, unit: next });
        else await saveExerciseUnitPref(client.id, exerciseId, next);
      } catch {
        setUnitOverrides((m) => {
          const copy = { ...m };
          if (previousOverride === "kg" || previousOverride === "lb") copy[key] = previousOverride;
          else delete copy[key];
          return copy;
        });
        toast.error("Could not save the exercise unit — try again");
        return;
      }
      await qc.invalidateQueries({ queryKey: ["client-exercise-unit-prefs"] });
    }

    undo.push({
      label: `Set exercise unit to ${next.toUpperCase()}`,
      coalesceKey: `ex-unit:${key}`,
      undo: async () => {
        setUnitOverrides((m) => ({ ...m, [key]: prevUnit }));
        if (client?.id && exerciseId) {
          try {
            if (adapter) await adapter.saveExerciseUnitPref({ exerciseId, unit: prevUnit });
            else await saveExerciseUnitPref(client.id, exerciseId, prevUnit);
            await qc.invalidateQueries({ queryKey: ["client-exercise-unit-prefs"] });
          } catch {
            toast.error("Could not restore the previous exercise unit");
          }
        }
      },
    });
  };

  const unitForRow'''
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f"Expected exactly one setExerciseUnit block; patched {count}")

path.write_text(text)
