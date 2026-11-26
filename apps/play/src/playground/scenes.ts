import type { PlayView } from "../lib/play-view";
import {
	createRecordingScenario,
	type RecordingScenario,
	type RecordingScenarioController,
	type RecordingScenarioSnapshot,
} from "./recording-scenario";
import combatRecording from "./recordings/combat.recording.json";
import conversationRecording from "./recordings/conversation.recording.json";
import creationRecording from "./recordings/creation.recording.json";
import explorationRecording from "./recordings/exploration.recording.json";
import liveCombatRecording from "./recordings/live-combat.recording.json";
import reactionRecording from "./recordings/reaction.recording.json";

/** Playground labels and URLs are stable entry points into checked-in recordings. */
export const scenes = [
	{
		id: "creation",
		label: "Creation",
		description: "Recorded Fighter creation path. Only its captured choices and name=Mira advance.",
	},
	{
		id: "conversation",
		label: "Conversation",
		description: "Recorded group-conversation frame; freeform replies have no simulated outcome.",
	},
	{
		id: "exploration",
		label: "Exploration",
		description: "Recorded Common Room and Stairs frames.",
	},
	{ id: "combat", label: "Combat", description: "Recorded encounter and recorded melee outcome." },
	{
		id: "reaction",
		label: "Reaction",
		description: "Recorded reaction-window frame; unsupported responses remain on it.",
	},
] as const;
export type SceneId = (typeof scenes)[number]["id"];
export function sceneId(value: string | null): SceneId {
	return scenes.find((scene) => scene.id === value)?.id ?? "creation";
}

/** These checkpoint names remain URL-compatible; they select captured frames. */
export const creationSteps = [
	"class",
	"species",
	"background",
	"scores",
	"name",
	"review",
	"complete",
] as const;
export type CreationStep = (typeof creationSteps)[number];
export function creationStep(value: string | null): CreationStep {
	return creationSteps.find((step) => step === value) ?? "class";
}

export interface PlaygroundSnapshot extends RecordingScenarioSnapshot {
	scene: SceneId;
	step: CreationStep;
	view: PlayView;
}

const recordings = {
	creation: creationRecording,
	conversation: conversationRecording,
	exploration: explorationRecording,
	combat: combatRecording,
	reaction: reactionRecording,
} as const;

/** A real browser export retained for read-only review. It is deliberately not
 * a sixth scripted scene: it has no scenario overlay or invented outcomes. */
export const readonlyRecordings = [
	{ id: "live-combat", label: "Recorded combat (read-only)", recording: liveCombatRecording },
] as const;

const overlays: Record<SceneId, RecordingScenario> = {
	creation: {
		recordingId: "playground_legacy_creation",
		entryFrameId: "frame_tb9oirlsdw13",
		checkpoints: {
			class: "frame_tb9oirlsdw13",
			species: "frame_1tnl3t6w9rhsy",
			background: "frame_o83dgr12h08dx",
			scores: "frame_11fgqlhr4ti1",
			name: "frame_1ygupjvf1zvdh",
			review: "frame_fq2lej1muasxf",
			complete: "frame_1fb95uo14yx7im",
		},
		transitions: [
			{
				fromFrameId: "frame_tb9oirlsdw13",
				toFrameId: "frame_1tnl3t6w9rhsy",
				input: { kind: "act", actionId: "preview:class:0" },
			},
			{
				fromFrameId: "frame_1tnl3t6w9rhsy",
				toFrameId: "frame_o83dgr12h08dx",
				input: { kind: "act", actionId: "preview:species:0" },
			},
			{
				fromFrameId: "frame_o83dgr12h08dx",
				toFrameId: "frame_11fgqlhr4ti1",
				input: { kind: "act", actionId: "preview:background:0" },
			},
			{
				fromFrameId: "frame_11fgqlhr4ti1",
				toFrameId: "frame_1ygupjvf1zvdh",
				input: { kind: "act", actionId: "preview:scores:0" },
			},
			{
				fromFrameId: "frame_1ygupjvf1zvdh",
				toFrameId: "frame_fq2lej1muasxf",
				input: { kind: "act", actionId: "preview:name", words: "name=Mira" },
			},
			{
				fromFrameId: "frame_fq2lej1muasxf",
				toFrameId: "frame_1fb95uo14yx7im",
				input: { kind: "act", actionId: "preview:review:0" },
			},
			{
				fromFrameId: "frame_fq2lej1muasxf",
				toFrameId: "frame_tb9oirlsdw13",
				input: { kind: "act", actionId: "preview:review:1" },
			},
		],
	},
	conversation: {
		recordingId: "playground_legacy_conversation",
		entryFrameId: "frame_1svjny51uufi35",
		transitions: [],
	},
	exploration: {
		recordingId: "playground_legacy_exploration",
		entryFrameId: "frame_3g6cg31s6rij7",
		transitions: [
			{
				fromFrameId: "frame_3g6cg31s6rij7",
				toFrameId: "frame_uun4g81ggt9fq",
				input: { kind: "move", handle: "s:exit:1" },
			},
		],
	},
	combat: {
		recordingId: "playground_legacy_combat",
		entryFrameId: "frame_wglac21tt6sl4",
		transitions: [
			{
				fromFrameId: "frame_wglac21tt6sl4",
				toFrameId: "frame_188k9ja1wt87i4",
				input: { kind: "act", actionId: "h:melee" },
			},
		],
	},
	reaction: {
		recordingId: "playground_legacy_reaction",
		entryFrameId: "frame_y2qmx6x8l4im",
		transitions: [],
	},
};

export function getSceneRecording(scene: SceneId): unknown {
	return recordings[scene];
}

export interface PlaygroundController extends RecordingScenarioController {
	recording: RecordingScenarioController["recording"];
	scenario: RecordingScenario;
	snapshot(): PlaygroundSnapshot;
}

/** Compatibility wrapper around the generic recording controller. Every
 * interaction is an exact overlay transition selecting an existing frame. */
export function createPlayground(
	scene: SceneId,
	onChange: (snapshot: PlaygroundSnapshot) => void = () => {},
	startStep: CreationStep = "class",
): PlaygroundController {
	const scenario = overlays[scene];
	const initialFrameId = scene === "creation" ? scenario.checkpoints?.[startStep] : undefined;
	const controller = createRecordingScenario({
		recording: recordings[scene],
		scenario,
		initialFrameId,
		onChange: () => onChange(snapshot()),
	});
	function snapshot(): PlaygroundSnapshot {
		const recorded = controller.snapshot();
		return { ...recorded, scene, step: startStep, view: recorded.view };
	}
	return { ...controller, scenario, snapshot };
}
