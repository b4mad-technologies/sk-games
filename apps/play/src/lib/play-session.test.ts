import {
	buildSubscribeSet,
	type ReaderManifest,
	WATCH_BUFFER_REQUIRED_TABLES,
} from "@spellkave/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	actRefusal,
	isPlayAttemptBlocked,
	latestTick,
	messageForAct,
	messageForMove,
	moveRefusal,
	openPlaySession,
} from "./play-session";
import { playCopy } from "./player-copy";

// `openPlaySession`'s own `readView` wires every `spellkave_self_states`
// kind straight to a live PLAYER tool call — this harness fakes that one
// seam (`@spellkave/session`'s `openSession` and the browser role tools it
// builds), the same mocking shape `play-item-selection.test.ts` already
// uses for the item-detail read.
const economyTools = vi.hoisted(() => new Map<string, { execute: ReturnType<typeof vi.fn> }>());
/** Broad enough to cover both the plain default fake AND the world-tick
 * tests' extended fake (`session.currentWorldTick`, an `onUpdate` that
 * captures its listener) — a single shape every `mockImplementationOnce`
 * override below can satisfy. */
interface OpenSessionFake {
	actorId: string;
	session: {
		conn: { db: import("@spellkave/sdk").SnapshotDb };
		worldEvents: { diffAndAdvance: () => unknown[] };
		currentWorldTick?: () => bigint;
	};
	onUpdate: (listener: (table?: string) => void) => () => void;
	close: () => void;
}
const openSessionMock = vi.hoisted(() =>
	vi.fn(
		async (_binding: unknown, _deps: Record<string, unknown>): Promise<OpenSessionFake> => ({
			actorId: "1",
			session: {
				conn: {
					db: {
						visible_entity_tag: { iter: () => [] },
						visible_entity_tag_coverage: {
							iter: () => [{ status: "complete", projectionVersion: 1 }],
						},
					},
				},
				worldEvents: { diffAndAdvance: () => [] },
			},
			onUpdate: () => () => {},
			close: vi.fn(),
		}),
	),
);
vi.mock("@spellkave/session", () => ({
	openSession: openSessionMock,
	PLAY_CONNECT_PHASE_TIMEOUT_MS: 30_000,
}));
vi.mock("./browser-role-tools", () => ({
	createLiveBrowserRoleTools: async () => ({ byName: economyTools }),
}));

beforeEach(() => economyTools.clear());

it.each([
	{
		verb: "manipulate",
		descriptor: "orbital/repair",
		tool: "spellkave_manipulate",
		words: undefined,
		// The composer check stops it before sending; the sentence comes from
		// the player copy table, not from the composer's own vocabulary.
		error: "Still getting ready. Try again in a moment.",
	},
	{
		verb: "communicate",
		descriptor: "orbital/say",
		tool: "spellkave_communicate",
		words: " Hello ",
		params: {
			target_id: "entity:9",
			speech_act_id: "orbital/say",
			utterance: "Hello",
			args_json: JSON.stringify({ dispatch_text: "Hello" }),
		},
	},
	{
		verb: "communicate",
		descriptor: "orbital/answer",
		tool: "spellkave_communicate",
		words: undefined,
		params: { target_id: "entity:9", speech_act_id: "orbital/answer", args_json: "{}" },
	},
	{
		verb: "sensing",
		descriptor: "orbital/survey",
		tool: "spellkave_sense",
		words: undefined,
		params: { query_kind: "orbital/survey", visibility: "Local" },
	},
])("dispatches $descriptor as one direct typed attempt", async ({
	verb,
	descriptor,
	tool,
	words,
	params,
	error,
}) => {
	const execute = vi.fn(async () => ({ status: "success" }));
	economyTools.set(tool, { execute });
	const handle = await openPlaySession({
		url: "http://localhost:9450",
		db: "test",
		token: "test",
		actorId: "1",
		authorizedToolRoles: ["PLAYER"],
		onView: vi.fn(),
		onError: vi.fn(),
	});
	try {
		const act = handle.act(
			{
				id: "local-candidate",
				label: "Attempt",
				verb,
				descriptor,
				targetName: "Beacon",
				targetRef: "entity:9",
				acceptsUtterance: words !== undefined,
			},
			words,
		);
		if (error !== undefined) {
			const cause = await act.catch((thrown: unknown) => thrown);
			expect(isPlayAttemptBlocked(cause)).toBe(true);
			expect((cause as Error).message).toBe(error);
			expect(execute).not.toHaveBeenCalled();
		} else {
			await act;
			expect(execute).toHaveBeenCalledTimes(1);
			expect(execute).toHaveBeenCalledWith("play", params);
		}
	} finally {
		handle.disconnect();
	}
});

it("carries structured character-creation input as the shared draft values", async () => {
	const execute = vi.fn(async () => ({ status: "success" }));
	economyTools.set("spellkave_communicate", { execute });
	const handle = await openPlaySession({
		url: "http://localhost:9450",
		db: "test",
		token: "test",
		actorId: "1",
		authorizedToolRoles: ["PLAYER"],
		onView: vi.fn(),
		onError: vi.fn(),
	});
	try {
		await handle.act(
			{
				id: "creation-name",
				label: "Name",
				verb: "communicate",
				descriptor: "dm/creation/input/name",
				targetName: "Aldwin",
				targetRef: "entity:4",
				acceptsUtterance: true,
				input: {
					fields: [
						{ name: "name", label: "Name", control: "text", required: true, channel: "utterance" },
					],
				},
			},
			'{"name":"Mira"}',
			0,
			{ name: "Mira" },
		);
		expect(execute).toHaveBeenCalledWith("play", {
			target_id: "entity:4",
			speech_act_id: "dm/creation/input/name",
			utterance: '{"name":"Mira"}',
			args_json: '{"dispatch_text":"{\\"name\\":\\"Mira\\"}"}',
		});
	} finally {
		handle.disconnect();
	}
});

it("keeps args_json-channel form values out of speech while retaining legacy fields as utterance", async () => {
	const execute = vi.fn(async () => ({ status: "success" }));
	economyTools.set("spellkave_communicate", { execute });
	const handle = await openPlaySession({
		url: "http://localhost:9450",
		db: "test",
		token: "test",
		actorId: "1",
		authorizedToolRoles: ["PLAYER"],
		onView: vi.fn(),
		onError: vi.fn(),
	});
	try {
		await handle.act(
			{
				id: "mixed-input",
				label: "Mixed input",
				verb: "communicate",
				descriptor: "dm/example/mixed-input",
				targetName: "Aldwin",
				targetRef: "entity:4",
				acceptsUtterance: true,
				input: {
					fields: [
						{ name: "words", label: "Words", control: "text", channel: "utterance" },
						{ name: "count", label: "Count", control: "number", channel: "args_json" },
						{ name: "legacy", label: "Legacy", control: "text" },
					],
				},
			},
			'{"legacy":"old"}',
			0,
			{ words: "hello", count: 2, legacy: "old" },
		);
		expect(execute).toHaveBeenCalledWith("play", {
			target_id: "entity:4",
			speech_act_id: "dm/example/mixed-input",
			utterance: '{"legacy":"old"}',
			args_json: JSON.stringify({ count: 2, dispatch_text: '{"legacy":"old"}' }),
		});
	} finally {
		handle.disconnect();
	}
});

