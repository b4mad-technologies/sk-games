import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import PlayGate from "./PlayGate.svelte";

const noop = (): void => {};

describe("PlayGate", () => {
	it("offers claimable heroes on the seat board", () => {
		render(PlayGate, {
			phase: "choose-hero",
			status: "Choose a hero to play in The Woven Marches.",
			showSignIn: false,
			reachable: [
				{
					slug: "demo1",
					display_name: "The Woven Marches",
					role: "open",
					capabilities: ["world.join"],
				},
			],
			requestedSlug: "demo1",
			claimingActor: null,
			releasing: false,
			heldHero: null,
			confirmRelease: false,
			releaseError: null,
			heroes: [
				{ actor_id: "7", name: "Renn", claimed: false, mine: false },
				{ actor_id: "8", name: "Mara", claimed: true, mine: false },
			],
			claimStatus: null,
			worldName: "The Woven Marches",
			signedIn: true,
			onSignIn: noop,
			onChooseWorld: vi.fn(),
			onRelease: noop,
			onClaim: vi.fn(),
			onRetry: noop,
		});
		expect(screen.getByRole("heading", { name: "Who will you be?" })).toBeTruthy();
		expect(screen.getByTestId("hero-choices")).toBeTruthy();
		expect(screen.getByRole("button", { name: /Play as Renn/ })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Play as Mara/ })).toBeNull();
		expect(screen.getByText("taken")).toBeTruthy();
	});
});
