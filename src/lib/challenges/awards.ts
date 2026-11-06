// Who a prize goes to, as challenge_finalize decides it (kept in step with the
// SQL; awards.test.ts runs the same cases): a prize for place P goes to
// everyone whose tie covers P (rank ≤ P ≤ rank + tied − 1), split equally.

export interface Ranked {
  id: string;
  rank: number;
  division_rank: number;
  division_id: string | null;
}

export interface PrizeLite {
  id: string;
  place: number;
  division_id: string | null;
}

export function awardWinners(rows: Ranked[], prize: PrizeLite): { id: string; share: number }[] {
  const pool = prize.division_id ? rows.filter((r) => r.division_id === prize.division_id) : rows;
  const rankOf = (r: Ranked) => (prize.division_id ? r.division_rank : r.rank);
  const counts = new Map<number, number>();
  for (const r of pool) counts.set(rankOf(r), (counts.get(rankOf(r)) ?? 0) + 1);
  return pool
    .filter((r) => {
      const n = counts.get(rankOf(r)) ?? 1;
      return rankOf(r) <= prize.place && rankOf(r) + n - 1 >= prize.place;
    })
    .map((r) => ({ id: r.id, share: Math.round((1 / (counts.get(rankOf(r)) ?? 1)) * 10000) / 10000 }));
}
