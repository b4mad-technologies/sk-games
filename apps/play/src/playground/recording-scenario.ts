import type { BrowserRoleToolSet } from "../lib/browser-role-tools";
import type { PlayPresentation } from "../lib/play-recording";
import {
	parsePlayRecording,
	playPresentationFromPayload,
	playViewFromPayload,
} from "../lib/play-recording";
import type { PlaySandbox } from "../lib/play-sandbox";
import type { PlaySessionHandle } from "../lib/play-session";
import type { PlayAction, PlayExit, PlayView } from "../lib/play-view";

export interface RecordingScenario {
	recordingId: string;
	entryFrameId: string;
	checkpoints?: Record<string, string>;
	transitions?: RecordingTransition[];
}
export type RecordingTransitionInput =
	| { kind: "act"; actionId: string; words?: string }
	| { kind: "move"; handle: string }
	| { kind: "endTurn" }
	| { kind: "react"; handle: string; responseIntent: string };
export interface RecordingTransition {
	fromFrameId: string;
	toFrameId: string;
	input: RecordingTransitionInput;
}
export interface RecordingScenarioSnapshot {
	frameId: string;
	view: PlayView;
	log: string[];
	presentation?: PlayPresentation;
}
export interface RecordingScenarioController {
	sandbox: PlaySandbox;
	snapshot(): RecordingScenarioSnapshot;
	selectFrame(frameId: string): boolean;
	selectCheckpoint(id: string): boolean;
	readonly recording: NonNullable<ReturnType<typeof parsePlayRecording>>;
}
export interface CreateRecordingScenarioArgs {
	recording: unknown;
	scenario?: RecordingScenario;
	world?: { slug: string; name: string; db: string };
	presentation?: PlayPresentation;
	onChange?: (snapshot: RecordingScenarioSnapshot) => void;
	initialFrameId?: string;
}

export function createRecordingScenarioController(
	recording: unknown,
	scenario?: RecordingScenario,
	onChange?: (snapshot: RecordingScenarioSnapshot) => void,
	initialFrameId?: string,
): RecordingScenarioController {
	return createRecordingScenario({ recording, scenario, onChange, initialFrameId });
}

