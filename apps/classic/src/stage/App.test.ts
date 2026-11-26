import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.svelte";
import { MockWorld } from "./mock/world.svelte";

// The shell on the fixture world: what it draws from a Stage, and that a
// click reaches the port. The fixture world answers after a short pause.
function mounted(creation = false) {
	const world = new MockWorld();
	if (!creation) world.skipCreation();
	render(App, { props: { world } });
	return world;
}

beforeEach(() => {
	vi.useFakeTimers();
	// jsdom has no layout: the scene's pan and the outline scroll are no-ops.
	Element.prototype.scrollTo = () => {};
	Element.prototype.scrollIntoView = () => {};
});
afterEach(() => vi.useRealTimers());

describe("the stage shell on the fixture world", () => {
	it("shows the place on the top line and everything on the stage by name", () => {
		const world = mounted();
		expect(screen.getByText(world.stage.place.name)).toBeTruthy();
		for (const thing of world.stage.things) {
			if (thing.kind === "way")
				expect(screen.getByRole("button", { name: new RegExp(thing.name) })).toBeTruthy();
			else expect(screen.getByRole("button", { name: thing.name })).toBeTruthy();
		}
	});

	it("starts with hero creation as a guided talk: a question, its answers, the steps", () => {
		const world = mounted(true);
		const round = world.stage.talk;
		expect(round?.outline?.length).toBeGreaterThan(0);
		expect(screen.getByRole("group", { name: `Talk with ${round?.speakerName}` })).toBeTruthy();
		expect(screen.getByRole("list", { name: "Steps" })).toBeTruthy();
		for (const answer of round?.answers ?? []) {
			expect(screen.getByRole("button", { name: new RegExp(answer.label) })).toBeTruthy();
		}
		// No map, pack or hero chip before there is a hero.
		expect(screen.queryByRole("button", { name: "Map" })).toBeNull();
	});

	it("gives an answer through the port and moves on to the next question", async () => {
		const world = mounted(true);
		const first = world.stage.talk;
		const answer = first?.answers[0];
		await fireEvent.click(screen.getByRole("button", { name: new RegExp(answer?.label ?? "") }));
		await vi.advanceTimersByTimeAsync(2000);
		expect(world.stage.talk?.id).not.toBe(first?.id);
		expect(world.stage.talk?.outline?.find((step) => step.value)?.value).toBe(answer?.label);
	});

	it("goes through a way out on one click", async () => {
		const world = mounted();
		const from = world.stage.place.id;
		const way = world.stage.things.find((thing) => thing.kind === "way" && !thing.way?.gate);
		if (!way) throw new Error("the fixture place has no open way");
		await fireEvent.click(screen.getByRole("button", { name: new RegExp(way.name) }));
		await vi.advanceTimersByTimeAsync(2000);
		expect(world.stage.place.id).not.toBe(from);
		expect(screen.getByText(world.stage.place.name)).toBeTruthy();
	});

	it("opens the hero sheet and the pack from the foot line", async () => {
		const world = mounted();
		await fireEvent.click(screen.getByRole("button", { name: `Hero: ${world.stage.hero.name}` }));
		expect(screen.getByRole("dialog", { name: "Hero" }).textContent).toContain(
			world.stage.hero.calling,
		);
		await fireEvent.click(screen.getByRole("button", { name: "Close" }));
		await fireEvent.click(screen.getByRole("button", { name: /^Pack/ }));
		const pack = screen.getByRole("dialog", { name: "Pack" });
		for (const item of world.stage.pack) expect(pack.textContent).toContain(item.name);
	});

	it("draws the map as a sheet of places and walks to a clicked one", async () => {
		const world = mounted();
		const from = world.stage.place.id;
		await fireEvent.click(screen.getByRole("button", { name: "Map" }));
		const sheet = world.stage.map.sheets[0];
		if (!sheet) throw new Error("the fixture world has no map sheet");
		const map = screen.getByRole("group", { name: sheet.title });
		for (const place of sheet.places) expect(map.textContent).toContain(place.name);
		const here = sheet.places.find((place) => place.id === from);
		const goal = sheet.places.find((place) => place.id !== from);
		if (!here || !goal) throw new Error("the fixture map needs two places");
		const tag = (name: string) => within(map).getByRole("button", { name }) as HTMLButtonElement;
		expect(tag(here.name).getAttribute("aria-current")).toBe("location");
		expect(tag(here.name).disabled).toBe(true);
		await fireEvent.click(tag(goal.name));
		await vi.advanceTimersByTimeAsync(4000);
		expect(world.stage.place.id).toBe(goal.id);
	});

	it("opens and closes a sheet by its letter, but not while typing", async () => {
		mounted();
		await fireEvent.keyDown(window, { key: "m" });
		expect(screen.getByRole("dialog", { name: "Everything you have seen" })).toBeTruthy();
		await fireEvent.keyDown(window, { key: "m" });
		expect(screen.queryByRole("dialog")).toBeNull();
		await fireEvent.keyDown(window, { key: "p" });
		expect(screen.getByRole("dialog", { name: "Pack" })).toBeTruthy();
		// A held key repeats; the sheet does not flicker.
		await fireEvent.keyDown(window, { key: "p", repeat: true });
		expect(screen.getByRole("dialog", { name: "Pack" })).toBeTruthy();
		await fireEvent.keyDown(window, { key: "p" });
		const field = document.createElement("input");
		document.body.append(field);
		await fireEvent.keyDown(field, { key: "h" });
		expect(screen.queryByRole("dialog")).toBeNull();
		field.remove();
	});

	it("says Mock on the fixture world", () => {
		mounted();
		expect(screen.getByRole("button", { name: /^Mock/ })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /^Gaps/ })).toBeNull();
	});
});
