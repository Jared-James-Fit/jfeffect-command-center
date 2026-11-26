/** Copy only unambiguous member intake answers into a reviewable form.
 * Existing canonical values and explicit drafts always win; no writes here. */
const goalMap: Record<string, string> = {
  "Get stronger": "Get stronger", "Lose fat": "Lose body fat", "Build muscle": "Build muscle",
  "General fitness": "Improve general fitness", "Powerlifting meet": "Prepare for a competition",
};
export function memberIntakePrefill(member: { goals_tags?: string[] | null; goals?: string | null } | null): { main_goal?: string } {
  const tags = (member?.goals_tags ?? []).filter(Boolean);
  const goal = tags.length === 1 ? tags[0] : tags.length === 0 ? member?.goals?.trim() : undefined;
  const match = goal && Object.prototype.hasOwnProperty.call(goalMap, goal) ? goalMap[goal] : undefined;
  return match ? { main_goal: match } : {};
}
const shared = {
  phone: "phone", date_of_birth: "date_of_birth", address: "address_line1", city: "address_city",
  province: "address_state", postal_code: "address_zip", country: "address_country",
  emergency_contact_name: "emergency_contact_name", emergency_contact_phone: "emergency_contact_phone",
} as const;
export function memberBasicPrefill(member: Record<string, unknown> | null) {
  const out: Record<string, string> = {};
  for (const [field, source] of Object.entries(shared)) {
    const value = member?.[source];
    if (typeof value === "string" && value.trim()) out[field] = value;
  }
  return out;
}
export function fillMissing<T extends Record<string, any>>(current: T, defaults: Record<string, unknown>): T {
  const result: Record<string, any> = { ...current };
  for (const [key, value] of Object.entries(defaults)) {
    if (result[key] == null || (typeof result[key] === "string" && !result[key].trim())) result[key] = value;
  }
  return result as T;
}