it("copies a reactive prompt occurrence context before the Attempt snapshot", async () => {
	const execute = vi.fn(async () => ({ status: "success" }));
	economyTools.set("spellkave_communicate", { execute });
	const handle = await openPlaySession({
		url: "http://localhost:9450",
		db: "test",
		token: "test",
		actorId: "1",
		authorizedToolRoles: ["PLAYER"],
		onView: vi.fn(),
		onError: vi.fn(),
	});
	try {
		const reactiveContext = new Proxy({ source_ref: "entity:4", occurrence_id: "42" }, {});
		await handle.act(
			{
				id: "prompt-answer",
				label: "Barbarian",
				verb: "communicate",
				descriptor: "dm/creation/class/barbarian",
				targetName: "Aldwin",
				targetRef: "entity:4",
				acceptsUtterance: false,
				semanticContext: reactiveContext,
			},
			undefined,
			0,
			new Proxy({}, {}),
		);
		expect(execute).toHaveBeenCalledWith("play", {
			target_id: "entity:4",
			speech_act_id: "dm/creation/class/barbarian",
			args_json: JSON.stringify({
				semantic_context: { source_ref: "entity:4", occurrence_id: "42" },
			}),
		});
	} finally {
		handle.disconnect();
	}
});

it("waits for a successor prompt only after an accepted prompt-bound answer", async () => {
	const communicate = vi.fn(async () => ({
		details: {
			receipt: { status: "dispatched", outcome: "accepted", communicate: { status: "success" } },
			// Menu answers have no player utterance, so the real tool result is a
			// quiet accepted receipt rather than an authored observation line.
			observation: null,
			observation_gap: "No spoken utterance was supplied.",
		},
	}));
	const manipulationContext = vi.fn(async () => ({
		details: {
			manipulation_context: {
				status: "ready",
				revision: 1,
				actions: [],
				targets: [],
				participants: [],
				prompts: [],
			},
		},
	}));
	economyTools.set("spellkave_communicate", { execute: communicate });
	economyTools.set("spellkave_manipulation_context", { execute: manipulationContext });
	const handle = await openPlaySession({
		url: "http://localhost:9450",
		db: "test",
		token: "test",
		actorId: "1",
		authorizedToolRoles: ["PLAYER"],
		onView: vi.fn(),
		onError: vi.fn(),
	});
	try {
		await handle.act(
			{
				id: "creation-answer",
				label: "Barbarian",
				verb: "communicate",
				descriptor: "dm/dialog/choice/1",
				targetName: "Aldwin",
				targetRef: "entity:4",
				acceptsUtterance: false,
				semanticContext: { source_ref: "entity:4", occurrence_id: "42" },
			},
			undefined,
		);
		expect(manipulationContext).toHaveBeenLastCalledWith("play", {
			detail: "full",
			wait_for_prompt_ms: 5000,
		});
	} finally {
		handle.disconnect();
	}
});

it("does not wait after a rejected prompt-bound answer", async () => {
	const communicate = vi.fn(async () => ({
		details: {
			receipt: {
				status: "dispatched",
				outcome: "rejected",
				communicate: { status: "rejected", reason: "predicate_rejected" },
			},
		},
	}));
	const manipulationContext = vi.fn(async () => ({
		details: {
			manipulation_context: {
				status: "ready",
				revision: 1,
				actions: [],
				targets: [],
				participants: [],
				prompts: [],
			},
		},
	}));
	economyTools.set("spellkave_communicate", { execute: communicate });
	economyTools.set("spellkave_manipulation_context", { execute: manipulationContext });
	const handle = await openPlaySession({
		url: "http://localhost:9450",
		db: "test",
		token: "test",
		actorId: "1",
		authorizedToolRoles: ["PLAYER"],
		onView: vi.fn(),
		onError: vi.fn(),
	});
	try {
		await handle.act(
			{
				id: "creation-answer",
				label: "Barbarian",
				verb: "communicate",
				descriptor: "dm/dialog/choice/1",
				targetName: "Aldwin",
				targetRef: "entity:4",
				acceptsUtterance: false,
				semanticContext: { source_ref: "entity:4", occurrence_id: "42" },
			},
			undefined,
		);
		expect(manipulationContext).toHaveBeenLastCalledWith("play", { detail: "full" });
	} finally {
		handle.disconnect();
	}
});

it("allows a repaired speech draft after a server rejection", async () => {
	const execute = vi
		.fn()
		.mockResolvedValueOnce({
			details: {
				receipt: { status: "dispatched", outcome: "rejected", communicate: { status: "rejected" } },
			},
		})
		.mockResolvedValueOnce({
			details: {
				receipt: { status: "dispatched", outcome: "accepted", communicate: { status: "success" } },
			},
		});
	economyTools.set("spellkave_communicate", { execute });
	const handle = await openPlaySession({
		url: "http://localhost:9450",
		db: "test",
		token: "test",
		actorId: "1",
		authorizedToolRoles: ["PLAYER"],
		onView: vi.fn(),
		onError: vi.fn(),
	});
	const action = {
		id: "reply",
		label: "Reply",
		verb: "communicate",
		descriptor: "dm/dialog/reply",
		targetName: "Aldwin",
		targetRef: "entity:4",
		acceptsUtterance: true,
	};
	try {
		const refusal = await handle.act(action, "wrong");
		// The repeat is stopped by Play, in player words, and repeats the
		// refusal line the player already saw.
		const repeat = await handle.act(action, "wrong").catch((cause: unknown) => cause);
		expect(isPlayAttemptBlocked(repeat)).toBe(true);
		expect((repeat as Error).message).toBe(playCopy.session.repeatRefusal(refusal));
		expect((repeat as Error).message).toMatch(/^That was already refused/);
		expect((repeat as Error).message).not.toMatch(/unchanged observed|\bdraft\b|\bfacts?\b/i);
		await handle.act(action, "Mira");
		expect(execute).toHaveBeenCalledTimes(2);
		expect(execute.mock.calls.map((call) => call[1]?.utterance)).toEqual(["wrong", "Mira"]);
	} finally {
		handle.disconnect();
	}
});

