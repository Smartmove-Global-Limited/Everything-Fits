// Difficulty shown on the Home Play button (Figma "EF / Play · Difficulty": Easy green, Hard
// orange, Super Hard red). Each level has its own "playDifficulty" in levels.json, set in the
// Level Editor; a level without it takes it from the editor's computed tier.
import { Color } from 'cc';

export type PlayDifficulty = 'Easy' | 'Hard' | 'Super Hard';
export const PLAY_DIFFICULTIES: PlayDifficulty[] = ['Easy', 'Hard', 'Super Hard'];

/** Colours of each difficulty (Figma EF / Play · Difficulty): fill, lip */
export const PLAY_COLORS: Record<PlayDifficulty, [Color, Color]> = {
  Easy: [new Color(0x34, 0x74, 0x50, 255), new Color(0x24, 0x53, 0x3A, 255)],
  Hard: [new Color(0xA9, 0x71, 0x3F, 255), new Color(0x7E, 0x51, 0x29, 255)],
  'Super Hard': [new Color(0xA9, 0x4F, 0x50, 255), new Color(0x7A, 0x36, 0x37, 255)],
};

const FROM_TIER: Record<string, PlayDifficulty> = { Easy: 'Easy', Medium: 'Hard', Hard: 'Hard', 'Very Hard': 'Super Hard', Challenge: 'Super Hard' };

export function playDifficultyOf(level: any): PlayDifficulty {
  const d = level?.playDifficulty;
  if (PLAY_DIFFICULTIES.includes(d)) return d;
  return FROM_TIER[level?.difficulty?.tier] || 'Easy';
}
