import { describe, expect, it } from "vitest";
import { type MosaicLayout, TILE_IDS } from "../lib/mosaic";
import {
	capturePlayView,
	createPlayRecording,
	PLAY_RECORDING_SURFACE,
	type PlayRecordingPayload,
} from "../lib/play-recording";
import { sampleView } from "./fixtures";
import { createRecordingScenario, type RecordingScenario } from "./recording-scenario";

function recording() {
	const source = createPlayRecording({ now: () => 1 });
	source.record(capturePlayView(sampleView) as unknown as PlayRecordingPayload);
	source.record({
		view: { ...sampleView, actions: [], actionCount: 0 },
		presentation: null,
	} as unknown as PlayRecordingPayload);
	return source.export(PLAY_RECORDING_SURFACE);
}

function layout(seed: number): { layout: MosaicLayout; mobile: boolean } {
	return {
		layout: {
			colShare: [seed, 1 - seed, 0],
			rowShare: Object.fromEntries(TILE_IDS.map((id) => [id, seed])) as MosaicLayout["rowShare"],
		},
		mobile: false,
	};
}

describe("recording scenario overlay", () => {
	it("selects only recorded frames through exact offered action IDs", async () => {
		const envelope = recording();
		const first = envelope.frames[0]!;
		const second = envelope.frames[1]!;
		const scenario: RecordingScenario = {
			recordingId: envelope.id,
			entryFrameId: first.id,
			transitions: [
				{
					fromFrameId: first.id,
					toFrameId: second.id,
					input: { kind: "act", actionId: "h:talk", words: "hello" },
				},
			],
		};
		const controller = createRecordingScenario({ recording: envelope, scenario });
		let view = controller.snapshot().view;
		const handle = await controller.sandbox.openWorld({
			url: "ignored",
			db: "ignored",
			token: "ignored",
			actorId: "ignored",
			authorizedToolRoles: ["PLAYER"],
			onView: (next) => (view = next),
			onError: () => {},
		});
		await handle.act(sampleView.actions[0]!, "hello");
		expect(controller.snapshot().frameId).toBe(second.id);
		expect(view?.actions).toEqual([]);
		await handle.endTurn();
		expect(controller.snapshot().frameId).toBe(second.id);
	});

	it("rejects missing frame and unoffered action references", () => {
		const envelope = recording();
		const first = envelope.frames[0]!;
		expect(() =>
			createRecordingScenario({
				recording: envelope,
				scenario: {
					recordingId: envelope.id,
					entryFrameId: first.id,
					checkpoints: { missing: "nope" },
				},
			}),
		).toThrow(/missing frame/);
		expect(() =>
			createRecordingScenario({
				recording: envelope,
				scenario: {
					recordingId: envelope.id,
					entryFrameId: first.id,
					transitions: [
						{
							fromFrameId: first.id,
							toFrameId: first.id,
							input: { kind: "act", actionId: "not-offered" },
						},
					],
				},
			}),
		).toThrow(/not offered/);
	});

	it("is inert when no scenario overlay is supplied", async () => {
		const controller = createRecordingScenario({ recording: recording() });
		const before = controller.snapshot();
		const handle = await controller.sandbox.openWorld({
			url: "",
			db: "",
			token: "",
			actorId: "",
			authorizedToolRoles: ["PLAYER"],
			onView: () => {},
			onError: () => {},
		});
		await handle.act(sampleView.actions[0]!);
		expect(controller.snapshot()).toEqual(before);
	});

	it("matches action inputs independent of JSON field order and requires exact words", async () => {
		const envelope = recording();
		const [first, second] = envelope.frames;
		const controller = createRecordingScenario({
			recording: envelope,
			scenario: {
				recordingId: envelope.id,
				entryFrameId: first!.id,
				transitions: [
					{
						fromFrameId: first!.id,
						toFrameId: second!.id,
						input: { words: "hello", actionId: "h:talk", kind: "act" },
					},
				],
			},
		});
		const handle = await controller.sandbox.openWorld({
			url: "",
			db: "",
			token: "",
			actorId: "",
			authorizedToolRoles: ["PLAYER"],
			onView: () => {},
			onError: () => {},
		});
		await handle.act(sampleView.actions[0]!, "wrong");
		expect(controller.snapshot().frameId).toBe(first!.id);
		await handle.act(sampleView.actions[0]!, "hello");
		expect(controller.snapshot().frameId).toBe(second!.id);
	});

	it("rejects duplicate transitions and unknown/unsupported overlay fields", () => {
		const envelope = recording();
		const [first, second] = envelope.frames;
		const input = { kind: "act" as const, actionId: "h:talk", words: "hello" };
		const base = {
			recordingId: envelope.id,
			entryFrameId: first!.id,
			transitions: [{ fromFrameId: first!.id, toFrameId: second!.id, input }],
		};
		expect(() =>
			createRecordingScenario({
				recording: envelope,
				scenario: { ...base, transitions: [...base.transitions, ...base.transitions] },
			}),
		).toThrow(/Duplicate/);
		expect(() =>
			createRecordingScenario({
				recording: envelope,
				scenario: { ...base, unknown: true } as unknown as RecordingScenario,
			}),
		).toThrow(/unknown|key|field|schema/i);
		expect(() =>
			createRecordingScenario({
				recording: envelope,
				scenario: {
					...base,
					transitions: [
						{ fromFrameId: first!.id, toFrameId: second!.id, input: { kind: "teleport" } },
					],
				} as unknown as RecordingScenario,
			}),
		).toThrow(/input|kind|unsupported/i);
	});

	it("invalidates stale handles after a new open and isolates overlay mutation", async () => {
		const envelope = recording();
		const [first, second] = envelope.frames;
		const scenario: RecordingScenario = {
			recordingId: envelope.id,
			entryFrameId: first!.id,
			transitions: [
				{
					fromFrameId: first!.id,
					toFrameId: second!.id,
					input: { kind: "act", actionId: "h:talk", words: "hello" },
				},
			],
		};
		const controller = createRecordingScenario({ recording: envelope, scenario });
		const args = {
			url: "",
			db: "",
			token: "",
			actorId: "",
			authorizedToolRoles: ["PLAYER"] as const,
			onView: () => {},
			onError: () => {},
		};
		const stale = await controller.sandbox.openWorld(args);
		const fresh = await controller.sandbox.openWorld(args);
		scenario.transitions = [];
		await stale.act(sampleView.actions[0]!, "hello");
		expect(controller.snapshot().frameId).toBe(first!.id);
		await fresh.act(sampleView.actions[0]!, "hello");
		expect(controller.snapshot().frameId).toBe(second!.id);
	});

	it("reads presentation from the currently selected frame", () => {
		const source = createPlayRecording({ now: () => 1 });
		source.record({
			view: sampleView,
			presentation: layout(0.2),
		} as unknown as PlayRecordingPayload);
		source.record({
			view: sampleView,
			presentation: layout(0.8),
		} as unknown as PlayRecordingPayload);
		const envelope = source.export(PLAY_RECORDING_SURFACE);
		const controller = createRecordingScenario({ recording: envelope });
		expect(controller.snapshot().presentation?.layout.colShare[0]).toBe(0.8);
		controller.selectFrame(envelope.frames[0]!.id);
		expect(controller.snapshot().presentation?.layout.colShare[0]).toBe(0.2);
		expect(controller.sandbox.presentation?.layout.colShare[0]).toBe(0.2);
	});
});
