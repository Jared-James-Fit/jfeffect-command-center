import { createContext } from "react";
import type { BuilderAthlete } from "@/lib/builder-athlete";

/** The athlete a client's block is for (session limit, equipment, pain): null in the template editor. */
export const BuilderAthleteContext = createContext<BuilderAthlete | null>(null);
