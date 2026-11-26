/**
 * A specialist's session: who they are, their athletes, the one picked, and
 * the unit they read loads in. The server decides what they see
 * (specialist.functions.ts); this only remembers their choices on the device.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getSpecialistHome,
  type SpecialistAthlete,
  type SpecialistMe,
} from "@/lib/team-access/specialist.functions";

type Ctx = {
  me: SpecialistMe | null;
  athletes: SpecialistAthlete[];
  athlete: SpecialistAthlete | null;
  setAthleteId: (id: string) => void;
  unit: "kg" | "lb";
  setUnit: (u: "kg" | "lb") => void;
  refresh: () => Promise<unknown>;
};

const SpecialistCtx = createContext<Ctx | null>(null);

export const SPECIALIST_HOME_KEY = ["specialist-home"] as const;
const ATHLETE_KEY = "jf-specialist-athlete";
const UNIT_KEY = "jf-specialist-unit";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string) {
  try {
    window.localStorage.setItem(key, v);
  } catch {
    /* private window: the choice lasts the visit */
  }
}

export function useSpecialistHome() {
  const load = useServerFn(getSpecialistHome);
  return useQuery({ queryKey: SPECIALIST_HOME_KEY, queryFn: () => load(), staleTime: 60_000 });
}

export function SpecialistProvider({
  data,
  children,
  refresh,
}: {
  data: { me: SpecialistMe | null; athletes: SpecialistAthlete[] };
  children: ReactNode;
  refresh: () => Promise<unknown>;
}) {
  const [athleteId, setAthleteIdState] = useState<string | null>(() =>
    typeof window === "undefined" ? null : read(ATHLETE_KEY),
  );
  // meets are in kg; a game day coach thinks in kg unless they choose lb
  const [unit, setUnitState] = useState<"kg" | "lb">(() =>
    typeof window !== "undefined" && read(UNIT_KEY) === "lb" ? "lb" : "kg",
  );
  const athlete = useMemo(
    () => data.athletes.find((a) => a.clientId === athleteId) ?? data.athletes[0] ?? null,
    [data.athletes, athleteId],
  );
  useEffect(() => {
    if (athlete && athlete.clientId !== athleteId) setAthleteIdState(athlete.clientId);
  }, [athlete, athleteId]);
  const value: Ctx = {
    me: data.me,
    athletes: data.athletes,
    athlete,
    setAthleteId: (id) => {
      setAthleteIdState(id);
      write(ATHLETE_KEY, id);
    },
    unit,
    setUnit: (u) => {
      setUnitState(u);
      write(UNIT_KEY, u);
    },
    refresh,
  };
  return <SpecialistCtx.Provider value={value}>{children}</SpecialistCtx.Provider>;
}

export function useSpecialist(): Ctx {
  const c = useContext(SpecialistCtx);
  if (!c) throw new Error("useSpecialist outside SpecialistProvider");
  return c;
}

/** kg ↔ lb, one decimal. */
export function inUnit(lb: number, unit: "kg" | "lb"): number {
  return Math.round((unit === "kg" ? lb / 2.2046226218 : lb) * 10) / 10;
}
