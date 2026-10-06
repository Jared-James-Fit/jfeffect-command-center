/**
 * JF Effect Coaching Agreement — canonical content.
 *
 * Single source of truth for the in-app reader, the signed copy, the PDF and the
 * admin view. When a client signs, a frozen copy of this content is stored by
 * SHA-256, so every signature always renders the exact words that were agreed to,
 * even after the agreement is later revised.
 *
 * TO REVISE THE AGREEMENT: edit the text, bump AGREEMENT_VERSION, and record the
 * new hash in PUBLISHED_CONTENT_HASHES (a test fails until you do, so published
 * wording can never be changed silently). Clients re-sign automatically when
 * AGREEMENT_VERSION rises above the version they signed, unless the change is
 * non-material (see RESIGN_REQUIRED_BELOW_VERSION).
 *
 * Inline markup: `**bold**` only. Cross-references use `{{n:section-id}}`, which
 * resolves to that section's number so numbering can never drift.
 */

import { AGREEMENT_VERSION } from "./version";

export const AGREEMENT_SLUG = "coaching-agreement";
export const AGREEMENT_TITLE = "JF Effect Coaching Agreement";
export const AGREEMENT_SUBTITLE =
  "Liability Waiver, Release of Claims, Assumption of Risk & Indemnity";
export const AGREEMENT_EFFECTIVE_DATE = "2026-10-06";

// Version numbers live in ./version so the always-loaded status rules never import this file.
export { AGREEMENT_VERSION, RESIGN_REQUIRED_BELOW_VERSION, compareVersions } from "./version";

export const COACH = {
  business: "JF Effect / Jared James Fit",
  operator: "Jared James McIntyre",
  location: "Winnipeg, Manitoba, Canada",
  email: "jaredjamesfit@gmail.com",
  timezone: "America/Winnipeg",
} as const;

export type AgreementClause = {
  /** Bold lead-in, e.g. "No refunds." */
  label?: string;
  text: string;
};

export type AgreementSection = {
  id: string;
  number: number;
  title: string;
  /** One plain-English line shown on the collapsed card (a summary, not a term). */
  inShort: string;
  clauses: AgreementClause[];
};

export type AgreementAcknowledgement = {
  id: string;
  /** Short label for the admin view and signed copy. */
  short: string;
  /** Full wording the client ticks; recorded verbatim with the signature. */
  text: string;
};

export type AgreementOptionalConsent = {
  /** Matches legal_consent_preferences.consent_key so the Legal & Safety toggles stay in sync. */
  key: "testimonial_use" | "social_publication";
  label: string;
  text: string;
};

export type AgreementContent = {
  version: string;
  title: string;
  subtitle: string;
  effectiveDate: string;
  coach: typeof COACH;
  intro: AgreementClause[];
  keyTerms: { title: string; text: string }[];
  sections: AgreementSection[];
  acknowledgements: AgreementAcknowledgement[];
  optionalConsents: AgreementOptionalConsent[];
  intentStatement: string;
  guardianStatement: string;
  payorStatement: string;
};

type RawSection = Omit<AgreementSection, "number">;

