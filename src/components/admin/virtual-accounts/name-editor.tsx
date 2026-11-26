import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { placeholderReason } from "@/lib/virtual-accounts/names";
import {
  checkVirtualNameFn,
  suggestVirtualNamesFn,
  type SuggestedName,
} from "@/lib/virtual-accounts/virtual-accounts.functions";

/** An error's own words, else the fallback. */
export function errorWords(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export type NameDraft = {
  first: string;
  last: string;
  /** Who the persona is: picked here, from a suggestion, or read from the pool for a typed name. */
  gender: "f" | "m" | "u" | null;
  origin: string | null;
  /** A free username for the name on screen (from the suggestion or the database's check). */
  username: string | null;
  /** 'generated' while the name on screen is exactly the one the generator gave. */
  source: "generated" | "admin";
  /** Why it can't be saved, or null. */
  problem: string | null;
  checking: boolean;
};

/**
 * A virtual account's name, typed or generated: Suggest asks the database's generator (the same
 * one new accounts and the automatic correction use) for a natural name nobody has, for a woman
 * or a man; anything typed is checked by the database as it's typed (placeholders, members'
 * names, other virtual accounts, famous people), with the same placeholder rule shown at once.
 */
export function useNameDraft({
  userId,
  first,
  last,
  gender,
  suggestOnOpen,
}: {
  userId?: string | null;
  first?: string;
  last?: string;
  gender?: "f" | "m" | "u" | null;
  suggestOnOpen?: boolean;
}) {
  const suggestFn = useServerFn(suggestVirtualNamesFn);
  const checkFn = useServerFn(checkVirtualNameFn);
  const original = useRef({ first: first ?? "", last: last ?? "" });
  const generated = useRef<SuggestedName | null>(null);
  const seq = useRef(0);
  const [draft, setDraft] = useState<NameDraft>({
    first: first ?? "",
    last: last ?? "",
    gender: gender ?? null,
    origin: null,
    username: null,
    source: "admin",
    problem: null,
    checking: false,
  });
  const [want, setWant] = useState<"f" | "m" | null>(
    gender === "f" || gender === "m" ? gender : null,
  );
  const [suggesting, setSuggesting] = useState(false);

  const changed =
    draft.first.trim() !== original.current.first.trim() ||
    draft.last.trim() !== original.current.last.trim();

  async function suggest(g: "f" | "m" | null = want) {
    setSuggesting(true);
    try {
      const [s] = await suggestFn({ data: { count: 1, gender: g, userId: userId ?? null } });
      if (!s) throw new Error("No name came back. Try again.");
      generated.current = s;
      seq.current++;
      setDraft({
        first: s.first_name,
        last: s.last_name,
        gender: s.gender,
        origin: s.origin,
        username: s.username,
        source: "generated",
        problem: null,
        checking: false,
      });
    } finally {
      setSuggesting(false);
    }
  }

  useEffect(() => {
    if (suggestOnOpen) void suggest(want).catch(() => undefined);
    // first open only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Typed names: the placeholder rule at once, the database's full check after a pause.
  useEffect(() => {
    const g = generated.current;
    if (g && draft.first === g.first_name && draft.last === g.last_name) {
      // typed back to exactly the generated name: it's that name again
      setDraft((d) =>
        d.source === "generated" && d.username === g.username
          ? d
          : {
              ...d,
              source: "generated",
              username: g.username,
              origin: g.origin,
              gender: g.gender,
              problem: null,
              checking: false,
            },
      );
      return;
    }
    if (!changed) {
      setDraft((d) => ({ ...d, problem: null, checking: false }));
      return;
    }
    const local =
      placeholderReason(draft.first, draft.last) ?? (draft.last.trim() ? null : "Add a last name");
    const mine = ++seq.current;
    setDraft((d) => ({ ...d, source: "admin", username: null, problem: local, checking: !local }));
    if (local) return;
    const t = setTimeout(() => {
      checkFn({ data: { first: draft.first, last: draft.last, userId: userId ?? null } })
        .then((r) => {
          if (seq.current !== mine) return;
          setDraft((d) => ({
            ...d,
            problem: r.problem,
            username: r.username,
            origin: r.origin,
            gender: want ?? r.gender ?? d.gender,
            checking: false,
          }));
        })
        .catch((e: unknown) => {
          if (seq.current !== mine) return;
          setDraft((d) => ({
            ...d,
            problem: errorWords(e, "Couldn't check that name"),
            checking: false,
          }));
        });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.first, draft.last]);

  return {
    draft,
    changed,
    want,
    suggesting,
    setFirst: (v: string) => setDraft((d) => ({ ...d, first: v.slice(0, 40) })),
    setLast: (v: string) => setDraft((d) => ({ ...d, last: v.slice(0, 40) })),
    setWant: (g: "f" | "m" | null) => {
      setWant(g);
      void suggest(g).catch(() => undefined);
    },
    suggest: () => suggest(want),
    ready: !draft.checking && !draft.problem && !!draft.first.trim() && !!draft.last.trim(),
  };
}

export function NameFields({
  state,
  onError,
}: {
  state: ReturnType<typeof useNameDraft>;
  onError?: (message: string) => void;
}) {
  const { draft, want, suggesting, changed } = state;
  return (
    <div className="space-y-2" data-virtual-name-editor>
      <div className="grid grid-cols-2 gap-2">
        <Input
          value={draft.first}
          onChange={(e) => state.setFirst(e.target.value)}
          placeholder="First name"
          aria-label="First name"
          className="h-11"
          autoComplete="off"
          name="search-virtual-first"
        />
        <Input
          value={draft.last}
          onChange={(e) => state.setLast(e.target.value)}
          placeholder="Last name"
          aria-label="Last name"
          className="h-11"
          autoComplete="off"
          name="search-virtual-last"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex rounded-lg bg-muted p-0.5" role="group" aria-label="Suggest names for">
          {(
            [
              [null, "Anyone"],
              ["f", "Woman"],
              ["m", "Man"],
            ] as const
          ).map(([g, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={want === g}
              disabled={suggesting}
              onClick={() => state.setWant(g)}
              className={cn(
                "min-h-9 rounded-md px-2.5 text-xs font-medium",
                want === g ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          disabled={suggesting}
          onClick={() =>
            state
              .suggest()
              .catch((e: unknown) => onError?.(errorWords(e, "Couldn't suggest a name")))
          }
          data-virtual-suggest
        >
          {suggesting ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-4 w-4" />
          )}
          Suggest a name
        </Button>
      </div>
      <div className="min-h-5 text-xs" aria-live="polite" data-virtual-name-status>
        {draft.checking ? (
          <span className="text-muted-foreground">Checking…</span>
        ) : draft.problem ? (
          <span className="text-warning">{draft.problem}</span>
        ) : changed && draft.username ? (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Check className="h-3.5 w-3.5 text-success" aria-hidden />
            {draft.source === "generated" ? "Generated name" : "Reads as a real name"} · nobody else
            has it · @{draft.username}
          </span>
        ) : null}
      </div>
    </div>
  );
}
