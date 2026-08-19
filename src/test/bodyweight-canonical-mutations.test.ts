import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

import { deleteBodyweight, logBodyweight, updateBodyweight } from "@/lib/progress";

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { id: "entry-1" }, error: null });
});

describe("canonical bodyweight mutations", () => {
  it("saves through the per-user/date RPC instead of a direct insert", async () => {
    await logBodyweight({
      user_id: "user-1",
      weight_value: 182.4,
      weight_unit: "lb",
      logged_date: "2026-08-19",
      note: "Morning",
    });

    expect(rpc).toHaveBeenCalledWith("save_progress_bodyweight", {
      p_user_id: "user-1",
      p_weight_value: 182.4,
      p_weight_unit: "lb",
      p_logged_date: "2026-08-19",
      p_note: "Morning",
      p_entry_id: null,
    });
  });

  it("edits the selected row by its existing ID without issuing a new-row save", async () => {
    await updateBodyweight("user-1", "entry-9", {
      weight_value: 82.7,
      weight_unit: "kg",
      logged_date: "2026-08-18",
      note: null,
    });

    expect(rpc).toHaveBeenCalledWith("save_progress_bodyweight", {
      p_user_id: "user-1",
      p_weight_value: 82.7,
      p_weight_unit: "kg",
      p_logged_date: "2026-08-18",
      p_note: null,
      p_entry_id: "entry-9",
    });
  });

  it("deletes only the selected canonical row through the owner-scoped RPC", async () => {
    await deleteBodyweight("user-1", "entry-3");

    expect(rpc).toHaveBeenCalledWith("delete_progress_bodyweight", {
      p_user_id: "user-1",
      p_entry_id: "entry-3",
    });
  });

  it("rejects invalid decimal input before making a persistence request", async () => {
    await expect(
      logBodyweight({
        user_id: "user-1",
        weight_value: Number.NaN,
        weight_unit: "lb",
        logged_date: "2026-08-19",
      }),
    ).rejects.toThrow("Enter a valid bodyweight.");

    expect(rpc).not.toHaveBeenCalled();
  });
});
