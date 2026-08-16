/**
 * Registry of the public website forms that feed the coaching application
 * pipeline. These are real routes in this app — the registry only describes
 * them so the admin Forms workspace can show status, the page they are used
 * on, and open/preview/test links. No second form platform is introduced.
 */
export type WebsiteForm = {
  id: string;
  name: string;
  /** Public route this form is used on. */
  path: string;
  /** Marketing `from` token appended when testing. */
  from: string;
  description: string;
  active: boolean;
};

export const WEBSITE_FORMS: WebsiteForm[] = [
  {
    id: "quick-apply-coaching",
    name: "Quick Apply — Online Coaching",
    path: "/coaching/apply",
    from: "coaching",
    description: "Primary online coaching application. Feeds the Applications inbox and CRM.",
    active: true,
  },
  {
    id: "quick-apply-selkirk",
    name: "Quick Apply — Selkirk Personal Training",
    path: "/personal-trainer-selkirk/apply",
    from: "selkirk",
    description: "In-person Selkirk PT application. Same pipeline, different source label.",
    active: true,
  },
];

/** Live URL for a website form, with an optional test marker. */
export function websiteFormUrl(form: WebsiteForm, opts: { test?: boolean } = {}) {
  const params = new URLSearchParams({ from: form.from });
  if (opts.test) params.set("test", "1");
  return `${form.path}?${params.toString()}`;
}
