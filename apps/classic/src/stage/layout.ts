// Where things stand on the stage, in stage units (480 x 270, feet position).
//
// The world sends no position inside a place and no hotspot on a place
// picture. Ways out therefore stand where their direction says, the same in
// every place, and everything else gets a stable spot on the floor.

export const STAGE = { width: 480, height: 270, horizon: 150 } as const;

export type Spot = { x: number; y: number };

const WAY_SPOT: Record<string, Spot> = {
	north: { x: 240, y: 152 },
	south: { x: 240, y: 266 },
	east: { x: 452, y: 208 },
	west: { x: 28, y: 208 },
	northeast: { x: 400, y: 152 },
	northwest: { x: 80, y: 152 },
	southeast: { x: 400, y: 266 },
	southwest: { x: 80, y: 266 },
	up: { x: 190, y: 152 },
	down: { x: 410, y: 262 },
};

const ARROW: Record<string, string> = {
	north: "↑",
	south: "↓",
	east: "→",
	west: "←",
	northeast: "↗",
	northwest: "↖",
	southeast: "↘",
	southwest: "↙",
	up: "⇡",
	down: "⇣",
};

function key(direction: string): string {
	return direction.toLowerCase().replace(/[^a-z]/g, "");
}

/** Does the app know where a way with this direction stands? */
export function wayPlaced(direction: string): boolean {
	return key(direction) in WAY_SPOT;
}

/**
 * The spot of a way out. Ways the app cannot place line up along the front.
 * A second way in the same direction stands beside the first, towards the
 * middle of the stage: one above the other at the sides, side by side along
 * the back and the front. None leaves the stage.
 */
export function waySpot(direction: string, sameBefore: number, looseBefore: number): Spot {
	const spot = WAY_SPOT[key(direction)];
	if (!spot) return { x: Math.min(60 + looseBefore * 70, STAGE.width - 60), y: 266 };
	if (sameBefore === 0) return spot;
	const side = waySide(spot);
	if (side !== "middle" && spot.y > 170 && spot.y < 250)
		return { x: spot.x, y: Math.max(170, spot.y - sameBefore * 22) };
	const towardMiddle = spot.x >= STAGE.width / 2 ? -1 : 1;
	return { x: spot.x + towardMiddle * sameBefore * 70, y: spot.y };
}

/**
 * Which edge of the stage a way's tag hangs on. A tag at the side grows
 * inwards from that edge, so a long name is not cut off.
 */
export function waySide(spot: Spot): "left" | "right" | "middle" {
	if (spot.x >= 400) return "right";
	if (spot.x <= 80) return "left";
	return "middle";
}

export function wayArrow(direction: string): string {
	return ARROW[key(direction)] ?? "•";
}

/** FNV-1a, folded to 0..1. Stable across sessions and machines. */
function unitHash(text: string): number {
	let value = 2166136261;
	for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
	return (value >>> 0) / 4294967295;
}

/** How much of the stage a standing figure and a way's tag take, in stage units. */
const FIGURE = { half: 24, height: 76 } as const;
const WAY_TAG = { half: 36, above: 10, below: 12 } as const;
/** Two figures nearer than this, both ways, stand on each other. */
const APART = { x: 44, y: 60 } as const;
/** Feet this far forward clear a tag on the back wall. */
const FRONT_ROW = 244;

/** Would a figure with its feet on `spot` stand on the tag of the way at `way`? */
export function coversWay(spot: Spot, way: Spot): boolean {
	return (
		Math.abs(spot.x - way.x) < FIGURE.half + WAY_TAG.half &&
		way.y + WAY_TAG.below > spot.y - FIGURE.height &&
		way.y - WAY_TAG.above < spot.y
	);
}

/**
 * Stable floor spots for everything that is no way out: slots across the
 * floor, ordered by id, each nudged by a hash of its id. The hero keeps the
 * front left. A figure does not stand on the tag of a way out (`ways`): it
 * steps aside along the floor, or forward, to the nearest free spot.
 */
export function floorSpots(ids: readonly string[], ways: readonly Spot[] = []): Map<string, Spot> {
	const ordered = [...ids].sort();
	const spots = new Map<string, Spot>();
	// A way at the right edge takes the floor in front of its tag: the slots
	// spread over what is left, so nobody has to squeeze in beside it.
	const edge = ways
		.filter((way) => waySide(way) === "right" && way.y > 160 && way.y < 255)
		.map((way) => way.x - FIGURE.half - WAY_TAG.half - 2);
	const span = Math.min(450, ...edge) - 150;
	// Each id is nudged off its slot, by no more than the room between two slots allows.
	const nudge = Math.min(20, Math.max(0, span / Math.max(1, ordered.length) - APART.x));
	const free = (spot: Spot) => !ways.some((way) => coversWay(spot, way));
	// Stepping aside from a way must not end on somebody else's toes.
	const apart = (spot: Spot) =>
		![...spots.values()].some(
			(other) => Math.abs(other.x - spot.x) < APART.x && Math.abs(other.y - spot.y) < APART.y,
		);
	ordered.forEach((id, index) => {
		const slot = (index + 0.5) / ordered.length;
		const wanted = {
			x: Math.round(150 + slot * span + (unitHash(id) - 0.5) * nudge),
			y: Math.round(196 + (index % 2) * 34 + (unitHash(`${id}y`) - 0.5) * 12),
		};
		// Nearest first: a little left or right; then the same in the front
		// row, below the tags of the ways along the back wall.
		const tries = [wanted.y, FRONT_ROW].flatMap((y) =>
			[0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6].map((step) => ({ x: wanted.x + step * 12, y })),
		);
		const onFloor = (at: Spot) => at.x >= 130 && at.x <= 460;
		const spot =
			tries.find((at) => onFloor(at) && free(at) && apart(at)) ??
			tries.find((at) => onFloor(at) && free(at));
		spots.set(id, spot ?? wanted);
	});
	return spots;
}

export const HERO_SPOT: Spot = { x: 84, y: 232 };
