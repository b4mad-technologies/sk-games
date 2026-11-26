import { describe, expect, it } from "vitest";
import {
	createOperationClockObserver,
	operationReferenceFromResult,
	operationsFromPayload,
} from "./play-operations";

const answer = (session: Record<string, unknown> | null) => ({
	details: {
		status: session ? "session_detail" : "no_session_detail",
		session,
		ongoing: { items: [], matched: 0, next_cursor: null },
	},
});

describe("authorized operation presentation", () => {
	it("follows an admitted travel receipt, not a session id in arbitrary result text", () => {
		expect(
			operationReferenceFromResult({
				receipt: { move: { status: "travelling", session_id: "7" } },
			}),
		).toBe("7");
		expect(
			operationReferenceFromResult({ receipt: { move: { status: "rejected", session_id: "7" } } }),
		).toBeNull();
		expect(operationReferenceFromResult({ observation: "session 7", session_id: "7" })).toBeNull();
	});
	it("does not turn elapsed estimates into completion or combat", () => {
		const selected = operationsFromPayload(
			answer({
				session_id: "9",
				lifecycle: "waiting-on-external",
				turn_rule: "Sequential",
				timing: { basis: "world_ticks", duration_ticks: "4", estimated_remaining_ticks: "0" },
			}),
		).selected;
		expect(selected).toMatchObject({
			label: "Activity",
			phase: "waiting-on-external",
			progress: 100,
			terminal: false,
		});
	});
	it("keeps large world tick values exact and leaves absent timing unknown", () => {
		const selected = operationsFromPayload(
			answer({
				session_id: "9",
				lifecycle: "active",
				timing: {
					basis: "world_ticks",
					opened_at: "90071992547409931234",
					duration_ticks: "90071992547409931234",
					estimated_remaining_ticks: "45035996273704965617",
				},
			}),
		).selected;
		expect(selected?.progress).toBe(50);
		expect(selected?.fields).toContainEqual({
			label: "Opened at world tick",
			value: "90071992547409931234",
		});
		expect(selected?.fields).toContainEqual({
			label: "Last advanced at world tick",
			value: "Unknown",
		});
	});
	it("distinguishes a failed read from an authorized empty result", () => {
		expect(operationsFromPayload({ details: { status: "stale_cursor" } }).state).toBe("failed");
		expect(operationsFromPayload(answer(null))).toMatchObject({ state: "ready", selected: null });
	});
	it("preserves explicit terminal selection and authorized participant names", () => {
		const selected = operationsFromPayload(
			answer({
				session_id: "9",
				lifecycle: "completed",
				my_turn: true,
				roster: [{ actor_id: "4", ordinal: 0 }],
			}),
			(id) => (id === "4" ? "Rowan" : id),
		).selected;
		expect(selected).toMatchObject({ label: "Activity", terminal: true, progress: null });
		expect(selected?.fields).toContainEqual({ label: "Current participant is you", value: "Yes" });
		expect(selected?.fields.some((field) => field.label === "Your turn")).toBe(false);
		expect(selected?.fields).toContainEqual({ label: "Participant 1", value: "Rowan" });
	});
});

it("reports repeated unchanged world-time reads without inferring a pause and clears on advance", () => {
	const observe = createOperationClockObserver();
	const status = (observed_at: string, lifecycle = "active") =>
		operationsFromPayload(
			answer({
				session_id: "7",
				lifecycle,
				timing: {
					basis: "world_ticks",
					observed_at,
					duration_ticks: "4",
					estimated_remaining_ticks: "3",
				},
			}),
		);
	expect(observe(status("11"), 0).selected?.clockUnchanged).toBe(false);
	expect(observe(status("11"), 9999).selected?.notice).toBeUndefined();
	expect(observe(status("11"), 10000).selected).toMatchObject({
		clockUnchanged: true,
		progress: 25,
		terminal: false,
	});
	expect(observe(status("12"), 10001).selected?.notice).toBeUndefined();
	expect(observe(status("12", "completed"), 30000).selected?.notice).toBeUndefined();
	observe(status("12"), 40000);
	observe(operationsFromPayload({}), 50000);
	expect(observe(status("12"), 50001).selected?.clockUnchanged).toBe(false);
});
