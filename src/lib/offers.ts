export const OFFER_TYPES = [
  "Online Coaching",
  "In-Person Personal Training",
  "In-Person Session Package",
  "Hybrid Coaching",
  "Powerlifting Coaching",
  "Fat Loss Coaching",
  "Muscle Building Coaching",
  "Consultation",
  "Assessment",
  "Technique Session",
  "Program Review",
  "Custom Training Program",
  "Nutrition Targets Setup",
  "Digital Product",
  "Template",
  "Guide",
  "Add-On Service",
  "Custom Offer",
] as const;

export const OFFER_STATUSES = ["Draft", "Active", "Private", "Archived", "Testing"] as const;

export const PAYMENT_STRUCTURES = [
  "One-time payment",
  "Weekly payment",
  "Bi-weekly payment",
  "Monthly payment",
  "3-month commitment",
  "6-month commitment",
  "12-month commitment",
  "Paid in full",
  "Custom payment plan",
] as const;

export const PAYMENT_FREQUENCIES = [
  "One-time",
  "Weekly",
  "Bi-weekly",
  "Monthly",
  "Quarterly",
  "Paid in full",
  "Installments",
  "Custom payment plan",
] as const;

export const TERM_DURATION_UNITS = [
  "Days",
  "Weeks",
  "Months",
  "Years",
  "One-time",
  "Session package",
  "Custom",
] as const;

export const AGREEMENT_STATUSES = [
  "Not Sent",
  "Sent",
  "Signed",
  "Missing",
  "Needs Update",
  "Expired",
] as const;

export const PAYMENT_RECORD_STATUSES = [
  "Pending",
  "Deposit Paid",
  "Paid",
  "Partially Paid",
  "Failed",
  "Overdue",
  "Cancelled",
  "Refunded",
] as const;

export const PAYMENT_STATUS_DETAILED = [
  "Draft",
  "Pending Payment",
  "Paid",
  "Partially Paid",
  "Active Subscription",
  "Payment Plan Active",
  "Overdue",
  "Failed",
  "Cancelled",
  "Refunded",
  "Expired",
  "Manual Payment Needed",
  "Error",
] as const;

export const SERVICE_STATUSES = [
  "Not Started",
  "Active",
  "Ending Soon",
  "Expired",
  "Paused",
  "Cancelled",
  "Completed",
] as const;

export const PURCHASE_RECORD_STATUSES = ["Active", "Cancelled", "Completed", "Refunded"] as const;

export const OFFER_TEMPLATES: Array<Partial<OfferLike> & { name: string }> = [
  {
    name: "12 Month Online Coaching",
    offer_type: "Online Coaching",
    payment_structure: "12-month commitment",
    payment_frequency: "Monthly",
    is_fixed_term_commitment: true,
    term_duration: 12,
    term_duration_unit: "Months",
    requires_agreement: true,
    included_features: [
      "Custom training program",
      "Nutrition targets",
      "Weekly check-ins",
      "Program updates",
      "Messaging support",
      "Lift video review",
      "Client dashboard access",
    ],
    excluded_features: [
      "Medical advice",
      "Injury rehabilitation",
      "Registered dietitian services",
      "Guaranteed results",
      "In-person sessions",
    ],
  },
  {
    name: "6 Month Online Coaching",
    offer_type: "Online Coaching",
    payment_structure: "6-month commitment",
    payment_frequency: "Monthly",
    is_fixed_term_commitment: true,
    term_duration: 6,
    term_duration_unit: "Months",
    requires_agreement: true,
  },
  {
    name: "3 Month Online Coaching",
    offer_type: "Online Coaching",
    payment_structure: "3-month commitment",
    payment_frequency: "Monthly",
    is_fixed_term_commitment: true,
    term_duration: 3,
    term_duration_unit: "Months",
    requires_agreement: true,
  },
  {
    name: "Monthly Online Coaching",
    offer_type: "Online Coaching",
    payment_structure: "Monthly payment",
    payment_frequency: "Monthly",
    is_recurring: true,
    requires_agreement: true,
  },
  {
    name: "In-Person Session Package",
    offer_type: "In-Person Session Package",
    payment_structure: "Paid in full",
    payment_frequency: "One-time",
    term_duration_unit: "Session package",
    location: "Iron Image Gym",
    sessions_included: 10,
    session_length_minutes: 60,
    requires_agreement: true,
  },
  {
    name: "Hybrid Coaching",
    offer_type: "Hybrid Coaching",
    payment_structure: "Monthly payment",
    payment_frequency: "Monthly",
    is_recurring: true,
    requires_agreement: true,
    location: "Iron Image Gym",
  },
  {
    name: "Powerlifting Program Review",
    offer_type: "Program Review",
    payment_structure: "One-time payment",
    payment_frequency: "One-time",
    term_duration_unit: "One-time",
    requires_agreement: true,
  },
  {
    name: "12 Week Training Program",
    offer_type: "Custom Training Program",
    payment_structure: "One-time payment",
    payment_frequency: "One-time",
    term_duration: 12,
    term_duration_unit: "Weeks",
    requires_agreement: true,
  },
  {
    name: "Nutrition Targets Setup",
    offer_type: "Nutrition Targets Setup",
    payment_structure: "One-time payment",
    payment_frequency: "One-time",
    term_duration_unit: "One-time",
    requires_agreement: true,
  },
  {
    name: "Consultation Call",
    offer_type: "Consultation",
    payment_structure: "One-time payment",
    payment_frequency: "One-time",
    term_duration_unit: "One-time",
    session_length_minutes: 30,
    requires_agreement: false,
  },
];

