import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
	createPlayRumProducer,
	filterPlayRumEvent,
	hashRumSubject,
	PLAY_RUM_SESSION_SAMPLE_RATE,
	playRumAction,
	readPlayRumConfig,
	readPlayRumSessionSampleRate,
} from "./play-rum";
import type { PlayTrailActEntry, PlayTrailLayoutEntry } from "./play-trail";

const CONFIG = {
	enabled: true,
	applicationId: "play-app",
	clientToken: "public-rum-token",
	version: "sha-123",
	sessionSampleRate: 100,
};

function fakeSdk() {
	return {
		init: vi.fn(),
		addAction: vi.fn(),
		setUser: vi.fn(),
		clearUser: vi.fn(),
		setGlobalContextProperty: vi.fn(),
		removeGlobalContextProperty: vi.fn(),
		setTrackingConsent: vi.fn(),
		getInternalContext: vi.fn((): { session_id?: string } | undefined => ({ session_id: "s-1" })),
	};
}

const ACT_ENTRY: PlayTrailActEntry = {
	id: 1,
	at: 1000,
	tick: 5,
	kind: "act",
	tool: "spellkave_manipulate",
	actionId: "h:1",
	targetRef: "item:7",
	words: "I open the chest.",
	outcome: "happened",
	observation: "The chest opens.",
	durationMs: 120,
	refusalCode: null,
	refusalDetail: null,
};

describe("readPlayRumConfig", () => {
	const env = {
		VITE_SPELLKAVE_RUM_APPLICATION_ID: " play-app ",
		VITE_SPELLKAVE_RUM_CLIENT_TOKEN: " public-rum-token ",
		VITE_SPELLKAVE_RUM_VERSION: " sha-123 ",
	};

	it("is always disabled outside a production build", () => {
		expect(readPlayRumConfig(env, false).enabled).toBe(false);
	});

	it("fails closed when any production input is missing", () => {
		expect(readPlayRumConfig({ ...env, VITE_SPELLKAVE_RUM_CLIENT_TOKEN: "" }, true).enabled).toBe(
			false,
		);
	});

	it("enables only a fully configured production build", () => {
		expect(readPlayRumConfig(env, true)).toEqual(CONFIG);
	});

	it("defaults to full beta sampling and accepts a deploy-time rate", () => {
		expect(PLAY_RUM_SESSION_SAMPLE_RATE).toBe(100);
		expect(
			readPlayRumConfig({ ...env, VITE_SPELLKAVE_RUM_SESSION_SAMPLE_RATE: " 25 " }, true),
		).toMatchObject({ enabled: true, sessionSampleRate: 25 });
	});

	it.each([undefined, "", "abc", "-1", "101"])("falls back to the default rate for %j", (value) => {
		expect(readPlayRumSessionSampleRate(value)).toBe(PLAY_RUM_SESSION_SAMPLE_RATE);
	});
});

describe("RUM privacy boundary", () => {
	it("uses the same 16-hex SHA-256 subject prefix as server telemetry", async () => {
		const subject = "oauth-sub-1";
		const expected = createHash("sha256").update(subject).digest("hex").slice(0, 16);
		expect(await hashRumSubject(subject, webcrypto.subtle as unknown as SubtleCrypto)).toBe(
			expected,
		);
	});

	it("drops automatic errors/resources and strips URL query data", () => {
		const event = {
			type: "view",
			view: {
				url: "https://play.spellkave.com/?world=kavemouth-1&token=secret",
				referrer: "https://spellkave.com/?email=person@example.com#worlds",
			},
		};
		expect(filterPlayRumEvent(event)).toBe(true);
		expect(event.view.url).toBe("https://play.spellkave.com/");
		expect(event.view.referrer).toBe("https://spellkave.com/");
		expect(filterPlayRumEvent({ type: "error" })).toBe(false);
		expect(filterPlayRumEvent({ type: "resource" })).toBe(false);
	});

	it("projects an act without words, observation, ids, or error messages", () => {
		const action = playRumAction(ACT_ENTRY, "kavemouth-1");
		expect(action).toEqual({
			name: "play_act",
			context: {
				spellkave_world_slug: "kavemouth-1",
				spellkave_tool_name: "spellkave_manipulate",
				spellkave_outcome: "happened",
				spellkave_duration_ms: 120,
			},
		});
		expect(JSON.stringify(action)).not.toContain("I open the chest");
		expect(JSON.stringify(action)).not.toContain("The chest opens");
		expect(JSON.stringify(action)).not.toContain("item:7");
	});

	it("gives non-tool layout entries bounded join fields", () => {
		const entry: PlayTrailLayoutEntry = {
			id: 2,
			at: 1000,
			tick: 5,
			kind: "layout",
			tile: "map",
			level: "stage",
			trigger: "tap",
		};
		expect(playRumAction(entry, "kavemouth-1")?.context).toMatchObject({
			spellkave_world_slug: "kavemouth-1",
			spellkave_tool_name: "play_layout",
			spellkave_outcome: "observed",
			spellkave_duration_ms: 0,
			spellkave_client_kind: "layout",
			spellkave_tile: "map",
		});
	});
});

