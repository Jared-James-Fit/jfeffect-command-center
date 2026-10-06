import { describe, expect, it } from "vitest";
import {
  describeDetailsErrors,
  isValidLegalName,
  missingForSigning,
  type SigningInput,
} from "@/lib/coaching-agreement/readiness";

const acks = [
  { id: "money" },
  { id: "risk" },
  { id: "health" },
  { id: "disputes" },
  { id: "review" },
];

const ready: SigningInput = {
  acknowledgements: acks,
  acked: acks.map((a) => a.id),
  payorOn: false,
  payorConfirmed: false,
  typedName: "Jane Doe",
  minor: false,
  method: "drawn",
  hasSignature: true,
  guardianName: "",
  guardianAck: false,
  guardianMethod: "drawn",
  hasGuardianSignature: false,
  online: true,
};

const keys = (input: SigningInput) => missingForSigning(input).map((m) => m.key);

describe("legal name", () => {
  it("needs three characters including a letter", () => {
    expect(isValidLegalName("Jane Doe")).toBe(true);
    expect(isValidLegalName("  Al ")).toBe(false);
    expect(isValidLegalName("12345")).toBe(false);
    expect(isValidLegalName("José")).toBe(true);
    expect(isValidLegalName("")).toBe(false);
  });
});

describe("what is missing before signing", () => {
  it("is empty when everything is done", () => {
    expect(missingForSigning(ready)).toEqual([]);
  });

  it("lists everything, in page order, for a client who has done nothing", () => {
    const items = missingForSigning({
      ...ready,
      acked: [],
      typedName: "",
      hasSignature: false,
    });
    expect(items.map((i) => i.key)).toEqual(["acknowledgements", "name", "signature"]);
    expect(items[0].label).toBe("Confirm the 5 key points");
    expect(items[0].anchor).toBe("ag-ack-money");
    expect(items[1].anchor).toBe("ag-legal-name");
    expect(items[2].anchor).toBe("ag-signature");
  });

  it("counts only the key points still unticked and points at the first of them", () => {
    const one = missingForSigning({ ...ready, acked: ["money", "risk", "health", "disputes"] });
    expect(one).toHaveLength(1);
    expect(one[0].label).toBe("Confirm the remaining 1 key point");
    expect(one[0].anchor).toBe("ag-ack-review");

    const some = missingForSigning({ ...ready, acked: ["money", "health"] });
    expect(some[0].label).toBe("Confirm the remaining 3 key points");
    expect(some[0].anchor).toBe("ag-ack-risk");
  });

  it("asks for the payor statement only when someone else pays", () => {
    expect(keys({ ...ready, payorOn: false, payorConfirmed: false })).toEqual([]);
    expect(keys({ ...ready, payorOn: true, payorConfirmed: false })).toEqual(["payor"]);
    expect(keys({ ...ready, payorOn: true, payorConfirmed: true })).toEqual([]);
  });

  it("rejects a name that is too short or has no letters", () => {
    expect(keys({ ...ready, typedName: "Jo" })).toEqual(["name"]);
    expect(keys({ ...ready, typedName: "123" })).toEqual(["name"]);
  });

  it("needs a drawn signature only when the client chose to draw", () => {
    expect(keys({ ...ready, hasSignature: false })).toEqual(["signature"]);
    expect(keys({ ...ready, method: "typed", hasSignature: false })).toEqual([]);
    // Typed signatures are the typed name, so a bad name is the only thing missing.
    expect(keys({ ...ready, method: "typed", hasSignature: false, typedName: "x" })).toEqual([
      "name",
    ]);
  });

  describe("under 18", () => {
    const minor: SigningInput = {
      ...ready,
      minor: true,
      hasSignature: false,
      guardianName: "Dee Guardian",
    };

    it("does not ask the minor to draw; the parent or guardian signs", () => {
      expect(keys(minor)).toEqual(["guardian-ack", "guardian-signature"]);
    });

    it("clears once the guardian confirms and signs", () => {
      expect(
        keys({ ...minor, guardianAck: true, guardianMethod: "drawn", hasGuardianSignature: true }),
      ).toEqual([]);
      expect(keys({ ...minor, guardianAck: true, guardianMethod: "typed" })).toEqual([]);
    });

    it("still needs the minor's own typed name", () => {
      expect(
        keys({
          ...minor,
          typedName: "",
          guardianAck: true,
          hasGuardianSignature: true,
        }),
      ).toEqual(["name"]);
    });

    it("explains a missing guardian name when they chose a typed signature", () => {
      const items = missingForSigning({
        ...minor,
        guardianAck: true,
        guardianMethod: "typed",
        guardianName: " ",
      });
      expect(items.map((i) => i.key)).toEqual(["guardian-signature"]);
      expect(items[0].label).toMatch(/details step/);
    });
  });

  it("includes being offline, last, so the button can explain it too", () => {
    expect(keys({ ...ready, online: false })).toEqual(["offline"]);
    expect(keys({ ...ready, acked: [], online: false })).toEqual(["acknowledgements", "offline"]);
  });
});

describe("what is missing on the details step", () => {
  it("is empty when there are no errors", () => {
    expect(describeDetailsErrors({})).toEqual([]);
  });

  it("names the parts of a section that need attention, in page order", () => {
    const items = describeDetailsErrors({
      "emergencyContact1.phone": "Enter a valid phone number",
      "address.city": "City is required",
      "address.street": "Street address is required",
      "address.postalCode": "Postal or zip code is required",
    });
    expect(items.map((i) => i.label)).toEqual([
      "Address: street, city, postal code",
      "Emergency contact 1: phone",
    ]);
    // Jumps to the first field of the section that is actually missing.
    expect(items[0].anchor).toBe("ag-street");
    expect(items[1].anchor).toBe("ag-ec1p");
  });

  it("uses the message itself for a single-field section", () => {
    const items = describeDetailsErrors({
      phone: "Enter a valid phone number",
      dateOfBirth: "Enter your date of birth",
    });
    expect(items.map((i) => i.label)).toEqual([
      "Enter a valid phone number",
      "Enter your date of birth",
    ]);
    expect(items.map((i) => i.anchor)).toEqual(["ag-phone", "ag-dob"]);
  });

  it("covers the guardian and payor sections", () => {
    const items = describeDetailsErrors({
      "guardian.fullName": "Parent or guardian name must contain letters",
      "guardian.relationship": "Relationship is required",
      "payor.email": "Enter a valid email address",
    });
    expect(items.map((i) => i.label)).toEqual([
      "Parent or guardian: name, relationship",
      "Payor: email",
    ]);
    expect(items.map((i) => i.anchor)).toEqual(["ag-gn", "ag-pe"]);
  });

  it("never loses an error it does not recognise", () => {
    const items = describeDetailsErrors({ "something.new": "Something else is wrong" });
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("Something else is wrong");
  });
});
