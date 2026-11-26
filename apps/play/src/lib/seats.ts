/**
 * Seat vocabulary for Play.
 *
 * Deliberately a trimmed copy of `apps/website/src/lib/seats.ts` rather than a
 * shared import: Play still carries its own seats and account-api helpers.
 * AuthKit now lives in `@spellkave/authkit`; extracting seats would still be a
 * cross-cutting refactor of website, maps and operator.
 *
 * Only what Play needs to let a seatless player pick a hero. Anything the
 * website's copy has beyond that is intentionally absent.
 */

/** One row of GET /v1/worlds/{slug}/seats. */
export interface PlaySeat {
	actor_id: string;
	name: string;
	claimed: boolean;
	mine: boolean;
}

/** Raw board row as the Account API returns it. */
export interface SeatBoardEntry {
	actor_id: string | number;
	name?: string | null;
	claimed?: boolean;
	mine?: boolean;
}

/**
 * Label for a seat. The Account API already normalizes empty names server-side;
 * keep the same client fallback so a partial payload stays honest instead of
 * rendering a blank button.
 */
export function displaySeatName(seat: { actor_id: string; name?: string | null }): string {
	const name = typeof seat.name === "string" ? seat.name.trim() : "";
	if (name !== "") return name;
	return `Unnamed hero #${String(seat.actor_id)}`;
}

export function playSeatsFromBoard(seats: SeatBoardEntry[]): PlaySeat[] {
	return seats.map((seat) => ({
		actor_id: String(seat.actor_id),
		name: displaySeatName({ actor_id: String(seat.actor_id), name: seat.name }),
		claimed: Boolean(seat.claimed),
		mine: Boolean(seat.mine),
	}));
}

/** True when this row may be claimed: free, and not already mine. */
export function seatIsClaimable(seat: PlaySeat): boolean {
	return !seat.mine && !seat.claimed;
}

/** The seat this account already holds in the board, if any. */
export function mySeat(seats: PlaySeat[]): PlaySeat | null {
	return seats.find((seat) => seat.mine) ?? null;
}

/**
 * The seats `account.seats` reports in `slug`, as board-shaped rows (actor ids;
 * the account has no names). `null` when the list cannot answer: an older API
 * omitted `seats`, or this world is in `seats_unread` — the caller then reads
 * the world's board instead. An empty array is a real "holds none here".
 */
export function heldSeatsFromAccount(
	account: { seats?: { slug: string; actor_id: string }[]; seats_unread?: string[] },
	slug: string,
): PlaySeat[] | null {
	if (account.seats === undefined) return null;
	if (account.seats_unread?.includes(slug) === true) return null;
	return account.seats
		.filter((seat) => seat.slug === slug)
		.map((seat) => ({
			actor_id: String(seat.actor_id),
			name: displaySeatName({ actor_id: String(seat.actor_id) }),
			claimed: true,
			mine: true,
		}));
}

/** Shown when the world's per-identity seat cap refuses a claim (409 `seat_cap_reached`). */
export const SEAT_CAP_MESSAGE = "You already play the most heroes this world allows.";

/** sessionStorage key of the hero this tab plays (ADR-0161 D-6): `<slug>/<actor_id>`. */
export const SELECTED_SEAT_KEY = "spellkave.play.seat";

export interface SelectedSeat {
	slug: string;
	actorId: string;
}

/** Stable id of a seat across worlds, the same shape `SeatBoard` takes as `key`. */
export function seatKey(slug: string, actorId: string): string {
	return `${slug}/${actorId}`;
}

/** Split a `<slug>/<actor_id>` key; null when it does not have that shape. */
export function parseSeatKey(key: string): SelectedSeat | null {
	const at = key.lastIndexOf("/");
	if (at <= 0 || at === key.length - 1) return null;
	return { slug: key.slice(0, at), actorId: key.slice(at + 1) };
}

/**
 * Remember which hero this tab plays. The choice is a preference only: the
 * module checks the binding on every call, so a stale or forged value can at
 * worst fail to open a session.
 */
export function rememberSeat(storage: Storage, slug: string | null, actorId: string | null): void {
	if (slug === null || slug === "" || actorId === null || actorId === "") return;
	try {
		storage.setItem(SELECTED_SEAT_KEY, seatKey(slug, actorId));
	} catch {
		// Blocked storage: the account's own seat still opens.
	}
}

export function selectedSeat(storage: Storage): SelectedSeat | null {
	try {
		return parseSeatKey(storage.getItem(SELECTED_SEAT_KEY)?.trim() ?? "");
	} catch {
		return null;
	}
}

/**
 * Which hero to open in `slug`. Order: the remembered/URL selection when the
 * person still holds it; else the account's one reported seat in this world;
 * else the first held hero; else null (hero chooser). `mine` is the world's
 * seat-board rows held by this person, `null` when the board was unavailable.
 */
export function chooseActor(args: {
	slug: string;
	mine: PlaySeat[] | null;
	selected: SelectedSeat | null;
	accountSeat: { slug: string; actor_id: string } | null;
}): string | null {
	const held = args.mine ?? [];
	if (
		args.selected !== null &&
		args.selected.slug === args.slug &&
		held.some((seat) => seat.actor_id === args.selected?.actorId)
	) {
		return args.selected.actorId;
	}
	if (args.accountSeat !== null && args.accountSeat.slug === args.slug) {
		return args.accountSeat.actor_id;
	}
	return held[0]?.actor_id ?? null;
}
