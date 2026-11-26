import { describe, expect, it } from "vitest";

import {
	chooseActor,
	displaySeatName,
	mySeat,
	parseSeatKey,
	playSeatsFromBoard,
	rememberSeat,
	SELECTED_SEAT_KEY,
	seatIsClaimable,
	seatKey,
	selectedSeat,
} from "./seats";

describe("seat vocabulary", () => {
	it("falls back to a stable label when the board sends no name", () => {
		expect(displaySeatName({ actor_id: "7", name: "  " })).toBe("Unnamed hero #7");
		expect(displaySeatName({ actor_id: "7" })).toBe("Unnamed hero #7");
		expect(displaySeatName({ actor_id: "7", name: " Renn " })).toBe("Renn");
	});

	it("normalizes a numeric actor_id, which the live API returns as a string", () => {
		// Measured 2026-08-26: GET /v1/worlds/kavemouth-3/seats returns
		// {"actor_id":"1", ...}. The type allows a number, so normalize either way
		// rather than letting a === comparison against a string silently fail.
		const [seat] = playSeatsFromBoard([{ actor_id: 1, name: "Creation Candidate" }]);
		expect(seat?.actor_id).toBe("1");
	});

	it("treats a missing claimed/mine flag as false rather than undefined", () => {
		const [seat] = playSeatsFromBoard([{ actor_id: "2" }]);
		expect(seat?.claimed).toBe(false);
		expect(seat?.mine).toBe(false);
	});

	it("offers only seats that are free and not already mine", () => {
		expect(seatIsClaimable({ actor_id: "1", name: "a", claimed: false, mine: false })).toBe(true);
		expect(seatIsClaimable({ actor_id: "2", name: "b", claimed: true, mine: false })).toBe(false);
		// A seat that is already mine must not be offered again: claiming it would
		// return 409 and read to the player as losing a race they had won.
		expect(seatIsClaimable({ actor_id: "3", name: "c", claimed: true, mine: true })).toBe(false);
	});

	it("finds the seat this account already holds", () => {
		const seats = playSeatsFromBoard([
			{ actor_id: "1", name: "a", claimed: true, mine: false },
			{ actor_id: "2", name: "b", claimed: true, mine: true },
		]);
		expect(mySeat(seats)?.actor_id).toBe("2");
		expect(mySeat([])).toBeNull();
	});
});

describe("selected hero", () => {
	const mine = playSeatsFromBoard([
		{ actor_id: "7", name: "Renn", claimed: true, mine: true },
		{ actor_id: "9", name: "Mara", claimed: true, mine: true },
	]);

	it("round-trips <slug>/<actor_id> through sessionStorage", () => {
		window.sessionStorage.clear();
		expect(selectedSeat(window.sessionStorage)).toBeNull();
		rememberSeat(window.sessionStorage, "demo1", "9");
		expect(window.sessionStorage.getItem(SELECTED_SEAT_KEY)).toBe("demo1/9");
		expect(selectedSeat(window.sessionStorage)).toEqual({ slug: "demo1", actorId: "9" });
		window.sessionStorage.clear();
	});

	it("ignores empty values and malformed keys", () => {
		window.sessionStorage.clear();
		rememberSeat(window.sessionStorage, null, "9");
		rememberSeat(window.sessionStorage, "demo1", "");
		expect(window.sessionStorage.getItem(SELECTED_SEAT_KEY)).toBeNull();
		window.sessionStorage.setItem(SELECTED_SEAT_KEY, "nonsense");
		expect(selectedSeat(window.sessionStorage)).toBeNull();
		expect(parseSeatKey("/9")).toBeNull();
		expect(parseSeatKey("demo1/")).toBeNull();
		expect(parseSeatKey(seatKey("a/b", "3"))).toEqual({ slug: "a/b", actorId: "3" });
		window.sessionStorage.clear();
	});

	it("prefers a held selection, then the account seat, then the first held hero", () => {
		const accountSeat = { slug: "demo1", actor_id: "7" };
		expect(
			chooseActor({ slug: "demo1", mine, selected: { slug: "demo1", actorId: "9" }, accountSeat }),
		).toBe("9");
		// A selection the person no longer holds, or for another world, is not authority.
		expect(
			chooseActor({ slug: "demo1", mine, selected: { slug: "demo1", actorId: "99" }, accountSeat }),
		).toBe("7");
		expect(
			chooseActor({ slug: "demo1", mine, selected: { slug: "demo2", actorId: "9" }, accountSeat }),
		).toBe("7");
		expect(chooseActor({ slug: "demo2", mine, selected: null, accountSeat })).toBe("7");
		expect(chooseActor({ slug: "demo1", mine: null, selected: null, accountSeat })).toBe("7");
		expect(chooseActor({ slug: "demo1", mine: [], selected: null, accountSeat: null })).toBeNull();
	});
});
