import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { tick } from "svelte";
import { describe, expect, it, vi } from "vitest";
import type { ThreadLine } from "../lib/play-table";
import { clearReferenceVocabularyCache } from "../lib/reference-vocabulary";
import Thread from "./Thread.svelte";

function line(overrides: Partial<ThreadLine> & Pick<ThreadLine, "id" | "text">): ThreadLine {
	return {
		speakerId: "4",
		speaker: "Aldwin, keeper of the hearth-ledger",
		mine: false,
		isChoice: false,
		addresseeName: null,
		startsBurst: true,
		chips: [],
		...overrides,
	};
}

describe("Thread (sk-jay0.1.8.12)", () => {
	it("keeps dialogue quotes fluid with the Table tile", () => {
		render(Thread, {
			lines: [
				line({
					id: "measure",
					text: "A deliberately long line that must keep a readable measure.",
				}),
			],
			density: "stage",
		});
		const quote = document.querySelector(".play-thread .sk-play-quote");
		expect(quote).not.toBeNull();
		// keep(K4): the shared bubble owns the CSS contract; Chromium checks actual geometry.
		const source = readFileSync(
			resolve(
				import.meta.dirname,
				"../../node_modules/@spellkave/ui-widgets/src/SpeechBubble.svelte",
			),
			"utf8",
		);
		expect(source).toMatch(/width: fit-content/);
		expect(source).toMatch(/max-width: 100%/);
		expect(source).toMatch(/box-sizing: border-box/);
		expect(source).toMatch(/overflow-wrap: anywhere/);
	});

	it("renders read-only reference links without dispatching an answer", async () => {
		clearReferenceVocabularyCache();
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					version: 1,
					targets: [
						{ label: "Fighter", kind: "class", ref: "fighter", href: "/docs/class/fighter" },
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		const onAct = vi.fn();
		render(Thread, {
			lines: [line({ id: "a", text: "Choose Fighter." })],
			density: "stage",
			onAct,
		});
		const trigger = await screen.findByRole("button", { name: "Fighter" });
		await fireEvent.click(trigger);
		const link = await screen.findByRole("link", { name: /Full reference/ });
		expect(link.getAttribute("href")).toContain("/docs/class/fighter");
		expect(onAct).not.toHaveBeenCalled();
		expect(link.getAttribute("target")).toBe("spellkave-reference");
		expect(link.getAttribute("rel")).toBeNull();
		fetchMock.mockRestore();
	});

	it("keeps ordinary prose intact when the public vocabulary is unavailable", async () => {
		clearReferenceVocabularyCache();
		const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
		render(Thread, {
			lines: [line({ id: "offline", text: "Choose Fighter." })],
			density: "stage",
			onAct: vi.fn(),
		});
		await waitFor(() => expect(screen.getByText("Choose Fighter.")).toBeTruthy());
		expect(screen.queryByRole("link")).toBeNull();
		fetchMock.mockRestore();
	});
	it("keeps unsafe and off-site reference targets as plain text", async () => {
		clearReferenceVocabularyCache();
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					version: 1,
					targets: [
						{ label: "Fighter", kind: "class", ref: "fighter", href: "javascript:alert(1)" },
						{
							label: "Wizard",
							kind: "class",
							ref: "wizard",
							href: "https://elsewhere.example/docs/wizard",
						},
						{ label: "Rogue", kind: "class", ref: "rogue", href: "/docs/class/rogue" },
					],
				}),
			),
		);
		render(Thread, {
			lines: [line({ id: "safe", text: "Fighter, Wizard, Rogue." })],
			density: "stage",
			onAct: vi.fn(),
		});
		const safeLink = await screen.findByRole("button", { name: "Rogue" });
		expect(screen.queryByRole("button", { name: "Fighter" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Wizard" })).toBeNull();
		expect(safeLink.parentElement?.textContent).toBe("Fighter, Wizard, Rogue.");
		fetchMock.mockRestore();
	});
	it("reports unread lines and catches up through the tile callback", async () => {
		const host = document.createElement("div");
		host.className = "tile-body";
		Object.defineProperties(host, {
			clientHeight: { value: 100 },
			scrollHeight: { value: 600 },
		});
		document.body.append(host);
		const onUnreadChange = vi.fn();
		const initial = [line({ id: "a", text: "Earlier conversation." })];
		const { rerender, unmount } = render(Thread, {
			target: host,
			props: { lines: initial, density: "stage", onAct: vi.fn(), onUnreadChange },
		});
		await tick();
		host.scrollTop = 100;
		await fireEvent.scroll(host);
		await rerender({ lines: [...initial, line({ id: "b", text: "A new reply." })] });
		expect(onUnreadChange).toHaveBeenLastCalledWith(1, expect.any(Function));
		const jump = onUnreadChange.mock.lastCall?.[1] as () => void;
		jump();
		await fireEvent.scroll(host);
		expect(host.scrollTop).toBe(600);
		expect(onUnreadChange).toHaveBeenLastCalledWith(0, expect.any(Function));
		await unmount();
		host.remove();
	});

	it("card density shows only the last two lines, statically", () => {
		const lines = [
			line({ id: "a", text: "First." }),
			line({ id: "b", text: "Second." }),
			line({ id: "c", text: "Third." }),
		];
		render(Thread, { lines, density: "card", onAct: vi.fn() });
		expect(screen.queryByText("First.")).toBeNull();
		expect(screen.getByText("Second.")).toBeTruthy();
		expect(screen.getByText("Third.")).toBeTruthy();
	});

	it("stage density shows every line, in the order given (world order)", () => {
		const lines = [
			line({ id: "a", text: "First." }),
			line({ id: "b", text: "Second." }),
			line({ id: "c", text: "Third." }),
		];
		render(Thread, { lines, density: "stage", onAct: vi.fn() });
		const said = screen.getAllByText(/First\.|Second\.|Third\./).map((el) => el.textContent);
		expect(said).toEqual(["First.", "Second.", "Third."]);
	});

	it("carries a stable data-line-id per rendered line (sk-jay0.1.8.18 task 2: PlayTable's scrollToBurst hook)", () => {
		const lines = [
			line({ id: "speech:8", text: "First." }),
			line({ id: "speech:9", text: "Second." }),
		];
		render(Thread, { lines, density: "stage", onAct: vi.fn() });
		expect(document.querySelector('[data-line-id="speech:8"]')?.textContent).toContain("First.");
		expect(document.querySelector('[data-line-id="speech:9"]')?.textContent).toContain("Second.");
	});

	it("shows the empty state when nobody has spoken here", () => {
		render(Thread, { lines: [], density: "stage", onAct: vi.fn() });
		expect(screen.getByText("Nobody has spoken here.")).toBeTruthy();
	});

	it("renders 'to <name>' only when the line carries an addressee", () => {
		const lines = [
			line({ id: "a", text: "General remark." }),
			line({ id: "b", text: "Direct remark.", addresseeName: "Renn the Roadwarden" }),
		];
		render(Thread, { lines, density: "stage", onAct: vi.fn() });
		expect(screen.queryByText(/^to /)).toBeTruthy();
		expect(screen.getByText("to Renn the Roadwarden")).toBeTruthy();
	});

	it("marks an own choice line as chosen, not spoken words", () => {
		const lines = [
			line({ id: "a", text: "5 Fighter", mine: true, isChoice: true, speaker: "You" }),
		];
		render(Thread, { lines, density: "stage", onAct: vi.fn() });
		expect(screen.getByText(/Chose ·/)).toBeTruthy();
		expect(screen.getByText(/5 Fighter/)).toBeTruthy();
	});

	it("fires a chip's own action id through onAct, disabled while busy", async () => {
		const onAct = vi.fn();
		const lines = [
			line({
				id: "a",
				text: "Which class calls to you?",
				chips: [
					{ kind: "choice", actionId: "h:ans1", slot: 1, label: "Fighter" },
					{ kind: "action", actionId: "h:adopt-array", label: "Adopt the recommended array" },
				],
			}),
		];
		const { rerender } = render(Thread, { lines, density: "stage", onAct, busy: false });
		const answers = screen.getByRole("list", { name: /Answers from/ });
		const fighter = within(answers).getByRole<HTMLButtonElement>("button", { name: /Fighter/ });
		expect(fighter.disabled).toBe(false);
		await fireEvent.click(fighter);
		expect(onAct).toHaveBeenCalledWith("h:ans1");
		expect(
			within(answers).getByRole("button", { name: /Adopt the recommended array/ }),
		).toBeTruthy();

		await rerender({ lines, density: "stage", onAct, busy: true });
		const fighterBusy = within(
			screen.getByRole("list", { name: /Answers from/ }),
		).getByRole<HTMLButtonElement>("button", { name: /Fighter/ });
		expect(fighterBusy.disabled).toBe(true);
	});

	it("keeps a resolved choice direct while offering a separate reference preview", async () => {
		clearReferenceVocabularyCache();
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					version: 1,
					targets: [
						{ label: "Fighter", kind: "class", ref: "fighter", href: "/docs/classes/fighter" },
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		const onAct = vi.fn();
		render(Thread, {
			lines: [
				line({
					id: "choice",
					text: "Which class calls to you?",
					chips: [{ kind: "choice", actionId: "h:fighter", slot: 1, label: "Fighter" }],
				}),
			],
			density: "stage",
			onAct,
		});

		const answer = await screen.findByRole("button", { name: "1. Fighter" });
		await fireEvent.click(answer);
		expect(onAct).toHaveBeenCalledWith("h:fighter");

		const reference = await screen.findByRole("button", { name: "About Fighter" });
		await fireEvent.click(reference);
		expect(await screen.findByRole("dialog", { name: "Fighter reference" })).toBeTruthy();
		expect(screen.getByRole("link", { name: /Full reference/ }).getAttribute("href")).toBe(
			"https://spellkave.com/docs/classes/fighter",
		);
		fetchMock.mockRestore();
	});

	it("leaves a choice alone when its public reference vocabulary is unavailable", async () => {
		clearReferenceVocabularyCache();
		const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
		render(Thread, {
			lines: [
				line({
					id: "unavailable-choice",
					text: "Which class calls to you?",
					chips: [{ kind: "choice", actionId: "h:fighter", slot: 1, label: "Fighter" }],
				}),
			],
			density: "stage",
			onAct: vi.fn(),
		});
		await screen.findByRole("button", { name: "1. Fighter" });
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(screen.queryByRole("button", { name: "About Fighter" })).toBeNull();
		fetchMock.mockRestore();
	});

	// The participant head test moved to `TalkParticipants.test.ts`
	// (sk-jay0.1.8.63.1 Part B): the head is `TalkParticipants.svelte` now,
	// a Talk-only header PlayTable mounts above the shared stream, not part
	// of this card-only component.
});
