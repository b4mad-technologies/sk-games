// The story: what the world said and did, with what the hero's own clicks
// came to sorted in between.
//
// A click's result is known only after the world answered, and by then the
// world's reply to it (the foe's counter-attack, the next turn) has often
// arrived too. Sorting a result by the time it was noted puts it below its
// own consequences. So every result remembers the last world line that was
// on screen when the player clicked, and is placed right after that line.

export type StoryLine = {
	key: string;
	tick: number;
	who: string;
	text: string;
	mine?: boolean;
	result?: boolean;
};

export type ClickResult = {
	id: number;
	/** Key of the last world line shown when the player clicked; null when
	 * there was none. */
	after: string | null;
	text: string;
};

/** World lines in tick order; arrival order decides between equal ticks. */
export function inTickOrder(lines: readonly StoryLine[]): StoryLine[] {
	return [...lines].sort((a, b) => a.tick - b.tick);
}

/**
 * Put each click result right after the world line it followed. Results that
 * share an anchor keep their own order. A result whose anchor is no longer
 * among the lines (it slid out of the window) leads the story.
 */
export function withResults(
	world: readonly StoryLine[],
	results: readonly ClickResult[],
): StoryLine[] {
	const known = new Set(world.map((line) => line.key));
	const byAnchor = new Map<string | null, StoryLine[]>();
	for (const result of results) {
		const anchor = result.after !== null && known.has(result.after) ? result.after : null;
		const line: StoryLine = {
			key: `r${result.id}`,
			tick: 0,
			who: "",
			text: result.text,
			mine: false,
			result: true,
		};
		byAnchor.set(anchor, [...(byAnchor.get(anchor) ?? []), line]);
	}
	const out: StoryLine[] = [...(byAnchor.get(null) ?? [])];
	for (const line of world) {
		out.push(line, ...(byAnchor.get(line.key) ?? []));
	}
	return out;
}
