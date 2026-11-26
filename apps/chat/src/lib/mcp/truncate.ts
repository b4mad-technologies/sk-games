export const TOOL_RESULT_ARRAY_LIMIT = 20;
export const TOOL_RESULT_STRING_LIMIT = 2000;

const TRUNCATED_NOTE = "… truncated";

export function truncateToolResultJson(
	value: unknown,
	arrayLimit = TOOL_RESULT_ARRAY_LIMIT,
	stringLimit = TOOL_RESULT_STRING_LIMIT,
): { text: string; truncated: boolean } {
	let truncated = false;

	const walk = (node: unknown): unknown => {
		if (typeof node === "string") {
			if (node.length > stringLimit) {
				truncated = true;
				return `${node.slice(0, stringLimit)}${TRUNCATED_NOTE}`;
			}
			return node;
		}
		if (Array.isArray(node)) {
			const sliced = node.length > arrayLimit ? node.slice(0, arrayLimit) : node;
			if (sliced.length !== node.length) truncated = true;
			const mapped = sliced.map(walk);
			if (node.length > arrayLimit) mapped.push(TRUNCATED_NOTE);
			return mapped;
		}
		if (node !== null && typeof node === "object") {
			const out: Record<string, unknown> = {};
			for (const [key, child] of Object.entries(node)) {
				out[key] = walk(child);
			}
			return out;
		}
		return node;
	};

	const walked = walk(value);
	const text = JSON.stringify(walked, null, 2);
	if (truncated) {
		return {
			text: `${text}\n(truncated: arrays>${arrayLimit} or strings>${stringLimit})`,
			truncated,
		};
	}
	return { text, truncated };
}