const RAW_SECTIONS: RawSection[] = [
  {
    id: "parties",
    title: "Parties & Contact Details",
    inShort: "Who is who, and how to reach each other.",
    clauses: [
      {
        label: "The Coach.",
        text: "JF Effect / Jared James Fit, operated by Jared James McIntyre, Winnipeg, Manitoba, Canada.",
      },
      {
        label: "Official email.",
        text: "Cancellations, freeze requests, billing questions and other written notices to the Coach must be sent to **jaredjamesfit@gmail.com**.",
      },
      {
        label: "Your details.",
        text: "The personal and emergency-contact details you enter when you sign form part of this Agreement. You confirm they are true and complete, and you agree to keep them up to date in the app.",
      },
      {
        label: "Winnipeg time.",
        text: "All dates, deadlines, billing dates and notice periods in this Agreement are measured in Winnipeg time (Central Time).",
      },
    ],
  },
  {
    id: "services",
    title: "Services & Purchases Covered",
    inShort: "One agreement covers everything you buy from the Coach, now and later.",
    clauses: [
      {
        label: "Services covered.",
        text: "This Agreement covers all Services, including (but not limited to) online coaching, in-person personal training, hybrid coaching, strength training, bodybuilding, powerlifting, conditioning, mobility work, templates, programs, guides, consultations, education, form review, digital products and any future service offered by the Coach.",
      },
      {
        label: "One agreement covers every purchase.",
        text: "By signing once, you agree that every purchase you make now or later is automatically covered by this Agreement. This includes monthly coaching, add-ons, personal training sessions and packages, consultations, digital products, templates and any future service. Each time you purchase something, you confirm your acceptance of this Agreement again for that purchase.",
      },
      {
        label: "If someone else pays.",
        text: "If someone other than you pays for the Services (a “Payor”), the Payor is financially responsible for all charges and obligations under this Agreement, including fixed-term commitments, buyouts, late fees, failed payments and unpaid balances, and agrees to the no-refund policy except where the law requires otherwise. By making any payment for you, the Payor accepts these payment terms. You confirm you have given the Payor the chance to read this Agreement. Your own obligations, including the safety, health and conduct terms, remain yours.",
      },
    ],
  },
  {
    id: "records",
    title: "Purchase Records & Receipts",
    inShort: "Your receipts show exactly what you bought.",
    clauses: [
      {
        label: "How each purchase is recorded.",
        text: "The exact details of each purchase are confirmed by the invoice, receipt, checkout confirmation, payment link, Stripe receipt, in-app purchase record, confirmation email or written message from the Coach, including: (1) the service purchased; (2) the term length, if any; (3) the total payable amount, if any; and (4) the billing schedule or installment amount, if any. Together with this Agreement, these records are the complete record of what you bought and agreed to.",
      },
      {
        label: "If records differ.",
        text: "If a purchase record shows a price, term or billing schedule that differs from this Agreement, the purchase record controls for those details only, and this Agreement controls everything else. If a price is not written anywhere else, the price on the invoice, receipt or checkout confirmation is the agreed price.",
      },
      {
        label: "Your receipts.",
        text: "You can see your purchases and receipts in the app at any time. If a record contains an error, tell the Coach in writing so it can be corrected.",
      },
      {
        label: "“In writing”.",
        text: "“In writing” means an email, invoice or receipt, checkout confirmation, or a message sent through the coaching app or platform used for the Services. Cancellation and freeze requests must still be emailed to the official email address (see Sections {{n:billing}} and {{n:freeze}}), and social media messages and Instagram DMs do not count as written notice.",
      },
    ],
  },
  {
    id: "billing",
    title: "Pricing, Billing & Payments",
    inShort:
      "Recurring plans renew automatically until you cancel by email before the next billing date.",
    clauses: [
      {
        label: "Price.",
        text: "The price is the amount shown on your invoice, receipt, payment link or checkout confirmation. Prices are in Canadian dollars (CAD) unless the checkout says otherwise, and any taxes are shown at checkout.",
      },
      {
        label: "Recurring billing.",
        text: "If you purchase a recurring service, you authorize the Coach to charge your payment method automatically on each billing date until you properly cancel, and you agree to keep a valid payment method on file. Payments are processed securely by Stripe.",
      },
      {
        label: "Failed payments.",
        text: "If a payment fails, access to coaching and Services may be paused until payment is completed. Repeated failed payments may lead to termination. A reasonable late or failed-payment fee of **$25** may apply where permitted by law.",
      },
      {
        label: "Cancelling recurring billing.",
        text: "To cancel, you must give written notice by email to **jaredjamesfit@gmail.com** before your next billing date (no later than 11:59 p.m. Winnipeg time on the day before). Cancellation applies to the next billing cycle, and charges already processed are not refundable. Social media messages and Instagram DMs do not count as written notice. If you are on a fixed-term commitment or installment plan, cancelling billing does not end your payment obligations (see Section {{n:commitments}}).",
      },
      {
        label: "Billing errors.",
        text: "If you believe you were charged in error (for example, a duplicate or incorrect amount), email the Coach within **30 days** of the charge so it can be reviewed and corrected. Please contact the Coach before disputing a charge with your bank (see Section {{n:refunds}}).",
      },
    ],
  },
  {
    id: "term",
    title: "Start Date & Term",
    inShort:
      "A term starts on the day you purchase unless the Coach confirms another date in writing.",
    clauses: [
      {
        text: "Any commitment term begins on the **date of purchase or payment** unless the Coach confirms a different start date in writing. If a different start date is confirmed in writing, that written confirmation controls.",
      },
      {
        text: "Ongoing (month-to-month) services continue until cancelled as described in Section {{n:billing}}.",
      },
    ],
  },
  {
    id: "commitments",
    title: "Fixed-Term Commitments, Installments & Early Termination",
    inShort:
      "A fixed term is a commitment. Installments are a way to pay for it, not a way out of it.",
    clauses: [
      {
        label: "Fixed terms.",
        text: "If you purchase a fixed-term option (for example 8 or 12 weeks, or 6 or 12 months), you are buying a time-based commitment and are financially responsible for the full term. The total payable amount is the full amount shown on the invoice, receipt, checkout confirmation or payment plan for the whole term.",
      },
      {
        label: "Installments.",
        text: "If you pay in installments (weekly, bi-weekly, monthly or on another schedule), those payments are installments toward the total payable amount. They do not create a cancel-anytime agreement, and you may not stop paying early without completing payment for the full term.",
      },
      {
        label: "You still owe the balance.",
        text: "You are legally responsible for paying the total payable amount for the full commitment term even if you stop responding, stop using the Services, stop training or stop checking in.",
      },
      {
        label: "Early termination.",
        text: "If you end a fixed-term commitment early for any reason, there are no refunds and the remaining balance is still owed.",
      },
      {
        label: "Buyout (at the Coach’s discretion).",
        text: "Instead of the full remaining balance, the Coach may offer a one-time buyout equal to **50% of the remaining unpaid balance**, which must be paid within **7 days** of approval. The Coach is not required to offer a buyout and may refuse at any time.",
      },
      {
        label: "Payment enforcement.",
        text: "If you try to avoid payment (for example by blocking charges, cancelling payment methods, or filing disputes or chargebacks), the Coach may end the Services immediately and pursue the balance through collections or legal enforcement where permitted by law.",
      },
      {
        label: "Collection costs.",
        text: "If the Coach must use collections or legal enforcement to recover unpaid balances, you agree to pay reasonable collection costs, administrative fees and legal fees where permitted by law.",
      },
    ],
  },
  {
    id: "refunds",
    title: "No Refunds, Cooling-Off Rights & Chargebacks",
    inShort: "All sales are final. If something looks wrong on a bill, email first.",
    clauses: [
      {
        label: "All sales are final.",
        text: "**No refunds.** This includes coaching services, subscriptions, personal training sessions and packages, consultations, digital products, templates, guides, add-ons and any other service provided by the Coach. You are not entitled to a refund for partially used months, missed check-ins, unused time or services, change of mind, lack of motivation, failure to follow the plan, or expired sessions. The only exceptions are those stated in Section {{n:conduct}}, corrections of billing errors under Section {{n:billing}}, and where the law requires otherwise.",
      },
      {
        label: "Cooling-off and consumer rights.",
        text: "If the laws where you live give you a cancellation right or cooling-off period that cannot be waived, you may use it only as the law requires and must give written notice within the required timeframe. Where instant access is provided to digital products, app access, templates or downloads, those products are considered delivered once access is provided and are not refundable except where required by law.",
      },
      {
        label: "Chargebacks and disputes.",
        text: "You agree to contact the Coach in writing before filing any chargeback or dispute. If you file a chargeback or dispute for any reason, the Coach may end your Services immediately. You remain responsible for all unpaid balances under this Agreement, plus any dispute fees and costs where permitted by law.",
      },
    ],
  },
  {
    id: "freeze",
    title: "Freeze Policy",
    inShort: "A freeze is a favour, not a right. Ask in writing before it starts.",
    clauses: [
      {
        label: "Freeze or pause (no refunds).",
        text: "Unexpected circumstances (such as travel, injury, illness, a family emergency, or school or work schedule changes) are not a reason for a refund. Instead, the Coach may allow a temporary freeze at the Coach’s discretion. A freeze is not guaranteed.",
      },
      {
        label: "How to request one.",
        text: "Freeze requests must be submitted in writing to **jaredjamesfit@gmail.com** before the freeze begins. Freeze requests cannot be backdated.",
      },
      {
        label: "What a freeze does.",
        text: "If approved, a freeze pauses coaching only. During a freeze, the Coach is not required to provide programming updates, check-ins, feedback, plan changes or messaging support, and app access may be paused. Freeze periods pause the Services only and do not cancel payment obligations unless the Coach agrees in writing.",
      },
      {
        label: "Limits.",
        text: "The maximum length of an approved freeze is **30 days** unless otherwise agreed in writing. A reasonable admin fee of **$25** may apply where permitted by law.",
      },
    ],
  },
  {
    id: "in-person",
    title: "In-Person Training Rules",
    inShort: "Use sessions within 6 months. Give 24 hours’ notice to reschedule.",
    clauses: [
      {
        label: "Session expiry.",
        text: "All in-person personal training sessions and packages must be used within **6 months** of the date of purchase. Unused sessions expire after 6 months and are not refundable.",
      },
      {
        label: "Rescheduling and no-shows.",
        text: "You must give at least **24 hours’ notice** to reschedule. Late cancellations or no-shows may be counted as used sessions. If you arrive late, the session still ends at the scheduled time.",
      },
      {
        label: "If the Coach reschedules.",
        text: "The Coach may reschedule sessions because of illness, emergencies, facility issues or scheduling conflicts. In that case, the session will be rebooked within a reasonable time or credited toward a future session.",
      },
      {
        label: "Medical emergencies.",
        text: "If there is a medical emergency during an in-person session, you authorize the Coach to call emergency services and to share your emergency contacts and relevant health information with responders. You are responsible for the cost of any emergency treatment or transport.",
      },
    ],
  },
  {
    id: "conduct",
    title: "Communication, Conduct & Right to Refuse Service",
    inShort: "Coaching isn’t emergency support. Respect goes both ways.",
    clauses: [
      {
        label: "Communication.",
        text: "Coaching is not emergency support, and response times may vary. No refunds or credits will be issued because of response time, delayed replies, missed messages or scheduling issues.",
      },
      {
        label: "Conduct.",
        text: "Abusive, threatening, harassing, disrespectful or unsafe behaviour may result in immediate termination without refund. Payment obligations remain enforceable.",
      },
      {
        label: "Right to refuse or end Services.",
        text: "The Coach may refuse, pause or end Services at any time for safety, conduct, non-payment, non-compliance or business reasons. If the Coach ends your Services because of your conduct, safety concerns, non-payment or non-compliance, no refunds apply and payment obligations remain enforceable where permitted by law.",
      },
      {
        label: "If the Coach ends Services for other reasons.",
        text: "If the Coach ends or permanently discontinues your Services for business reasons that are not caused by you, the Coach will refund the unused, prepaid portion of the Services on a pro-rated basis, and you will not owe any remaining balance on the ended commitment.",
      },
    ],
  },
  {
    id: "health",
    title: "Health, Medical & Nutrition",
    inShort:
      "The Coach is a fitness coach, not a doctor. Tell the Coach about injuries and conditions.",
    clauses: [
      {
        label: "Coaching, not medical care.",
        text: "The Coach provides fitness coaching and general education only. The Coach is not a physician, medical provider, physiotherapist, rehab specialist, chiropractor, psychologist, psychiatrist, therapist, counsellor, registered dietitian, nutritionist or other licensed healthcare provider. The Coach does not provide medical diagnosis or treatment, injury rehabilitation plans, physical therapy, clinical nutrition therapy, or mental-health counselling or crisis support.",
      },
      {
        label: "Your health disclosure.",
        text: "You agree to tell the Coach about any injuries, medical conditions, pregnancy, medications, pain, limitations or health concerns that may affect training safety, and to update the Coach when anything changes. The Coach is not responsible for issues caused by conditions you did not disclose.",
      },
      {
        label: "Health screening (PAR-Q).",
        text: "You confirm that you have completed any required health screening forms (including the PAR-Q, if provided) honestly and completely. Inaccurate or incomplete answers increase risk, and the Coach is not responsible for issues caused by inaccurate or incomplete disclosures.",
      },
      {
        label: "See a professional.",
        text: "If you have any health concerns, you agree to consult a qualified, licensed professional before starting or continuing training. Stop training and seek medical help if you feel pain, dizziness, chest discomfort or anything unusual.",
      },
      {
        label: "Nutrition.",
        text: "Nutrition guidance is general education only and may include calorie and macro targets, meal-structure suggestions, hydration guidance and supplement suggestions. You are responsible for your food choices, allergies, intolerances and supplement use.",
      },
      {
        label: "Not therapy.",
        text: "Coaching is not therapy. The Coach does not provide confidential or privileged mental-health services and does not guarantee secrecy beyond what Section {{n:privacy}} describes. The Coach may disclose information if required for safety or legal reasons.",
      },
    ],
  },
  {
    id: "risk",
    title: "Assumption of Risk, Safe Training & Online Coaching",
    inShort: "Training can hurt you. You accept that risk and train within your limits.",
    clauses: [
      {
        label: "The risks.",
        text: "Training has inherent risks, including **serious injury, disability or death**. Risks include, but are not limited to, strains, sprains, tears, joint injuries, dizziness, fainting, nausea, falls, equipment failure or misuse, worsening of prior injuries and serious medical events.",
      },
      {
        label: "You accept them.",
        text: "You accept all risks of participation and agree that you are responsible for your own training decisions, load selection and safety. You agree to train within your limits and to stop if something does not feel right.",
      },
      {
        label: "A safe environment.",
        text: "You are responsible for maintaining a safe training environment, especially when you train independently or in a home gym. The Coach is not responsible for unsafe environments, broken equipment or lack of supervision.",
      },
      {
        label: "Online coaching.",
        text: "For online coaching, you understand the Coach is not physically present during your workouts, that feedback is limited to what you show and tell the Coach, and that you accept full responsibility for execution and safety.",
      },
    ],
  },
  {
    id: "facilities",
    title: "Facilities, Property & Technology",
    inShort: "Follow the gym’s rules. Damage you cause is on you.",
    clauses: [
      {
        label: "Third-party facilities.",
        text: "The Coach does not own or control any third-party gym or facility. You agree to follow all facility rules, policies, staff instructions and safety requirements at all times. A facility may require separate waivers, memberships or terms, and you are responsible for those obligations.",
      },
      {
        label: "Property damage.",
        text: "To the fullest extent permitted by law, the Coach is not responsible for any property damage, equipment damage or loss of personal belongings that occurs during or in connection with training sessions, workouts or Services, whether at a gym, facility, home gym or any other location. You are solely responsible for your own conduct and equipment use, and for any damage you cause to facility property, equipment or third-party property, and for any resulting costs, charges or claims.",
      },
      {
        label: "Technology.",
        text: "The Coach is not responsible for app outages, internet issues, email delivery failures, payment-platform errors, device problems or other third-party service failures. You are responsible for your login and for keeping your account secure. App access is for your personal use and may be paused when Services end, payments fail or during a freeze.",
      },
    ],
  },
  {
    id: "content",
    title: "Your Content & Media Permission",
    inShort:
      "Your coaching photos and videos stay private to coaching unless you say yes to public use.",
    clauses: [
      {
        label: "Your responsibility.",
        text: "You are solely responsible for any content you upload, send or share with the Coach or through the coaching app, including photos, videos, messages, check-ins, forms, voice notes, screenshots, documents and other materials (“Client Content”). You confirm you have the legal right to provide Client Content and that it does not violate any law or any privacy or third-party right.",
      },
      {
        label: "Use for coaching.",
        text: "By submitting Client Content, you give the Coach permission to store, review and use it to deliver and administer the Services, including coaching, feedback, education and quality review. This use stays between you and the Coach’s team.",
      },
      {
        label: "Public use needs your permission.",
        text: "The Coach will use your photos, videos, results, name or likeness publicly (for example in testimonials, before-and-after posts, advertising, marketing, the website or social media) only if you give permission when you sign or later in your account, or if you send content or a testimonial to the Coach specifically so it can be shared. Where you give permission, you grant the Coach an ongoing, royalty-free licence to store, edit, crop, modify, display, publish, repost and distribute that content for legitimate business purposes. You can withdraw permission for future use at any time by emailing the Coach; withdrawal does not affect uses already made.",
      },
      {
        label: "No liability for Client Content.",
        text: "You agree the Coach is not responsible for the nature of the Client Content you submit, including any information, images or materials you voluntarily provide, and is not liable for any claim arising from your decision to submit it.",
      },
      {
        label: "Removal requests.",
        text: "The Coach may remove posted content as a courtesy. However, once content has been published, shared, reposted, saved or distributed by others, complete removal may not be possible, and you agree not to hold the Coach responsible for third-party sharing, reposting, downloading or continued circulation of content.",
      },
      {
        label: "No compensation.",
        text: "You understand you will not receive payment or compensation for the use of Client Content.",
      },
    ],
  },
  {
    id: "privacy",
    title: "Privacy, Health Information & Communications",
    inShort:
      "Your information is used to coach and bill you, with trusted providers, under Canadian privacy law.",
    clauses: [
      {
        label: "What the Coach collects.",
        text: "To coach you, the Coach collects and uses information you provide or create in the app, including your contact details, date of birth, emergency contacts, injury and health information, training, nutrition and bodyweight data, check-ins, messages, photos, videos and payment records. Card details are handled by Stripe and are not stored by the Coach.",
      },
      {
        label: "Your consent.",
        text: "Some of this information is sensitive health information. By signing, you consent to the Coach collecting, using and storing it to provide and administer the Services, keep you safe, bill you, communicate with you and meet legal and tax obligations.",
      },
      {
        label: "Service providers and storage.",
        text: "The Coach uses trusted service providers for hosting, databases, payments, email, messaging, notifications and video. Some of them store or process information outside Canada (including in the United States), where it may be subject to local laws and accessible to authorities there. The Coach does not sell your personal information.",
      },
      {
        label: "Your choices.",
        text: "You may ask to see or correct your information, or ask the Coach to delete it, by emailing the official address. The Coach may keep records it is legally or reasonably required to keep (for example payment, tax and agreement records). You may withdraw consent for optional uses at any time, but some information is necessary to coach you safely and to bill you.",
      },
      {
        label: "Messages about your Services.",
        text: "You agree the Coach may contact you about your Services (for example programming, check-ins, scheduling, billing, receipts and policy updates) through the app, push notifications, email, SMS or other messaging using the contact details you provide. Marketing messages are separate and optional, and you can opt out at any time.",
      },
      {
        label: "Privacy Policy.",
        text: "The Coach’s Privacy Policy (jfeffect.com/privacy) explains more. If it conflicts with this section on how personal information is handled, the Privacy Policy controls.",
      },
    ],
  },
  {
    id: "ip",
    title: "Coach Materials & Intellectual Property",
    inShort: "Programs and materials are for your personal use only.",
    clauses: [
      {
        label: "Ownership.",
        text: "Programs, templates, guides, educational materials, videos, exercise demonstrations, documents, app content and other coaching resources provided by the Coach remain the Coach’s intellectual property and are for your personal use only. You may not copy, share, publish, distribute, resell or provide access to Coach materials without written permission.",
      },
      {
        label: "No transfer.",
        text: "You may not transfer, share, assign or resell Services, sessions, access or materials to anyone else.",
      },
    ],
  },
  {
    id: "release",
    title: "Release of Liability, Indemnity & Limits",
    inShort:
      "You give up the right to make most injury and loss claims against the Coach, including for negligence, as far as the law allows.",
    clauses: [
      {
        label: "Released Parties.",
        text: "“Released Parties” means the Coach (including Jared James McIntyre personally), the Coach’s business, employees, contractors, assistants, agents, representatives, successors and anyone acting on the Coach’s behalf.",
      },
      {
        label: "Release and waiver (including negligence).",
        text: "To the fullest extent permitted by law, you waive, release and discharge the Coach and the Released Parties from any and all claims, demands, causes of action, injuries, damages, losses, costs or liabilities arising from your participation in the Services. **This includes claims related to negligence**, where permitted by law, including coaching cues, programming decisions, exercise selection, load guidance, lack of supervision, facility conditions, equipment issues and the actions of others. This release also binds your heirs, executors, successors and assigns.",
      },
      {
        label: "Indemnity.",
        text: "You agree to indemnify and hold harmless the Coach and the Released Parties from claims, damages, losses, costs or legal fees arising from your actions, negligence, misconduct or failure to follow safety instructions.",
      },
      {
        label: "Limitation of liability.",
        text: "To the fullest extent permitted by law, the Coach and the Released Parties are not liable for indirect, incidental, special, punitive or consequential damages. Total liability for any claim is limited to the amount you actually paid for the specific Service that gave rise to the claim, unless the law prohibits this limit.",
      },
      {
        label: "No guarantees.",
        text: "Results are not guaranteed. The Coach does not guarantee results by any specific date or within any timeframe. Any estimates or examples are informational only.",
      },
      {
        label: "Legal limitation notice.",
        text: "Nothing in this Agreement limits liability where such a limitation is prohibited by law.",
      },
    ],
  },
  {
    id: "disputes",
    title: "Disputes, Governing Law & Time Limits",
    inShort: "Email first. Manitoba law applies. Claims must be brought within 12 months.",
    clauses: [
      {
        label: "Talk first.",
        text: "Before starting any legal action, you agree to try to resolve the issue informally by writing to the Coach at the official email address. Either party may propose mediation or arbitration in Manitoba; neither is required unless both parties agree in writing, and you understand that arbitration may limit your court rights.",
      },
      {
        label: "Governing law and courts.",
        text: "This Agreement is governed by the laws of the Province of Manitoba and the federal laws of Canada that apply there. Any court action must be brought in the courts of Manitoba, except where the law where you live gives you a right to bring or defend a claim elsewhere that cannot be waived.",
      },
      {
        label: "Waiver of jury trial.",
        text: "To the fullest extent permitted by law, you and the Coach waive the right to a trial by jury.",
      },
      {
        label: "Class action waiver.",
        text: "To the fullest extent permitted by law, claims must be brought individually and not as part of a class action.",
      },
      {
        label: "Time limit to bring claims.",
        text: "To the fullest extent permitted by law, any claim must be brought within **12 months** of the event giving rise to it, or it is permanently barred.",
      },
      {
        label: "Legal fees.",
        text: "If you bring a legal action and the Coach wins, you agree to pay the Coach’s reasonable legal fees and costs where permitted by law.",
      },
    ],
  },
  {
    id: "international",
    title: "Clients Outside Manitoba or Canada",
    inShort:
      "Based in Winnipeg, serving clients everywhere. Your local consumer rights still apply.",
    clauses: [
      {
        label: "Based in Winnipeg.",
        text: "The Coach is based in Winnipeg, Manitoba, Canada, and provides the Services from Canada to clients across Canada and around the world.",
      },
      {
        label: "Currency and bank fees.",
        text: "Prices are in Canadian dollars unless the checkout says otherwise. Your bank or card issuer may charge currency-conversion or foreign-transaction fees, which are your responsibility.",
      },
      {
        label: "Taxes and duties.",
        text: "Taxes shown at checkout are included in what you pay. You are responsible for any other taxes, duties or levies that apply where you live.",
      },
      {
        label: "Local laws and suitability.",
        text: "You are responsible for making sure that the training, nutrition and supplement guidance you receive is appropriate and lawful where you live.",
      },
      {
        label: "Emergencies.",
        text: "The Coach cannot send or arrange emergency help to your location. In an emergency, call your local emergency number (for example 911 in Canada and the United States).",
      },
      {
        label: "Your local rights.",
        text: "Nothing in this Agreement removes consumer-protection, privacy or other rights you have under the laws where you live that cannot lawfully be waived by contract. If any term cannot be enforced where you live, the rest of this Agreement still applies.",
      },
    ],
  },
  {
    id: "final",
    title: "Final Terms",
    inShort: "The remaining ground rules, including how this Agreement can change.",
    clauses: [
      {
        label: "Force majeure.",
        text: "The Coach is not liable for delays or interruptions caused by events outside the Coach’s control, including illness, injury, emergencies, power or internet outages, extreme weather, travel disruptions, facility closures and platform outages. No refunds will be issued for these events, except as described in Section {{n:conduct}} if the Coach permanently ends your Services.",
      },
      {
        label: "No employment or partnership.",
        text: "Nothing in this Agreement creates an employment relationship, partnership, joint venture or agency relationship between you and the Coach.",
      },
      {
        label: "Severability.",
        text: "If any part of this Agreement is found invalid, the rest remains enforceable.",
      },
      {
        label: "Survival.",
        text: "Sections about payment obligations, refunds, disputes, chargebacks, content rights, privacy, intellectual property, release, indemnity, limitation of liability and governing law survive termination.",
      },
      {
        label: "Entire agreement and changes.",
        text: "This is the entire agreement about its subject matter. Verbal statements do not change it, and changes must be in writing. It replaces any earlier agreement between you and the Coach going forward, but commitments, balances and purchases made under an earlier agreement stay in effect.",
      },
      {
        label: "Updates.",
        text: "The Coach may update this Agreement from time to time. An update applies to future purchases and renewals once you have been notified in the app or by email and have accepted it (the app may ask you to review and sign again). An update will not change the price, term or payment schedule of a commitment you have already purchased without your agreement.",
      },
      {
        label: "Assignment.",
        text: "You may not assign this Agreement or transfer it to anyone else. The Coach may assign it to a successor to the business and will notify you.",
      },
      {
        label: "Notices.",
        text: "Notices to the Coach go to the official email address. Notices to you may be given in the app, by push notification or to the email address on your account, so please keep it current.",
      },
      {
        label: "Electronic signing and records.",
        text: "Digital signatures (drawn or typed), checkboxes and submitting payment all count as valid acceptance and are legally binding. You agree to sign and receive this Agreement electronically. Your signed copy is stored in your account for you to view at any time, you are emailed a receipt, and you may ask the Coach for a paper or PDF copy at no charge. Your signature is recorded with the date and time, your account, and your device and network details.",
      },
      {
        label: "Your review.",
        text: "You confirm you had the opportunity to read this Agreement, ask questions and seek independent legal advice before signing, and that you sign voluntarily.",
      },
      {
        label: "Under 18.",
        text: "If you are under 18, a parent or legal guardian must also sign, and agrees to be responsible for your participation and payment obligations to the extent permitted by law.",
      },
    ],
  },
  {
    id: "signing",
    title: "Signatures",
    inShort: "Your signature means you agree to everything above.",
    clauses: [
      {
        text: "By signing, you confirm that you have read, understood and agree to all terms of this Agreement, including every section, and that you agree to be legally bound by it.",
      },
      {
        label: "Parent or guardian (if the client is under 18).",
        text: "A parent or legal guardian signs on the minor’s behalf, confirming they agree to this Agreement and accept responsibility for the minor’s participation and payment obligations to the extent permitted by law.",
      },
    ],
  },
];

