import { describe, expect, it } from "vitest";
import {
	buildFeedbackClientWirePayload,
	FEEDBACK_CLIENT_TRAIL_LIMIT,
	feedbackMessageByteLength,
	gatherFeedbackClientSection,
	isHttpUrl,
	submitFeedback,
} from "./feedback";
import type { PlayTrailEntry } from "./play-trail";

describe("feedbackMessageByteLength", () => {
	it("counts ASCII as one byte per character", () => {
		expect(feedbackMessageByteLength("hello")).toBe(5);
	});

	it("counts a multi-byte character by its UTF-8 encoding, not its length", () => {
		// "é" is one UTF-16 code unit but two UTF-8 bytes.
		expect(feedbackMessageByteLength("é")).toBe(2);
		expect("é".length).toBe(1);
	});
});

describe("isHttpUrl", () => {
	it("accepts an absolute http(s) URL", () => {
		expect(isHttpUrl("https://github.com/b4mad-technologies/sk-games/issues/1")).toBe(true);
	});

	it("rejects a bare reference id from the in-memory dev sink", () => {
		expect(isHttpUrl("local-feedback-1")).toBe(false);
	});

	it("rejects a non-http(s) scheme", () => {
		expect(isHttpUrl("javascript:alert(1)")).toBe(false);
	});
});

function layoutEntry(tile: string, level: string, id: number): PlayTrailEntry {
	return { id, at: id, tick: 0, kind: "layout", tile, level, trigger: "tap" };
}

describe("gatherFeedbackClientSection", () => {
	it("reads the viewport and the trail from the given window", () => {
		const trail: PlayTrailEntry[] = [layoutEntry("table", "stage", 1)];
		const section = gatherFeedbackClientSection({
			innerWidth: 1280,
			innerHeight: 720,
			__spellkavePlayTrail: trail,
		});
		expect(section.viewport).toEqual({ width: 1280, height: 720 });
		expect(section.trail).toBe(trail);
	});

	it("carries the given RUM diagnostics", () => {
		const rum = { runId: "d54646db-291f-4666-b197-54cfb6833c9f", sampled: true };
		const section = gatherFeedbackClientSection({ innerWidth: 1, innerHeight: 1 }, rum);
		expect(section.rum).toBe(rum);
	});

	it("derives the latest level per tile from the trail's layout entries, in order", () => {
		const trail: PlayTrailEntry[] = [
			layoutEntry("table", "card", 1),
			layoutEntry("place", "stage", 2),
			layoutEntry("table", "stage", 3),
		];
		const section = gatherFeedbackClientSection({
			innerWidth: 390,
			innerHeight: 844,
			__spellkavePlayTrail: trail,
		});
		expect(section.layout).toEqual({ table: "stage", place: "stage" });
	});

	it("degrades to an empty trail and layout when the trail was never installed", () => {
		const section = gatherFeedbackClientSection({ innerWidth: 1280, innerHeight: 720 });
		expect(section.trail).toEqual([]);
		expect(section.layout).toEqual({});
	});
});

function actEntry(id: number): PlayTrailEntry {
	return {
		id,
		at: id,
		tick: 0,
		kind: "act",
		tool: "spellkave_manipulate",
		actionId: "h:12",
		targetRef: null,
		words: null,
		outcome: "You open the chest.",
		observation: null,
		durationMs: 240,
		refusalCode: null,
		refusalDetail: null,
	};
}

describe("buildFeedbackClientWirePayload", () => {
	it("drops null fields from each trail entry rather than sending explicit nulls", () => {
		const payload = buildFeedbackClientWirePayload({
			trail: [actEntry(1)],
			viewport: { width: 1280, height: 720 },
			layout: {},
		});
		const entry = (payload.trail as Record<string, unknown>[])[0];
		expect(entry).toEqual({
			id: 1,
			at: 1,
			tick: 0,
			kind: "act",
			tool: "spellkave_manipulate",
			actionId: "h:12",
			outcome: "You open the chest.",
			durationMs: 240,
		});
		expect(entry).not.toHaveProperty("targetRef");
		expect(entry).not.toHaveProperty("words");
		expect(entry).not.toHaveProperty("observation");
	});

	it("sends only the last FEEDBACK_CLIENT_TRAIL_LIMIT entries", () => {
		const trail = Array.from({ length: FEEDBACK_CLIENT_TRAIL_LIMIT + 10 }, (_, i) => actEntry(i));
		const payload = buildFeedbackClientWirePayload({
			trail,
			viewport: { width: 1280, height: 720 },
			layout: {},
		});
		const sentTrail = payload.trail as Record<string, unknown>[];
		expect(sentTrail).toHaveLength(FEEDBACK_CLIENT_TRAIL_LIMIT);
		expect(sentTrail[0]?.id).toBe(10);
		expect(sentTrail.at(-1)?.id).toBe(FEEDBACK_CLIENT_TRAIL_LIMIT + 9);
	});

	it("shapes RUM diagnostics as run_id and sampled", () => {
		const base = { trail: [], viewport: { width: 1, height: 1 }, layout: {} };
		expect(
			buildFeedbackClientWirePayload({
				...base,
				rum: { runId: "d54646db-291f-4666-b197-54cfb6833c9f", sampled: true },
			}).rum,
		).toEqual({ run_id: "d54646db-291f-4666-b197-54cfb6833c9f", sampled: true });
		expect(buildFeedbackClientWirePayload({ ...base, rum: { sampled: false } }).rum).toEqual({
			sampled: false,
		});
		expect(buildFeedbackClientWirePayload(base)).not.toHaveProperty("rum");
	});

	it("passes viewport and layout through unchanged", () => {
		const payload = buildFeedbackClientWirePayload({
			trail: [],
			viewport: { width: 390, height: 844 },
			layout: { table: "stage", place: "card" },
		});
		expect(payload.viewport).toEqual({ width: 390, height: 844 });
		expect(payload.layout).toEqual({ table: "stage", place: "card" });
	});
});

