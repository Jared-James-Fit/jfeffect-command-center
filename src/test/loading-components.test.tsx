import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, OfflineState, QueryState, UploadProgress, WorkingOn } from "@/components/loading";

const render = (el: React.ReactElement) => renderToStaticMarkup(el);

const query = (over: Record<string, unknown>) => ({
  status: "pending",
  fetchStatus: "fetching",
  data: undefined,
  error: null,
  isFetching: true,
  refetch: async () => ({}) as any,
  ...over,
}) as any;

const list = (rows: string[]) => h("ul", { "data-rows": rows.length }, rows.map((r) => h("li", { key: r }, r)));

describe("a button's work", () => {
  it("is disabled and busy at once (no second submit), its label kept", () => {
    const html = render(h(Button, { loading: true }, "Send payment request"));
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("data-btn-spinner");
    expect(html).toContain("Send payment request");
  });
  it("says what it's doing when asked, and hides its own icon for the spinner", () => {
    const html = render(h(Button, { loading: true, loadingText: "Saving…" }, h("svg", { "data-icon": "" }), "Save"));
    expect(html).toContain("Saving…");
    expect(html).not.toContain(">Save<");
    expect(html).toContain("[&amp;&gt;svg:not([data-btn-spinner])]:hidden");
  });
  it("an icon button keeps a name for screen readers", () => {
    expect(render(h(Button, { loading: true, size: "icon", "aria-label": "Delete" }, h("svg")))).toContain("Working…");
  });
  it("is an ordinary button when it isn't working", () => {
    const html = render(h(Button, null, "Save"));
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain("aria-busy");
    expect(html).not.toContain("data-btn-spinner");
  });
});

describe("a section driven by data", () => {
  const props = (q: any) => ({
    query: q,
    what: "your sales",
    isEmpty: (d: string[]) => d.length === 0,
    empty: h(EmptyState, { title: "No sales yet" }),
    children: (d: string[]) => list(d),
  });
  it("holds its space while the first read runs", () => {
    const html = render(h(QueryState<string[]>, props(query({}))));
    expect(html).toContain('data-load-state="loading"');
    expect(html).toContain("jf-load-reveal");
    expect(html).not.toContain("No sales yet");
  });
  it("says a failure in plain words with Try again, never an empty list", () => {
    const html = render(h(QueryState<string[]>, props(query({ status: "error", fetchStatus: "idle", isFetching: false, error: { code: "42P01", message: 'relation "x" does not exist' } }))));
    expect(html).toContain("Couldn&#x27;t load your sales");
    expect(html).toContain("Try again");
    expect(html).not.toContain("No sales yet");
    expect(html).not.toContain("42P01");
  });
  it("says it's waiting for a connection when it can't even start", () => {
    const html = render(h(QueryState<string[]>, props(query({ fetchStatus: "paused", isFetching: false }))));
    expect(html).toContain("You&#x27;re offline");
    expect(html).not.toContain("No sales yet");
  });
  it("is empty only when the answer is empty", () => {
    const html = render(h(QueryState<string[]>, props(query({ status: "success", fetchStatus: "idle", isFetching: false, data: [] }))));
    expect(html).toContain("No sales yet");
  });
  it("keeps data on screen when a refresh fails, and says so quietly", () => {
    const html = render(h(QueryState<string[]>, props(query({ status: "error", fetchStatus: "idle", isFetching: false, data: ["Package 3"], error: new TypeError("Failed to fetch") }))));
    expect(html).toContain("Package 3");
    expect(html).toContain('data-load-state="refresh-failed"');
    expect(html).toContain("Showing what loaded earlier");
  });
});

describe("the small states", () => {
  it("an error that can't get better offers no Try again", () => {
    const html = render(h(ErrorState, { error: { code: "42501", message: "permission denied" }, onRetry: () => undefined }));
    expect(html).toContain("You don&#x27;t have access to this");
    expect(html).not.toContain("Try again");
  });
  it("offline says it loads by itself", () => {
    expect(render(h(OfflineState, { what: "your plan" }))).toContain("Your plan will load by itself when you&#x27;re back online.");
  });
});

describe("long work, said honestly", () => {
  it("an upload shows its real bytes, never a made-up percent", () => {
    const html = render(h(UploadProgress, { name: "squat.mov", status: "uploading", loaded: 2 * 1024 * 1024, total: 8 * 1024 * 1024 }));
    expect(html).toContain("2.0 MB of 8.0 MB · 25%");
    expect(html).toContain('aria-valuenow="25"');
  });
  it("an upload of unknown size moves a stripe and claims no number", () => {
    const html = render(h(UploadProgress, { name: "plan.pdf", status: "uploading" }));
    expect(html).toContain("jf-indeterminate");
    expect(html).not.toContain("aria-valuenow");
  });
  it("a failed upload says so with Try again", () => {
    const html = render(h(UploadProgress, { name: "plan.pdf", status: "error", error: "Your file didn't upload.", onRetry: () => undefined }));
    expect(html).toContain("Didn&#x27;t upload");
    expect(html).toContain("Try again");
  });
  it("work with no measurable progress says what it's doing and its steps, no percent", () => {
    const html = render(h(WorkingOn, {
      label: "Writing the meal plan",
      steps: [{ label: "Targets", done: true }, { label: "Meal plan", done: false }, { label: "Check", done: false }],
    }));
    expect(html).toContain("Writing the meal plan");
    expect(html).toContain("Targets");
    expect(html).not.toMatch(/\d+%/);
  });
  it("a failed run says so with Try again", () => {
    const html = render(h(WorkingOn, { label: "Writing", failed: true, error: "OpenAI didn't answer.", onRetry: () => undefined }));
    expect(html).toContain("It didn&#x27;t finish");
    expect(html).toContain("OpenAI didn&#x27;t answer.");
    expect(html).toContain("Try again");
  });
});