// keep(K2): inject turn delivery independently of manipulation-context revisions.
it.each([
	true,
	false,
])("retries a spent-effort attack next turn (opponent turn observed: %s)", async (observeOpponentTurn) => {
	let currentActor = "1";
	let spent = false;
	let windowStart = 0;
	let update: () => void = () => {};
	openSessionMock.mockImplementationOnce(async () => ({
		actorId: "1",
		session: {
			conn: { db: {} },
			worldEvents: { diffAndAdvance: () => [] },
		},
		onUpdate: (listener) => {
			update = listener;
			return () => {};
		},
		close: vi.fn(),
	}));
	const context = {
		status: "ready",
		schema_version: 1,
		revision: 7,
		actions: [{ action_id: "srd/melee-attack", display_name: "Melee attack" }],
		targets: [{ target_fact_id: "target:9", target_ref: "entity:9" }],
		participants: [],
		prompts: [],
	};
	economyTools.set("spellkave_manipulation_context", {
		execute: vi.fn(async () => ({ details: { manipulation_context: context } })),
	});
	economyTools.set("spellkave_self_states", {
		execute: vi.fn(async (_call: string, params: Record<string, unknown>) => ({
			details: {
				items:
					params.kind === "economy"
						? [
								{
									channel_id: "srd/economy_channel/primary",
									spent_ms: spent ? "6000" : "0",
									window_start_ms: String(windowStart),
								},
							]
						: params.kind === "economy_budget"
							? [
									{
										channel_id: "srd/economy_channel/primary",
										effective_pool_ms: "6000",
										remaining_ms: spent ? "0" : "6000",
										spent_ms: spent ? "6000" : "0",
										status: "ok",
									},
								]
							: [],
			},
		})),
	});
	economyTools.set("spellkave_session_status", {
		execute: vi.fn(async () => ({
			details: {
				session: {
					session_id: "fight",
					lifecycle: "Active",
					current_actor: currentActor,
					my_turn: currentActor === "1",
				},
			},
		})),
	});
	const manipulate = vi.fn(async () => {
		if (spent)
			return {
				details: {
					receipt: {
						status: "dispatched",
						outcome: "rejected",
						manipulate: {
							status: "rejected",
							reason: "r_manipulate rejected by server",
							failure_detail: "action_budget_exhausted",
							player_message: "No effort is available for that action.",
						},
					},
				},
			};
		spent = true;
		return {
			details: {
				receipt: { status: "dispatched", outcome: "accepted", manipulate: { status: "success" } },
				observation: "You attack.",
			},
		};
	});
	economyTools.set("spellkave_manipulate", { execute: manipulate });
	economyTools.set("spellkave_end_turn", {
		execute: vi.fn(async () => {
			currentActor = observeOpponentTurn ? "9" : "1";
			if (!observeOpponentTurn) {
				spent = false;
				windowStart = 6000;
			}
			return { details: { session: { current_actor: currentActor } } };
		}),
	});
	const onView = vi.fn();
	const handle = await openPlaySession({
		url: "http://localhost:9450",
		db: "test",
		token: "test",
		actorId: "1",
		authorizedToolRoles: ["PLAYER"],
		onView,
		onError: vi.fn(),
		debounceMs: 0,
	});
	const attack = {
		id: "attack",
		label: "Melee attack",
		verb: "manipulate",
		descriptor: "srd/melee-attack",
		targetRef: "entity:9",
		targetName: "Rat swarm",
		acceptsUtterance: false,
	};
	try {
		await handle.act(attack);
		expect(await handle.act(attack)).toContain("No effort is available");
		await expect(handle.act(attack)).rejects.toThrow(
			playCopy.session.repeatRefusal("No effort is available for that action."),
		);
		expect(manipulate).toHaveBeenCalledTimes(2);
		// An ordinary refresh with identical facts must retain the refusal.
		const beforeRefresh = onView.mock.calls.length;
		update();
		await vi.waitFor(() => expect(onView.mock.calls.length).toBeGreaterThan(beforeRefresh));
		await expect(handle.act(attack)).rejects.toThrow(
			playCopy.session.repeatRefusal("No effort is available for that action."),
		);
		await handle.endTurn();
		if (observeOpponentTurn) {
			expect(onView.mock.lastCall?.[0].session.myTurn).toBe(false);
			currentActor = "1";
			spent = false;
			windowStart = 6000;
			update();
			await vi.waitFor(() => expect(onView.mock.lastCall?.[0].session.myTurn).toBe(true));
		}
		expect(onView.mock.lastCall?.[0].manipulationContext.revision).toBe(7);
		expect(onView.mock.lastCall?.[0].economyBudget.channels[0].remainingMs).toBe(6000);
		expect(await handle.act(attack)).toContain("You attack.");
		expect(manipulate).toHaveBeenCalledTimes(3);
		expect(manipulate.mock.calls[2]).toEqual(manipulate.mock.calls[0]);
	} finally {
		handle.disconnect();
	}
});

it("stops an attempt with a missing required field before sending, in player words", async () => {
	const execute = vi.fn(async () => ({ status: "success" }));
	economyTools.set("spellkave_communicate", { execute });
	const handle = await openPlaySession({
		url: "http://localhost:9450",
		db: "test",
		token: "test",
		actorId: "1",
		authorizedToolRoles: ["PLAYER"],
		onView: vi.fn(),
		onError: vi.fn(),
	});
	const field = (name: string, label: string) =>
		({ name, label, control: "text", required: true, channel: "utterance" }) as const;
	const action = {
		id: "creation-name",
		label: "Name",
		verb: "communicate",
		descriptor: "dm/creation/input/name",
		targetName: "Aldwin",
		targetRef: "entity:4",
		acceptsUtterance: true,
	} as const;
	try {
		const one = await handle
			.act({ ...action, input: { fields: [field("name", "Name")] } })
			.catch((cause: unknown) => cause);
		expect(isPlayAttemptBlocked(one)).toBe(true);
		expect((one as Error).message).toBe("Fill in “Name” first.");
		const several = await handle
			.act({ ...action, input: { fields: [field("name", "Name"), field("origin", "Origin")] } })
			.catch((cause: unknown) => cause);
		expect(isPlayAttemptBlocked(several)).toBe(true);
		expect((several as Error).message).toBe(playCopy.session.requiredFields);
		for (const cause of [one, several])
			expect((cause as Error).message).not.toMatch(
				/\bfacts?\b|\bdraft\b|observed|context|required fields/i,
			);
		expect(execute).not.toHaveBeenCalled();
	} finally {
		handle.disconnect();
	}
});

describe("openPlaySession — economy read", () => {
	it("carries spellkave_self_states(kind: economy) rows into view.economy, in the order answered", async () => {
		economyTools.set("spellkave_self_states", {
			execute: vi.fn(async (_call: string, params: Record<string, unknown>) => {
				if (params.kind !== "economy") return { details: { items: [] } };
				return {
					details: {
						items: [
							{
								channel_id: "srd/economy_channel/primary",
								spent_ms: "1200",
								window_start_ms: "0",
							},
							{
								channel_id: "srd/economy_channel/bonus",
								spent_ms: "0",
								window_start_ms: "0",
							},
						],
					},
				};
			}),
		});
		const onView = vi.fn();
		const handle = await openPlaySession({
			url: "http://localhost:9450",
			db: "test",
			token: "test",
			actorId: "1",
			authorizedToolRoles: ["PLAYER"],
			onView,
			onError: vi.fn(),
		});
		try {
			expect(onView.mock.lastCall?.[0].economy).toEqual([
				{ channelId: "srd/economy_channel/primary", spentMs: 1200, windowStartMs: 0 },
				{ channelId: "srd/economy_channel/bonus", spentMs: 0, windowStartMs: 0 },
			]);
		} finally {
			handle.disconnect();
		}
	});

	it("answers economy: null when the read fails, never a thrown error", async () => {
		economyTools.set("spellkave_self_states", {
			execute: vi.fn(async (_call: string, params: Record<string, unknown>) => {
				if (params.kind === "economy") throw new Error("boom");
				return { details: { items: [] } };
			}),
		});
		const onView = vi.fn();
		const onError = vi.fn();
		const handle = await openPlaySession({
			url: "http://localhost:9450",
			db: "test",
			token: "test",
			actorId: "1",
			authorizedToolRoles: ["PLAYER"],
			onView,
			onError,
		});
		try {
			expect(onError).not.toHaveBeenCalled();
			expect(onView.mock.lastCall?.[0].economy).toBeNull();
		} finally {
			handle.disconnect();
		}
	});
});

// sk-jay0.6.38.25: `openSession`'s new `onPhase` hook and its typed timeout
// errors only help #3464's stall investigation if `openPlaySession` actually
// forwards/surfaces them.
describe("openPlaySession — connect phase and error wiring (sk-jay0.6.38.25)", () => {
	beforeEach(() => {
		economyTools.clear();
		openSessionMock.mockClear();
	});

	it("forwards deps.onPhase verbatim to openSession", async () => {
		const onPhase = vi.fn();
		const handle = await openPlaySession({
			url: "http://localhost:9450",
			db: "test",
			token: "test",
			actorId: "1",
			authorizedToolRoles: ["PLAYER"],
			onView: vi.fn(),
			onError: vi.fn(),
			onPhase,
		});
		try {
			expect(openSessionMock.mock.calls[0]?.[1]).toMatchObject({ onPhase });
		} finally {
			handle.disconnect();
		}
	});

	it("calls onError and rethrows when openSession itself never resolves the connect", async () => {
		const failure = new Error("openSession: session.ready timed out after 30ms");
		(failure as Error & { phase?: string }).phase = "ready";
		openSessionMock.mockImplementationOnce(async () => {
			throw failure;
		});
		const onError = vi.fn();

		await expect(
			openPlaySession({
				url: "http://localhost:9450",
				db: "test",
				token: "test",
				actorId: "1",
				authorizedToolRoles: ["PLAYER"],
				onView: vi.fn(),
				onError,
			}),
		).rejects.toBe(failure);

		expect(onError).toHaveBeenCalledWith(failure);
	});
});

