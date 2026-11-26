// Stand-in scene pictures for the mock, drawn as chunky SVG on the stage's
// own 480 x 270 grid. They show what a place looks like once the world sends
// a picture through `place.art` (ADR-0073). No adventure has one today
// (sk-jay0.1.76.14.8), so the mock lists them as a gap and can switch them off.

const r = (x: number, y: number, w: number, h: number, fill: string, extra = ""): string =>
	`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;

function rows(count: number, draw: (index: number) => string): string {
	let out = "";
	for (let index = 0; index < count; index += 1) out += draw(index);
	return out;
}

/** Plank floor from the horizon down. */
function planks(top: number, base: string, seam: string): string {
	return (
		r(0, top, 480, 270 - top, base) +
		rows(6, (i) => r(0, top + 4 + i * 22, 480, 2, seam)) +
		rows(14, (i) => r(20 + i * 36 + (i % 2) * 10, top + 6 + (i % 5) * 22, 2, 20, seam))
	);
}

/** Courses of stone for a back wall. */
function stones(height: number, base: string, seam: string): string {
	return (
		r(0, 0, 480, height, base) +
		rows(Math.ceil(height / 18), (i) => r(0, i * 18 + 16, 480, 2, seam)) +
		rows(40, (i) => r(((i * 53) % 470) + 4, Math.floor((i * 7) % (height / 18)) * 18, 2, 16, seam))
	);
}

function wrap(body: string): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270" shape-rendering="crispEdges">${body}</svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const threshold = wrap(
	r(0, 0, 480, 270, "#0d0f1a") +
		rows(46, (i) => r((i * 97) % 476, (i * 41) % 150, 2, 2, i % 5 === 0 ? "#f3d9a4" : "#5d6690")) +
		// A pale arch of light, the way into the world.
		r(206, 40, 68, 112, "#23294a") +
		r(214, 48, 52, 104, "#3a4478") +
		r(222, 58, 36, 94, "#8f9bd6") +
		r(230, 70, 20, 82, "#dfe5ff") +
		// The stone disc the two stand on.
		r(40, 156, 400, 8, "#3b3f58") +
		r(20, 164, 440, 70, "#2c3046") +
		r(40, 234, 400, 10, "#22263a") +
		rows(9, (i) => r(40 + i * 48, 170 + (i % 3) * 18, 30, 2, "#3b3f58")),
);

const attic = wrap(
	r(0, 0, 480, 150, "#2a211c") +
		// Roof slopes.
		rows(12, (i) => r(0, i * 10, 150 - i * 12, 10, "#1a1411")) +
		rows(12, (i) => r(330 + i * 12, i * 10, 150 - i * 12, 10, "#1a1411")) +
		rows(5, (i) => r(60 + i * 90, 0, 6, 150, "#3d2f26")) +
		r(0, 60, 480, 6, "#3d2f26") +
		// Moonlit window.
		r(214, 46, 52, 56, "#3d2f26") +
		r(220, 52, 40, 44, "#9db7d8") +
		r(238, 52, 4, 44, "#3d2f26") +
		r(220, 72, 40, 4, "#3d2f26") +
		planks(150, "#4a382b", "#34261d") +
		// Light from the window on the floor.
		r(196, 170, 88, 40, "#6a543f", 'opacity="0.55"') +
		// A bed.
		r(36, 132, 96, 30, "#5a2f2b") +
		r(36, 120, 24, 14, "#d8cdb4") +
		r(32, 160, 104, 8, "#2a1d16") +
		// The stairs down, front right.
		r(372, 214, 96, 46, "#1a1411") +
		rows(4, (i) => r(380 + i * 6, 220 + i * 10, 80 - i * 6, 4, "#5a4636")),
);

const taproom = wrap(
	stones(150, "#3a3531", "#2a2623") +
		// Hearth.
		r(48, 60, 96, 90, "#231f1d") +
		r(60, 78, 72, 72, "#120f0e") +
		r(74, 118, 44, 32, "#b8431f") +
		r(82, 108, 28, 42, "#ef8a2c") +
		r(90, 122, 12, 28, "#ffd97a") +
		r(40, 52, 112, 10, "#5c4a3a") +
		// Shelves with bottles.
		r(300, 44, 140, 6, "#5c4a3a") +
		r(300, 84, 140, 6, "#5c4a3a") +
		rows(8, (i) =>
			r(308 + i * 16, 26 + (i % 3) * 2, 8, 18 - (i % 3) * 2, i % 2 ? "#4f7a5a" : "#8a5a2c"),
		) +
		rows(8, (i) =>
			r(308 + i * 16, 68 + (i % 2) * 4, 8, 16 - (i % 2) * 4, i % 3 ? "#7a4f6e" : "#4f6a7a"),
		) +
		// Stairs up, back left.
		rows(5, (i) => r(162 + i * 10, 140 - i * 10, 60 - i * 10, 10, "#4a3d32")) +
		planks(150, "#5a4534", "#3f3024") +
		// The bar.
		r(280, 126, 180, 12, "#7a5a3c") +
		r(288, 138, 164, 44, "#4a3626") +
		rows(4, (i) => r(296 + i * 40, 142, 4, 36, "#3a2a1d")) +
		// Firelight on the floor.
		r(40, 152, 130, 46, "#a0562a", 'opacity="0.35"') +
		// Cellar hatch, front left.
		r(368, 226, 84, 34, "#2a1d16") +
		r(374, 232, 72, 22, "#17100c") +
		r(404, 240, 12, 6, "#8a7a5a"),
);

const cellar = wrap(
	stones(150, "#23262b", "#16181c") +
		// Arch into the dark.
		r(156, 50, 88, 100, "#0b0c0f") +
		r(148, 44, 104, 8, "#34383f") +
		// A torch.
		r(120, 70, 6, 26, "#5c4a3a") +
		r(116, 56, 14, 16, "#ef8a2c") +
		r(120, 50, 6, 10, "#ffd97a") +
		// Barrels.
		rows(
			3,
			(i) =>
				r(340 + i * 42, 104, 34, 48, "#5a4030") +
				r(340 + i * 42, 112, 34, 4, "#2c2a2a") +
				r(340 + i * 42, 138, 34, 4, "#2c2a2a"),
		) +
		r(360, 60, 34, 46, "#4a3528") +
		r(360, 68, 34, 4, "#2c2a2a") +
		// Dirt floor.
		r(0, 150, 480, 120, "#3a3028") +
		rows(30, (i) => r((i * 67) % 470, 156 + ((i * 29) % 104), 8, 2, "#2c241e")) +
		rows(12, (i) => r((i * 113) % 460, 160 + ((i * 47) % 96), 4, 4, "#4a4036")) +
		// Steps up, inside the arch.
		rows(4, (i) => r(164 + i * 6, 138 - i * 12, 72 - i * 12, 6, "#4a4d54")),
);

const yard = wrap(
	r(0, 0, 480, 150, "#141a2e") +
		rows(30, (i) => r((i * 89) % 476, (i * 37) % 70, 2, 2, "#c9d2f0")) +
		r(380, 20, 22, 22, "#f0ecd0") +
		// Far trees.
		rows(9, (i) => r(i * 56 - 6, 70 + (i % 3) * 8, 44, 60, "#0f1a17")) +
		// The yard wall and its gate.
		r(0, 100, 480, 50, "#34363c") +
		rows(16, (i) => r(i * 32 + 6, 94, 20, 8, "#34363c")) +
		r(404, 84, 62, 66, "#1e1a17") +
		rows(4, (i) => r(410 + i * 14, 88, 8, 62, "#4a3a2c")) +
		r(404, 112, 62, 6, "#6a6a6a") +
		// The inn's door, back left.
		r(205, 70, 70, 80, "#4a3d32") +
		r(219, 92, 40, 58, "#231a14") +
		r(225, 98, 28, 52, "#e0a040", 'opacity="0.5"') +
		// Packed earth.
		r(0, 150, 480, 120, "#3d3a2c") +
		rows(34, (i) => r((i * 71) % 470, 156 + ((i * 31) % 104), 10, 2, "#2e2c22")) +
		rows(16, (i) => r((i * 127) % 460, 158 + ((i * 53) % 100), 4, 2, "#5a6a3c")),
);

export const backdrops: Record<string, string> = { threshold, attic, taproom, cellar, yard };
