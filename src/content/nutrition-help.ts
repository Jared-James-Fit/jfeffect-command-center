export type FaqItem = { q: string; a: string };
export type ResourceItem = { title: string; bullets: string[] };

export const NUTRITION_FAQS: FaqItem[] = [
  { q: "How exact do I need to be with my macros?", a: "Consistency matters more than perfection. Aim to stay close to your calorie and protein targets. Small daily differences are normal." },
  { q: "Do I need to hit every macro perfectly?", a: "Prioritize total calories and protein first. Carbohydrates and fats can vary slightly unless your coach has given you more specific instructions." },
  { q: "What should I do if I go over my calories?", a: "Do not starve yourself the next day. Return to your normal targets at the next meal and focus on your weekly consistency." },
  { q: "What happens if I eat below my targets?", a: "One low day is not a crisis. Repeatedly under-eating can affect recovery, energy, training performance, and adherence." },
  { q: "Can I save calories for the weekend?", a: "A weekly calorie approach can work, but large restriction-and-binge cycles usually make progress harder. Keep daily intake reasonably consistent." },
  { q: "How much protein should I eat?", a: "Use the protein target shown in your plan. Spread protein across several meals when possible." },
  { q: "Should I eat before training?", a: "A meal containing carbohydrates and protein before training can support energy and performance. Choose foods that digest comfortably." },
  { q: "What should I eat after training?", a: "Have a normal meal containing protein and carbohydrates within a reasonable period after training. Exact timing is less important than total daily intake." },
  { q: "Are carbohydrates bad for fat loss?", a: "No. Fat loss is primarily driven by sustained energy balance. Carbohydrates can support training performance and recovery." },
  { q: "Are fats bad for fat loss?", a: "No. Dietary fats support health and help make meals satisfying. Portions still matter because fats are calorie-dense." },
  { q: "How much water should I drink?", a: "Start with the water target inside the app. Increase intake when training hard, sweating heavily, or spending time in hot conditions." },
  { q: "Why did my weight increase overnight?", a: "Daily body weight can change because of water, sodium, carbohydrates, digestion, stress, sleep, and hormonal changes. Look at the longer-term trend." },
  { q: "How often should I weigh myself?", a: "Follow your coach's instructions. Frequent weigh-ins can provide better trend data when interpreted calmly rather than judged one day at a time." },
  { q: "What should I do if my weight has stopped changing?", a: "Confirm that food is being logged accurately and consistently. Look at several weeks of data before changing targets. Coaching clients should contact their coach before making adjustments." },
  { q: "Do I need to log vegetables, sauces, drinks, and cooking oils?", a: "Yes, when they contain meaningful calories. Oils, sauces, creamers, beverages, and small extras are commonly missed." },
  { q: "How do I log restaurant food?", a: "Use the restaurant's nutrition information when available. Otherwise, select a close database entry and make a reasonable estimate." },
  { q: "Can I eat foods that are not in the meal plan?", a: "Unless your coach has given different instructions, foods can usually be exchanged while keeping calories, protein, and portions similar." },
  { q: "Do I need supplements?", a: "Supplements are optional and cannot replace consistent nutrition, training, hydration, and sleep. Coaching clients should follow the plan discussed with their coach." },
  { q: "Why are my targets waiting for approval?", a: "Some coaching plans require a coach to review nutrition targets before they become active. Your current approved plan remains active while the estimate is reviewed." },
  { q: "How do I contact my coach about nutrition?", a: "Use the Contact Coach button inside Nutrition Help. Include the issue, the dates involved, and any relevant food logs or progress information." },
];

export const NUTRITION_RESOURCES: ResourceItem[] = [
  { title: "Understanding Calories", bullets: [
    "Calories represent energy.",
    "Body weight changes are influenced by long-term energy balance.",
    "Daily scale changes do not equal instant fat gain or loss.",
    "Consistency over time matters more than one meal.",
  ]},
  { title: "Understanding Protein", bullets: [
    "Protein supports muscle retention, recovery, and growth.",
    "Daily intake is more important than perfect timing.",
    "Spread protein across multiple meals.",
    "Examples: meat, fish, eggs, dairy, tofu, legumes, and suitable protein products.",
  ]},
  { title: "Carbohydrates and Training", bullets: [
    "Carbohydrates are an important training fuel.",
    "They can support strength, volume, and recovery.",
    "Pre-workout and post-workout meals can include carbohydrates.",
    "Carbohydrates do not automatically cause fat gain.",
  ]},
  { title: "Dietary Fats", bullets: [
    "Fats support health and meal satisfaction.",
    "Include a mix of fat sources.",
    "Portion awareness matters because fats contain more calories per gram than protein or carbohydrates.",
  ]},
  { title: "Food Logging Accuracy", bullets: [
    "Use a food scale when appropriate.",
    "Confirm cooked versus uncooked entries.",
    "Log oils, sauces, drinks, bites, and snacks.",
    "Avoid choosing database entries with obviously incorrect nutrition values.",
    "Save frequently used meals for faster logging.",
  ]},
  { title: "Eating Around Workouts", bullets: [
    "Before training: protein plus carbohydrates, moderate portions, foods that digest comfortably.",
    "After training: protein, carbohydrates, fluids, and a normal balanced meal.",
  ]},
  { title: "Managing Hunger", bullets: [
    "Eat enough protein.",
    "Include fruits and vegetables.",
    "Choose filling meals.",
    "Drink enough water.",
    "Maintain a consistent meal schedule.",
    "Avoid creating an unnecessarily aggressive deficit.",
  ]},
  { title: "Eating Out", bullets: [
    "Review the menu in advance.",
    "Prioritize a clear protein source.",
    "Be aware of sauces, oils, drinks, and large portions.",
    "Estimate honestly rather than skipping the log.",
    "Return to normal eating afterward.",
  ]},
  { title: "Understanding Body-Weight Fluctuations", bullets: [
    "Fluctuations may come from water retention, sodium, carbohydrate intake, digestion, stress, sleep, training fatigue, and hormonal changes.",
    "Use trends instead of reacting to one weigh-in.",
  ]},
  { title: "When to Contact Your Coach", bullets: [
    "Hunger or fatigue is consistently high.",
    "Training performance is declining.",
    "You cannot follow the targets.",
    "Weight is changing much faster or slower than planned.",
    "Digestion is repeatedly problematic.",
    "You need food substitutions.",
    "Several weeks of accurate data show no expected progress.",
  ]},
];