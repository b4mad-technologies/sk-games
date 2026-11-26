// Small helpers for the words the world sends.

/**
 * A question as somebody says it, without the list of numbered answers the
 * world appends to the same sentence ("Which class? 1 Fighter, 2 Rogue." or
 * "... a room for you. 1: I'll clear it. 2: Not today."). The talk panel
 * shows those answers as cards; the story keeps the sentence whole.
 */
export function withoutAnswerList(text: string): string {
	const list = /\s+1[:.)]?\s+\S[\s\S]*?[\s,]2[:.)]?\s+\S/.exec(text);
	// A lone "1" proves nothing; a "1 ... 2 ..." run after a full sentence does.
	const single = /^([\s\S]*[.?!…])\s+1[:.)]?\s+\S[^?]*$/.exec(text);
	if (list && list.index > 0) {
		const head = text.slice(0, list.index).trim();
		if (/[.?!…:)]$/.test(head)) return head;
	}
	if (!list && single?.[1] && /^Which\b/.test(text)) return single[1].trim();
	return text;
}

/**
 * A question without the count the world puts before its question mark
 * ("Which skill (2 more)?"). The talk panel says how many are left to pick.
 */
export function withoutPickCount(text: string): string {
	return text.replace(/\s*\(\d+ more\)(?=\?)/, "");
}

/**
 * The numbered answers somebody names at the end of what they say ("... as
 * you are. 1: Take the companion. 2: Walk alone a while longer."), or null
 * when the sentence names none. The numbers count up from 1.
 */
export function answerList(text: string): { question: string; answers: string[] } | null {
	const question = withoutAnswerList(text);
	if (question === text) return null;
	const rest = text.slice(question.length);
	const marks: { at: number; end: number }[] = [];
	for (const match of rest.matchAll(/(^|[\s,])(\d+)[:.)]?\s+/g)) {
		if (Number(match[2]) !== marks.length + 1) continue;
		const at = match.index + (match[1]?.length ?? 0);
		marks.push({ at, end: match.index + match[0].length });
	}
	const answers = marks.map((mark, index) =>
		rest
			.slice(mark.end, marks[index + 1]?.at ?? rest.length)
			.trim()
			.replace(/,$/, ""),
	);
	return answers.length > 0 && answers.every((answer) => answer !== "")
		? { question, answers }
		: null;
}

/**
 * What was answered so far in a guided talk, for its last step: there the
 * speaker asks for a yes to the whole, and the top line cuts long answers.
 * Empty before the last step.
 */
export function answeredSoFar(
	outline: readonly { label: string; value?: string; current: boolean }[] | undefined,
): { label: string; value: string }[] {
	if (!outline?.at(-1)?.current) return [];
	return outline.flatMap((step) => (step.value ? [{ label: step.label, value: step.value }] : []));
}

/**
 * What the talk partner said since the hero last did something, for the talk
 * panel: a bubble is gone after a few seconds, and two replies in a row leave
 * only the second one. The hero's own words, an answer given by a click and
 * an arrival all count as doing something. At most the last two sentences;
 * what was said before the app opened is the past.
 */
export function saidSince(
	lines: readonly { kind: string; text: string; thingId?: string; old?: boolean }[],
	speakerId: string,
): string[] {
	const acted = lines.findLastIndex((line) => line.kind !== "speech" && line.kind !== "story");
	return lines
		.slice(acted + 1)
		.filter((line) => line.kind === "speech" && line.thingId === speakerId && !line.old)
		.slice(-2)
		.map((line) => withoutAnswerList(line.text));
}

/**
 * What the speaker said right before the open question, out of what they
 * said since the hero last did something. The answer to the hero's last
 * words is often followed at once by the next question ("End Sister
 * Maelis." and then "Raid smoke on the road ..."); it would be seen only
 * in the story. One sentence at most; none without a question.
 */
export function saidBefore(said: readonly string[], question: string | undefined): string[] {
	if (!question) return [];
	return said.filter((sentence) => sentence !== question).slice(-1);
}

/**
 * What a set of ability scores costs by the SRD's point cost table (8 costs
 * nothing, 13 costs 5, 14 costs 7, 15 costs 9). Undefined for a score the
 * table does not know: then the stage counts nothing.
 */
const POINT_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

export function pointsSpent(scores: readonly number[]): number | undefined {
	let total = 0;
	for (const score of scores) {
		const cost = POINT_COST[score];
		if (cost === undefined) return undefined;
		total += cost;
	}
	return total;
}
