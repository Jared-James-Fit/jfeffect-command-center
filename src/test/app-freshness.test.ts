import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decideOnNewBuild,
  isBusyPath,
  isSafeToReloadPath,
  NEW_VISIT_AWAY_MS,
  RESUME_MIN_AWAY_MS,
} from "@/lib/app-freshness";
import { pageIsBusy } from "@/lib/app-busy";
import { RESUME_NEW_VISIT_MS } from "@/lib/feed-anchor";

const base = {
  live: "b2",
  running: "b1",
  awayMs: RESUME_MIN_AWAY_MS,
  pathname: "/admin/messages",
  unsaved: false,
  alreadyReloadedFor: null,
};

describe("picking up a new publish, quietly (Nov 25 2026)", () => {
  it("does nothing when already on the live build (or in dev)", () => {
    expect(decideOnNewBuild({ ...base, live: "b1" })).toBe("none");
    expect(decideOnNewBuild({ ...base, running: "dev" })).toBe("none");
  });

  it("never asks: anything it can't do now waits for the next quiet moment", () => {
    const answers = new Set<string>();
    for (const pathname of [
      "/admin/clients/1",
      "/portal/workouts/abc",
      "/portal/community",
      "/admin/messages",
    ]) {
      for (const awayMs of [0, 5_000, RESUME_MIN_AWAY_MS, NEW_VISIT_AWAY_MS]) {
        for (const unsaved of [false, true]) {
          for (const hidden of [false, true])
            answers.add(decideOnNewBuild({ ...base, pathname, awayMs, unsaved, hidden }));
        }
      }
    }
    expect([...answers].sort()).toEqual(["reload", "wait"]);
    // the pop-up and its "Update" action are gone
    expect(existsSync("src/components/pwa/pwa-update-toast.tsx")).toBe(false);
    expect(readFileSync("src/routes/__root.tsx", "utf8")).not.toContain("PwaUpdateToast");
    expect(readFileSync("src/lib/pwa/register-sw.ts", "utf8")).not.toContain("applyUpdate");
  });

  it("reopening a list screen after 30 s reloads, as before", () => {
    expect(decideOnNewBuild(base)).toBe("reload");
    expect(decideOnNewBuild({ ...base, pathname: "/portal" })).toBe("reload");
    expect(decideOnNewBuild({ ...base, awayMs: 5_000 })).toBe("wait");
  });

  it("a new visit (30 min away) reloads any calm screen, on reopen or still in the background", () => {
    expect(NEW_VISIT_AWAY_MS).toBe(RESUME_NEW_VISIT_MS);
    const away = { ...base, awayMs: NEW_VISIT_AWAY_MS };
    expect(decideOnNewBuild({ ...away, pathname: "/admin/clients/abc" })).toBe("reload");
    expect(decideOnNewBuild({ ...away, pathname: "/portal/community" })).toBe("reload");
    expect(decideOnNewBuild({ ...away, pathname: "/admin/clients/abc", hidden: true })).toBe(
      "reload",
    );
    // a shorter stretch in the background never reloads (a computer tab you'll come straight back to)
    expect(decideOnNewBuild({ ...base, awayMs: 10 * 60_000, hidden: true })).toBe("wait");
    // a client page after a short reopen keeps its place
    expect(decideOnNewBuild({ ...base, pathname: "/admin/clients/abc", awayMs: 10 * 60_000 })).toBe(
      "wait",
    );
  });

  it("never reloads under someone in the middle of something, however long they were away", () => {
    const away = { ...base, awayMs: 3 * NEW_VISIT_AWAY_MS };
    expect(decideOnNewBuild({ ...away, unsaved: true })).toBe("wait");
    for (const pathname of [
      "/portal/workouts/abc",
      "/portal/check-ins/form-1",
      "/portal/check-in",
      "/portal/programs/new",
      "/portal/programs/import",
      "/portal/nutrition-studio",
      "/admin/blocks/b1",
      "/admin/program-library/t1",
      "/admin/competition/c1",
      "/admin/meetings/s1/present",
      "/admin/client-programs/c1/next-program",
      "/activate",
      "/join",
      "/coaching/apply",
      "/setup",
      "/reset-password",
      "/book/general-call",
      "/b/tok",
      "/autopay/tok",
    ]) {
      expect(isBusyPath(pathname), pathname).toBe(true);
      expect(decideOnNewBuild({ ...away, pathname }), pathname).toBe("wait");
    }
    for (const pathname of [
      "/portal/workouts",
      "/portal/workouts/analytics",
      "/portal/workouts/prs",
      "/admin/clients/abc",
      "/portal/community",
    ]) {
      expect(isBusyPath(pathname), pathname).toBe(false);
    }
  });

  it("never reload-loops on the same build", () => {
    expect(decideOnNewBuild({ ...base, alreadyReloadedFor: "b2" })).toBe("wait");
  });

  it("treats home, messages, inbox and notifications as list screens", () => {
    for (const p of [
      "/",
      "/admin",
      "/m/",
      "/admin/messages",
      "/admin/communication",
      "/notifications",
    ]) {
      expect(isSafeToReloadPath(p)).toBe(true);
    }
    for (const p of ["/portal/workouts/1", "/admin/clients", "/portal/check-in"]) {
      expect(isSafeToReloadPath(p)).toBe(false);
    }
  });

  it("stamps every build and checks from the app root", () => {
    expect(readFileSync("vite.config.ts", "utf8")).toContain(
      "__APP_BUILD_ID__: JSON.stringify(APP_BUILD_ID)",
    );
    expect(readFileSync("src/routes/__root.tsx", "utf8")).toContain("useAppFreshness();");
    expect(readFileSync("src/lib/app-version.functions.ts", "utf8")).toContain("createServerFn");
  });
});