const SECTION_NUMBER_BY_ID: Record<string, number> = Object.fromEntries(
  RAW_SECTIONS.map((s, i) => [s.id, i + 1]),
);

/** Resolves `{{n:section-id}}` tokens to section numbers. Throws on an unknown id. */
export function resolveRefs(text: string): string {
  return text.replace(/\{\{n:([a-z0-9-]+)\}\}/g, (_match, id: string) => {
    const n = SECTION_NUMBER_BY_ID[id];
    if (!n) throw new Error(`Unknown agreement section reference: ${id}`);
    return String(n);
  });
}

const KEY_TERMS: { title: string; text: string }[] = [
  {
    title: "One agreement for everything",
    text: "This covers every service and purchase you make with the Coach, now and later.",
  },
  {
    title: "All sales are final",
    text: "No refunds, except where the law requires one or the Coach ends your Services for reasons that aren’t your fault (Sections {{n:refunds}} and {{n:conduct}}).",
  },
  {
    title: "Commitments are owed in full",
    text: "Fixed terms and installment plans must be paid in full. Leaving early doesn’t cancel the balance. The Coach may offer a buyout at 50% of what’s left, at the Coach’s discretion.",
  },
  {
    title: "Cancel by email",
    text: "Recurring plans renew automatically. To cancel, email jaredjamesfit@gmail.com before your next billing date.",
  },
  {
    title: "Failed payments",
    text: "Services may pause until you pay, and a $25 fee may apply.",
  },
  {
    title: "Freezes",
    text: "Possible at the Coach’s discretion, up to 30 days, and requested in writing before they start.",
  },
  {
    title: "In-person sessions",
    text: "Reschedule with at least 24 hours’ notice. Sessions expire 6 months after you buy them.",
  },
  {
    title: "Health and safety",
    text: "The Coach isn’t a doctor or dietitian. Tell the Coach about injuries and conditions, and stop if something feels wrong.",
  },
  {
    title: "Risk and release",
    text: "Training carries real risk, including serious injury. You accept it and release the Coach from claims, including negligence, as far as the law allows.",
  },
  {
    title: "Your privacy and content",
    text: "Your health information and coaching content are used to coach you. Public use of your photos or results needs your permission, which you choose when you sign.",
  },
  {
    title: "Disputes",
    text: "Email first. Manitoba law applies, and your local consumer rights still apply. Claims must be brought within 12 months.",
  },
];

