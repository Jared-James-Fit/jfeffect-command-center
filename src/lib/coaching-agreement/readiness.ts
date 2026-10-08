/**
 * What is still missing before a client can sign, as plain-language items the screen can list
 * and jump to. Pure, so every rule is unit-tested without a browser, and the button and the
 * list can never disagree about whether signing is allowed.
 */

export type MissingItem = {
  key: string;
  label: string;
  /** DOM id of the thing to scroll to and focus. */
  anchor: string;
};

/** A legal name needs at least three characters and at least one letter. */
export function isValidLegalName(name: string): boolean {
  return name.trim().length >= 3 && /\p{L}/u.test(name);
}

export type SigningInput = {
  acknowledgements: readonly { id: string }[];
  acked: readonly string[];
  payorOn: boolean;
  payorConfirmed: boolean;
  typedName: string;
  minor: boolean;
  method: "drawn" | "typed";
  hasSignature: boolean;
  guardianName: string;
  guardianAck: boolean;
  guardianMethod: "drawn" | "typed";
  hasGuardianSignature: boolean;
  online: boolean;
};

/** Everything standing between the client and "Sign agreement", in the order it appears. */
export function missingForSigning(input: SigningInput): MissingItem[] {
  const out: MissingItem[] = [];

  const unticked = input.acknowledgements.filter((a) => !input.acked.includes(a.id));
  if (unticked.length > 0) {
    const total = input.acknowledgements.length;
    out.push({
      key: "acknowledgements",
      label:
        unticked.length === total
          ? `Confirm the ${total} key points`
          : `Confirm the remaining ${unticked.length} key ${unticked.length === 1 ? "point" : "points"}`,
      anchor: `ag-ack-${unticked[0].id}`,
    });
  }

  if (input.payorOn && !input.payorConfirmed) {
    out.push({ key: "payor", label: "Confirm the payor statement", anchor: "ag-ack-payor" });
  }

  if (!isValidLegalName(input.typedName)) {
    out.push({ key: "name", label: "Type your full legal name", anchor: "ag-legal-name" });
  }

  // Under 18, the parent or guardian provides the signature; the minor's typed name is theirs.
  if (!input.minor && input.method === "drawn" && !input.hasSignature) {
    out.push({ key: "signature", label: "Draw your signature", anchor: "ag-signature" });
  }

  if (input.minor) {
    if (!input.guardianAck) {
      out.push({
        key: "guardian-ack",
        label: "Parent or guardian: tick their confirmation",
        anchor: "ag-ack-guardian",
      });
    }
    const guardianSigned =
      input.guardianMethod === "drawn"
        ? input.hasGuardianSignature
        : input.guardianName.trim().length >= 2;
    if (!guardianSigned) {
      out.push({
        key: "guardian-signature",
        label:
          input.guardianMethod === "drawn"
            ? "Parent or guardian: sign in the box"
            : "Parent or guardian: add their name on the details step",
        anchor: "ag-guardian-signature",
      });
    }
  }

  if (!input.online) {
    out.push({ key: "offline", label: "Reconnect to the internet", anchor: "ag-offline" });
  }

  return out;
}

type DetailsGroup = {
  key: string;
  label: string;
  fields: { path: string; part: string; anchor: string }[];
};

/** In the order the fields appear on the details step. */
const DETAILS_GROUPS: DetailsGroup[] = [
  {
    key: "phone",
    label: "Phone number",
    fields: [{ path: "phone", part: "phone number", anchor: "ag-phone" }],
  },
  {
    key: "dob",
    label: "Date of birth",
    fields: [{ path: "dateOfBirth", part: "date of birth", anchor: "ag-dob" }],
  },
  {
    key: "address",
    label: "Address",
    fields: [
      { path: "address.street", part: "street", anchor: "ag-street" },
      { path: "address.city", part: "city", anchor: "ag-city" },
      { path: "address.province", part: "province or state", anchor: "ag-province" },
      { path: "address.postalCode", part: "postal code", anchor: "ag-postal" },
      { path: "address.country", part: "country", anchor: "ag-country" },
    ],
  },
  {
    key: "ec1",
    label: "Emergency contact 1",
    fields: [
      { path: "emergencyContact1.name", part: "name", anchor: "ag-ec1n" },
      { path: "emergencyContact1.phone", part: "phone", anchor: "ag-ec1p" },
    ],
  },
  {
    key: "ec2",
    label: "Emergency contact 2",
    fields: [
      { path: "emergencyContact2.name", part: "name", anchor: "ag-ec2n" },
      { path: "emergencyContact2.phone", part: "phone", anchor: "ag-ec2p" },
    ],
  },
  {
    key: "guardian",
    label: "Parent or guardian",
    fields: [
      { path: "guardian.fullName", part: "name", anchor: "ag-gn" },
      { path: "guardian.relationship", part: "relationship", anchor: "ag-gr" },
      { path: "guardian.phone", part: "phone", anchor: "ag-gp" },
    ],
  },
  {
    key: "payor",
    label: "Payor",
    fields: [
      { path: "payor.name", part: "name", anchor: "ag-pn" },
      { path: "payor.relationship", part: "relationship", anchor: "ag-pr" },
      { path: "payor.phone", part: "phone", anchor: "ag-pp" },
      { path: "payor.email", part: "email", anchor: "ag-pe" },
    ],
  },
];

/**
 * Turns the per-field errors on the details step into a short list: one line per section, naming
 * the parts that need attention ("Address: street, city"), or the message itself for a single
 * field ("Enter a valid phone number"). Nothing can fail silently: an error for a field this
 * doesn't know about still gets its own line.
 */
export function describeDetailsErrors(errors: Record<string, string>): MissingItem[] {
  const out: MissingItem[] = [];
  const known = new Set<string>();

  for (const group of DETAILS_GROUPS) {
    const hits = group.fields.filter((f) => errors[f.path]);
    if (hits.length === 0) continue;
    for (const f of group.fields) known.add(f.path);
    out.push({
      key: group.key,
      label:
        group.fields.length === 1
          ? errors[hits[0].path]
          : `${group.label}: ${hits.map((f) => f.part).join(", ")}`,
      anchor: hits[0].anchor,
    });
  }

  for (const [path, message] of Object.entries(errors)) {
    if (known.has(path) || !message) continue;
    out.push({ key: path, label: message, anchor: "ag-phone" });
  }

  return out;
}
