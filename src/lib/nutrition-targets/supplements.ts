/**
 * Supplement advice for one client, from the evidence and their own record,
 * decided in code (never by a model, so doses and safety calls are always the
 * same for the same record). The nutrition AI reads it alongside the targets,
 * the coach reviews and edits it, and the client sees what the coach publishes.
 *
 * The approach (food first, only what's worth it):
 * - Core: creatine monohydrate for anyone lifting, vitamin D3 for anyone in
 *   Canada (the sun can't make it about October to April), B12 for vegans.
 * - Considered only when their record calls for it: omega-3 when no fatty fish
 *   is in their food, magnesium for poor sleep / cramps / constipation,
 *   calcium when dairy is out or after menopause, psyllium fibre for
 *   constipation, IBS or a GLP-1 medication, a basic multivitamin on a diet
 *   that cuts out food groups or low calories, a probiotic during antibiotics.
 * - Check first (a blood test or their doctor): iron, B12 on metformin or acid
 *   reducers, anything a condition or medication on file makes risky.
 * - Convenience, never needed: protein powder, caffeine, electrolytes.
 * - Never: what has no good evidence or a high contamination risk (BCAAs, fat
 *   burners, testosterone boosters, detoxes); named when they take one.
 * - Safety: pregnancy, breastfeeding and under 18 switch to doctor-first;
 *   kidney disease rules out creatine and magnesium; blood thinners put
 *   omega-3 behind their doctor; medications get their timing (thyroid
 *   medication 4 hours from minerals, antibiotics 2–6 hours).
 * - Drug-tested: only third-party-certified products (NSF Certified for Sport,
 *   Informed Sport), no pre-workouts or fat burners, every medication checked
 *   on Global DRO for a Therapeutic Use Exemption. It lowers the risk; nothing
 *   guarantees a clean test.
 * - Budget: "essentials" keeps to the core, the checks and cheap needs; the
 *   rest is offered as extras the coach can add.
 *
 * Doses follow the ISSN position stands (creatine, caffeine), Health Canada's
 * upper limits (vitamin D 4,000 IU, supplemental magnesium 350 mg, caffeine
 * 400 mg a day, 300 mg in pregnancy) and the IOC 2018 consensus on supplements
 * in athletes. Written to the client ("you"): what's published is theirs to read.
 */

export type SupplementKey =
  | "creatine"
  | "vitamin_d"
  | "omega3"
  | "magnesium"
  | "protein"
  | "caffeine"
  | "b12"
  | "calcium"
  | "fibre"
  | "multivitamin"
  | "iron"
  | "prenatal"
  | "electrolytes"
  | "probiotic";

export type Budget = "essentials" | "some" | "open";

/** One supplement on a published plan (nutrition_targets.supplements.items), as the client reads it. */
export type PlanSupplement = {
  key?: SupplementKey | null;
  name: string;
  dose: string;
  timing: string;
  why?: string | null;
  note?: string | null;
};

/** A plan's supplements as stored: the items and the lines under them. */
export type PlanSupplements = { items: PlanSupplement[]; notes: string[] };

export type SupplementPick = PlanSupplement & {
  key: SupplementKey;
  /** core = take it; consider = worth it for this record; check = a blood test or their doctor first. */
  tier: "core" | "consider" | "check";
  /** Rough cost a month: $ under ~$10, $$ ~$10–25, $$$ more. */
  cost: "$" | "$$" | "$$$";
  /** They take it now. */
  already: boolean;
  /** For the coach: what in their record put it here. */
  reason: string;
  foodFirst?: string | null;
};

export type SupplementAdvice = {
  picks: SupplementPick[];
  /** Worth it if the budget allows (the coach can add them). */
  extras: SupplementPick[];
  /** Left out, and why (for the coach). */
  skipped: Array<{ name: string; reason: string }>;
  /** Lines under the list. `client` ones are published with it. */
  notes: Array<{ text: string; for: "client" | "coach" }>;
  tested: boolean;
};

export type SupplementInput = {
  sex: "male" | "female" | null;
  age: number | null;
  weightKg: number | null;
  /** Lifts weights (every client with a program). */
  lifts: boolean;
  /** Powerlifter, or a meet on file. */
  competes: boolean;
  drugTested: boolean | null;
  /** Days to their next meet, and whether they make a weight class. */
  meetInDays?: number | null;
  weightClass?: boolean;
  /** Diets on file (food history labels: "AIP", "Vegan", ...). */
  diets: string[];
  /** Allergens on file ("Fish", "Shellfish", "Dairy", ...). */
  allergies: string[];
  /** Conditions and injuries on file, as text. */
  health: string;
  medications: string;
  /** What they take now, as text. */
  takes: string;
  /** Their plan's foods and their food answers, as text. */
  foods: string;
  /** `foods` holds a meal plan (so what isn't in it isn't eaten); a food answer alone never rules a food group out. */
  planGiven?: boolean;
  /** Calories a day across their week. */
  kcal?: number | null;
  /** Their last weekly check-ins: how many, and how many flagged sleep / digestion / energy. */
  checkins?: { total: number; sleep: number; digestion: number; energy: number };
  budget: Budget;
};

