import { toolDetails } from "./play-view";

export interface PlayOperation {
	id: string;
	label: string;
	phase: string;
	description: string | null;
	/** A bounded ratio of reported world ticks, never a completion verdict. */
	progress: number | null;
	terminal: boolean;
	worldTimed: boolean;
	turnRule: string | null;
	observedWorldTick?: string | null;
	clockUnchanged?: boolean;
	notice?: string;
	fields: { label: string; value: string }[];
}

export interface PlayOperations {
	state: "ready" | "failed";
	selected: PlayOperation | null;
	items: { id: string; label: string; phase: string }[];
	total: number | null;
	nextCursor: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function text(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function ticks(value: unknown): bigint | null {
	return typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : null;
}

/** The move receipt already supplies the admitted session reference. */
export function operationReferenceFromResult(payload: unknown): string | null {
	const move = record(record(record(toolDetails(payload))?.receipt)?.move);
	const id = text(move?.session_id);
	return move?.status === "travelling" && id !== null && /^\d+$/.test(id) ? id : null;
}

/** Map only the authorized detail answer. No action admission is inferred. */
export function operationsFromPayload(
	payload: unknown,
	nameOf: (id: string) => string = (id) => id,
): PlayOperations {
	const details = record(toolDetails(payload));
	if (!details || !["session_detail", "no_session_detail"].includes(String(details.status))) {
		return { state: "failed", selected: null, items: [], total: null, nextCursor: null };
	}
	const page = record(details.ongoing);
	const items = (Array.isArray(page?.items) ? page.items : []).flatMap((value) => {
		const row = record(value);
		const id = text(row?.session_id);
		return id
			? [
					{
						id,
						label: text(row?.label) ?? "Activity",
						phase: text(row?.lifecycle) ?? "Unknown",
					},
				]
			: [];
	});
	const session = record(details.session);
	const id = text(session?.session_id);
	let selected: PlayOperation | null = null;
	if (session && id) {
		const timing = record(session.timing);
		const fields: PlayOperation["fields"] = [];
		const add = (label: string, value: unknown): void => {
			fields.push({ label, value: text(value) ?? "Unknown" });
		};
		add("Phase", session.lifecycle);
		add("Session", session.session_id);
		add("Definition", session.session_definition_id);
		add("Turn rule", session.turn_rule);
		add("Round duration (milliseconds)", session.round_duration_ms);
		add("Opened by", text(session.opened_by) ? nameOf(String(session.opened_by)) : null);
		add(
			"Current participant",
			text(session.current_actor) ? nameOf(String(session.current_actor)) : null,
		);
		add("Originating action", session.originating_action);
		add(
			"Current participant is you",
			typeof session.my_turn === "boolean" ? (session.my_turn ? "Yes" : "No") : null,
		);
		add("Originating target", session.originating_target);
		for (const [label, key] of [
			["Observed world tick", "observed_at"],
			["Last world tick timestamp (Unix microseconds)", "last_tick_at_micros"],
			["Opened at world tick", "opened_at"],
			["Last advanced at world tick", "last_advanced_at"],
			["Duration (world ticks)", "duration_ticks"],
			["Estimated completion world tick", "estimated_completion_at"],
			["Estimated remaining world ticks", "estimated_remaining_ticks"],
		] as const)
			add(label, timing?.[key]);
		const roster = Array.isArray(session.roster) ? session.roster : [];
		for (const [index, value] of roster.entries()) {
			const participant = record(value);
			const actorId = text(participant?.actor_id);
			if (actorId) add(`Participant ${index + 1}`, nameOf(actorId));
		}
		if (session.roster_truncated === true) {
			add("Participant coverage", `${roster.length} of ${session.roster_total} supplied`);
		}
		const duration = timing?.basis === "world_ticks" ? ticks(timing.duration_ticks) : null;
		const remaining = ticks(timing?.estimated_remaining_ticks);
		const phase = text(session.lifecycle) ?? "Unknown";
		selected = {
			id,
			label: text(session.label) ?? "Activity",
			phase,
			description: text(session.description),
			terminal: ["completed", "failed", "abandoned"].includes(phase),
			worldTimed: duration !== null && duration > 0n,
			turnRule: text(session.turn_rule),
			observedWorldTick: ticks(timing?.observed_at)?.toString() ?? null,
			progress:
				duration !== null && duration > 0n && remaining !== null
					? Number(
							((duration - (remaining > duration ? duration : remaining)) * 10000n) / duration,
						) / 100
					: null,
			fields,
		};
	}
	return {
		state: "ready",
		selected,
		items,
		total: typeof page?.matched === "number" ? page.matched : null,
		nextCursor: text(page?.next_cursor),
	};
}

/** Repeated successful reads establish an observation, never a server pause. */
export function createOperationClockObserver() {
	let previous: { id: string; tick: string; since: number } | null = null;
	return (operations: PlayOperations, now: number): PlayOperations => {
		const selected = operations.selected;
		if (
			operations.state !== "ready" ||
			!selected?.worldTimed ||
			selected.terminal ||
			!selected.observedWorldTick
		) {
			previous = null;
			return operations;
		}
		if (
			!previous ||
			previous.id !== selected.id ||
			previous.tick !== selected.observedWorldTick ||
			now < previous.since
		) {
			previous = { id: selected.id, tick: selected.observedWorldTick, since: now };
		}
		const clockUnchanged = now - previous.since >= 10000;
		return {
			...operations,
			selected: {
				...selected,
				clockUnchanged,
				notice: clockUnchanged
					? "No newer world time has been observed. Progress updates when world time advances."
					: undefined,
			},
		};
	};
}