describe("createPlayRumProducer", () => {
	it("samples local diagnostics fully through the relay and isolates context generations", async () => {
		const sdk = fakeSdk();
		const producer = createPlayRumProducer(
			{
				...CONFIG,
				local: { ...CONFIG, environment: "local-play-it", worldSlug: "kavemouth-local-play-it" },
			},
			sdk,
			webcrypto.subtle as unknown as SubtleCrypto,
		);
		producer.initialize();
		expect(sdk.init.mock.calls[0]?.[0]).toMatchObject({
			env: "local-play-it",
			sessionSampleRate: 100,
			sessionReplaySampleRate: 0,
		});
		expect(sdk.init.mock.calls[0]?.[0].proxy({ parameters: "public=token" })).toBe(
			"/__rum?public=token",
		);
		await producer.setContext("subject", "kavemouth");
		producer.observe?.({ phase: "intent", interaction: 1, intent: "move" });
		const first = sdk.addAction.mock.calls.at(-1)?.[1];
		expect(first).toMatchObject({
			spellkave_sequence: 2,
			spellkave_world_slug: "kavemouth-local-play-it",
		});
		producer.clearContext();
		const count = sdk.addAction.mock.calls.length;
		producer.observe?.({ phase: "rendered", interaction: 1 });
		expect(sdk.addAction.mock.calls.length).toBe(count);
		await producer.setContext("other-subject", "kavemouth");
		const second = sdk.addAction.mock.calls.at(-1)?.[1];
		expect(second?.spellkave_run).not.toBe(first?.spellkave_run);
		expect(second?.spellkave_sequence).toBe(1);
	});
	it("never touches the SDK when disabled", async () => {
		const sdk = fakeSdk();
		const producer = createPlayRumProducer({ ...CONFIG, enabled: false }, sdk);
		producer.initialize();
		await producer.setContext("raw-subject", "kavemouth-1");
		producer.record(ACT_ENTRY);
		expect(sdk.init).not.toHaveBeenCalled();
		expect(sdk.addAction).not.toHaveBeenCalled();
	});

	it("initializes with replay off, masked input, closed collection, and consent withheld", () => {
		const sdk = fakeSdk();
		const producer = createPlayRumProducer({ ...CONFIG, sessionSampleRate: 10 }, sdk);
		producer.initialize();
		expect(sdk.init).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionSampleRate: 10,
				sessionReplaySampleRate: 0,
				defaultPrivacyLevel: "mask-user-input",
				trackUserInteractions: false,
				trackResources: false,
				trackAnonymousUser: false,
				trackingConsent: "not-granted",
			}),
		);
	});

	it("grants consent only after setting a hashed user and world", async () => {
		const sdk = fakeSdk();
		const producer = createPlayRumProducer(
			CONFIG,
			sdk,
			webcrypto.subtle as unknown as SubtleCrypto,
		);
		producer.initialize();
		await producer.setContext("raw-workos-subject", "kavemouth-1");

		expect(sdk.setUser).toHaveBeenCalledWith({ id: expect.stringMatching(/^[0-9a-f]{16}$/) });
		expect(sdk.setGlobalContextProperty).toHaveBeenCalledWith(
			"spellkave_world_slug",
			"kavemouth-1",
		);
		expect(sdk.setTrackingConsent).toHaveBeenCalledWith("granted");
		expect(JSON.stringify(sdk.setUser.mock.calls)).not.toContain("raw-workos-subject");
	});

	it("emits one custom action per trail entry after context is ready", async () => {
		const sdk = fakeSdk();
		const producer = createPlayRumProducer(
			CONFIG,
			sdk,
			webcrypto.subtle as unknown as SubtleCrypto,
		);
		producer.initialize();
		producer.record(ACT_ENTRY);
		expect(sdk.addAction).not.toHaveBeenCalled();
		await producer.setContext("raw-workos-subject", "kavemouth-1");
		producer.record(ACT_ENTRY);
		expect(sdk.addAction).toHaveBeenCalledWith(
			"play_act",
			expect.objectContaining({
				spellkave_world_slug: "kavemouth-1",
				spellkave_tool_name: "spellkave_manipulate",
				spellkave_outcome: "happened",
				spellkave_duration_ms: 120,
				spellkave_sequence: 2,
				spellkave_tick: 5,
			}),
		);
	});

	it("keeps the sampled run and consent across same-context reconnects", async () => {
		const sdk = fakeSdk();
		const producer = createPlayRumProducer(
			CONFIG,
			sdk,
			webcrypto.subtle as unknown as SubtleCrypto,
		);
		producer.initialize();
		await producer.setContext("same-subject", "kavemouth-3");
		const first = sdk.addAction.mock.calls.at(-1)?.[1];
		const consentCalls = sdk.setTrackingConsent.mock.calls.length;
		const clearCalls = sdk.clearUser.mock.calls.length;
		await producer.setContext("same-subject", "kavemouth-3");
		expect(sdk.setTrackingConsent.mock.calls.length).toBe(consentCalls);
		expect(sdk.clearUser.mock.calls.length).toBe(clearCalls);
		expect(sdk.addAction.mock.calls.at(-1)).toEqual([
			"play_connection",
			expect.objectContaining({ spellkave_run: first?.spellkave_run, spellkave_sequence: 2 }),
		]);
		producer.record(ACT_ENTRY);
		expect(sdk.addAction.mock.calls.at(-1)?.[1]).toMatchObject({
			spellkave_run: first?.spellkave_run,
			spellkave_sequence: 3,
		});
		expect(JSON.stringify(sdk.addAction.mock.calls)).not.toContain("same-subject");
	});

	it.each([
		"subject",
		"world",
		"logout",
	])("starts a separate run after %s changes", async (change) => {
		const sdk = fakeSdk();
		const producer = createPlayRumProducer(
			CONFIG,
			sdk,
			webcrypto.subtle as unknown as SubtleCrypto,
		);
		producer.initialize();
		await producer.setContext("subject-a", "kavemouth-3");
		const first = sdk.addAction.mock.calls.at(-1)?.[1];
		if (change === "logout") producer.clearContext();
		await producer.setContext(
			change === "subject" ? "subject-b" : "subject-a",
			change === "world" ? "kavemouth-4" : "kavemouth-3",
		);
		const next = sdk.addAction.mock.calls.at(-1)?.[1];
		expect(next?.spellkave_run).not.toBe(first?.spellkave_run);
		expect(next?.spellkave_sequence).toBe(1);
	});

	it("reports the run id and sampled flag for feedback linkage", async () => {
		const sdk = fakeSdk();
		const producer = createPlayRumProducer(
			CONFIG,
			sdk,
			webcrypto.subtle as unknown as SubtleCrypto,
		);
		producer.initialize();
		expect(producer.diagnostics()).toEqual({ sampled: false });
		await producer.setContext("raw-workos-subject", "kavemouth-1");
		const run = sdk.addAction.mock.calls.at(-1)?.[1]?.spellkave_run;
		expect(producer.diagnostics()).toEqual({ runId: run, sampled: true });
		sdk.getInternalContext.mockReturnValue(undefined);
		expect(producer.diagnostics()).toEqual({ runId: run, sampled: false });
		producer.clearContext();
		expect(producer.diagnostics()).toEqual({ sampled: false });
	});

	it("withdraws consent and clears pseudonymous context on logout", async () => {
		const sdk = fakeSdk();
		const producer = createPlayRumProducer(
			CONFIG,
			sdk,
			webcrypto.subtle as unknown as SubtleCrypto,
		);
		producer.initialize();
		await producer.setContext("raw-workos-subject", "kavemouth-1");
		producer.clearContext();
		expect(sdk.setTrackingConsent).toHaveBeenLastCalledWith("not-granted");
		expect(sdk.clearUser).toHaveBeenCalled();
		expect(sdk.removeGlobalContextProperty).toHaveBeenCalledWith("spellkave_world_slug");
	});

	it("does not restore a stale context when hashing finishes after logout", async () => {
		const sdk = fakeSdk();
		let finishDigest: ((value: ArrayBuffer) => void) | undefined;
		const subtle = {
			digest: vi.fn(
				() =>
					new Promise<ArrayBuffer>((resolve) => {
						finishDigest = resolve;
					}),
			),
		} as unknown as SubtleCrypto;
		const producer = createPlayRumProducer(CONFIG, sdk, subtle);
		producer.initialize();
		const context = producer.setContext("raw-workos-subject", "kavemouth-1");
		producer.clearContext();
		finishDigest?.(new Uint8Array(32).buffer);
		await context;

		expect(sdk.setTrackingConsent).not.toHaveBeenCalledWith("granted");
		expect(sdk.setUser).not.toHaveBeenCalled();
	});
});