const has = (re: RegExp, ...texts: Array<string | null | undefined>) => texts.some((t) => !!t && re.test(t));

/* ------------------------------------------------------------------ */
/* What their record says                                              */

const KIDNEY = /\b(kidney|renal|ckd|dialysis|nephr\w*)\b/i;
const PREGNANT = /\bpregnan\w*|\bbreast-?feed\w*|\bbreastfeed\w*|\btrying to conceive\b|\bttc\b|\bivf\b/i;
const BLOOD_THINNER =
  /\b(warfarin|coumadin|apixaban|eliquis|rivaroxaban|xarelto|dabigatran|pradaxa|edoxaban|lixiana|clopidogrel|plavix|ticagrelor|brilinta|prasugrel|heparin|enoxaparin|lovenox|blood thinners?|anticoagul\w*|antiplatelet)\b/i;
const BLEEDING = /\b(bleeding disorder|hemophilia|haemophilia|von willebrand)\b/i;
const THYROID_MED = /\b(levothyroxine|synthroid|eltroxin|euthyrox|tirosint|liothyronine|cytomel|armour thyroid|thyroid (med\w*|pills?|hormone))\b/i;
const MINERAL_ANTIBIOTIC = /\b(doxycycline|tetracycline|minocycline|ciprofloxacin|cipro|levofloxacin|moxifloxacin|quinolone)\b/i;
const ANTIBIOTIC = /\b(antibiotics?|doxycycline|tetracycline|minocycline|ciprofloxacin|cipro|levofloxacin|moxifloxacin|amoxicillin|amoxil|clavulin|augmentin|azithromycin|zithromax|cephalexin|keflex|clindamycin)\b/i;
const METFORMIN = /\b(metformin|glucophage|janumet|synjardy|xigduo)\b/i;
const PPI = /\b(omeprazole|esomeprazole|pantoprazole|lansoprazole|rabeprazole|dexlansoprazole|nexium|losec|prilosec|pantoloc|tecta|prevacid|dexilant|acid reducers?)\b/i;
const GLP1 = /\b(ozempic|wegovy|rybelsus|mounjaro|zepbound|saxenda|semaglutide|tirzepatide|liraglutide|glp-?1)\b/i;
const BP_POTASSIUM = /\b(lisinopril|ramipril|enalapril|perindopril|quinapril|captopril|losartan|valsartan|candesartan|irbesartan|telmisartan|olmesartan|spironolactone|eplerenone|ace inhibitors?)\b/i;
const THIAZIDE = /\b(hydrochlorothiazide|hctz|chlorthalidone|indapamide|metolazone|thiazides?)\b/i;
const STIMULANT_MED = /\b(adderall|vyvanse|elvanse|ritalin|concerta|biphentin|foquest|methylphenidate|amphetamines?|lisdexamfetamine|dexedrine|dextroamphetamine|modafinil|adhd med\w*)\b/i;
const LITHIUM = /\blithium\b/i;
const BISPHOSPHONATE = /\b(alendronate|fosamax|risedronate|actonel|ibandronate|boniva)\b/i;
const HEART = /\b(heart (condition|disease|failure|attack)|cardiac|arrhythmi\w*|a-?fib|atrial fibrillation|palpitations?|hypertension|high blood pressure|tachycardia)\b/i;
const ANXIETY_SLEEP = /\b(anxiety|panic (attacks?|disorder)|insomnia)\b/i;
const GUT_CONDITION = /\b(ibs|irritable bowel|crohn\w*|colitis|celiac|coeliac|sibo|diverticul\w*)\b/i;
const CONSTIPATION = /\bconstipat\w*/i;
const ANEMIA = /\b(anemi\w*|anaemi\w*|low iron|iron deficien\w*|low ferritin|heavy periods?|menorrhagia)\b/i;
const LOW_VITAMIN_D = /\b(low vitamin d|vitamin d deficien\w*|low vit d)\b/i;
const BONE = /\b(osteopor\w*|osteopeni\w*|menopaus\w*|peri-?menopaus\w*|post-?menopaus\w*|stress fractures?)\b/i;
const CALCIUM_RISK = /\b(hypercalc\w*|sarcoid\w*|kidney stones?|hyperparathyroid\w*)\b/i;
const SURGERY = /\bsurgery\b/i;
const CRAMPS = /\bcramp\w*/i;
const SWEAT = /\b(heavy sweat\w*|sweat a lot|salty sweat\w*|sweater)\b/i;

/** Medications that may need a Therapeutic Use Exemption in drug-tested sport (WADA list: prohibited at all times or in competition). */
const TUE_MEDS: Array<[RegExp, string]> = [
  [/\b(testosterone|trt|anabolic|nandrolone|oxandrolone|hgh|growth hormone)\b/i, "testosterone or other hormones"],
  [/\binsulin\b/i, "insulin"],
  [/\b(diuretics?|water pills?|furosemide|lasix|hydrochlorothiazide|hctz|chlorthalidone|indapamide|spironolactone|bumetanide|torsemide)\b/i, "a diuretic (water pill)"],
  [STIMULANT_MED, "an ADHD stimulant"],
  [/\b(prednisone|prednisolone|dexamethasone|methylprednisolone|medrol|cortisone (shot|injection)|steroid (pills?|shot|injection))\b/i, "a corticosteroid"],
  [/\b(clomiphene|clomid|tamoxifen|anastrozole|arimidex|letrozole|femara|exemestane)\b/i, "a hormone blocker"],
];
const ASTHMA = /\b(asthma|inhaler|salbutamol|ventolin|albuterol|symbicort|advair|formoterol|salmeterol|terbutaline)\b/i;