/** Credential-free, read-only replay. Transitions can only select captured frames. */
export function createRecordingScenario(
	args: CreateRecordingScenarioArgs,
): RecordingScenarioController {
	const envelope = parsePlayRecording(args.recording);
	if (!envelope || envelope.frames.length === 0)
		throw new Error("Recording must contain at least one frame");
	const id = identity(envelope);
	const frames = new Map<string, (typeof envelope.frames)[number]>();
	for (const frame of envelope.frames) {
		const key = frameId(frame);
		if (frames.has(key)) throw new Error(`Recording has duplicate frame ID: ${key}`);
		frames.set(key, frame);
	}
	if (args.scenario !== undefined) validate(args.scenario, id, frames);
	const scenario = args.scenario === undefined ? undefined : structuredClone(args.scenario);
	let current = args.initialFrameId ?? scenario?.entryFrameId ?? frameId(envelope.frames.at(-1)!);
	if (!frames.has(current)) throw new Error(`Scenario references missing frame: ${current}`);
	let view = playViewFromPayload(frames.get(current)!.payload);
	let log: string[] = [];
	let publish: ((view: PlayView) => void) | undefined;
	let disconnected = false;
	let handleGeneration = 0;
	const currentPresentation = () =>
		args.presentation ?? playPresentationFromPayload(frames.get(current)!.payload);
	const snapshot = (): RecordingScenarioSnapshot => ({
		frameId: current,
		view: structuredClone(view),
		log: [...log],
		presentation: currentPresentation(),
	});
	const selectFrame = (next: string): boolean => {
		const frame = frames.get(next);
		if (!frame) return false;
		current = next;
		view = playViewFromPayload(frame.payload);
		log = [...log, `Recording frame: ${next}`].slice(-24);
		if (!disconnected) {
			publish?.(structuredClone(view));
			args.onChange?.(snapshot());
		}
		return true;
	};
	const selectCheckpoint = (key: string): boolean => {
		const target = scenario?.checkpoints?.[key];
		return target ? selectFrame(target) : false;
	};
	const transition = (input: RecordingTransitionInput) =>
		scenario?.transitions?.find(
			(item) => item.fromFrameId === current && sameInput(item.input, input),
		);
	const unavailable = (what: string) => `${what} is not available in this recording.`;
	function handle(): PlaySessionHandle {
		const generation = handleGeneration;
		const active = () => !disconnected && generation === handleGeneration;
		const roleTools: BrowserRoleToolSet = { authorizedRoles: [], tools: [], byName: new Map() };
		const go = (target: string | undefined, what: string) =>
			active() && target && selectFrame(target)
				? `Selected recorded frame ${target}.`
				: scenario === undefined
					? "Imported recordings are read-only."
					: unavailable(what);
		return {
			roleTools,
			move: async (exit: PlayExit) =>
				go(transition({ kind: "move", handle: exit.handle })?.toFrameId, `Exit ${exit.handle}`),
			act: async (action: PlayAction, words?: string) =>
				go(
					transition({
						...(words === undefined
							? { kind: "act" as const, actionId: action.id }
							: { kind: "act" as const, actionId: action.id, words }),
					})?.toFrameId,
					`Action ${action.id}`,
				),
			endTurn: async () => go(transition({ kind: "endTurn" })?.toFrameId, "End turn"),
			react: async (h, _r, intent) =>
				go(transition({ kind: "react", handle: h, responseIntent: intent })?.toFrameId, "Reaction"),
			selectItem: async () => {},
			selectOccupant: async () => {},
			refresh: async () => {
				if (active()) {
					publish?.(structuredClone(view));
					args.onChange?.(snapshot());
				}
			},
			disconnect: () => {
				if (generation !== handleGeneration) return;
				disconnected = true;
				handleGeneration += 1;
				publish = undefined;
			},
		};
	}
	const sandbox: PlaySandbox = {
		session: {
			access_token: "recording-only",
			id_token: "",
			expires_at: Number.MAX_SAFE_INTEGER,
			display_name: "Recorded player",
		},
		account: {
			sub: "recording",
			capabilities: [],
			worlds: [
				{
					slug: "recording",
					display_name: "Recording",
					role: "member",
					capabilities: ["world.observe", "world.play"],
				},
			],
			seat: { slug: "recording", actor_id: "recorded", role: "primary" },
		},
		world: args.world ?? {
			slug: "recording",
			name: envelope.provenance?.title ?? "UI recording",
			db: "no-live-database",
		},
		get presentation() {
			return currentPresentation();
		},
		openWorld: async (openArgs) => {
			handleGeneration += 1;
			disconnected = false;
			publish = openArgs.onView;
			publish(structuredClone(view));
			return handle();
		},
	};
	return {
		sandbox,
		snapshot,
		selectFrame,
		selectCheckpoint,
		get recording() {
			return structuredClone(envelope);
		},
	};
}
function identity(value: { id: string }): string {
	return value.id;
}
function frameId(frame: { id: string; sequence: number }): string {
	return frame.id;
}
function sameInput(a: RecordingTransitionInput, b: RecordingTransitionInput): boolean {
	return inputKey(a) === inputKey(b);
}
function inputKey(input: RecordingTransitionInput): string {
	switch (input.kind) {
		case "act":
			return JSON.stringify([input.kind, input.actionId, input.words ?? null]);
		case "move":
			return JSON.stringify([input.kind, input.handle]);
		case "endTurn":
			return JSON.stringify([input.kind]);
		case "react":
			return JSON.stringify([input.kind, input.handle, input.responseIntent]);
	}
}
function validate(
	scenario: unknown,
	recordingId: string,
	frames: Map<string, NonNullable<ReturnType<typeof parsePlayRecording>>["frames"][number]>,
): void {
	if (
		!record(scenario) ||
		!keys(scenario, ["recordingId", "entryFrameId", "checkpoints", "transitions"])
	)
		throw new Error("Invalid scenario fields");
	if (scenario.recordingId !== recordingId)
		throw new Error(`Scenario recordingId does not match recording (${scenario.recordingId})`);
	if (typeof scenario.entryFrameId !== "string" || !frames.has(scenario.entryFrameId))
		throw new Error(`Scenario references missing frame: ${scenario.entryFrameId}`);
	if (scenario.checkpoints !== undefined && !record(scenario.checkpoints))
		throw new Error("Invalid scenario checkpoints");
	for (const target of Object.values(scenario.checkpoints ?? {}))
		if (typeof target !== "string" || !frames.has(target))
			throw new Error(`Scenario references missing frame: ${target}`);
	if (
		scenario.transitions !== undefined &&
		(!Array.isArray(scenario.transitions) || scenario.transitions.length > 10_000)
	)
		throw new Error("Invalid scenario transitions");
	const seen = new Set<string>();
	for (const item of scenario.transitions ?? []) {
		if (!record(item) || !keys(item, ["fromFrameId", "toFrameId", "input"]))
			throw new Error("Invalid transition fields");
		if (
			typeof item.fromFrameId !== "string" ||
			typeof item.toFrameId !== "string" ||
			!frames.has(item.fromFrameId) ||
			!frames.has(item.toFrameId)
		)
			throw new Error("Scenario transition references missing frame");
		if (!isInput(item.input)) throw new Error("Invalid scenario input");
		const key = JSON.stringify([item.fromFrameId, inputKey(item.input)]);
		if (seen.has(key)) throw new Error(`Duplicate scenario transition: ${key}`);
		seen.add(key);
		const input = item.input;
		const view = playViewFromPayload(frames.get(item.fromFrameId)!.payload);
		const offered =
			input.kind === "act"
				? view.actions.some(
						(action) =>
							action.id === input.actionId &&
							(!action.acceptsUtterance || input.words !== undefined),
					)
				: input.kind === "move"
					? view.place?.exits.some((exit) => exit.handle === input.handle)
					: input.kind === "endTurn"
						? view.session.inSession && view.session.myTurn
						: view.reaction?.handle === input.handle;
		if (!offered) throw new Error(`Scenario input is not offered by frame ${item.fromFrameId}`);
	}
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: string[]): boolean {
	return Object.keys(value).every((key) => allowed.includes(key));
}
function isInput(value: unknown): value is RecordingTransitionInput {
	if (!record(value)) return false;
	switch (value.kind) {
		case "act":
			return (
				keys(value, ["kind", "actionId", "words"]) &&
				typeof value.actionId === "string" &&
				(value.words === undefined || typeof value.words === "string")
			);
		case "move":
			return keys(value, ["kind", "handle"]) && typeof value.handle === "string";
		case "endTurn":
			return keys(value, ["kind"]);
		case "react":
			return (
				keys(value, ["kind", "handle", "responseIntent"]) &&
				typeof value.handle === "string" &&
				typeof value.responseIntent === "string"
			);
		default:
			return false;
	}
}
