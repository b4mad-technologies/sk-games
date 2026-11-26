import { describe, expect, it } from "vitest";
import { TRANSCRIPT_FIXTURE } from "./transcript.fixture";
import { createMemoryStorage, transcriptKey } from "./transcript-idb";

describe("transcript storage", () => {
	it("round-trips messages through a fake store", async () => {
		const storage = createMemoryStorage();
		const key = transcriptKey("user-1", "model-a");
		expect(await storage.load(key)).toBeNull();
		await storage.save(key, TRANSCRIPT_FIXTURE);
		expect(await storage.load(key)).toEqual(TRANSCRIPT_FIXTURE);
		await storage.clear(key);
		expect(await storage.load(key)).toBeNull();
	});
});