/** What they take now, by supplement. */
const TAKES: Record<SupplementKey, RegExp> = {
  creatine: /creatine/i,
  vitamin_d: /\bvit(amin)?\.? ?d3?\b|\bd3\b|cholecalciferol/i,
  omega3: /omega|fish oil|krill|algae oil|algal|\bdha\b|\bepa\b|cod liver/i,
  magnesium: /magnesium|\bzma\b/i,
  protein: /whey|protein powder|casein|plant protein|isolate|protein shakes?/i,
  caffeine: /caffeine|pre-?workout|coffee|espresso/i,
  b12: /\bb-?12\b|methylcobalamin|cyanocobalamin|b[- ]complex/i,
  calcium: /calcium/i,
  fibre: /psyllium|metamucil|benefiber|fib(re|er) (supplement|powder)/i,
  multivitamin: /multi-?vitamin|\bmulti\b|centrum|one[- ]a[- ]day/i,
  iron: /\biron\b|ferrous|feramax|ferritin/i,
  prenatal: /pre-?natal|materna/i,
  electrolytes: /electrolytes?|\blmnt\b|liquid i\.?v|nuun|pedialyte|salt tabs?/i,
  probiotic: /probiotics?|lactobacillus|bifido\w*|saccharomyces|culturelle|florastor/i,
};

/** Things not worth the money (or the risk), named when they take one. */
const NOT_WORTH: Array<[RegExp, string, string, boolean]> = [
  [/\b(bcaas?|eaas?|amino acids?)\b/i, "BCAAs / EAAs", "Not needed when protein is on target: their food and any protein powder already cover it.", false],
  [/fat burn\w*|thermogenic|\bcla\b|garcinia|raspberry ketones?|l-?carnitine|yohimbine|synephrine/i, "Fat burners", "No meaningful fat loss beyond the caffeine in them, and among the most often contaminated products.", true],
  [/test(osterone)? boost\w*|tribulus|tongkat|fenugreek|d-?aspartic|\bdaa\b/i, "Testosterone boosters", "No reliable effect on muscle or strength in healthy people, and a high contamination risk.", true],
  [/\bdetox\w*|\bcleanse\w*/i, "Detox / cleanse products", "The liver and kidneys already do this, and they can cause cramping or diarrhea.", false],
  [/greens? powder|athletic greens|\bag1\b|superfood powder/i, "Greens powder", "Fine, but fruit and vegetables do more for less money.", false],
  [/\bcollagen\b/i, "Collagen", "Doesn't build muscle like other protein; the evidence for joints is early. Keep it only if they like it.", false],
  [/ashwagandha/i, "Ashwagandha", "Some early evidence for stress and sleep, but it can change thyroid levels and isn't for pregnancy: check with their doctor first.", false],
  [/pre-?workout/i, "Pre-workout blend", "Mostly caffeine at a higher price; coffee or plain caffeine does the same.", true],
];

const round25 = (n: number) => Math.round(n / 25) * 25;