describe("what counts as something in progress on the page", () => {
  // A stand-in page (the tests run without a browser): just the parts pageIsBusy reads.
  type El = {
    role?: string;
    state?: string;
    tag?: string;
    type?: string;
    value?: string;
    editable?: boolean;
    unsaved?: boolean;
  };
  const page = (els: El[], opts: { attrs?: string[]; focused?: El } = {}) => {
    const node = (e: El) => ({
      tagName: (e.tag ?? "DIV").toUpperCase(),
      type: e.type ?? "text",
      value: e.value ?? "",
      readOnly: false,
      disabled: false,
      isContentEditable: !!e.editable,
      textContent: e.value ?? "",
      getAttribute: (n: string) => (n === "data-state" ? (e.state ?? null) : null),
      closest: () => null,
    });
    const body = node({});
    const all = (sel: string) => {
      if (sel.includes("data-unsaved")) return els.filter((e) => e.unsaved).map(node);
      if (sel.includes("role=")) return els.filter((e) => e.role).map(node);
      if (sel === "textarea") return els.filter((e) => e.tag === "textarea").map(node);
      if (sel.includes("contenteditable")) return els.filter((e) => e.editable).map(node);
      return [];
    };
    return {
      body,
      activeElement: opts.focused ? node(opts.focused) : body,
      documentElement: { hasAttribute: (a: string) => (opts.attrs ?? []).includes(a) },
      querySelector: (sel: string) => all(sel)[0] ?? null,
      querySelectorAll: (sel: string) => all(sel),
    } as unknown as Document;
  };

  it("a calm page is calm", () => {
    expect(pageIsBusy(page([{ tag: "input", value: "saved" }, { tag: "textarea" }]))).toBe(false);
    // a closed sheet left in the page doesn't count
    expect(pageIsBusy(page([{ role: "dialog", state: "closed" }]))).toBe(false);
  });

  it("an open sheet, dialog or menu", () => {
    expect(pageIsBusy(page([{ role: "dialog", state: "open" }]))).toBe(true);
    expect(pageIsBusy(page([{ role: "alertdialog" }]))).toBe(true);
  });

  it("typing, or words not sent yet", () => {
    expect(pageIsBusy(page([], { focused: { tag: "input", type: "text" } }))).toBe(true);
    expect(pageIsBusy(page([], { focused: { tag: "input", type: "checkbox" } }))).toBe(false);
    expect(pageIsBusy(page([{ tag: "textarea", value: "half a message" }]))).toBe(true);
    expect(pageIsBusy(page([{ editable: true, value: "a note" }]))).toBe(true);
  });

  it("the camera, a held clip, or a screen marked unsaved", () => {
    expect(pageIsBusy(page([], { attrs: ["data-camera-open"] }))).toBe(true);
    expect(pageIsBusy(page([], { attrs: ["data-clip-held"] }))).toBe(true);
    expect(pageIsBusy(page([{ unsaved: true }]))).toBe(true);
  });
});