// #3487 root cause (found during the sk-jay0.1.1.14 investigation): Play used
// to pass `readerManifests: [{ requiredTables: [...WATCH_BUFFER_REQUIRED_TABLES] }]`
// verbatim to `openSession`. `buildSubscribeSet` (`packages/spellkave-sdk/src/
// connection.ts`) treats ANY supplied `readerManifests` as a total
// REPLACEMENT of its own default reader-scoped union, never an addition —
// so that line silently narrowed Play's whole subscription to just the watch
// buffer's tables plus `CONNECTION_BASELINE`, dropping `visible_place_node`/
// `visible_place_edge`/`place_edge_affordance` and everything else
// `readCurrentScene` needs. This pins the fix: Play's manifest, run through
// the REAL `buildSubscribeSet`, must resolve to the same shape the default
// (no-manifest) union produces, plus the watch buffer's own tables.
describe("openPlaySession — subscribed tables (#3487 regression, sk-jay0.1.1.14)", () => {
	beforeEach(() => {
		economyTools.clear();
		openSessionMock.mockClear();
	});

	it("subscribes the default reader union (place/scene tables included) union the watch-buffer tables, not a narrowed override", async () => {
		const handle = await openPlaySession({
			url: "http://localhost:9450",
			db: "test",
			token: "test",
			actorId: "1",
			authorizedToolRoles: ["PLAYER"],
			onView: vi.fn(),
			onError: vi.fn(),
		});
		try {
			const deps = openSessionMock.mock.calls[0]?.[1] as {
				readerManifests?: readonly ReaderManifest[];
			};
			const set = buildSubscribeSet(deps.readerManifests);
			// world_time: this bead's own tick readout depends on it (always
			// true via CONNECTION_BASELINE regardless of readerManifests, but
			// pinned here too since a future SDK change could otherwise silently
			// break both this bead and the scene fix in the same place).
			expect(set).toContain("world_time");
			// The scene reader's own required tables (`core/readers/scene.ts`) —
			// the exact set #3487's narrowed manifest dropped.
			expect(set).toContain("visible_place_node");
			expect(set).toContain("visible_place_edge");
			expect(set).toContain("place_edge_affordance");
			// Matches the no-manifest default exactly, i.e. Play is no longer
			// narrower than every other `openSession` caller.
			expect(set).toEqual(buildSubscribeSet());
			// The watch buffer's own extra table, additive on top of the default.
			for (const t of WATCH_BUFFER_REQUIRED_TABLES) expect(set).toContain(t);
		} finally {
			handle.disconnect();
		}
	});
});

// sk-jay0.1.1.14: the seal cluster's live world-tick readout reads
// `live.session.currentWorldTick()` — a synchronous accessor over the
// already-subscribed `world_time` cache (world_time is in `CONNECTION_
// BASELINE`, so every session subscribes it regardless of readerManifests;
// see `packages/spellkave-sdk/src/reader-manifest.ts` and its own
// `buildSubscribeSet` tests) — never `latestTick()` below, and never a new
// `readView()` call.
describe("openPlaySession — world tick (sk-jay0.1.1.14)", () => {
	beforeEach(() => {
		economyTools.clear();
		openSessionMock.mockClear();
	});

	function mockLiveWithTick(getTick: () => bigint) {
		const listeners: Array<(table?: string) => void> = [];
		openSessionMock.mockImplementationOnce(async () => ({
			actorId: "1",
			session: {
				conn: {
					db: {
						visible_entity_tag: { iter: () => [] },
						visible_entity_tag_coverage: {
							iter: () => [{ status: "complete", projectionVersion: 1 }],
						},
					},
				},
				worldEvents: { diffAndAdvance: () => [] },
				currentWorldTick: getTick,
			},
			onUpdate: (listener: (table?: string) => void) => {
				listeners.push(listener);
				return () => {};
			},
			close: vi.fn(),
		}));
		return listeners;
	}

	it("publishes the tick via onWorldTick right after connect", async () => {
		mockLiveWithTick(() => 5n);
		const onWorldTick = vi.fn();
		const handle = await openPlaySession({
			url: "http://localhost:9450",
			db: "test",
			token: "test",
			actorId: "1",
			authorizedToolRoles: ["PLAYER"],
			onView: vi.fn(),
			onError: vi.fn(),
			onWorldTick,
		});
		try {
			expect(onWorldTick).toHaveBeenCalledWith(5);
		} finally {
			handle.disconnect();
		}
	});

	it("re-publishes on a world_time cache mutation, ignores an unrelated table, and calls no PLAYER tool to do it", async () => {
		let tick = 1n;
		const listeners = mockLiveWithTick(() => tick);
		const selfSummaryExecute = vi.fn(async () => ({ details: {} }));
		economyTools.set("spellkave_self_summary", { execute: selfSummaryExecute });
		const onWorldTick = vi.fn();
		const handle = await openPlaySession({
			url: "http://localhost:9450",
			db: "test",
			token: "test",
			actorId: "1",
			authorizedToolRoles: ["PLAYER"],
			onView: vi.fn(),
			onError: vi.fn(),
			onWorldTick,
		});
		try {
			const toolCallsAfterConnect = selfSummaryExecute.mock.calls.length;
			onWorldTick.mockClear();

			// Some other subscribed table mutating (e.g. a scene table) must not
			// move a readout that only ever means world_time.
			for (const listener of listeners) listener("actor");
			expect(onWorldTick).not.toHaveBeenCalled();

			// A world_time mutation republishes synchronously — no PLAYER tool
			// call, i.e. no `readView()` — the debounced `schedule()`/`readView`
			// refresh (120ms real timer, untouched here) is a separate path this
			// listener does not drive.
			tick = 7n;
			for (const listener of listeners) listener("world_time");
			expect(onWorldTick).toHaveBeenCalledExactlyOnceWith(7);
			expect(selfSummaryExecute.mock.calls.length).toBe(toolCallsAfterConnect);
		} finally {
			handle.disconnect();
		}
	});

	it("never calls the session accessor, and never throws, when onWorldTick is omitted", async () => {
		const currentWorldTick = vi.fn(() => 9n);
		mockLiveWithTick(currentWorldTick);
		const handle = await openPlaySession({
			url: "http://localhost:9450",
			db: "test",
			token: "test",
			actorId: "1",
			authorizedToolRoles: ["PLAYER"],
			onView: vi.fn(),
			onError: vi.fn(),
		});
		try {
			expect(currentWorldTick).not.toHaveBeenCalled();
		} finally {
			handle.disconnect();
		}
	});
});

// Shapes below mirror the real dispatched-receipt envelope both
// `spellkave_move` and `spellkave_manipulate` answer with
// (`packages/spellkave-tool-player/src/tools.ts`'s `dispatchMovementByEdge`/
// act dispatch, `packages/spellkave-sdk/src/core/reducers/r_move.ts` for the
// movement-specific fields) — trimmed to what these mappers read
// (sk-jay0.1.7 item 1).