/** The advice for one client. */
export function adviseSupplements(x: SupplementInput): SupplementAdvice {
  const health = x.health ?? "";
  const meds = x.medications ?? "";
  const takes = x.takes ?? "";
  const foods = x.foods ?? "";
  const diets = x.diets.map((d) => d.toLowerCase());
  const allergies = x.allergies.map((a) => a.toLowerCase());
  const tested = x.drugTested === true;
  const female = x.sex === "female";
  const age = x.age;
  const ck = x.checkins ?? { total: 0, sleep: 0, digestion: 0, energy: 0 };
  const often = (n: number) => ck.total >= 2 && n >= 2 && n / ck.total >= 0.3;

  const vegan = diets.includes("vegan");
  const vegetarian = vegan || diets.includes("vegetarian");
  const fishAllergy = allergies.includes("fish");
  const fishFree = vegetarian || fishAllergy;
  const dairyOut = allergies.includes("dairy") || diets.some((d) => ["vegan", "dairy-free", "aip", "paleo", "whole30"].includes(d));
  const restrictive = diets.filter((d) => ["aip", "vegan", "carnivore", "keto"].includes(d));
  const kidney = has(KIDNEY, health, meds);
  const pregnant = has(PREGNANT, health, meds);
  const thinner = has(BLOOD_THINNER, meds, health) || has(BLEEDING, health);
  const glp1 = has(GLP1, meds, health);
  const constipated = has(CONSTIPATION, health) || glp1;
  const gut = has(GUT_CONDITION, health);
  const calciumRisk = has(CALCIUM_RISK, health);
  // only a meal plan says what they don't eat: "I eat anything" never means no dairy
  const lowDairyInFood = !!x.planGiven && !/\b(milk|yog\w*urt|cheese|cottage|kefir|skyr|fortified|whey|casein)\b/i.test(foods);
  const paleoLike = diets.some((d) => ["aip", "paleo", "whole30"].includes(d));

  const picks: SupplementPick[] = [];
  const extras: SupplementPick[] = [];
  const skipped: SupplementAdvice["skipped"] = [];
  const skippedKeys = new Set<SupplementKey>();
  const skip = (key: SupplementKey | null, name: string, reason: string) => {
    if (key) skippedKeys.add(key);
    skipped.push({ name, reason });
  };
  const notes: SupplementAdvice["notes"] = [];
  const add = (p: Omit<SupplementPick, "already"> & { need?: boolean; convenience?: boolean }) => {
    const already = TAKES[p.key].test(takes);
    const { need, convenience, ...pick } = p;
    // drug-tested: "certified only" is said once, in the notes under the list (never repeated on every item)
    const full: SupplementPick = { ...pick, already, note: pick.note ?? null };
    // what goes on the list: core and checks always; then by budget (something they already buy always stays)
    const onList =
      full.tier !== "consider" ||
      already ||
      x.budget === "open" ||
      (x.budget === "some" && !convenience) ||
      (x.budget === "essentials" && !!need && full.cost === "$");
    (onList ? picks : extras).push(full);
  };

  // Under 18 and pregnancy / breastfeeding: their doctor first, almost nothing else.
  if (age != null && age < 18) {
    add({
      key: "vitamin_d",
      tier: "core",
      name: "Vitamin D3",
      dose: "600–1,000 IU a day",
      timing: "With a meal, October to April at least",
      why: "Most Canadians run low on vitamin D in winter.",
      cost: "$",
      reason: "Under 18: only the basics.",
    });
    skip("creatine", "Creatine, caffeine and pre-workouts", "Under 18: food first; anything more only with their doctor and a parent.");
    notes.push({ text: "Under 18: food comes first. Talk to your doctor before taking anything else.", for: "client" });
    return finish();
  }
  if (pregnant) {
    add({
      key: "prenatal",
      tier: "core",
      name: "Prenatal vitamin",
      dose: "As your doctor or midwife says (with folic acid, iron and iodine)",
      timing: "Daily, with food",
      why: "Covers folic acid, iron and iodine for you and the baby.",
      cost: "$",
      reason: "Pregnancy, breastfeeding or trying to conceive on file.",
    });
    add({
      key: "omega3",
      tier: "check",
      name: fishAllergy || vegetarian ? "DHA (algae oil)" : "DHA (fish or algae oil)",
      dose: "As your doctor says (often about 200–300 mg DHA a day)",
      timing: "With a meal",
      why: "DHA supports the baby's brain and eyes.",
      cost: "$$",
      reason: "Pregnancy: ask their doctor about DHA.",
    });
    skip("creatine", "Creatine", "Not enough safety research in pregnancy or breastfeeding.");
    notes.push({ text: "Pregnant or breastfeeding: check every supplement with your doctor or midwife first, and keep caffeine to 300 mg a day or less (Health Canada).", for: "client" });
    return finish();
  }

  // Creatine monohydrate.
  if (kidney) skip("creatine", "Creatine", "Kidney condition on file: only with their doctor's OK.");
  else {
    const nearMeet = x.weightClass && x.meetInDays != null && x.meetInDays >= 0 && x.meetInDays <= 42 && !TAKES.creatine.test(takes);
    add({
      key: "creatine",
      tier: nearMeet ? "consider" : x.lifts ? "core" : "consider",
      name: "Creatine monohydrate",
      dose: x.weightKg != null && x.weightKg < 70 ? "3–5 g a day" : "5 g a day",
      timing: nearMeet
        ? "Start after your meet: the first weeks add about 1–2 lb of water, which matters at weigh-ins"
        : "Any time of day, every day (rest days too), with a meal or shake. No loading or breaks needed",
      why:
        "The most researched supplement for strength and muscle, and it works the same for women and men." +
        (age != null && age >= 50 ? " With lifting it also helps you keep and build muscle as you age." : ""),
      note:
        "Plain creatine monohydrate powder: the cheapest kind works best. The scale may go up 1–2 lb in the first weeks: that's water in the muscle, not fat. Tell your doctor you take it before a kidney blood test (it raises creatinine)." +
        (ck.digestion >= 2 || gut ? " If it upsets your stomach, split it into 2 doses with meals." : ""),
      cost: "$",
      reason: nearMeet ? "Lifts, but a weigh-in is within 6 weeks: start after the meet." : "Lifts: the strongest evidence for strength and muscle.",
    });
  }

  // Vitamin D3.
  if (calciumRisk) skip("vitamin_d", "Vitamin D", "Calcium, kidney-stone or parathyroid condition on file: only at the dose their doctor sets.");
  else if (has(LOW_VITAMIN_D, health))
    add({
      key: "vitamin_d",
      tier: "check",
      name: "Vitamin D3",
      dose: "The dose your doctor prescribed",
      timing: "With a meal that has some fat",
      why: "Low vitamin D is on file.",
      cost: "$",
      reason: "Known low vitamin D: their doctor's dose.",
    });
  else {
    const thiazide = has(THIAZIDE, meds);
    add({
      key: "vitamin_d",
      tier: "core",
      name: "Vitamin D3",
      dose: thiazide ? "1,000 IU (25 mcg) a day" : "1,000–2,000 IU (25–50 mcg) a day",
      timing: "With a meal that has some fat. October to April at least (Canada's sun can't make it then); all year if you're 50+ or rarely outside",
      why: "Most Canadians run low in winter. It supports bones, muscle and immune health.",
      note: thiazide
        ? "You're on a water pill (thiazide): keep to 1,000 IU unless your doctor says more."
        : "D3, not D2. Don't go over 4,000 IU a day without a blood test.",
      cost: "$",
      reason: "Lives in Canada: low sun from October to April.",
    });
  }

  // B12: vegans always; long-term metformin or acid reducers, or 60+, check.
  if (vegan)
    add({
      key: "b12",
      tier: "core",
      name: "Vitamin B12",
      dose: "25–100 mcg a day, or 2,000 mcg once a week",
      timing: "Any time",
      why: "Plant foods don't have B12, so every vegan needs it.",
      cost: "$",
      reason: "Vegan diet on file.",
    });
  else if (has(METFORMIN, meds) || has(PPI, meds) || (age != null && age >= 60))
    add({
      key: "b12",
      tier: "check",
      name: "Vitamin B12",
      dose: "25–100 mcg a day if a blood test shows it's low",
      timing: "Any time",
      why: has(METFORMIN, meds) ? "Long-term metformin lowers B12." : has(PPI, meds) ? "Long-term acid reducers lower B12." : "B12 absorption drops with age.",
      note: "Ask your doctor to check it.",
      cost: "$",
      reason: has(METFORMIN, meds) ? "On metformin." : has(PPI, meds) ? "On an acid reducer (PPI)." : "60+.",
    });
  else if (vegetarian)
    add({
      key: "b12",
      tier: "consider",
      name: "Vitamin B12",
      dose: "25–100 mcg a day",
      timing: "Any time",
      why: "Vegetarians who eat few eggs and little dairy run low.",
      cost: "$",
      need: true,
      reason: "Vegetarian diet on file.",
    });

  // Omega-3: only when fatty fish isn't in their food.
  if (/\b(salmon|sardines?|mackerel|trout|herring|anchov\w*|arctic char|albacore)\b/i.test(foods))
    skip("omega3", "Omega-3", "Fatty fish is in their food: food covers it.");
  else {
    add({
      key: "omega3",
      tier: thinner ? "check" : "consider",
      name: fishFree ? "Algae oil (omega-3)" : "Fish oil (omega-3)",
      dose: "1–2 g of EPA + DHA combined a day (add up the EPA and DHA on the label, not the oil)",
      timing: "With a meal",
      why: fishFree ? "You don't eat fish, so this covers the omega-3s fish would give you." : "You don't eat fatty fish twice a week, so this fills the gap for heart health.",
      note: [
        thinner ? "You're on a blood thinner: ask your doctor before taking it." : null,
        has(SURGERY, health) ? "Stop it a week before any surgery unless your surgeon says otherwise." : null,
        allergies.includes("shellfish") && !fishAllergy ? "Fine with a shellfish allergy; skip krill oil." : null,
      ]
        .filter(Boolean)
        .join(" ") || null,
      foodFirst: fishFree ? null : "Food first: salmon, trout or sardines twice a week covers it.",
      cost: "$$",
      reason: thinner ? "No fatty fish, but on a blood thinner: their doctor first." : fishFree ? "Doesn't eat fish." : "No fatty fish in their food.",
    });
  }

  // Magnesium: when sleep, cramps or constipation keep coming up, or a medication drains it.
  const sleepy = often(ck.sleep);
  const cramps = has(CRAMPS, health);
  const magReason = sleepy ? "sleep" : constipated ? "constipation" : cramps ? "cramps" : has(PPI, meds) ? "ppi" : restrictive.length ? "diet" : null;
  if (magReason) {
    if (kidney) skip("magnesium", "Magnesium", "Kidney condition on file: only with their doctor's OK.");
    else
      add({
        key: "magnesium",
        tier: "consider",
        name: magReason === "constipation" ? "Magnesium citrate" : "Magnesium glycinate",
        dose: "200–350 mg of elemental magnesium a day",
        timing: "In the evening",
        why:
          magReason === "sleep"
            ? "Sleep keeps coming up in your check-ins. Magnesium may help if your intake is low, and it's cheap and low risk."
            : magReason === "constipation"
              ? "Citrate gently helps keep you regular."
              : magReason === "cramps"
                ? "May help cramps when your intake is low."
                : magReason === "ppi"
                  ? "Long-term acid reducers can lower magnesium."
                  : "Your diet cuts out some of the foods magnesium comes from.",
        note: "Keep supplements under 350 mg a day: more causes loose stools.",
        foodFirst: "Food first: pumpkin seeds, nuts, beans, spinach, potatoes, oats, dark chocolate.",
        cost: "$",
        need: magReason !== "sleep",
        reason: magReason === "sleep" ? `Sleep flagged in ${ck.sleep} of ${ck.total} check-ins.` : magReason === "constipation" ? "Constipation (or a GLP-1) on file." : magReason === "cramps" ? "Cramps on file." : magReason === "ppi" ? "On an acid reducer (PPI)." : `${restrictive.join(", ")} diet.`,
      });
  }

  // Calcium: dairy out, or bones need more (menopause, osteoporosis).
  const bone = has(BONE, health) || (female && age != null && age >= 51);
  if (dairyOut || lowDairyInFood || bone) {
    if (calciumRisk) skip("calcium", "Calcium", "Calcium or kidney-stone condition on file: only with their doctor's OK.");
    else
      add({
        key: "calcium",
        tier: "consider",
        name: "Calcium citrate",
        dose: bone ? "500 mg a day, so food plus supplement reach about 1,200 mg" : "500 mg a day, only on days you get under about 2 servings of dairy or fortified alternatives",
        timing: "With a meal. 2 hours away from iron, 4 hours from thyroid medication",
        why: bone ? "Bones need more calcium after menopause." : "Your food has little dairy, so calcium can run low.",
        foodFirst: "Food first: fortified soy or almond milk, yogurt if it fits, canned salmon or sardines with bones, tofu made with calcium.",
        cost: "$",
        need: true,
        reason: bone ? "Menopause / bone condition, or a woman over 50." : dairyOut ? "Dairy out (diet or allergy)." : "No dairy in their food.",
      });
  }

  // Iron: never without a blood test.
  const ironRisk = female && (has(ANEMIA, health) || vegetarian || often(ck.energy));
  if (ironRisk || (!female && has(ANEMIA, health)))
    add({
      key: "iron",
      tier: "check",
      name: "Iron (only after a blood test)",
      dose: "Only if a blood test shows low iron or ferritin, at the dose your doctor sets",
      timing: "Away from calcium, coffee and tea by 2 hours",
      why: has(ANEMIA, health)
        ? "Low iron or heavy periods are on file."
        : vegetarian
          ? "Women who don't eat meat often run low on iron."
          : "Low energy keeps coming up in your check-ins: ask your doctor to check ferritin and vitamin D.",
      note: "Too much iron is harmful, so never guess the dose.",
      foodFirst: "Food first: red meat, beans and lentils with vitamin C (fruit, peppers).",
      cost: "$",
      reason: has(ANEMIA, health) ? "Anemia / heavy periods on file." : vegetarian ? "Female, vegetarian." : `Female, low energy in ${ck.energy} of ${ck.total} check-ins.`,
    });

  // Psyllium fibre: constipation, IBS, a GLP-1, or digestion flagged often.
  if (constipated || gut || often(ck.digestion))
    add({
      key: "fibre",
      tier: "consider",
      name: "Psyllium husk (fibre)",
      dose: "1 tsp (about 5 g) a day, building up to 2 tsp over 1–2 weeks",
      timing: "In a full glass of water. 2 hours away from medications",
      why: glp1 ? "A GLP-1 slows digestion; soluble fibre and water keep things moving." : "Soluble fibre is the best-proven supplement for regularity and is gentle on IBS.",
      foodFirst: "Food first: fruit, potatoes with the skin, oats and vegetables, built up slowly with more water.",
      cost: "$",
      need: true,
      reason: glp1 ? "On a GLP-1." : gut ? "Gut condition on file." : constipated ? "Constipation on file." : `Digestion flagged in ${ck.digestion} of ${ck.total} check-ins.`,
    });

  // A basic multivitamin: a diet that cuts out food groups, low calories, or a GLP-1.
  const lowKcal = x.kcal != null && x.kcal > 0 && x.kcal < (female ? 1500 : 1800);
  if (restrictive.length || lowKcal || glp1)
    add({
      key: "multivitamin",
      tier: "consider",
      name: "Basic multivitamin",
      dose: "1 a day (a standard one, no mega-doses)",
      timing: "With breakfast",
      why: restrictive.length
        ? `${restrictive.map((d) => (d === "aip" ? "AIP" : d.charAt(0).toUpperCase() + d.slice(1))).join(" and ")} cuts out whole food groups; a basic multi covers the gaps.`
        : glp1
          ? "Eating less on a GLP-1 means fewer vitamins and minerals; a basic multi is cheap insurance."
          : "Lower calories mean fewer vitamins and minerals; a basic multi is cheap insurance while the plan runs.",
      cost: "$",
      need: true,
      reason: restrictive.length ? `${restrictive.join(", ")} diet.` : glp1 ? "On a GLP-1." : `About ${x.kcal} kcal a day.`,
    });

  // A probiotic during antibiotics.
  if (has(ANTIBIOTIC, meds))
    add({
      key: "probiotic",
      tier: "consider",
      name: "Probiotic (while on antibiotics)",
      dose: "Lactobacillus rhamnosus GG or Saccharomyces boulardii, as the label says",
      timing: "2 hours away from the antibiotic, and for 1–2 weeks after",
      why: "Can lower the chance of diarrhea from antibiotics.",
      cost: "$$",
      need: true,
      reason: "On an antibiotic.",
    });

  // Convenience: protein powder, caffeine, electrolytes.
  if (/\b(whey|protein powder|casein|plant protein|protein shake|isolate)\b/i.test(foods)) skip("protein", "Protein powder", "Already in their meal plan.");
  else
    add({
      key: "protein",
      tier: "consider",
      // AIP / paleo rule out dairy, legumes and grains: beef protein isolate fits; vegans and a milk allergy get a plant blend
      name: paleoLike ? "Beef protein isolate" : allergies.includes("dairy") || vegan ? "Plant protein powder (pea and rice)" : "Whey protein",
      dose: "1 scoop (about 25 g protein) on days food doesn't get you to your protein",
      timing: "Any time; after training or as a snack is easiest",
      why: "Only for convenience: food does the same job, but it's often the cheapest protein per gram.",
      note: paleoLike
        ? "Fits AIP and paleo (no dairy, legumes or grains)."
        : allergies.includes("dairy") && !vegan
          ? "With lactose (not a milk allergy), whey isolate is usually fine."
          : null,
      cost: "$$",
      convenience: true,
      reason: "Convenience only.",
    });

  const caffeineOut = has(HEART, health, meds) ? "heart or blood pressure" : has(ANXIETY_SLEEP, health) ? "anxiety or insomnia" : has(STIMULANT_MED, meds) ? "an ADHD stimulant" : has(LITHIUM, meds) ? "lithium" : null;
  if (caffeineOut) skip("caffeine", "Caffeine before training", `${caffeineOut.charAt(0).toUpperCase() + caffeineOut.slice(1)} on file: ask their doctor first.`);
  else {
    const lo = x.weightKg ? Math.min(250, Math.max(100, round25(2 * x.weightKg))) : 100;
    const hi = x.weightKg ? Math.max(lo + 50, Math.min(300, round25(3 * x.weightKg))) : 200;
    add({
      key: "caffeine",
      tier: "consider",
      name: "Caffeine before training",
      dose: `About ${lo}–${hi} mg (a coffee has about 100 mg)`,
      timing: "30–60 minutes before training, and none within 8 hours of bed",
      why: "Proven to help strength and effort. A coffee does the job.",
      note: tested
        ? "Use coffee, or caffeine tablets certified by NSF Certified for Sport or Informed Sport, never a pre-workout blend. Stay under 400 mg a day in total."
        : "Stay under 400 mg a day in total.",
      cost: "$",
      convenience: true,
      reason: "Optional performance boost.",
    });
  }

  if (has(SWEAT, health) || has(CRAMPS, health) || glp1)
    add({
      key: "electrolytes",
      tier: "consider",
      name: "Electrolytes / salt",
      dose: "Salt your food; on long or very sweaty sessions, a drink with about 300–600 mg sodium",
      timing: "During or after long or hot sessions",
      why: glp1 ? "Eating and drinking less on a GLP-1 makes dehydration easier." : "Replaces the sodium sweat takes out.",
      note: has(BP_POTASSIUM, meds) ? "You're on a blood pressure medication: skip mixes high in potassium." : has(HEART, health) ? "Ask your doctor before adding salt." : null,
      cost: "$$",
      convenience: true,
      reason: glp1 ? "On a GLP-1." : "Heavy sweating or cramps on file.",
    });

  return finish();

  function finish(): SupplementAdvice {
    // What they take that isn't worth it.
    for (const [re, name, reason, risky] of NOT_WORTH) {
      if (!re.test(takes)) continue;
      skipped.push({ name: `${name} (they take it)`, reason: tested && risky ? `${reason} Stop it while drug-tested.` : reason });
    }
    // What they take that nothing on file calls for: fine to keep.
    for (const key of Object.keys(TAKES) as SupplementKey[]) {
      if (key === "caffeine" || !TAKES[key].test(takes)) continue;
      if ([...picks, ...extras].some((p) => p.key === key) || skippedKeys.has(key)) continue;
      skipped.push({ name: `${labelOf(key)} (they take it)`, reason: "Nothing on file calls for it; fine to keep if it helps them." });
    }

    // Lines under the list.
    if (tested)
      notes.push({
        text: "You're drug-tested: a positive test counts even when a supplement was contaminated. Only use products certified by NSF Certified for Sport or Informed Sport, keep the batch number and receipt, and skip pre-workouts, fat burners and testosterone boosters. Certification lowers the risk; nothing guarantees a clean test.",
        for: "client",
      });
    if (tested) {
      const tue = TUE_MEDS.filter(([re]) => re.test(meds)).map(([, what]) => what);
      if (tue.length)
        notes.push({
          text: `Before competing, check ${andList(tue)} on Global DRO (globaldro.com): ${tue.length === 1 ? "it" : "each"} may need a Therapeutic Use Exemption (TUE) from the anti-doping body.`,
          for: "client",
        });
      else if (has(ASTHMA, meds, health)) notes.push({ text: "Check your asthma medication on Global DRO (globaldro.com): most inhalers are allowed up to set doses, some need a TUE.", for: "client" });
      else if (meds.trim()) notes.push({ text: "Check every medication you take on Global DRO (globaldro.com) before competing.", for: "client" });
    }
    if (x.drugTested == null && x.competes)
      notes.push({ text: "They compete: set whether they're drug-tested in their health profile so supplements follow testing rules.", for: "coach" });
    const listed = [...picks];
    const hasMineral = listed.some((p) => ["calcium", "magnesium", "iron", "multivitamin"].includes(p.key));
    if (has(THYROID_MED, meds) && hasMineral) notes.push({ text: "Take calcium, iron, magnesium and multivitamins at least 4 hours away from your thyroid medication.", for: "client" });
    if (has(MINERAL_ANTIBIOTIC, meds) && hasMineral) notes.push({ text: "Keep magnesium, calcium, iron and multivitamins 2–6 hours away from your antibiotic.", for: "client" });
    if (has(BISPHOSPHONATE, meds) && hasMineral) notes.push({ text: "Take your bone medication alone first thing; calcium and magnesium later in the day.", for: "client" });
    if (glp1) notes.push({ text: "On a GLP-1: protein first at every meal, plenty of water, and fibre built up slowly.", for: "client" });
    if (gut || often(ck.digestion))
      notes.push({
        text: `Gut health first: fibre from fruit, vegetables, oats and potatoes built up slowly, 2–3 L of water a day, yogurt or kefir if dairy fits, regular meal times, and note which foods set it off before cutting whole food groups.${gut ? " Bigger changes (like low FODMAP) go through a registered dietitian." : ""}`,
        for: "client",
      });
    if (meds.trim()) notes.push({ text: "Tell your doctor and pharmacist about every supplement you take.", for: "client" });
    if (kidney || has(HEART, health) || calciumRisk || thinner) notes.push({ text: "A condition or medication on file changes what's safe: they should run the list past their doctor.", for: "coach" });

    const order: Record<SupplementPick["tier"], number> = { core: 0, check: 1, consider: 2 };
    const sort = (xs: SupplementPick[]) => xs.sort((a, b) => order[a.tier] - order[b.tier] || CATALOG.indexOf(a.key) - CATALOG.indexOf(b.key));
    return { picks: sort(picks), extras: sort(extras), skipped, notes, tested };
  }
}

