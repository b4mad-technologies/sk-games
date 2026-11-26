// Where things stand on the scene stage.
//
// The world places every entity in a place node and gives each exit a compass
// label, but sends no position inside a place. These helpers turn that into
// stable stage coordinates (percent of the stage box): the same ids always
// land on the same spots, so the picture does not jump between refreshes.

export type StagePoint = { x: number; y: number };

/** FNV-1a, folded to 0..1. Stable across sessions and machines. */
export function unitHash(text: string): number {
	let value = 2166136261;
	for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
	return (value >>> 0) / 4294967295;
}

/**
 * Spread items over a grid of slots inside the stage, ordered by id, each
 * nudged inside its own slot by a hash of its id. Slots never overlap, so
 * neither do the tokens' anchor points.
 */
export function spreadOnStage<T extends { id: string }>(
	items: readonly T[],
): Array<{ item: T } & StagePoint> {
	const ordered = [...items].sort((a, b) => a.id.localeCompare(b.id));
	const cols = Math.max(1, Math.ceil(Math.sqrt(ordered.length * 1.8)));
	const rows = Math.max(1, Math.ceil(ordered.length / cols));
	return ordered.map((item, index) => {
		const col = index % cols;
		const row = Math.floor(index / cols);
		return {
			item,
			x: 16 + ((col + 0.5) / cols) * 68 + (unitHash(item.id) - 0.5) * (30 / cols),
			y: 22 + ((row + 0.5) / rows) * 56 + (unitHash(`${item.id}y`) - 0.5) * (24 / rows),
		};
	});
}

const WALL: Record<string, StagePoint> = {
	north: { x: 50, y: 6 },
	south: { x: 50, y: 94 },
	east: { x: 94, y: 50 },
	west: { x: 6, y: 50 },
	northeast: { x: 90, y: 8 },
	northwest: { x: 10, y: 8 },
	southeast: { x: 90, y: 92 },
	southwest: { x: 10, y: 92 },
};

/**
 * Put each exit on the wall its compass label names. Several exits on one
 * wall fan out along it. A label that is no compass word (`known: false`)
 * lines up along the bottom edge.
 */
export function exitsOnWalls<T extends { label: string }>(
	exits: readonly T[],
): Array<{ exit: T; known: boolean } & StagePoint> {
	const perWall = new Map<string, number>();
	let loose = 0;
	return exits.map((exit) => {
		const key = exit.label.toLowerCase().replace(/[^a-z]/g, "");
		const wall = WALL[key];
		if (!wall) {
			loose += 1;
			return { exit, known: false, x: 10 + loose * 14, y: 94 };
		}
		const count = perWall.get(key) ?? 0;
		perWall.set(key, count + 1);
		const sideWall = wall.x < 20 || wall.x > 80;
		return {
			exit,
			known: true,
			x: wall.x + (sideWall ? 0 : count * 15),
			y: wall.y + (sideWall ? count * 12 : 0),
		};
	});
}
