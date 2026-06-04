import type { Database } from "@/integrations/supabase/types";

export type AgreementTemplate = Database["public"]["Tables"]["agreement_templates"]["Row"];
export type AgreementTemplateField = Database["public"]["Tables"]["agreement_template_fields"]["Row"];
export type Agreement = Database["public"]["Tables"]["agreements"]["Row"];
export type AgreementFieldValue = Database["public"]["Tables"]["agreement_field_values"]["Row"];
export type AgreementAuditEntry = Database["public"]["Tables"]["agreement_audit_log"]["Row"];

export const FIELD_TYPES = [
  "text",
  "signature",
  "initial",
  "date",
  "checkbox",
  "dropdown",
  "phone",
  "email",
  "address",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const SIGNER_ROLES = ["client", "coach", "payor", "parent_guardian"] as const;
export type SignerRole = (typeof SIGNER_ROLES)[number];

export const SIGNER_LABELS: Record<SignerRole, string> = {
  client: "Client",
  coach: "Coach / Admin",
  payor: "Payor",
  parent_guardian: "Parent / Guardian",
};

export const FIELD_LABELS: Record<FieldType, string> = {
  text: "Text",
  signature: "Signature",
  initial: "Initials",
  date: "Date",
  checkbox: "Checkbox",
  dropdown: "Dropdown",
  phone: "Phone",
  email: "Email",
  address: "Address",
};

export const AGREEMENT_STATUSES = [
  "Not Sent",
  "Sent",
  "Opened",
  "In Progress",
  "Waiting On Client",
  "Waiting On Coach",
  "Completed",
  "Expired",
  "Cancelled",
  "Needs Update",
] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

export const STATUS_BADGE: Record<string, string> = {
  "Not Sent": "bg-muted text-muted-foreground",
  Sent: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  Opened: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  "In Progress": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "Waiting On Client": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "Waiting On Coach": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  Completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  Expired: "bg-red-500/15 text-red-700 dark:text-red-300",
  Cancelled: "bg-red-500/15 text-red-700 dark:text-red-300",
  "Needs Update": "bg-red-500/15 text-red-700 dark:text-red-300",
};

export interface FieldSnapshot {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  field_type: FieldType;
  signer_role: SignerRole;
  label: string | null;
  internal_name: string;
  required: boolean;
  placeholder: string | null;
  options: string[];
  sort_order: number;
}