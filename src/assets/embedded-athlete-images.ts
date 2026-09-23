import j0 from "./embedded/jared-0";
import j1 from "./embedded/jared-1";
import j2 from "./embedded/jared-2";
import j3 from "./embedded/jared-3";
import j4 from "./embedded/jared-4";
import p0 from "./embedded/phillip-0";
import p1 from "./embedded/phillip-1";
import p2 from "./embedded/phillip-2";
import d0 from "./embedded/dwayne-0";
import d1 from "./embedded/dwayne-1";
import f0 from "./embedded/frederick-0";
import f1 from "./embedded/frederick-1";
import e0 from "./embedded/elisa-0";
import e1 from "./embedded/elisa-1";

const webp = (value: string) => `data:image/webp;base64,${value}`;

export const jaredHeroImage = webp(j0 + j1 + j2 + j3 + j4);
export const phillipAthleteImage = webp(p0 + p1 + p2);
export const dwayneAthleteImage = webp(d0 + d1);
export const frederickAthleteImage = webp(f0 + f1);
export const elisaAthleteImage = webp(e0 + e1);
