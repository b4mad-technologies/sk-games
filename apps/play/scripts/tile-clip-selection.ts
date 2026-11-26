// Only direct, card-local widgets can narrow the sweep. Shared dependencies,
// layout, fixture, workflow and unknown inputs all conservatively run every card.
const cardFiles: Record<string, string> = {
	"packages/spellkave-ui-widgets/src/Hero.svelte": "hero",
	"packages/spellkave-ui-widgets/src/Pack.svelte": "pack",
	"packages/spellkave-ui-widgets/src/Place.svelte": "place",
};
export const allCards = ["table", "map", "place", "hero", "pack"];
export function selectCards(files: string[]): string[] {
	if (files.length === 0 || files.some((file) => !Object.hasOwn(cardFiles, file))) return allCards;
	return [...new Set(files.map((file) => cardFiles[file]))];
}

/** `demo.html` beats the remainder sweep measures, each at both viewports. */
export const sweepBeats = [
	"fight",
	"fight-conditions",
	"fight-crowd",
	"talk-burst",
	"place-long",
	"hero-drafting",
];
export const sweepViewports = 2;

/**
 * Layout probes (`tile-clip-layout.ts`), each owned by the one card whose
 * layout it proves. A narrowed card selection runs only its own probes; the
 * full selection runs all of them.
 */
export const layoutProbeCards: Record<string, string> = {
	"place-card-rows": "place",
	"stream-under-filter": "table",
	"hero-drafting-vitals": "hero",
};
/** The `demo.html` beat each layout probe loads. */
export const layoutProbeBeats: Record<string, string> = {
	"place-card-rows": "place-long",
	"stream-under-filter": "stream-detail",
	"hero-drafting-vitals": "hero-drafting",
};
export function selectLayoutProbes(cards: string[]): string[] {
	return Object.entries(layoutProbeCards)
		.filter(([, card]) => cards.includes(card))
		.map(([probe]) => probe);
}