/** "a, b and c" */
function andList(xs: string[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

const CATALOG: SupplementKey[] = ["prenatal", "creatine", "vitamin_d", "b12", "omega3", "iron", "magnesium", "calcium", "fibre", "multivitamin", "probiotic", "protein", "caffeine", "electrolytes"];

function labelOf(key: SupplementKey): string {
  return {
    creatine: "Creatine",
    vitamin_d: "Vitamin D",
    omega3: "Omega-3",
    magnesium: "Magnesium",
    protein: "Protein powder",
    caffeine: "Caffeine",
    b12: "B12",
    calcium: "Calcium",
    fibre: "Fibre",
    multivitamin: "Multivitamin",
    iron: "Iron",
    prenatal: "Prenatal",
    electrolytes: "Electrolytes",
    probiotic: "Probiotic",
  }[key];
}

/** The advice as it's published with a plan: the list and the client's lines. */
export function planSupplementsFrom(a: SupplementAdvice): PlanSupplements {
  return {
    items: a.picks.map(toPlanItem),
    notes: a.notes.filter((n) => n.for === "client").map((n) => n.text),
  };
}

export function toPlanItem(p: SupplementPick | PlanSupplement): PlanSupplement {
  const foodFirst = (p as SupplementPick).foodFirst;
  return {
    key: p.key ?? null,
    name: p.name,
    dose: p.dose,
    timing: p.timing,
    why: p.why ?? null,
    note: [p.note, foodFirst].filter(Boolean).join(" ") || null,
  };
}

/** A stored value read back (null, an old array, or { items, notes }). */
export function readPlanSupplements(v: unknown): PlanSupplements {
  const obj = (v && typeof v === "object" ? v : {}) as any;
  const rawItems: unknown[] = Array.isArray(v) ? v : Array.isArray(obj.items) ? obj.items : [];
  const items = rawItems
    .map((x: any) => ({
      key: typeof x?.key === "string" ? (x.key as SupplementKey) : null,
      name: String(x?.name ?? "").trim(),
      dose: String(x?.dose ?? "").trim(),
      timing: String(x?.timing ?? "").trim(),
      why: x?.why ? String(x.why).trim() : null,
      note: x?.note ? String(x.note).trim() : null,
    }))
    .filter((x) => x.name);
  const notes = (Array.isArray(obj.notes) ? obj.notes : []).map((n: unknown) => String(n ?? "").trim()).filter(Boolean);
  return { items, notes };
}

/** The supplements as the AI reads them (alongside the targets). */
export function supplementsForAi(a: SupplementAdvice): string {
  const line = (p: SupplementPick) => `${p.name}: ${p.dose}${p.already ? " (already takes it)" : ""} [${p.tier}: ${p.reason}]`;
  return [
    "SUPPLEMENTS (decided by the app's evidence rules from their record; the coach reviews them. Don't write supplements into the plan. Under Flags, name anything in their answers that argues against one, or a supplement they take that's risky):",
    ...(a.picks.length ? a.picks.map((p) => `- ${line(p)}`) : ["- none"]),
    ...(a.extras.length ? [`- If budget allows: ${a.extras.map((p) => p.name).join(", ")}`] : []),
    ...(a.skipped.length ? [`- Left out: ${a.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}`] : []),
  ].join("\n");
}
