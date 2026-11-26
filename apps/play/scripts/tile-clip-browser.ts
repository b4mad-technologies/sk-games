// Runs in Chromium, serialized by the Node driver. Each iframe has its own
// layout viewport, document and App; the browser process and built assets are shared.
// `beats` comes from `tile-clip-selection.ts` (`sweepBeats`): this function is
// serialized, so it cannot import it.
export async function sweep(baseUrl: string, selected: string[], beats: string[]) {
	const viewports = [
		[1280, 720],
		[390, 844],
	];
	const allTiles = ["table", "map", "place", "hero", "pack"];
	const rows = await Promise.all(
		beats.flatMap((beat) =>
			viewports.map(async ([width, height]) => {
				const frame = document.createElement("iframe");
				frame.style.cssText = `position:absolute;top:0;left:0;width:${width}px;height:${height}px;border:0`;
				frame.src = `${baseUrl}/demo.html?beat=${beat}`;
				document.body.append(frame);
				const win = frame.contentWindow;
				if (!win) throw new Error("Missing frame window");
				const deadline = performance.now() + 25000; // agent-browser's existing action budget
				while (!win.document.querySelector('[data-tile="table"]')) {
					if (performance.now() >= deadline)
						throw new Error(`Missing table: ${beat} ${width}x${height}`);
					await new Promise((resolve) => setTimeout(resolve, 20));
				}
				await win.document.fonts.ready;
				await new Promise((resolve) =>
					win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)),
				);
				if (win.innerWidth !== width || win.innerHeight !== height)
					throw new Error("Wrong frame viewport");
				// Owner's stream regression: a place divider scrolls with speech
				// instead of covering speaker headings. Prove real browser geometry.
				if (beat === "talk-burst") {
					const header = win.document.querySelector<HTMLElement>(
						'[data-slot="activity-feed-header"]',
					);
					const stream = win.document.querySelector<HTMLElement>(".table-explore-stream");
					if (!header || !stream) throw new Error("Missing stream header scroll probe");
					if (win.getComputedStyle(header).position !== "static")
						throw new Error("Place header must scroll normally");
					const previousScroll = stream.scrollTop;
					const previousStyle = stream.style.cssText;
					stream.style.cssText += ";max-height:80px;flex:0 0 80px";
					stream.scrollTop = 0;
					const before = header.getBoundingClientRect().top;
					stream.scrollTop = 32;
					if (stream.scrollTop === 0) throw new Error("Header probe needs overflowing speech");
					const displacement = before - header.getBoundingClientRect().top;
					if (Math.abs(displacement - stream.scrollTop) > 1)
						throw new Error("Place header covers scrolled speech");
					stream.style.cssText = previousStyle;
					stream.scrollTop = previousScroll;
				}
				const bodies = Array.from(win.document.querySelectorAll<HTMLElement>(".tile-body"));
				const tileOf = (el: HTMLElement) => el.closest(".tile")?.getAttribute("data-tile") ?? "";
				for (const body of bodies) {
					if (!allTiles.includes(tileOf(body))) throw new Error(`Unknown tile ${tileOf(body)}`);
				}
				for (const tile of allTiles) {
					if (bodies.filter((body) => tileOf(body) === tile).length !== 1)
						throw new Error(`Missing/duplicate tile ${tile}: ${beat}`);
				}
				const measure = (cards = selected) =>
					bodies
						.filter((el) => cards.includes(tileOf(el)))
						.map((el) => {
							const tile = el.closest(".tile");
							const marker = el.querySelector<HTMLElement>("[data-tile-remainder]");
							let remainder = false;
							if (marker !== null) {
								const style = win.getComputedStyle(marker);
								remainder =
									style.display !== "none" &&
									style.visibility !== "hidden" &&
									marker.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + 1;
							}
							return {
								beat,
								viewport: `${width}x${height}`,
								tile: tile?.getAttribute("data-tile"),
								zoom: tile?.getAttribute("data-zoom"),
								scrollHeight: el.scrollHeight,
								clientHeight: el.clientHeight,
								remainder,
							};
						});
				const measured = measure();
				// Consumer proof: mutate real card geometry to exercise the same measurement
				// and verdict as the gate. These cases never alter the normal sweep.
				if (width === 1280 && beat === "fight") {
					const body = win.document.querySelector<HTMLElement>('[data-tile="hero"] .tile-body');
					if (!body) throw new Error("Missing probe body");
					body.style.cssText = "height:40px;min-height:0;max-height:40px;overflow:hidden";
					body.innerHTML =
						'<span data-tile-remainder style="display:block;height:10px">3 more</span><div style="height:200px"></div>';
					const row = () => {
						const result = measure(["hero"]).find((r) => r.tile === "hero");
						if (!result) throw new Error("Missing probe measurement");
						return result;
					};
					const clips = () => {
						const r = row();
						return r.scrollHeight > r.clientHeight && !r.remainder;
					};
					if (clips()) throw new Error("Visible remainder must permit overflow");
					const marker = body.firstElementChild as HTMLElement;
					marker.style.display = "none";
					if (!clips()) throw new Error("Hidden remainder must fail");
					marker.style.display = "block";
					marker.style.visibility = "hidden";
					if (!clips()) throw new Error("Invisible remainder must fail");
					marker.style.visibility = "visible";
					body.append(marker);
					if (!clips()) throw new Error("Below-fold remainder must fail");
					marker.remove();
					if (!clips()) throw new Error("Overflow without remainder must fail");
					body.innerHTML = "";
					if (clips()) throw new Error("Unclipped card must pass");
				}
				return measured;
			}),
		),
	);
	return rows.flat();
}
