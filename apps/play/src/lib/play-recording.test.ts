import { describe, expect, it } from "vitest";
import { sampleView } from "../playground/fixtures";
import { focusedLayout } from "./mosaic";
import {
	capturePlayView,
	createPlayRecording,
	PLAY_RECORDING_SURFACE,
	parsePlayRecording,
	playPresentationFromPayload,
	playViewFromPayload,
} from "./play-recording";

describe("Play recordings", () => {
	it("captures a safe view and accepts it only through the Play envelope", () => {
		const recording = createPlayRecording({ now: () => 1 });
		recording.record(capturePlayView(sampleView));
		const exported = recording.export(PLAY_RECORDING_SURFACE);
		const parsed = parsePlayRecording(JSON.parse(JSON.stringify(exported)));
		expect(
			playViewFromPayload(parsed?.frames[0]?.payload ?? capturePlayView(sampleView)).hero.name,
		).toBe("Renn the Roadwarden");
		expect(parsePlayRecording({ ...exported, surface: "spellkave.maps" })).toBeNull();
		expect(
			parsePlayRecording({ ...exported, frames: [{ sequence: 1, capturedAt: 1, payload: {} }] }),
		).toBeNull();
	});

	it("marks restored frames as legacy playback without persisting that runtime marker", () => {
		const captured = capturePlayView(sampleView);
		expect((captured.view as Record<string, unknown>).interactionOrigin).toBeUndefined();
		expect(playViewFromPayload(captured).interactionOrigin).toBe("legacy-recording");
	});

	it("restores canonical free-text presentation from a legacy recorded action", () => {
		const legacy = structuredClone(sampleView);
		legacy.actions = [
			{
				id: "h:speak-aloud",
				label: "Speak Aloud — Renn the Roadwarden",
				verb: "manipulate",
				descriptor: "srd/speak-aloud",
				targetName: "Renn the Roadwarden",
				targetRef: "entity:7",
				acceptsUtterance: false,
			},
		];
		expect(playViewFromPayload(capturePlayView(legacy)).actions[0]?.acceptsUtterance).toBe(true);
	});

	it("preserves a validated settled mosaic and rejects malformed presentation data", () => {
		const recording = createPlayRecording({ now: () => 1 });
		recording.record(capturePlayView(sampleView, { layout: focusedLayout("map"), mobile: false }));
		const exported = recording.export(PLAY_RECORDING_SURFACE);
		const parsed = parsePlayRecording(JSON.parse(JSON.stringify(exported)));
		expect(
			playPresentationFromPayload(parsed?.frames[0]?.payload ?? capturePlayView(sampleView)),
		).toEqual({ layout: focusedLayout("map"), mobile: false });
		const malformed = structuredClone(exported);
		const payload = malformed.frames[0]?.payload as {
			presentation?: { layout?: { colShare?: unknown[] } };
		};
		if (payload.presentation?.layout?.colShare) payload.presentation.layout.colShare[0] = 2;
		expect(parsePlayRecording(malformed)).toBeNull();
	});

	it("rejects malformed nested rows before components dereference them", () => {
		const recording = createPlayRecording({ now: () => 1, id: "recording_nested_validation" });
		recording.record(capturePlayView(sampleView));
		const exported = recording.export(PLAY_RECORDING_SURFACE);
		const malformedHero = structuredClone(exported);
		const hero = malformedHero.frames[0]?.payload.view as { hero: { vitals: unknown } };
		hero.hero.vitals = null;
		expect(parsePlayRecording(malformedHero)).toBeNull();

		const malformedSession = structuredClone(exported);
		const session = malformedSession.frames[0]?.payload.view as { session: { roster: unknown } };
		session.session.roster = {};
		expect(parsePlayRecording(malformedSession)).toBeNull();

		const forwardCompatible = structuredClone(exported);
		const view = forwardCompatible.frames[0]?.payload.view as Record<string, unknown>;
		view.futureDisplayHint = { value: "kept" };
		expect(parsePlayRecording(forwardCompatible)).not.toBeNull();
	});
});
