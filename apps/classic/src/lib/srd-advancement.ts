// The SRD 5.2 Character Advancement table: the experience a level asks for.
//
// The world keeps the same column as a rule (`srd/xp_threshold`, the gate of
// `srd/advancement/level-up`) and tells a player only that leveling "cannot
// be done right now". The app is coupled to the SRD ruleset
// (apps/classic/CLAUDE.md), so the sheet may say how far the next level is.

const XP_FOR_LEVEL = [
	0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000,
	195000, 225000, 265000, 305000, 355000,
] as const;

/** The experience needed to reach `level` (2..20); undefined beyond the table. */
export function xpForLevel(level: number): number | undefined {
	return level >= 2 ? XP_FOR_LEVEL[level - 1] : undefined;
}