export interface OfferLike {
  id?: string;
  name: string;
  offer_type?: string | null;
  status?: string;
  short_description?: string | null;
  description?: string | null;
  currency?: string | null;
  price?: number | null;
  full_payable_amount?: number | null;
  amount_due_today?: number | null;
  deposit_amount?: number | null;
  number_of_payments?: number | null;
  payment_amount?: number | null;
  payment_structure?: string | null;
  payment_frequency?: string | null;
  payment_start_date?: string | null;
  final_payment_date?: string | null;
  billing_day?: number | null;
  taxes_included?: boolean;
  payment_processing_note?: string | null;
  late_failed_policy?: string | null;
  refund_policy?: string | null;
  cancellation_policy?: string | null;
  is_fixed_term_commitment?: boolean;
  commitment_term_length?: string | null;
  commitment_start_date?: string | null;
  commitment_end_date?: string | null;
  installment_amount?: number | null;
  installment_frequency?: string | null;
  installment_due_day?: number | null;
  term_start_date?: string | null;
  term_end_date?: string | null;
  term_duration?: number | null;
  term_duration_unit?: string | null;
  access_length?: string | null;
  renewal_date?: string | null;
  expiration_date?: string | null;
  is_recurring?: boolean;
  minimum_commitment_length?: string | null;
  package_expiry_date?: string | null;
  location?: string | null;
  session_length_minutes?: number | null;
  sessions_included?: number | null;
  cancellation_window?: string | null;
  no_show_policy?: string | null;
  late_arrival_policy?: string | null;
  rescheduling_policy?: string | null;
  transferability_policy?: string | null;
  gym_access_note?: string | null;
  included_features?: string[] | null;
  excluded_features?: string[] | null;
  requires_agreement?: boolean;
  purchase_disclaimer?: string | null;
  stripe_payment_link?: string | null;
  stripe_product_id?: string | null;
  stripe_price_id?: string | null;
  admin_notes?: string | null;
  is_template?: boolean;
  archived?: boolean;
  version?: number;
  default_agreement_template_id?: string | null;
  agreement_before_service?: boolean;
}

export const DEFAULT_PURCHASE_DISCLAIMER = `By completing this purchase, you confirm that you understand the offer details, payment terms, service term, inclusions, exclusions, and any listed cancellation/refund policies.\n\nYou also understand this purchase is covered by the JF Effect / Jared James Fit Coaching Agreement + Liability Waiver you have signed or will be required to sign before services begin.`;

export function blankOffer(): OfferLike {
  return {
    name: "",
    offer_type: "Online Coaching",
    status: "Active",
    currency: "USD",
    payment_structure: "Monthly payment",
    payment_frequency: "Monthly",
    taxes_included: false,
    is_fixed_term_commitment: false,
    is_recurring: false,
    requires_agreement: true,
    included_features: [],
    excluded_features: [],
    location: "Iron Image Gym",
    purchase_disclaimer: DEFAULT_PURCHASE_DISCLAIMER,
    default_agreement_template_id: null,
  };
}

export function snapshotOfferForPurchase(o: any, extras: { clientId: string; assignedBy?: string | null; timezone?: string | null }) {
  return {
    client_id: extras.clientId,
    offer_id: o.id ?? null,
    offer_version: o.version ?? 1,
    offer_name: o.name,
    offer_type: o.offer_type ?? null,
    short_description: o.short_description ?? null,
    full_description: o.description ?? null,
    currency: o.currency ?? "USD",
    full_payable_amount: o.full_payable_amount ?? o.price ?? null,
    amount_due_today: o.amount_due_today ?? null,
    deposit_amount: o.deposit_amount ?? null,
    payment_structure: o.payment_structure ?? null,
    payment_frequency: o.payment_frequency ?? null,
    number_of_payments: o.number_of_payments ?? null,
    installment_amount: o.installment_amount ?? null,
    stripe_payment_link: o.stripe_payment_link ?? null,
    stripe_price_id: o.stripe_price_id ?? null,
    stripe_product_id: o.stripe_product_id ?? null,
    term_start_date: o.term_start_date ?? null,
    term_end_date: o.term_end_date ?? null,
    term_duration_text: o.term_duration && o.term_duration_unit ? `${o.term_duration} ${o.term_duration_unit}` : o.term_duration_unit ?? null,
    package_expiry_date: o.package_expiry_date ?? null,
    is_recurring: !!o.is_recurring,
    is_fixed_term_commitment: !!o.is_fixed_term_commitment,
    included_features: o.included_features ?? [],
    excluded_features: o.excluded_features ?? [],
    cancellation_policy: o.cancellation_policy ?? null,
    refund_policy: o.refund_policy ?? null,
    in_person_policy: [o.no_show_policy, o.late_arrival_policy, o.rescheduling_policy, o.transferability_policy, o.cancellation_window]
      .filter(Boolean)
      .join("\n\n") || null,
    purchase_disclaimer: o.purchase_disclaimer ?? DEFAULT_PURCHASE_DISCLAIMER,
    location: o.location ?? null,
    session_length_minutes: o.session_length_minutes ?? null,
    sessions_purchased: o.sessions_included ?? 0,
    package_tracking_enabled: !!(o.sessions_included && o.sessions_included > 0),
    timezone: extras.timezone ?? "America/Winnipeg",
    assigned_by: extras.assignedBy ?? null,
  };
}