const ACKNOWLEDGEMENTS: AgreementAcknowledgement[] = [
  {
    id: "money",
    short: "Purchases, no refunds and commitments",
    text: "I understand this Agreement covers every purchase I make now or later, that all sales are final, and that fixed-term commitments and installment plans are owed in full. My in-app records, Stripe receipts and emails are the record of what I bought. (Sections {{n:services}} to {{n:freeze}})",
  },
  {
    id: "risk",
    short: "Assumption of risk and release",
    text: "I understand training carries real risk, including serious injury or death. I accept those risks and release the Coach from claims, including negligence, to the fullest extent the law allows. (Sections {{n:risk}} and {{n:release}})",
  },
  {
    id: "health",
    short: "Health disclosure and privacy consent",
    text: "I have told the Coach about my injuries, health conditions and limits, and I will keep them updated. The Coach is not a doctor, therapist or dietitian. I consent to my health and personal information being collected and used as described in Section {{n:privacy}}, including by service providers that may be outside Canada. (Sections {{n:health}} and {{n:privacy}})",
  },
  {
    id: "disputes",
    short: "Disputes and governing law",
    text: "I agree to the dispute terms: Manitoba law, informal resolution first, a 12-month limit on claims, and the jury-trial and class-action waivers where the law allows. My local consumer rights still apply. (Sections {{n:disputes}} and {{n:international}})",
  },
  {
    id: "review",
    short: "Review and voluntary signing",
    text: "I had the chance to read this Agreement, ask questions and get independent legal advice. I am signing voluntarily and electronically. (Section {{n:final}})",
  },
];