describe("submitFeedback", () => {
	const options = { gatewayOrigin: "https://mcp.spellkave.test", accessToken: "seat-token" };

	it("always requests the report and attaches client diagnostics", async () => {
		let seenArgs: Record<string, unknown> | undefined;
		const result = await submitFeedback(
			{ message: "The exit chip clips on my phone.", category: "bug" },
			{
				...options,
				callTool: async (args) => {
					seenArgs = args;
					return {
						content: [{ type: "text", text: "Feedback recorded. Reference: local-feedback-1" }],
						structuredContent: { ok: true, include_report: true, reference: "local-feedback-1" },
					};
				},
			},
		);
		expect(seenArgs).toEqual({
			message: "The exit chip clips on my phone.",
			category: "bug",
			include_report: true,
			client: expect.objectContaining({ trail: expect.any(Array), viewport: expect.any(Object) }),
		});
		expect(JSON.stringify(seenArgs)).not.toContain("seat-token");
		expect(result).toEqual({ ok: true, issueUrl: "local-feedback-1" });
	});

	it("surfaces collection failure without submitting feedback", async () => {
		let called = false;
		const result = await submitFeedback(
			{ message: "m", category: "bug" },
			{
				...options,
				get clientSection(): never {
					throw new Error("secret detail");
				},
				callTool: async () => {
					called = true;
					return { content: [] };
				},
			},
		);
		expect(called).toBe(false);
		expect(result).toEqual({
			ok: false,
			reason: "failed",
			message:
				"Could not prepare the diagnostic report. Feedback was not sent. Try again in a moment.",
		});
	});

	it.each([
		false,
		undefined,
	])("does not claim success without report confirmation (%s)", async (included) => {
		const result = await submitFeedback(
			{ message: "m", category: "bug" },
			{
				...options,
				callTool: async () => ({
					content: [],
					structuredContent: {
						ok: true,
						reference: "x",
						include_report: included,
					},
				}),
			},
		);
		expect(result).toEqual({
			ok: false,
			reason: "failed",
			message:
				"Feedback was recorded, but its diagnostic report was not confirmed. Please do not resend it.",
		});
	});

	it("reports rate_limited from the structured error code, keeping the server's own retry text", async () => {
		const result = await submitFeedback(
			{ message: "m", category: "bug" },
			{
				...options,
				callTool: async () => ({
					isError: true,
					content: [
						{
							type: "text",
							text: "Feedback rate limit reached for this seat. Try again in about 12s.",
						},
					],
					structuredContent: {
						error: {
							category: "domain",
							code: "rate_limited",
							message: "Feedback rate limit reached for this seat. Try again in about 12s.",
						},
					},
				}),
			},
		);
		expect(result).toEqual({
			ok: false,
			reason: "rate_limited",
			message: "Feedback rate limit reached for this seat. Try again in about 12s.",
		});
	});

	it("reports failed for any other error code", async () => {
		const result = await submitFeedback(
			{ message: "m", category: "bug" },
			{
				...options,
				callTool: async () => ({
					isError: true,
					content: [{ type: "text", text: "Could not record feedback right now." }],
					structuredContent: {
						ok: false,
						error: {
							category: "internal",
							code: "feedback_failed",
							message: "Could not record feedback right now.",
						},
					},
				}),
			},
		);
		expect(result).toEqual({
			ok: false,
			reason: "failed",
			message: "Could not record feedback right now.",
		});
	});

	it("reports failed with a generic message when the transport itself throws", async () => {
		const result = await submitFeedback(
			{ message: "m", category: "bug" },
			{
				...options,
				callTool: async () => {
					throw new Error("network down");
				},
			},
		);
		expect(result).toEqual({
			ok: false,
			reason: "failed",
			message: "Could not send feedback right now. Try again in a moment.",
		});
	});
});
