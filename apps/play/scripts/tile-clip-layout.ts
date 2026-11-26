// Runs in Chromium, serialized by the Node driver like `sweep`
// (`tile-clip-browser.ts`), so it must stay self-contained: no imports, no
// module-level helpers. Each probe proves one layout rule of the Play app in
// real browser geometry that jsdom cannot lay out (batch 7, G6):
//
// - `place-card-rows` (`?beat=place-long`): a Place card with a long
//   description, three occupants and five way-out rows. Every row outside
//   the description is fully inside every clipping box up to the tile body,
//   all five way-out rows render (no "+N more"), and only the description
//   scrolls, with at least one visible line.
// - `stream-under-filter` (`?beat=stream-detail`): the Table stream scrolled
//   to its middle. Three independent facts together mean no stream text can
//   paint under the bar: the stream clips its overflow, its clip edge sits
//   below the filter bar, and it has no top padding (the gap is a margin
//   outside the scrollport, sk-jay0.1.8.110; inside a top padding band
//   scrolled rows would stay visible). A hit test on points inside the bar
//   adds that the stream is not stacked over it; it tests hit targets, not
//   paint. Whether a line is cut at the edge and where the first visible
//   line starts are reported, not asserted.
// - `hero-drafting-vitals` (`?beat=hero-drafting`): the You card of a hero
//   still being drafted shows the name and no vitals row (no HP/AC/XP).
//
// At 1280x720 the Place and You tiles are cards at rest. At 390x844 every
// tile but the Table rests as a hidden strip, so the probe opens the tile
// (its own "Open <tile>" button, as a tap) and then drags the divider below
// it up until the tile is a card: the same `PlayTable` handlers a finger
// drag reaches. The events are synthetic (no hit testing); a setup that does
// not end on a card throws instead of measuring the wrong level.
// The phone card is measured at ONE size only: 0.675, the tallest a card can
// be (a card spans 0.25 to 0.7, `mosaic.ts`). An `ok` row at 390x844 says the
// rows fit the tallest phone card. It does not say they fit a card the
// player dragged smaller.
// `beatOf` is `layoutProbeBeats` (`tile-clip-selection.ts`), passed in
// because this function cannot import it.
export async function layoutProbes(
	baseUrl: string,
	probes: string[],
	beatOf: Record<string, string>,
) {
	const viewports = [
		[1280, 720],
		[390, 844],
	];
	// Probe -> [tile id, tile title, title of the tile below it on a phone].
	const cardOf: Record<string, [string, string, string]> = {
		"place-card-rows": ["place", "Place", "You"],
		"hero-drafting-vitals": ["hero", "You", "Pack"],
	};
	const rows = await Promise.all(
		probes.flatMap((probe) =>
			viewports.map(async ([width, height]) => {
				const beat = beatOf[probe];
				if (beat === undefined) throw new Error(`Unknown layout probe ${probe}`);
				const viewport = `${width}x${height}`;
				const fail = (what: string) => new Error(`${probe} ${viewport}: ${what}`);
				const frame = document.createElement("iframe");
				frame.style.cssText = `position:absolute;top:0;left:0;width:${width}px;height:${height}px;border:0`;
				frame.src = `${baseUrl}/demo.html?beat=${beat}`;
				document.body.append(frame);
				const win = frame.contentWindow;
				if (!win) throw fail("missing frame window");
				const doc = () => win.document;
				const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
				const frames = () =>
					new Promise((resolve) =>
						win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)),
					);
				const until = async (what: string, ok: () => boolean) => {
					const deadline = performance.now() + 25000; // agent-browser's action budget
					while (!ok()) {
						if (performance.now() >= deadline) throw fail(`timed out waiting for ${what}`);
						await sleep(20);
					}
				};
				// Mosaic tracks ease between layouts (CSS transitions); geometry
				// is only read once none is running. Infinite animations (the map
				// skeleton shimmer) are not transitions and never block.
				const settle = async () => {
					await frames();
					await until("the mosaic to settle", () =>
						Array.from(doc().querySelectorAll(".mosaic")).every((mosaic) =>
							mosaic
								.getAnimations({ subtree: true })
								// Only a CSSTransition carries `transitionProperty`.
								.every((a) => !("transitionProperty" in a) || a.playState !== "running"),
						),
					);
					await frames();
				};
				await until("the table tile", () => doc().querySelector('[data-tile="table"]') !== null);
				await win.document.fonts.ready;
				await settle();
				if (win.innerWidth !== width || win.innerHeight !== height)
					throw fail("wrong frame viewport");
				const tileEl = (id: string) => {
					const el = doc().querySelector<HTMLElement>(`.tile[data-tile="${id}"]`);
					if (!el) throw fail(`missing tile ${id}`);
					return el;
				};
				// A box is fully shown when every clipping ancestor up to `stop`
				// contains it (one pixel of rounding either way).
				const fullyShown = (el: Element, stop: Element) => {
					const r = el.getBoundingClientRect();
					if (r.height <= 0 || r.width <= 0) return false;
					for (let a = el.parentElement; a !== null; a = a.parentElement) {
						const style = win.getComputedStyle(a);
						if (style.overflowX !== "visible" || style.overflowY !== "visible") {
							const c = a.getBoundingClientRect();
							if (r.top < c.top - 1 || r.bottom > c.bottom + 1) return false;
							if (r.left < c.left - 1 || r.right > c.right + 1) return false;
						}
						if (a === stop) break;
					}
					return true;
				};
				const card = cardOf[probe];
				if (card !== undefined && width < 1024) {
					const [id, title, belowTitle] = card;
					const open = tileEl(id).querySelector<HTMLButtonElement>(
						`button[aria-label="Open ${title}"]`,
					);
					if (!open) throw fail(`missing Open ${title} button`);
					open.click();
					await until(`${id} at stage`, () => tileEl(id).dataset.zoom === "stage");
					await settle();
					const splitter = doc().querySelector<HTMLElement>(
						`.mosaic--mobile [role="separator"][aria-label="Resize ${title} and ${belowTitle}"]`,
					);
					if (!splitter) throw fail(`missing ${title}/${belowTitle} divider`);
					// A synthetic pointer is not an active pointer, so capture would
					// throw before the drag starts; the window listeners carry the drag.
					Object.defineProperty(splitter, "setPointerCapture", { value: undefined });
					const below = tileEl(id)
						.closest(".mosaic-tile")
						?.nextElementSibling?.querySelector(".tile");
					if (!below) throw fail(`missing tile below ${id}`);
					const upper = tileEl(id).getBoundingClientRect().height;
					const lower = below.getBoundingClientRect().height;
					// After the tap the pair weighs 5 + 0 (`fr`, mosaic.ts). Leave the
					// tile 2.4 of it: size 0.675, a card just under the 0.7 stage
					// threshold, so the card gets as much height as a card can.
					const delta = (2.4 / 5) * (upper + lower) - upper;
					const r = splitter.getBoundingClientRect();
					const x = r.left + r.width / 2;
					const y = r.top + r.height / 2;
					const pointer = (type: string, clientY: number) =>
						new win.PointerEvent(type, {
							bubbles: true,
							cancelable: true,
							pointerId: 1,
							pointerType: "mouse",
							isPrimary: true,
							button: 0,
							buttons: type === "pointerup" ? 0 : 1,
							clientX: x,
							clientY,
						});
					splitter.dispatchEvent(pointer("pointerdown", y));
					win.dispatchEvent(pointer("pointermove", y + delta / 2));
					win.dispatchEvent(pointer("pointermove", y + delta));
					win.dispatchEvent(pointer("pointerup", y + delta));
					await settle();
					if (tileEl(id).dataset.zoom !== "card")
						throw fail(`${id} is ${tileEl(id).dataset.zoom} after the divider drag, not card`);
				}
				const detail: Record<string, unknown> = {};
				let ok = true;
				const check = (name: string, value: boolean) => {
					detail[name] = value;
					if (!value) ok = false;
				};
				if (probe === "place-card-rows") {
					const tile = tileEl("place");
					if (tile.dataset.zoom !== "card") throw fail(`place is ${tile.dataset.zoom}`);
					const body = tile.querySelector(".tile-body");
					const placeCard = body?.querySelector(".place-card");
					const scene = placeCard?.querySelector(':scope > [data-slot="play-scene"]');
					const description = scene?.querySelector<HTMLElement>(".scene-description");
					if (!body || !placeCard || !scene || !description)
						throw fail("missing place card, scene or description");
					const ways = Array.from(placeCard.querySelectorAll(".place-card-ways > li"));
					const shown = (el: Element) => el.getClientRects().length > 0;
					const rowsOutsideText = [
						...Array.from(placeCard.children).filter((el) => el !== scene),
						...Array.from(scene.children).filter((el) => el !== description),
						...ways,
					].filter(shown);
					const clipped = rowsOutsideText.filter((el) => !fullyShown(el, body));
					detail.clipped = clipped.map((el) => (el.textContent ?? "").trim().slice(0, 40));
					check("five-way-rows", ways.length === 5);
					check(
						"no-more-note",
						ways.every((li) => !(li.textContent ?? "").trim().startsWith("+")),
					);
					check("occupants-shown", (placeCard.textContent ?? "").includes("Brother Caddoc"));
					check("no-row-clipped", clipped.length === 0);
					const style = win.getComputedStyle(description);
					const lineHeight = Number.parseFloat(style.lineHeight) || 16;
					detail.description = {
						clientHeight: description.clientHeight,
						scrollHeight: description.scrollHeight,
						lineHeight,
					};
					check("description-box-shown", fullyShown(description, body));
					check("description-line-visible", description.clientHeight >= lineHeight - 1);
					check(
						"description-overflows",
						description.scrollHeight > description.clientHeight + 1 &&
							(style.overflowY === "auto" || style.overflowY === "scroll"),
					);
					description.scrollTop = 24;
					await frames();
					check("description-scrolls", description.scrollTop > 0);
					description.scrollTop = 0;
				} else if (probe === "stream-under-filter") {
					const table = tileEl("table");
					if (table.dataset.zoom !== "stage") throw fail(`table is ${table.dataset.zoom}`);
					const bar = table.querySelector<HTMLElement>('ul[aria-label="Filter the stream"]');
					const stream = table.querySelector<HTMLElement>(".table-explore-stream");
					if (!bar || !stream) throw fail("missing filter bar or stream");
					const max = stream.scrollHeight - stream.clientHeight;
					if (max < 80) throw fail(`stream overflows by ${max}px only; needs a longer fixture`);
					stream.scrollTop = Math.round(max / 2);
					await frames();
					await frames();
					const scrollTop = stream.scrollTop;
					check("scrolled-to-middle", scrollTop > 40 && scrollTop < max - 40);
					const barRect = bar.getBoundingClientRect();
					const s = stream.getBoundingClientRect();
					const cs = win.getComputedStyle(stream);
					// A scrollport clips at its padding box.
					const clipTop = s.top + Number.parseFloat(cs.borderTopWidth);
					const clipBottom = s.bottom - Number.parseFloat(cs.borderBottomWidth);
					let firstVisibleTop = Number.POSITIVE_INFINITY;
					let cutAtEdge = false;
					const walker = doc().createTreeWalker(stream, NodeFilter.SHOW_TEXT);
					const range = doc().createRange();
					for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
						if ((node.textContent ?? "").trim() === "") continue;
						range.selectNodeContents(node);
						for (const rect of Array.from(range.getClientRects())) {
							const top = Math.max(rect.top, clipTop);
							const bottom = Math.min(rect.bottom, clipBottom);
							if (bottom - top <= 0.5) continue;
							firstVisibleTop = Math.min(firstVisibleTop, top);
							if (rect.top < clipTop - 0.5) cutAtEdge = true;
						}
					}
					// Points inside the bar must hit the bar, never stream content
					// painted over or under it.
					let streamUnderBar = false;
					for (let px = barRect.left + 2; px < barRect.right - 1; px += 8) {
						for (const py of [
							barRect.top + 2,
							barRect.top + barRect.height / 2,
							barRect.bottom - 2,
						]) {
							const hit = doc().elementFromPoint(px, py);
							if (hit !== null && stream.contains(hit)) streamUnderBar = true;
						}
					}
					detail.geometry = {
						barBottom: barRect.bottom,
						clipTop,
						firstVisibleTop,
						paddingTop: cs.paddingTop,
						scrollTop,
						max,
					};
					check("stream-clips-overflow", cs.overflowY === "auto" || cs.overflowY === "scroll");
					check("clip-edge-below-bar", clipTop >= barRect.bottom + 1);
					// Rows scrolled past the edge stay visible inside a top padding
					// band (sk-jay0.1.8.110). `firstVisibleTop` is clamped to the
					// clip edge, so it cannot prove this; the padding itself does.
					check("no-top-padding", Number.parseFloat(cs.paddingTop) === 0);
					// Informational: a line boundary can land exactly on the edge.
					detail["text-cut-at-clip-edge"] = cutAtEdge;
					// Hit targets, not paint: the stream is not stacked over the bar.
					check("bar-not-covered-by-stream", !streamUnderBar);
				} else if (probe === "hero-drafting-vitals") {
					const tile = tileEl("hero");
					if (tile.dataset.zoom !== "card") throw fail(`hero is ${tile.dataset.zoom}`);
					const body = tile.querySelector(".tile-body");
					if (!body) throw fail("missing hero body");
					const text = body.textContent ?? "";
					check("name-shown", text.includes("Renn the Roadwarden"));
					check("no-vitals-row", body.querySelector(".sk-vitals-grid") === null);
					check("no-vital-terms", !/\b(HP|AC|XP)\b/.test(text));
				}
				return { probe, beat, viewport, ok, detail };
			}),
		),
	);
	return rows;
}