const OPTIONAL_CONSENTS: AgreementOptionalConsent[] = [
  {
    key: "testimonial_use",
    label: "Testimonials and results",
    text: "The Coach may share my quotes, results and before-and-after progress publicly, with my name or social handle.",
  },
  {
    key: "social_publication",
    label: "Social media, website and ads",
    text: "The Coach may use my approved photos and videos on JF Effect social accounts, the website and advertising.",
  },
];

function finalize(): AgreementContent {
  const sections: AgreementSection[] = RAW_SECTIONS.map((s, i) => ({
    ...s,
    number: i + 1,
    clauses: s.clauses.map((c) => ({
      ...(c.label ? { label: c.label } : {}),
      text: resolveRefs(c.text),
    })),
  }));

  return {
    version: AGREEMENT_VERSION,
    title: AGREEMENT_TITLE,
    subtitle: AGREEMENT_SUBTITLE,
    effectiveDate: AGREEMENT_EFFECTIVE_DATE,
    coach: COACH,
    intro: [
      {
        text: "**READ CAREFULLY. THIS IS A LEGALLY BINDING AGREEMENT.** By signing, you confirm that you have read and understood it and agree to be legally bound by it. You may be giving up certain legal rights, including the right to make claims for negligence. Headings, the Key Terms summary and the “In short” notes are for convenience only and do not change the full terms.",
      },
      {
        text: "This Agreement is between you (the “Client” or “you”) and **JF Effect / Jared James Fit**, operated by Jared James McIntyre in Winnipeg, Manitoba, Canada (together, the “Coach”). It applies to every service the Coach provides, including online coaching, in-person personal training, hybrid coaching, programs, templates, guides, consultations, education, form review, feedback, app access and any future service the Coach offers (the “Services”).",
      },
      {
        label: "Start date.",
        text: resolveRefs(
          "This Agreement begins on the date you sign it or the date of your first payment to the Coach, whichever happens first. If you signed an earlier agreement with the Coach, this Agreement replaces it going forward; commitments, balances and purchases made under the earlier agreement stay in effect (see Section {{n:final}}).",
        ),
      },
    ],
    keyTerms: KEY_TERMS.map((k) => ({ title: k.title, text: resolveRefs(k.text) })),
    sections,
    acknowledgements: ACKNOWLEDGEMENTS.map((a) => ({ ...a, text: resolveRefs(a.text) })),
    optionalConsents: OPTIONAL_CONSENTS,
    intentStatement:
      "I have read and understand this Coaching Agreement, I agree to be legally bound by it, and I am signing it electronically and voluntarily. I understand my electronic signature has the same legal effect as a handwritten signature.",
    guardianStatement:
      "I am the parent or legal guardian of the minor named above. I have read and agree to this Agreement on the minor’s behalf, I consent to the minor’s participation in the Services, and I accept responsibility for the minor’s participation and for payment obligations under this Agreement to the extent permitted by law.",
    payorStatement: resolveRefs(
      "The person paying for my Services has been given the chance to read this Agreement. I understand that by making any payment they accept the payment terms in Sections {{n:services}} to {{n:freeze}} and are financially responsible for those charges.",
    ),
  };
}

