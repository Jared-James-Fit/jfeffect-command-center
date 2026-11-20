/**
 * Props for a text box that is never a contact, address or password: Safari
 * on iPhone offers "AutoFill Contact" from what a box's name, id, label and
 * placeholder look like and ignores autocomplete="off", but it leaves a box
 * alone whose name says "search"; password managers have their own opt-outs.
 * Keep the visible label and placeholder clear of "name", "phone", "email",
 * "address" and the like too (equipment-form.tsx, setup-sheet.tsx).
 */
export function noAutofill(field: string) {
  return {
    name: `search-${field}`,
    autoComplete: "off",
    "data-1p-ignore": "true",
    "data-lpignore": "true",
    "data-form-type": "other",
  } as const;
}
