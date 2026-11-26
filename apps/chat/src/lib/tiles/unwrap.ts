/** Unwrap an MCP CallToolResult once, before mapping. */

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function textFromContent(result: Record<string, unknown>): string | undefined {
	const content = result.content;
	if (!Array.isArray(content)) return undefined;
	for (const block of content) {
		if (!isRecord(block) || block.type !== "text") continue;
		if (typeof block.text === "string" && block.text.trim() !== "") return block.text;
	}
	return undefined;
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

/**
 * Prefer `structuredContent` (daemon `details`). Fall back to parsing the
 * first text content block. A bare object with no MCP envelope is already
 * unwrapped (unit tests, inner details).
 */
export function unwrapToolResult(result: unknown): unknown {
	if (!isRecord(result)) return undefined;
	if (result.structuredContent !== undefined && result.structuredContent !== null) {
		return result.structuredContent;
	}
	const text = textFromContent(result);
	if (text !== undefined) {
		const parsed = parseJson(text);
		if (parsed !== undefined) return parsed;
	}
	if (result.content !== undefined) return undefined;
	return result;
}
