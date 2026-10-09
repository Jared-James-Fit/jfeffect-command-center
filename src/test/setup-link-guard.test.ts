import { describe, it, expect } from "vitest";
import { findAuthUserByEmail, assertNotPrivilegedUser, assertInviteRoleRedeemable } from "@/lib/setup-link-guard.server";

function fakeAdmin(opts: { users?: Array<{ id: string; email: string }>; roles?: Record<string, string[]> }) {
  const users = opts.users ?? [];
  const roles = opts.roles ?? {};
  return {
    auth: {
      admin: {
        listUsers: async ({ page, perPage }: { page: number; perPage: number }) => ({
          data: { users: users.slice((page - 1) * perPage, page * perPage) },
          error: null,
        }),
      },
    },
    from: () => {
      let userIds: string[] = [];
      const q: any = {
        select: () => q,
        in: (col: string, v: string[]) => {
          if (col === "user_id") { userIds = v; return q; }
          const data = userIds.flatMap((id) => (roles[id] ?? []).filter((r) => v.includes(r)).map((role) => ({ user_id: id, role })));
          return Promise.resolve({ data, error: null });
        },
      };
      return q;
    },
  };
}

describe("findAuthUserByEmail", () => {
  it("finds a user past the first page of auth users", async () => {
    const users = Array.from({ length: 1500 }, (_, i) => ({ id: `u${i}`, email: `user${i}@example.com` }));
    const found = await findAuthUserByEmail(fakeAdmin({ users }), "USER1234@example.com");
    expect(found).toEqual({ id: "u1234" });
  });

  it("returns null when nobody has that email", async () => {
    const found = await findAuthUserByEmail(fakeAdmin({ users: [{ id: "a", email: "a@example.com" }] }), "b@example.com");
    expect(found).toBeNull();
  });
});

describe("assertNotPrivilegedUser", () => {
  it("refuses every staff account", async () => {
    const admin = fakeAdmin({ roles: { owner: ["admin", "client"], coach1: ["coach"], mm: ["media_manager"], books: ["finance"] } });
    for (const id of ["owner", "coach1", "mm", "books"]) {
      await expect(assertNotPrivilegedUser(admin, id)).rejects.toThrow(/staff account/);
    }
  });

  it("allows client and member accounts", async () => {
    const admin = fakeAdmin({ roles: { member1: ["client"] } });
    await expect(assertNotPrivilegedUser(admin, "member1")).resolves.toBeUndefined();
  });
});

describe("assertInviteRoleRedeemable", () => {
  it("allows the media_manager and finance invite roles", () => {
    expect(() => assertInviteRoleRedeemable("media_manager")).not.toThrow();
    expect(() => assertInviteRoleRedeemable("finance")).not.toThrow();
  });

  it("refuses admin, coach and any role not meant for invite links", () => {
    for (const role of ["admin", "coach", "client", "", null, undefined]) {
      expect(() => assertInviteRoleRedeemable(role as any)).toThrow(/can't be redeemed/);
    }
  });
});