describe("messageForMove", () => {
	it("names where the hero arrived when the world authored arrival prose (a crossed graph boundary)", () => {
		const result = {
			details: {
				receipt: {
					status: "dispatched",
					verb_class: "movement",
					handle: "h:1",
					outcome: "accepted",
					move: {
						status: "success",
						actor_id: "7",
						edge_id: "e1",
						from_node: "inn/common_room",
						to_node: "inn/cellar",
					},
				},
				observation: "Barrels, damp stone, and a scuffle of claws in the dark.",
			},
		};
		expect(messageForMove(result)).toBe("Barrels, damp stone, and a scuffle of claws in the dark.");
	});

	it("names the destination when the move succeeded but the world authored no arrival prose", () => {
		const result = {
			details: {
				receipt: {
					status: "dispatched",
					verb_class: "movement",
					handle: "h:2",
					outcome: "accepted",
					move: {
						status: "success",
						actor_id: "7",
						edge_id: "e2",
						from_node: "inn/common_room",
						to_node: "inn/bar",
					},
				},
				observation: null,
				observation_gap:
					"This place has no description of its own, and you did not leave the region you were already in.",
			},
		};
		expect(messageForMove(result)).toBe("You arrive at Bar.");
	});

	it("names the world's own reason for a refused move (sk-jay0.1.7 item 1: 'The world did not accept that move.')", () => {
		const result = {
			details: {
				receipt: {
					status: "dispatched",
					verb_class: "movement",
					handle: "h:3",
					outcome: "rejected",
					move: {
						status: "rejected",
						actor_id: "7",
						edge_id: "e3",
						from_node: "inn/common_room",
						to_node: "inn/foyer",
						reason: "r_move rejected by server",
						failure_detail: "Something stands at the threshold; the way is barred.",
					},
				},
				observation: "Nothing happens.",
			},
		};
		expect(messageForMove(result)).toBe("Something stands at the threshold; the way is barred.");
	});

	it("renders a structured movement-budget refusal as player prose, never raw JSON", () => {
		const result = {
			details: {
				receipt: {
					status: "dispatched",
					verb_class: "movement",
					handle: "h:5",
					outcome: "rejected",
					move: {
						status: "rejected",
						actor_id: "7",
						edge_id: "e5",
						to_node: "tomb/crypt",
						reason: "r_move rejected by server",
						failure_detail:
							'channel=srd/economy_channel/movement;{"reason":"action_budget_exhausted","channel":"srd/economy_channel/movement","spent_ms":5002,"pool_ms":6000}',
					},
				},
			},
		};
		expect(messageForMove(result)).toBe("You have no movement left.");
	});

	it("shows the receipt's sentence for a failed gate, never its evaluation trail (sk-jay0.1.76.10)", () => {
		const trail =
			"affordance_template=srd/affordance/grid-step;mode=;predicate_source=canonical(template=srd/affordance/grid-step,root_node_id=6,nodes=6);span=unavailable;predicate_value=false";
		const result = (move: Record<string, unknown>) => ({
			details: {
				receipt: {
					status: "dispatched",
					verb_class: "movement",
					handle: "h:6",
					outcome: "rejected",
					move: { status: "rejected", reason: "r_move rejected by server", ...move },
				},
			},
		});
		const classed = result({
			failure_detail: trail,
			failure_kind: "predicate_no_longer_holds",
			player_message: "The way is closed to you right now.",
		});
		expect(messageForMove(classed)).toBe("The way is closed to you right now.");
		expect(moveRefusal(classed)).toEqual({ code: "r_move rejected by server", detail: trail });
		// A receipt without the sentence still never prints the trail.
		expect(messageForMove(result({ failure_detail: trail }))).toBe(
			"That cannot be done right now.",
		);
		// The sentence also beats the SDK wrapper text when there is no detail.
		expect(messageForMove(result({ player_message: "Something blocks the way." }))).toBe(
			"Something blocks the way.",
		);
	});

	it("falls back to the generic reason when the kernel gave no failure_detail", () => {
		const result = {
			details: {
				receipt: {
					status: "dispatched",
					verb_class: "movement",
					handle: "h:4",
					outcome: "rejected",
					move: {
						status: "rejected",
						actor_id: "7",
						edge_id: "e4",
						from_node: "inn/common_room",
						to_node: "inn/foyer",
						reason: "r_move rejected by server",
					},
				},
				observation: "Nothing happens.",
			},
		};
		expect(messageForMove(result)).toBe("r_move rejected by server");
	});
});

describe("messageForAct", () => {
	it("names what changed from world_deltas when a kit pick left no authored observation", () => {
		const result = {
			details: {
				receipt: {
					status: "dispatched",
					verb_class: "manipulate",
					handle: "h:kit",
					outcome: "accepted",
					manipulate: { status: "success" },
				},
				observation: null,
				observation_gap:
					"Nothing you can perceive changed, and this action has no narrative of its own.",
				world_deltas: { inventory: { added: ["Fighter's Pack"], removed: [], more: 0 } },
			},
		};
		expect(messageForAct(result)).toBe("You now carry Fighter's Pack.");
	});

	it("names a self-state change from world_deltas (confirm/adopt-name during character creation)", () => {
		const result = {
			details: {
				receipt: {
					status: "dispatched",
					verb_class: "communicate",
					handle: "h:confirm",
					outcome: "accepted",
					communicate: { status: "success" },
				},
				observation: null,
				observation_gap:
					"No spoken utterance was supplied (pass `utterance` to speak aloud); communicate outcomes carry no authored per-action narrative otherwise.",
				conversation: {
					spoken_by_player: null,
					response: null,
					awaiting_response: false,
					continuity: null,
				},
				world_deltas: { self: [{ state_id: "srd/state/level", prev: null, value: "1" }] },
			},
		};
		expect(messageForAct(result)).toBe("Level is now 1.");
	});

	it("stays 'Nothing you notice changes.' when the act truly changed nothing perceivable", () => {
		const result = {
			details: {
				receipt: {
					status: "dispatched",
					verb_class: "manipulate",
					handle: "h:noop",
					outcome: "accepted",
					manipulate: { status: "success" },
				},
				observation: null,
				observation_gap:
					"Nothing you can perceive changed, and this action has no narrative of its own.",
			},
		};
		expect(messageForAct(result)).toBe("Nothing you notice changes.");
	});
});

describe("moveRefusal / actRefusal: the raw code + failure_detail behind a rejection's prose (sk-j8e.4)", () => {
	it("moveRefusal carries the world's own reason and failure_detail for a rejected move", () => {
		const result = {
			details: {
				receipt: {
					status: "dispatched",
					verb_class: "movement",
					handle: "h:3",
					outcome: "rejected",
					move: {
						status: "rejected",
						actor_id: "7",
						edge_id: "e3",
						from_node: "inn/common_room",
						to_node: "inn/foyer",
						reason: "r_move rejected by server",
						failure_detail: "Something stands at the threshold; the way is barred.",
					},
				},
				observation: "Nothing happens.",
			},
		};
		expect(moveRefusal(result)).toEqual({
			code: "r_move rejected by server",
			detail: "Something stands at the threshold; the way is barred.",
		});
	});

	it("moveRefusal omits detail when the kernel gave none", () => {
		const result = {
			details: {
				receipt: {
					status: "dispatched",
					verb_class: "movement",
					handle: "h:4",
					outcome: "rejected",
					move: {
						status: "rejected",
						actor_id: "7",
						edge_id: "e4",
						reason: "r_move rejected by server",
					},
				},
				observation: "Nothing happens.",
			},
		};
		expect(moveRefusal(result)).toEqual({ code: "r_move rejected by server" });
	});

	it("moveRefusal is undefined for an accepted move", () => {
		const result = {
			details: {
				receipt: {
					status: "dispatched",
					verb_class: "movement",
					handle: "h:1",
					outcome: "accepted",
					move: { status: "success", actor_id: "7", edge_id: "e1", to_node: "inn/bar" },
				},
				observation: null,
			},
		};
		expect(moveRefusal(result)).toBeUndefined();
	});

	it("actRefusal carries the nested verb's reason and failure_detail for a rejected act", () => {
		const result = {
			details: {
				receipt: {
					status: "dispatched",
					verb_class: "manipulate",
					handle: "h:pick",
					outcome: "rejected",
					manipulate: {
						status: "rejected",
						reason: "r_manipulate rejected by server",
						player_message: "No effort is available for that action.",
						failure_detail: "action_budget_exhausted",
					},
				},
				observation: "Nothing happens.",
			},
		};
		expect(actRefusal(result)).toEqual({
			code: "r_manipulate rejected by server",
			detail: "action_budget_exhausted",
		});
	});

	it("actRefusal is undefined for an accepted act", () => {
		const result = {
			details: {
				receipt: {
					status: "dispatched",
					verb_class: "manipulate",
					handle: "h:kit",
					outcome: "accepted",
					manipulate: { status: "success" },
				},
				observation: "You open the chest.",
			},
		};
		expect(actRefusal(result)).toBeUndefined();
	});
});

