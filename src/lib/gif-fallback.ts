const MAP: Record<string, string> = {
  // Hype
  "fire": "🔥",
  "let's go": "🚀",
  "lets go": "🚀",
  "locked in": "⚡",
  "big energy": "💥",
  // PR / Wins
  "pr celebration": "🏆",
  "trophy": "🏆",
  "strong work": "💪",
  "strong": "💪",
  // Reviewed
  "reviewed": "✅",
  "approved": "👍",
  // Support
  "clap": "👏",
  "proud": "🥹",
  "keep going": "💪",
  // Celebration
  "confetti": "🎉",
  "party": "🥳",
  // Funny
  "lol": "😂",
  "crying laughing": "🤣",
  // Gym Pain
  "dead": "💀",
  "leg day pain": "🦵",
  "everything hurts": "😩",
  // Cardio
  "cardio suffering": "🥵",
  "dying on treadmill": "🏃‍♂️💀",
  // Excuses
  "i forgot": "🤷",
  "i was busy": "🙃",
  "sure jan": "🙄",
  // Coach reactions
  "side eye": "👀",
  "be serious": "🤨",
  "thinking": "🤔",
  // Food
  "starving": "🍽️",
  "chicken & rice again": "🍗",
  // Deload
  "zombie mode": "🧟",
};

const CATEGORY: Record<string, string> = {
  "Hype": "🔥",
  "PR / Wins": "🏆",
  "Reviewed": "✅",
  "Support": "👏",
  "Celebration": "🎉",
  "Funny": "😂",
  "Coach Reactions": "👀",
  "Gym Pain": "😩",
  "Cardio": "🥵",
  "Food / Diet": "🍽️",
  "Excuses": "🙄",
  "Deload / Dead": "💀",
  "Custom": "✨",
};

export function fallbackEmoji(title?: string | null, category?: string | null): string {
  const t = (title ?? "").trim().toLowerCase();
  if (t && MAP[t]) return MAP[t];
  for (const key of Object.keys(MAP)) {
    if (t.includes(key)) return MAP[key];
  }
  if (category && CATEGORY[category]) return CATEGORY[category];
  return "✨";
}