export const AGREEMENT_CONTENT: AgreementContent = finalize();

/** Serialized exactly once; this string is what gets hashed and stored with every signature. */
export const AGREEMENT_CONTENT_JSON: string = JSON.stringify(AGREEMENT_CONTENT);

/**
 * SHA-256 of AGREEMENT_CONTENT_JSON for every version that has been published.
 * A test asserts the live content matches the entry for AGREEMENT_VERSION, so the
 * words of a published version can never be edited without bumping the version.
 */
export const PUBLISHED_CONTENT_HASHES: Record<string, string> = {
  "2.0": "4229b1a2f2913bbbc6728de7b3ad42b0257009cbea547d97de722d6c0a820711",
};

export function sectionNumber(id: string): number {
  const n = SECTION_NUMBER_BY_ID[id];
  if (!n) throw new Error(`Unknown agreement section: ${id}`);
  return n;
}

/** Splits `**bold**` markup into renderable runs. Unbalanced markers render as plain text. */
export function parseInline(text: string): { text: string; bold: boolean }[] {
  const parts = text.split("**");
  if (parts.length % 2 === 0) return [{ text: text.replace(/\*\*/g, ""), bold: false }];
  return parts
    .map((part, i) => ({ text: part, bold: i % 2 === 1 }))
    .filter((run) => run.text.length > 0);
}