describe("latestTick", () => {
	it("returns 0 when neither events nor speech carry a tick yet", () => {
		expect(latestTick({ events: [], speech: [] })).toBe(0);
	});

	it("reads the freshest tick across both events and speech", () => {
		expect(
			latestTick({
				events: [
					{ id: "e1", tick: 3, kind: "self_condition_changed", summary: "x" },
					{ id: "e2", tick: 9, kind: "self_condition_changed", summary: "y" },
				],
				speech: [
					{
						id: "s1",
						tick: 5,
						speakerId: "1",
						speaker: "Aldwin",
						text: "Hello.",
						mine: false,
					},
				],
			}),
		).toBe(9);
	});

	it("prefers a speech tick over a lower event tick", () => {
		expect(
			latestTick({
				events: [{ id: "e1", tick: 2, kind: "self_condition_changed", summary: "x" }],
				speech: [{ id: "s1", tick: 12, speakerId: null, speaker: "You", text: "Hi.", mine: true }],
			}),
		).toBe(12);
	});
});

it("keeps the initial watch unavailable when admitted tag coverage has not arrived", async () => {
	openSessionMock.mockImplementationOnce(async () => ({
		actorId: "1",
		session: { conn: { db: {} }, worldEvents: { diffAndAdvance: () => [] } },
		onUpdate: () => () => {},
		close: vi.fn(),
	}));
	const onWatch = vi.fn();
	const onError = vi.fn();
	const handle = await openPlaySession({
		url: "http://localhost:9450",
		db: "test",
		token: "test",
		actorId: "1",
		authorizedToolRoles: ["PLAYER"],
		onView: vi.fn(),
		onError,
		onWatch,
	});
	try {
		expect(onError).not.toHaveBeenCalled();
		expect(onWatch).toHaveBeenCalledWith(null);
		expect(onWatch.mock.calls.every(([frame]) => frame === null)).toBe(true);
	} finally {
		handle.disconnect();
	}
});

// K2: event action IDs and observation ticks do not prove an answered occurrence.
it.each([
	{ retainedBeforeAnswer: false, confirmedText: "" },
	{ retainedBeforeAnswer: true, confirmedText: "" },
	{ retainedBeforeAnswer: true, confirmedText: "Acolyte" },
])("never relabels an observed choice from a reused slot: %j", async ({
	retainedBeforeAnswer,
	confirmedText,
}) => {
	const pending: unknown[] = [];
	openSessionMock.mockImplementationOnce(async () => ({
		actorId: "1",
		session: {
			conn: { db: {} },
			worldEvents: {
				observe: () => {},
				drainObserved: () => pending.splice(0),
				diffAndAdvance: () => [],
			},
		},
		onUpdate: () => () => {},
		close: vi.fn(),
	}));
	const prompt = (id: string, label: string, opened: number) => ({
		occurrence_id: id,
		prompt_def_id: id,
		contract_version: 1,
		source_ref: "entity:4",
		response_action_ids: ["dm/dialog/choice/1"],
		opened_at_tick: opened,
		consumed: false,
		presentation: { labels: { "dm/dialog/choice/1": label } },
	});
	let currentPrompt = retainedBeforeAnswer
		? prompt("background", "Acolyte", 10)
		: prompt("species", "Dragonborn", 20);
	economyTools.set("spellkave_manipulation_context", {
		execute: vi.fn(async () => ({
			details: {
				manipulation_context: {
					status: "ready",
					schema_version: 1,
					revision: 1,
					actions: [],
					targets: [],
					participants: [],
					prompts: [currentPrompt],
				},
			},
		})),
	});
	const onView = vi.fn();
	const handle = await openPlaySession({
		url: "http://localhost:9450",
		db: "test",
		token: "test",
		actorId: "1",
		authorizedToolRoles: ["PLAYER"],
		onView,
		onError: vi.fn(),
	});
	try {
		currentPrompt = prompt("species", "Dragonborn", 20);
		pending.push({
			kind: "speech_heard",
			trace_id: "old-choice",
			trace_kind: "srd/speech",
			text: confirmedText,
			action_id: "dm/dialog/choice/1",
			response: { action_id: "dm/dialog/choice/1", slot: 1 },
			inscribed_at: 12,
			observed_at_tick: 40,
			inscribed_by: "1",
			inscribed_by_name: "Hero",
			addressee: 4,
			location_kind: "place_node",
			location_ref: "room",
		});
		await handle.refresh();
		const choice = () =>
			onView.mock.calls
				.at(-1)?.[0]
				.speech.find((line: { id: string }) => line.id === "speech:old-choice");
		expect(choice()?.text).toBe(confirmedText);
		currentPrompt = prompt("next", "Another reused answer", 45);
		await handle.refresh();
		expect(choice()?.text).toBe(confirmedText);
	} finally {
		handle.disconnect();
	}
});

/** A live session whose world-event cursor the test feeds by hand. */
function mockLiveWithEvents(pending: unknown[], actorId = "1") {
	openSessionMock.mockImplementationOnce(async () => ({
		actorId,
		session: {
			conn: { db: {} },
			worldEvents: {
				observe: () => {},
				drainObserved: () => pending.splice(0),
				diffAndAdvance: () => [],
			},
		},
		onUpdate: () => () => {},
		close: vi.fn(),
	}));
}

const flushMicrotasks = async (): Promise<void> => {
	for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
};

