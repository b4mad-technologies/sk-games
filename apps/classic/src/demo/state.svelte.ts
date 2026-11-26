// Shared mock state. One module-level rune object stands in for the session
// handle a real app would get from the extracted Play session library.

import { ABILITIES, classes, recommendedScores } from "./fixtures";

export type Screen = "create" | "world" | "fight" | "sheet";

export type LogLine = {
	id: number;
	kind: "story" | "speech" | "roll" | "refusal" | "system";
	text: string;
	who?: string;
};

export type Hero = {
	created: boolean;
	name: string;
	classId: string;
	backgroundId: string;
	speciesId: string;
	skills: string[];
	cantrips: string[];
	spells: string[];
	kitId: string;
	items: string[];
	scores: number[];
	hp: number;
	hpMax: number;
	ac: number;
	xp: number;
	slotsUsed: number;
};

// A ready-made hero, so every screen works without walking the wizard first.
const defaultHero: Hero = {
	created: false,
	name: "Mira Ashgrove",
	classId: "wizard",
	backgroundId: "sage",
	speciesId: "elf",
	skills: ["Arcana", "Investigation"],
	cantrips: ["fire-bolt", "light", "mage-hand"],
	spells: ["magic-missile", "shield", "sleep"],
	kitId: "a",
	items: ["Quarterstaff", "Dagger", "Backpack", "Torch"],
	scores: recommendedScores("wizard"),
	hp: 8,
	hpMax: 8,
	ac: 12,
	xp: 0,
	slotsUsed: 0,
};

export const app = $state({
	screen: "create" as Screen,
	showGaps: true,
	hero: { ...defaultHero },
	log: [] as LogLine[],
	/** Counts fights started; a new value resets the fight screen. */
	fightKey: 0,
});

let nextLogId = 1;

export function say(kind: LogLine["kind"], text: string, who?: string): void {
	app.log.push({ id: nextLogId++, kind, text, who });
	if (app.log.length > 200) app.log.splice(0, app.log.length - 200);
}

export function modifier(score: number): number {
	return Math.floor((score - 10) / 2);
}

export function signed(value: number): string {
	return value >= 0 ? `+${value}` : `${value}`;
}

export function heroClass() {
	return classes.find((entry) => entry.id === app.hero.classId) ?? classes[0]!;
}

export function abilityRows() {
	return ABILITIES.map((ability, index) => ({
		...ability,
		score: app.hero.scores[index] ?? 10,
		modifier: modifier(app.hero.scores[index] ?? 10),
	}));
}

export function d(sides: number): number {
	return 1 + Math.floor(Math.random() * sides);
}
