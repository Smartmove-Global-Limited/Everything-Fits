// Difficulty shown on the Home Play button (Figma "EF / Play · Difficulty": Easy green, Hard
// orange, Super Hard red). Each level has its own "playDifficulty" in levels.json, set in the
// Level Editor; a level without it takes it from the editor's computed tier.
export type PlayDifficulty = 'Easy' | 'Hard' | 'Super Hard';
export const PLAY_DIFFICULTIES: PlayDifficulty[] = ['Easy', 'Hard', 'Super Hard'];

const FROM_TIER: Record<string, PlayDifficulty> = { Easy: 'Easy', Medium: 'Hard', Hard: 'Hard', 'Very Hard': 'Super Hard', Challenge: 'Super Hard' };

export function playDifficultyOf(level: any): PlayDifficulty {
  const d = level?.playDifficulty;
  if (PLAY_DIFFICULTIES.includes(d)) return d;
  return FROM_TIER[level?.difficulty?.tier] || 'Easy';
}
