import { describe, expect, it } from "vitest";
import { parsePlayRecording } from "../lib/play-recording";
import { createPlayground, creationStep, readonlyRecordings, sceneId, scenes } from "./scenes";

async function open(scene: Parameters<typeof createPlayground>[0]) {
	const controller = createPlayground(scene);
	const handle = await controller.sandbox.openWorld({
		url: "unused",
		db: "unused",
		token: "unused",
		actorId: "7",
		authorizedToolRoles: ["PLAYER"],
		onView: () => {},
		onError: () => {},
	});
	return { controller, handle };
}

describe("recorded playground catalogue", () => {
	it("keeps the five URL scene names and opens their recorded entry frames", async () => {
		expect(sceneId("unknown")).toBe("creation");
		expect(creationStep("unknown")).toBe("class");
		expect(scenes.map((scene) => scene.id)).toEqual([
			"creation",
			"conversation",
			"exploration",
			"combat",
			"reaction",
		]);
		for (const scene of scenes)
			expect((await open(scene.id)).controller.snapshot().view.hero.actorId).toBe("7");
	});

	it("advances creation only through the exact captured Fighter and name=Mira inputs", async () => {
		const { controller, handle } = await open("creation");
		const before = controller.snapshot().frameId;
		await handle.act(controller.snapshot().view.actions[1]!); // Wizard is not recorded.
		expect(controller.snapshot().frameId).toBe(before);
		await handle.act(controller.snapshot().view.actions[0]!); // Fighter
		await handle.act(controller.snapshot().view.actions[0]!); // Human
		await handle.act(controller.snapshot().view.actions[0]!); // Soldier
		await handle.act(controller.snapshot().view.actions[0]!); // scores
		const name = controller.snapshot().view.actions[0]!;
		await handle.act(name, "name=Arbitrary");
		expect(controller.snapshot().view.hero.name).toBe("Creation Candidate");
		await handle.act(name, "name=Mira");
		expect(controller.snapshot().view.hero.name).toBe("Mira");
	});

	it("switches only to recorded exploration and combat outcomes", async () => {
		const exploration = await open("exploration");
		const exits = exploration.controller.snapshot().view.place!.exits;
		await exploration.handle.move(exits[1]!);
		expect(exploration.controller.snapshot().view.place?.name).toBe("Common Room");
		await exploration.handle.move(exits[0]!);
		expect(exploration.controller.snapshot().view.place?.name).toBe("Stairs");

		const combat = await open("combat");
		await combat.handle.endTurn();
		expect(combat.controller.snapshot().view.session.inSession).toBe(true);
		await combat.handle.act(combat.controller.snapshot().view.actions[0]!);
		expect(combat.controller.snapshot().view.session.inSession).toBe(false);
	});

	it("registers the separately reviewed live export without an interactive overlay", () => {
		const live = readonlyRecordings[0]!;
		const parsed = parsePlayRecording(live.recording);
		expect(live.id).toBe("live-combat");
		expect(parsed?.provenance).toMatchObject({ source: "live", build: "5903fd9cf" });
		expect(parsed?.frames).toHaveLength(3);
	});
});