describe("openPlaySession — batch 4 of the 2026-11-12 dogfood round", () => {
	const open = async (onView: ReturnType<typeof vi.fn>) =>
		openPlaySession({
			url: "http://localhost:9450",
			db: "test",
			token: "test",
			actorId: "1",
			authorizedToolRoles: ["PLAYER"],
			onView,
			onError: vi.fn(),
		});

	it("keeps a speaker's name for a later unnamed line, and 'Someone' for a stranger (sk-jay0.1.8.96 s8)", async () => {
		const pending: unknown[] = [];
		mockLiveWithEvents(pending);
		const onView = vi.fn();
		const handle = await open(onView);
		const heard = (traceId: string, speaker: string, name: string | null, tick: number) => ({
			kind: "speech_heard",
			trace_id: traceId,
			trace_kind: "srd/speech",
			text: `line ${traceId}`,
			inscribed_at: tick,
			observed_at_tick: tick,
			inscribed_by: speaker,
			inscribed_by_name: name,
			location_kind: "place_node",
			location_ref: "room",
		});
		const speakers = () =>
			onView.mock.lastCall?.[0].speech.map((line: { speaker: string }) => line.speaker);
		try {
			pending.push(heard("1", "4", "Aldwin", 10));
			await handle.refresh();
			// A later refresh: the hero has left, the world no longer names him.
			pending.push(heard("2", "4", null, 20), heard("3", "9", null, 21));
			await handle.refresh();
			expect(speakers()).toEqual(["Aldwin", "Aldwin", "Someone"]);
		} finally {
			handle.disconnect();
		}
	});

	it("never gives an earlier unnamed line a name that arrives later in the same batch (sk-jay0.1.8.96 s8)", async () => {
		const pending: unknown[] = [];
		mockLiveWithEvents(pending);
		const onView = vi.fn();
		const handle = await open(onView);
		const heard = (traceId: string, name: string | null, tick: number) => ({
			kind: "speech_heard",
			trace_id: traceId,
			trace_kind: "srd/speech",
			text: `line ${traceId}`,
			inscribed_at: tick,
			observed_at_tick: tick,
			inscribed_by: "5",
			inscribed_by_name: name,
			location_kind: "place_node",
			location_ref: "room",
		});
		try {
			// One drain: the world withheld the name at tick 5 and gave it at 6.
			pending.push(heard("1", null, 5), heard("2", "Mara", 6), heard("3", null, 7));
			await handle.refresh();
			expect(
				onView.mock.lastCall?.[0].speech.map((line: { speaker: string }) => line.speaker),
			).toEqual(["Someone", "Mara", "Mara"]);
		} finally {
			handle.disconnect();
		}
	});

	it("asks the map for the hero's own floor, and keeps the picture while another elevation loads (sk-jay0.1.8.111)", async () => {
		mockLiveWithEvents([]);
		let scene: Record<string, unknown> = { node_id: "inn/common_room", pose_elevation: 0 };
		economyTools.set("spellkave_scene", {
			execute: vi.fn(async () => ({ details: { scene_resolved: true, items: [], ...scene } })),
		});
		const mapExecute = vi.fn(async (_call: string, _params: Record<string, unknown>) => ({
			details: { svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' },
		}));
		economyTools.set("spellkave_map", { execute: mapExecute });
		const onView = vi.fn();
		const handle = await open(onView);
		try {
			await flushMicrotasks();
			expect(mapExecute).toHaveBeenLastCalledWith("play", {
				output_type: "svg",
				graph: "inn",
				z: 0,
			});
			expect(onView.mock.lastCall?.[0].mapState).toBe("ready");

			// Another elevation in the same graph (the stairs down, or the next
			// node of an outdoor graph the tool does not draw by floor): the new
			// floor is asked for, and the card never blanks to "loading" while
			// the answer is on its way.
			scene = { node_id: "inn/cellar", pose_elevation: -3 };
			onView.mockClear();
			await handle.refresh();
			expect(mapExecute).toHaveBeenLastCalledWith("play", {
				output_type: "svg",
				graph: "inn",
				z: -3,
			});
			expect(onView.mock.calls.length).toBeGreaterThan(0);
			expect(onView.mock.calls.every(([published]) => published.mapState === "ready")).toBe(true);

			// No elevation from the world: the tool's own default floor, no z.
			scene = { node_id: "inn/yard" };
			await handle.refresh();
			expect(mapExecute).toHaveBeenLastCalledWith("play", { output_type: "svg", graph: "inn" });
		} finally {
			handle.disconnect();
		}
	});

	it("asks for every floor instead of the hero's own when the host sets mapSlice (apps/classic, sk-jay0.1.76.14.3)", async () => {
		mockLiveWithEvents([]);
		economyTools.set("spellkave_scene", {
			execute: vi.fn(async () => ({
				details: { scene_resolved: true, items: [], node_id: "inn/cellar", pose_elevation: -3 },
			})),
		});
		const mapExecute = vi.fn(async (_call: string, _params: Record<string, unknown>) => ({
			details: { svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' },
		}));
		economyTools.set("spellkave_map", { execute: mapExecute });
		const handle = await openPlaySession({
			url: "http://localhost:9450",
			db: "test",
			token: "test",
			actorId: "1",
			authorizedToolRoles: ["PLAYER"],
			mapSlice: "all_floors_offset",
			onView: vi.fn(),
			onError: vi.fn(),
		});
		try {
			await flushMicrotasks();
			expect(mapExecute).toHaveBeenLastCalledWith("play", {
				output_type: "svg",
				graph: "inn",
				slice: "all_floors_offset",
			});
		} finally {
			handle.disconnect();
		}
	});

	it("shows no HP, AC or XP while the hero is being drafted, the self-state xp included (sk-jay0.1.8.102 s3)", async () => {
		mockLiveWithEvents([]);
		let conditions: unknown[] = [{ condition_definition_id: "dm/creation/drafting" }];
		economyTools.set("spellkave_self_summary", {
			execute: vi.fn(async () => ({
				details: {
					self: {
						entity_name: "Brannoch",
						vitals: {
							items: [
								{ state_id: "srd/hp", value: "0" },
								{ state_id: "srd/ac", value: "0" },
							],
						},
						conditions: { items: conditions },
					},
				},
			})),
		});
		economyTools.set("spellkave_self_states", {
			execute: vi.fn(async (_call: string, params: { kind?: string }) => ({
				details: { items: params.kind === "state" ? [{ state_id: "srd/xp", value: "0" }] : [] },
			})),
		});
		const onView = vi.fn();
		const handle = await open(onView);
		const hero = () => onView.mock.lastCall?.[0].hero;
		try {
			expect(hero().drafting).toBe(true);
			expect([hero().hp, hero().ac, hero().xp]).toEqual([undefined, undefined, undefined]);
			expect(hero().vitals).toEqual([]);

			conditions = [];
			await handle.refresh();
			expect(hero().drafting).toBeUndefined();
			expect([hero().hp, hero().ac, hero().xp]).toEqual([0, 0, 0]);
		} finally {
			handle.disconnect();
		}
	});
});

describe("openPlaySession — event names are resolved at ingest (sk-jay0.1.8.96)", () => {
	it("names the hero 'you' and an attacker from the scene read of the SAME refresh, with no session roster", async () => {
		const pending: unknown[] = [];
		mockLiveWithEvents(pending);
		let occupants: unknown[] = [];
		economyTools.set("spellkave_self_summary", {
			execute: vi.fn(async () => ({ details: { self: { entity_name: "Brannoch" } } })),
		});
		economyTools.set("spellkave_scene", {
			execute: vi.fn(async () => ({
				details: {
					node_id: "inn/cellar",
					node_display_name: "Cellar",
					scene_resolved: true,
					items: occupants,
				},
			})),
		});
		const onView = vi.fn();
		const handle = await openPlaySession({
			url: "http://localhost:9450",
			db: "test",
			token: "test",
			actorId: "1",
			authorizedToolRoles: ["PLAYER"],
			onView,
			onError: vi.fn(),
		});
		try {
			// The hero walks into the cellar: the rat is first disclosed by the
			// scene read of the very refresh that drains its hit.
			occupants = [
				{ handle: "s:actor:170", rev: "r1", kind: "actor", id: "170", label: "Cellar Rat" },
			];
			pending.push(
				{
					kind: "turn_transition",
					session_id: "9001",
					from_actor: null,
					to_actor: "1",
					observed_at_tick: 40,
				},
				{
					kind: "self_hit",
					resource_id: "srd/hp",
					amount: 5,
					new_value: 0,
					attack_kind: "srd/attack/melee/success",
					attacker_id: "170",
					observed_at_tick: 40,
				},
				{
					kind: "self_condition_changed",
					condition_id: "dm/creation/pending/name",
					applied: false,
					source_entity_id: null,
					observed_at_tick: 40,
				},
			);
			await handle.refresh();
			const view = onView.mock.lastCall?.[0];
			expect(view.session.roster).toEqual([]);
			expect(view.events.map((event: { summary: string }) => event.summary)).toEqual([
				"The turn opens with you.",
				"You take 5 damage from Cellar Rat — 0 HP left.",
			]);
			expect(view.events[1].fields.attacker).toEqual({ id: "170", name: "Cellar Rat" });

			// The rat leaves; the line keeps the name known when it happened.
			occupants = [];
			await handle.refresh();
			expect(onView.mock.lastCall?.[0].events[1].summary).toBe(
				"You take 5 damage from Cellar Rat — 0 HP left.",
			);
		} finally {
			handle.disconnect();
		}
	});

	it("drops a hero-only walk session's lines across refreshes, remembering its id from 'opened' (sk-jay0.1.8.96 s4)", async () => {
		const pending: unknown[] = [];
		mockLiveWithEvents(pending);
		const onView = vi.fn();
		const handle = await openPlaySession({
			url: "http://localhost:9450",
			db: "test",
			token: "test",
			actorId: "1",
			authorizedToolRoles: ["PLAYER"],
			onView,
			onError: vi.fn(),
		});
		try {
			pending.push(
				{
					kind: "session_lifecycle",
					session_id: "77",
					phase: "opened",
					participants: ["1"],
					opened_by: "1",
					observed_at_tick: 10,
				},
				{
					kind: "turn_transition",
					session_id: "77",
					from_actor: null,
					to_actor: "1",
					observed_at_tick: 10,
				},
			);
			await handle.refresh();
			expect(onView.mock.lastCall?.[0].events).toEqual([]);
			// The next refresh drains the close, which names no participants.
			pending.push(
				{
					kind: "session_lifecycle",
					session_id: "77",
					phase: "closed",
					participants: [],
					opened_by: "1",
					observed_at_tick: 13,
				},
				{ kind: "xp_gained", amount: 5, observed_at_tick: 13 },
			);
			await handle.refresh();
			expect(onView.mock.lastCall?.[0].events.map((event: { kind: string }) => event.kind)).toEqual(
				["xp_gained"],
			);
		} finally {
			handle.disconnect();
		}
	});

	it("drops the close of a hero-only walk that was already running when the page connected", async () => {
		const pending: unknown[] = [];
		mockLiveWithEvents(pending);
		// A reconnect or reload mid-walk: the first read already shows the
		// session, and no 'opened' row is ever drained for it.
		const roster = [{ actor_id: "1", ordinal: 0 }];
		economyTools.set("spellkave_session_status", {
			execute: vi.fn(async () => ({
				details: { session: { session_id: "77", in_session: true, roster } },
			})),
		});
		const onView = vi.fn();
		const handle = await openPlaySession({
			url: "http://localhost:9450",
			db: "test",
			token: "test",
			actorId: "1",
			authorizedToolRoles: ["PLAYER"],
			onView,
			onError: vi.fn(),
		});
		const close = (sessionId: string, tick: number) => ({
			kind: "session_lifecycle",
			session_id: sessionId,
			phase: "closed",
			participants: [],
			opened_by: "1",
			observed_at_tick: tick,
		});
		try {
			expect(onView.mock.lastCall?.[0].session.id).toBe("77");
			pending.push(close("77", 13), { kind: "xp_gained", amount: 5, observed_at_tick: 13 });
			await handle.refresh();
			expect(onView.mock.lastCall?.[0].events.map((event: { kind: string }) => event.kind)).toEqual(
				["xp_gained"],
			);
			// Only the first read seeds: a later session that reads hero-only
			// without an 'opened' row here keeps its closing line.
			pending.push(close("78", 20));
			await handle.refresh();
			expect(onView.mock.lastCall?.[0].events.map((event: { kind: string }) => event.kind)).toEqual(
				["xp_gained", "session_lifecycle"],
			);
		} finally {
			handle.disconnect();
		}
	});

	it("labels the hero's own target 'You (<name>)' and never shows a raw target ref", async () => {
		mockLiveWithEvents([], "168");
		economyTools.set("spellkave_self_summary", {
			execute: vi.fn(async () => ({ details: { self: { entity_name: "Brannoch" } } })),
		});
		economyTools.set("spellkave_manipulation_context", {
			execute: vi.fn(async () => ({
				details: {
					manipulation_context: {
						status: "ready",
						schema_version: 1,
						revision: 1,
						actions: [],
						targets: [
							{ target_fact_id: "t:self", target_ref: "entity:168" },
							{ target_fact_id: "t:other", target_ref: "entity:999" },
						],
						participants: [],
						prompts: [],
					},
				},
			})),
		});
		const onView = vi.fn();
		const handle = await openPlaySession({
			url: "http://localhost:9450",
			db: "test",
			token: "test",
			actorId: "168",
			authorizedToolRoles: ["PLAYER"],
			onView,
			onError: vi.fn(),
		});
		try {
			const context = onView.mock.lastCall?.[0].manipulationContext;
			expect(context.targets.map((target: { targetName: string }) => target.targetName)).toEqual([
				"You (Brannoch)",
				"Someone here",
			]);
		} finally {
			handle.disconnect();
		}
	});
});

describe("openPlaySession — map refresh is stale-while-revalidate (sk-jay0.1.8.100)", () => {
	const svg = (name: string) => `<svg data-map="${name}"></svg>`;

	it("keeps the shown map while refetching the same graph, and goes to 'loading' only on a graph change", async () => {
		mockLiveWithEvents([]);
		let nodeId = "inn/common_room";
		economyTools.set("spellkave_scene", {
			execute: vi.fn(async () => ({
				details: { node_id: nodeId, node_display_name: nodeId, scene_resolved: true, items: [] },
			})),
		});
		const mapAnswers: Array<(payload: unknown) => void> = [];
		const mapExecute = vi.fn(
			(_call: string, _params: Record<string, unknown>) =>
				new Promise<unknown>((resolve) => {
					mapAnswers.push(resolve);
				}),
		);
		economyTools.set("spellkave_map", { execute: mapExecute });
		const onView = vi.fn();
		const handle = await openPlaySession({
			url: "http://localhost:9450",
			db: "test",
			token: "test",
			actorId: "1",
			authorizedToolRoles: ["PLAYER"],
			onView,
			onError: vi.fn(),
		});
		const last = () => onView.mock.lastCall?.[0];
		const answer = async (payload: unknown) => {
			mapAnswers.shift()?.(payload);
			await flushMicrotasks();
		};
		try {
			// First picture of the graph: nothing to keep, so it is "loading".
			expect(last().mapState).toBe("loading");
			expect(mapExecute).toHaveBeenLastCalledWith("play", { output_type: "svg", graph: "inn" });
			await answer({
				details: {
					svg: svg("first"),
					session_tokens: [{ node_id: "inn/common_room", actor_id: "1", name: "Renn" }],
				},
			});
			expect(last().mapState).toBe("ready");
			expect(last().mapSvg).toBe(svg("first"));

			// A move inside the same graph refetches in the background.
			onView.mockClear();
			nodeId = "inn/stairs";
			await handle.refresh();
			expect(mapExecute).toHaveBeenCalledTimes(2);
			expect(onView.mock.calls.length).toBeGreaterThan(0);
			for (const [published] of onView.mock.calls) {
				expect(published.mapState).toBe("ready");
				expect(published.mapSvg).toBe(svg("first"));
				expect(published.sessionTokens).toHaveLength(1);
			}
			expect(last().place.id).toBe("inn/stairs");
			await answer({ details: { svg: svg("second") } });
			expect(last().mapState).toBe("ready");
			expect(last().mapSvg).toBe(svg("second"));
			expect(last().sessionTokens).toEqual([]);

			// Another graph: the old drawing is of somewhere else, so it goes.
			nodeId = "cellar/landing";
			await handle.refresh();
			expect(mapExecute).toHaveBeenLastCalledWith("play", { output_type: "svg", graph: "cellar" });
			expect(last().mapState).toBe("loading");
			expect(last().mapSvg).toBeNull();
			expect(last().sessionTokens).toEqual([]);
			await answer({ details: { svg: svg("cellar") } });
			expect(last().mapSvg).toBe(svg("cellar"));
		} finally {
			handle.disconnect();
		}
	});

	it("shows the failure, not the kept map, when the background refetch fails", async () => {
		mockLiveWithEvents([]);
		let nodeId = "inn/common_room";
		economyTools.set("spellkave_scene", {
			execute: vi.fn(async () => ({
				details: { node_id: nodeId, node_display_name: nodeId, scene_resolved: true, items: [] },
			})),
		});
		let fail = false;
		economyTools.set("spellkave_map", {
			execute: vi.fn(async () => {
				if (fail) throw new Error("map unavailable");
				return { details: { svg: svg("first") } };
			}),
		});
		const onView = vi.fn();
		const handle = await openPlaySession({
			url: "http://localhost:9450",
			db: "test",
			token: "test",
			actorId: "1",
			authorizedToolRoles: ["PLAYER"],
			onView,
			onError: vi.fn(),
		});
		try {
			await flushMicrotasks();
			expect(onView.mock.lastCall?.[0].mapState).toBe("ready");
			fail = true;
			nodeId = "inn/stairs";
			await handle.refresh();
			await flushMicrotasks();
			expect(onView.mock.lastCall?.[0].mapState).toBe("failed");
			expect(onView.mock.lastCall?.[0].mapSvg).toBeNull();
		} finally {
			handle.disconnect();
		}
	});
});
