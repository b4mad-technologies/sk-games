import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_KEYMAP } from "../lib/keymap";
import { emptyShellBuffer, type ShellBuffer } from "../lib/shell-buffer";
import type { ShellFinderCandidate } from "../lib/shell-finder";
import ShellComposer from "./ShellComposer.svelte";

const inspect: ShellFinderCandidate = {
	id: "inspect",
	text: "/inspect",
	kind: "action",
	canonical: "srd/inspect",
	label: "Inspect",
	detail: "Look closely",
	preview: "Examine a disclosed fact. The world decides admission.",
	source: "actions",
};
const chest: ShellFinderCandidate = {
	id: "chest",
	text: '@"Locked chest"',
	kind: "actor",
	canonical: "entity:4",
	label: "Locked chest",
	detail: "Here with you",
	source: "targets",
};
const barbarianReply: ShellFinderCandidate = {
	id: "reply:barbarian",
	text: "/barbarian",
	kind: "action",
	canonical: "dm/answer/class/barbarian",
	label: "Barbarian — answer to Aldwin",
	detail: "Which class?",
	source: "prompts",
	semanticContext: { source_ref: "entity:aldwin", occurrence_id: "class-1" },
};

function renderComposer(buffer: ShellBuffer = emptyShellBuffer("/in")) {
	const onTextChange = vi.fn();
	const onChoose = vi.fn();
	const onAttempt = vi.fn();
	render(ShellComposer, {
		buffer,
		candidates: [inspect],
		completionRange: { start: 0, end: buffer.text.length },
		onTextChange,
		onChoose,
		onAttempt,
	});
	return { onTextChange, onChoose, onAttempt };
}

describe("ShellComposer", () => {
	it("keeps the blank dock as a command shell until the player explicitly opens completion", async () => {
		const view = render(ShellComposer, {
			buffer: emptyShellBuffer(),
			candidates: [inspect, chest],
			onTextChange: vi.fn(),
			onChoose: vi.fn(),
			onAttempt: vi.fn(),
		});
		expect(screen.queryByTestId("shell-finder")).toBeNull();
		expect(document.querySelector(".shell-composer__prompt")?.textContent).toBe("›");
		expect(screen.getByText("What do you do?")).toBeTruthy();
		expect(document.querySelector(".shell-composer__mirror")?.textContent).toBe("›What do you do?");
		// Nothing blocks this bare shell: the legend names what Enter and Tab do.
		expect(screen.getByText("Enter send · Tab more choices")).toBeTruthy();

		await fireEvent.input(screen.getByRole("combobox"), { target: { value: "/" } });
		await view.rerender({ buffer: emptyShellBuffer("/") });
		expect(screen.queryByTestId("shell-finder")).toBeNull();
	});

	it("owns one native combobox input and exposes its upward finder as an input-owned listbox", async () => {
		renderComposer();
		const input = screen.getByRole("combobox", { name: "Compose an intention" });
		await fireEvent.keyDown(input, { key: "ArrowDown" });
		const listbox = screen.getByRole("listbox", { name: "Suggested choices" });
		expect(screen.getByRole("region", { name: "Suggestions" })).toBeTruthy();
		expect(input.getAttribute("aria-controls")).toBe(listbox.id);
		expect(input.getAttribute("aria-activedescendant")).toBe("play-shell-option-inspect");
		expect(screen.getByTestId("shell-finder").className).toContain("shell-composer__finder");
		expect(screen.queryByText("Preview")).toBeNull();
	});

	it("uses Enter only to insert an active candidate, never to attempt", async () => {
		const { onChoose, onAttempt } = renderComposer();
		const input = screen.getByRole("combobox");
		await fireEvent.keyDown(input, { key: "ArrowDown" });
		await fireEvent.keyDown(input, { key: "Enter" });
		expect(onChoose).toHaveBeenCalledWith(inspect);
		expect(onAttempt).not.toHaveBeenCalled();
	});

	it("sends on Enter with the menu closed", async () => {
		const { onChoose, onAttempt } = renderComposer();
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
		expect(onAttempt).toHaveBeenCalledOnce();
		expect(onChoose).not.toHaveBeenCalled();
	});

	it("extends a shared prefix without binding and opens the menu", async () => {
		const onTextChange = vi.fn();
		const onChoose = vi.fn();
		render(ShellComposer, {
			buffer: emptyShellBuffer("/i"),
			activeToken: "/i",
			completionRange: { start: 0, end: 2 },
			candidates: [inspect, { ...inspect, id: "other", text: "/inspire" }],
			onTextChange,
			onChoose,
			onAttempt: vi.fn(),
		});
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "Tab" });
		expect(onTextChange).toHaveBeenCalledWith("/insp");
		expect(onChoose).not.toHaveBeenCalled();
		expect(screen.getByRole("listbox")).toBeTruthy();
	});

	it("reconciles a refreshed finder by candidate identity, never its former numeric index", async () => {
		const onChoose = vi.fn();
		const view = render(ShellComposer, {
			buffer: emptyShellBuffer("/"),
			candidates: [inspect, chest],
			refreshToken: 0,
			onTextChange: vi.fn(),
			onChoose,
			onAttempt: vi.fn(),
		});
		const input = screen.getByRole("combobox");
		await fireEvent.keyDown(input, { key: "ArrowDown" });
		await fireEvent.keyDown(input, { key: "ArrowDown" });
		expect(input.getAttribute("aria-activedescendant")).toBe("play-shell-option-chest");
		await view.rerender({ candidates: [chest, inspect], refreshToken: 1 });
		expect(input.getAttribute("aria-activedescendant")).toBe("play-shell-option-chest");
		await fireEvent.keyDown(input, { key: "Enter" });
		expect(onChoose).toHaveBeenCalledWith(chest);
	});

	it("announces when an explicit refresh removes the active fact", async () => {
		const view = render(ShellComposer, {
			buffer: emptyShellBuffer("/"),
			candidates: [inspect, chest],
			refreshToken: 0,
			onTextChange: vi.fn(),
			onChoose: vi.fn(),
			onAttempt: vi.fn(),
		});
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "Tab" });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		await view.rerender({ candidates: [inspect], refreshToken: 1 });
		expect(screen.getByRole("combobox").getAttribute("aria-activedescendant")).toBe(
			"play-shell-option-inspect",
		);
		expect(screen.getByText(/Locked chest is no longer available/).textContent).toBe(
			"Suggestions updated. Locked chest is no longer available. Inspect selected.",
		);
	});

	it("accepts the active strict-prefix ghost with Tab while preserving ordinary Tab without one", async () => {
		const { onChoose } = renderComposer();
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "Tab" });
		expect(onChoose).toHaveBeenCalledWith(inspect);

		const onChooseWithoutGhost = vi.fn();
		render(ShellComposer, {
			buffer: emptyShellBuffer("/in"),
			candidates: [],
			completionRange: { start: 0, end: 3 },
			onTextChange: vi.fn(),
			onChoose: onChooseWithoutGhost,
			onAttempt: vi.fn(),
		});
		const inputs = screen.getAllByRole("combobox");
		const event = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
		inputs[1]?.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);
		expect(onChooseWithoutGhost).not.toHaveBeenCalled();
	});

	it("binds an exact active completion with Tab instead of moving focus", async () => {
		const onChoose = vi.fn();
		render(ShellComposer, {
			buffer: emptyShellBuffer("/inspect"),
			candidates: [inspect],
			completionRange: { start: 0, end: "/inspect".length },
			onTextChange: vi.fn(),
			onChoose,
			onAttempt: vi.fn(),
		});
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "Tab" });
		expect(onChoose).toHaveBeenCalledWith(inspect);
	});

	it("returns Tab to native traversal after Escape hides the finder", async () => {
		const { onChoose } = renderComposer();
		const input = screen.getByRole("combobox");
		await fireEvent.keyDown(input, { key: "ArrowDown" });
		await fireEvent.keyDown(input, { key: "Escape" });
		expect(screen.queryByTestId("shell-finder")).toBeNull();
		const event = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
		input.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);
		expect(onChoose).not.toHaveBeenCalled();
	});

	it("leaves modified completion keys to native input behavior", async () => {
		const { onChoose } = renderComposer();
		const input = screen.getByRole("combobox");
		for (const init of [
			{ key: "Tab", shiftKey: true },
			{ key: "Tab", ctrlKey: true },
			{ key: "Tab", altKey: true },
			{ key: "Tab", metaKey: true },
			{ key: "ArrowRight", shiftKey: true },
		]) {
			const event = new KeyboardEvent("keydown", { ...init, cancelable: true });
			input.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(false);
		}
		expect(onChoose).not.toHaveBeenCalled();
	});

	it("uses Tab to bind a ghost for the active token within a longer sentence", async () => {
		const onChoose = vi.fn();
		render(ShellComposer, {
			buffer: emptyShellBuffer('/inspect @"Loc'),
			candidates: [chest],
			completionRange: { start: "/inspect ".length, end: '/inspect @"Loc'.length },
			onTextChange: vi.fn(),
			onChoose,
			onAttempt: vi.fn(),
		});
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "Tab" });
		expect(onChoose).toHaveBeenCalledWith(chest);
	});

	it("inserts the sole matching target even with a non-literal spelling", async () => {
		const onChoose = vi.fn();
		render(ShellComposer, {
			buffer: emptyShellBuffer("/inspect @Loc"),
			candidates: [chest],
			completionRange: { start: "/inspect ".length, end: "/inspect @Loc".length },
			onTextChange: vi.fn(),
			onChoose,
			onAttempt: vi.fn(),
		});
		const native = await fireEvent.keyDown(screen.getByRole("combobox"), { key: "Tab" });
		expect(native).toBe(false);
		expect(onChoose).toHaveBeenCalledWith(chest);
	});

	it("aligns ghost, preview, and Tab insertion with the selected fuzzy row", async () => {
		const investigate: ShellFinderCandidate = {
			...inspect,
			id: "investigate",
			text: "/investigate",
			label: "Investigate",
			preview: "Study a fact more closely.",
		};
		const onChoose = vi.fn();
		render(ShellComposer, {
			buffer: emptyShellBuffer("/in"),
			completionRange: { start: 0, end: 3 },
			candidates: [inspect, investigate],
			onTextChange: vi.fn(),
			onChoose,
			onAttempt: vi.fn(),
		});
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "Tab" });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		expect(screen.getByRole("combobox").getAttribute("aria-activedescendant")).toBe(
			"play-shell-option-investigate",
		);
		expect(screen.getByText("Study a fact more closely.")).toBeTruthy();
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "Tab" });
		expect(onChoose).toHaveBeenCalledWith(investigate);
	});

	it("renders and accepts a ghost at its active token rather than the end of trailing payload", async () => {
		const onChoose = vi.fn();
		render(ShellComposer, {
			buffer: emptyShellBuffer('/in "keep this payload"'),
			completionRange: { start: 0, end: 3 },
			activeToken: "/in",
			candidates: [inspect],
			onTextChange: vi.fn(),
			onChoose,
			onAttempt: vi.fn(),
		});
		expect(document.querySelector(".shell-composer__mirror")?.textContent).toBe(
			'›/inspect "keep this payload"',
		);
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "Tab" });
		expect(onChoose).toHaveBeenCalledWith(inspect);
	});

	it("uses Right only to accept a visible ghost at a collapsed token end", async () => {
		const { onChoose } = renderComposer();
		const input = screen.getByRole<HTMLInputElement>("combobox");
		input.setSelectionRange(3, 3);
		await fireEvent.keyDown(input, { key: "ArrowRight" });
		expect(onChoose).toHaveBeenCalledWith(inspect);

		const onChooseWithCaretInside = vi.fn();
		render(ShellComposer, {
			buffer: emptyShellBuffer("/in"),
			completionRange: { start: 0, end: 3 },
			candidates: [inspect],
			onTextChange: vi.fn(),
			onChoose: onChooseWithCaretInside,
			onAttempt: vi.fn(),
		});
		const secondInput = screen.getAllByRole<HTMLInputElement>("combobox")[1];
		if (secondInput === undefined) throw new Error("fixture needs a second shell input");
		secondInput.setSelectionRange(1, 1);
		const event = new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true });
		secondInput.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);
		expect(onChooseWithCaretInside).not.toHaveBeenCalled();
	});

	it("keeps IME composition out of finder commands and forwards committed text", async () => {
		const { onChoose, onTextChange } = renderComposer();
		const input = screen.getByRole("combobox");
		await fireEvent.keyDown(input, { key: "Enter", isComposing: true });
		expect(onChoose).not.toHaveBeenCalled();
		await fireEvent.input(input, { target: { value: '/speak "こんにちは' } });
		expect(onTextChange).toHaveBeenCalledWith('/speak "こんにちは');
	});

	it("renders completable grammar distinctly from bound facts and free payload", () => {
		renderComposer(emptyShellBuffer('/inspect "look" stray'));
		expect(document.querySelector('[data-role="syntax-action"]')?.textContent).toBe("/inspect");
		expect(document.querySelector('[data-role="payload"]')?.textContent).toBe('"look"');
		expect(document.querySelector('.shell-composer__mirror [data-role="muted"]')?.textContent).toBe(
			"stray",
		);
	});

	it("marks a manually typed but completable target as syntax, not as an executable fact", () => {
		renderComposer(emptyShellBuffer("/inspect @Loc"));
		expect(document.querySelector('[data-role="syntax-actor"]')?.textContent).toBe("@Loc");
	});

	it("renders an unbound prompt response as repairable prompt syntax", () => {
		render(ShellComposer, {
			buffer: emptyShellBuffer("/barbarian"),
			candidates: [barbarianReply],
			onTextChange: vi.fn(),
			onChoose: vi.fn(),
			onAttempt: vi.fn(),
		});
		expect(document.querySelector('[data-role="syntax-action"]')?.textContent).toBe("/barbarian");
	});

	it("colours a bound prompt response as a semantic prompt token", () => {
		render(ShellComposer, {
			buffer: {
				text: "/barbarian",
				bindings: [
					{
						start: 0,
						end: "/barbarian".length,
						text: "/barbarian",
						kind: "action",
						canonical: barbarianReply.canonical,
						semanticContext: barbarianReply.semanticContext,
					},
				],
			},
			candidates: [barbarianReply],
			onTextChange: vi.fn(),
			onChoose: vi.fn(),
			onAttempt: vi.fn(),
		});
		expect(document.querySelector('[data-role="prompt"]')?.textContent).toBe("/barbarian");
	});

	it("keeps the active finder option in view while keyboard browsing", async () => {
		const scrollIntoView = vi.fn();
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: scrollIntoView,
		});
		renderComposer(emptyShellBuffer("/"));
		scrollIntoView.mockClear();
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "Tab" });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
	});

	it("keeps the error role on an unresolved fact after the caret leaves that token", () => {
		render(ShellComposer, {
			buffer: emptyShellBuffer('/unknown @"Locked chest"'),
			candidates: [chest],
			unresolvedTokenRanges: [{ start: 0, end: "/unknown".length }],
			onTextChange: vi.fn(),
			onChoose: vi.fn(),
			onAttempt: vi.fn(),
		});
		expect(document.querySelector('[data-role="error"]')?.textContent).toBe("/unknown");
	});

	it("describes a disabled attempt from the same owner-derived blocker", () => {
		render(ShellComposer, {
			buffer: emptyShellBuffer("/unknown"),
			attemptDisabled: true,
			attemptBlock: {
				message: "No observed action matches this text. Edit it or choose a suggestion.",
				invalid: true,
			},
			onTextChange: vi.fn(),
			onChoose: vi.fn(),
			onAttempt: vi.fn(),
		});
		const input = screen.getByRole("combobox");
		expect(input.getAttribute("aria-invalid")).toBe("true");
		expect(document.getElementById("play-shell-status")?.textContent).toContain(
			"No observed action matches",
		);
		expect((screen.getByRole("button", { name: "Attempt" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	});

	it("names the blocker when Enter meets a blocked draft after an earlier outcome", async () => {
		const onAttempt = vi.fn();
		render(ShellComposer, {
			buffer: emptyShellBuffer("/name-your-character"),
			attemptDisabled: true,
			attemptBlock: {
				message:
					"Name Your Character: who or what? Type @ for someone here, # for a place or thing.",
				invalid: false,
			},
			outcome: { kind: "accepted", text: "Nothing you notice changes." },
			onTextChange: vi.fn(),
			onChoose: vi.fn(),
			onAttempt,
		});
		const status = () => document.getElementById("play-shell-status")?.textContent;
		expect(status()).toContain("Nothing you notice changes.");
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
		expect(onAttempt).not.toHaveBeenCalled();
		expect(status()).toContain("Name Your Character: who or what?");
		expect(status()).not.toContain("Nothing you notice changes.");
	});

	it("keeps the syntax mirror on the native input's horizontal scroll segment", async () => {
		renderComposer(emptyShellBuffer(`/inspect @"${"A very long observed target ".repeat(8)}"`));
		const input = screen.getByRole<HTMLInputElement>("combobox");
		input.scrollLeft = 72;
		await fireEvent.scroll(input);
		expect(document.querySelector<HTMLElement>(".shell-composer__mirror")?.scrollLeft).toBe(72);
	});

	it("labels finder groups in player words, not internal source names", async () => {
		renderComposer();
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		const option = screen.getByRole("option", { name: /Inspect/ });
		expect(option.querySelector(".shell-composer__candidate-source")?.textContent).toBe("Do");
		expect(screen.queryByText("actions")).toBeNull();
	});

	it("shows no filler sentence in the preview of a candidate without prose", async () => {
		render(ShellComposer, {
			buffer: emptyShellBuffer("/"),
			candidates: [{ ...chest, detail: undefined }],
			onTextChange: vi.fn(),
			onChoose: vi.fn(),
			onAttempt: vi.fn(),
		});
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		expect(document.querySelector(".shell-composer__preview p")).toBeNull();
		expect(screen.queryByText(/Pick a suggestion/)).toBeNull();
	});

	it.each([
		["rejected", "Refused — your words are kept, so you can change them and try again.", "error"],
		[
			"unobserved",
			"Result unknown — your words are kept; look around before you try again.",
			"stale",
		],
		["blocked", "Not sent — your words are kept.", "error"],
	] as const)("names the %s state after the outcome text", (kind, phrase, tone) => {
		render(ShellComposer, {
			buffer: emptyShellBuffer("/inspect"),
			outcome: { kind, text: "The door is locked." },
			onTextChange: vi.fn(),
			onChoose: vi.fn(),
			onAttempt: vi.fn(),
		});
		const status = document.getElementById("play-shell-status");
		expect(status?.textContent).toContain(`The door is locked. ${phrase}`);
		expect(status?.getAttribute("data-role")).toBe(tone);
	});

	it("shows the plain idle hint and waiting line without composer jargon", async () => {
		const view = render(ShellComposer, {
			buffer: emptyShellBuffer(),
			onTextChange: vi.fn(),
			onChoose: vi.fn(),
			onAttempt: vi.fn(),
		});
		const status = () => document.getElementById("play-shell-status")?.textContent ?? "";
		expect(status()).toContain(
			"Type / to do something, @ for someone here, or # for a place or thing. Tab picks, Enter sends.",
		);
		await view.rerender({ submitting: true });
		expect(status()).toContain("Sent. Waiting for the world to answer.");
		expect(status()).not.toMatch(/receipt|fact|draft/i);
	});

	it("returns focus to the input when an attempt settles and nothing else took it", async () => {
		const props = {
			buffer: emptyShellBuffer("/inspect"),
			onTextChange: vi.fn(),
			onChoose: vi.fn(),
			onAttempt: vi.fn(),
		};
		const view = render(ShellComposer, props);
		const input = screen.getByRole("combobox") as HTMLInputElement;
		// A browser moves focus to the body when the focused control becomes
		// disabled. jsdom does not, so the blur stands in for it.
		input.blur();
		await view.rerender({ ...props, disabled: true });
		expect(document.activeElement).toBe(document.body);
		await view.rerender({ ...props, disabled: false });
		await vi.waitFor(() => expect(document.activeElement).toBe(input));
	});

	it("leaves focus alone when another control took it while an attempt ran", async () => {
		const props = {
			buffer: emptyShellBuffer("/inspect"),
			onTextChange: vi.fn(),
			onChoose: vi.fn(),
			onAttempt: vi.fn(),
		};
		const view = render(ShellComposer, props);
		const other = document.createElement("button");
		document.body.append(other);
		await view.rerender({ ...props, disabled: true });
		other.focus();
		await view.rerender({ ...props, disabled: false });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(document.activeElement).toBe(other);
		other.remove();
	});

	it("shows one key legend per state and never changes a key", async () => {
		render(ShellComposer, {
			buffer: emptyShellBuffer("/in"),
			candidates: [inspect, chest],
			completionRange: { start: 0, end: 3 },
			attemptDisabled: true,
			attemptBlock: { message: "not picked", invalid: false },
			onTextChange: vi.fn(),
			onChoose: vi.fn(),
			onAttempt: vi.fn(),
		});
		const legend = () => document.querySelector('[data-testid="dock-help-line"] span')?.textContent;
		expect(legend()).toBe("Tab pick · → take grey text · ↑/↓ browse");
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		expect(legend()).toBe("↑/↓ move · Enter or Tab put it in · Esc close");
		const footer = document.querySelector(".shell-composer__keys")?.textContent ?? "";
		expect(footer.startsWith("Picking does not send.")).toBe(true);
		expect(footer).toContain("↑/↓ move · Enter or Tab put it in · Esc close");
	});

	it("names rebound keys in the legend", () => {
		render(ShellComposer, {
			buffer: emptyShellBuffer("/inspect"),
			keymap: { ...DEFAULT_KEYMAP, "shell.attempt": ["Ctrl+Enter"] },
			onTextChange: vi.fn(),
			onChoose: vi.fn(),
			onAttempt: vi.fn(),
		});
		expect(document.querySelector('[data-testid="dock-help-line"] span')?.textContent).toBe(
			"Ctrl+Enter send · Tab more choices",
		);
	});

	it("puts the caret where a focus request asks and reports that selection", async () => {
		const onSelectionChange = vi.fn();
		const buffer = emptyShellBuffer('/name @"Aldwin" name:""');
		const view = render(ShellComposer, {
			buffer,
			onTextChange: vi.fn(),
			onSelectionChange,
			onChoose: vi.fn(),
			onAttempt: vi.fn(),
		});
		const input = screen.getByRole<HTMLInputElement>("combobox");
		const caret = buffer.text.length - 1;
		await view.rerender({ focusToken: 1, focusCaret: caret });
		await waitFor(() => expect(input.selectionStart).toBe(caret));
		expect(input.selectionEnd).toBe(caret);
		expect(document.activeElement).toBe(input);
		expect(onSelectionChange).toHaveBeenLastCalledWith({ start: caret, end: caret });

		// Without a caret the request keeps today's behaviour: the end.
		await view.rerender({ focusToken: 2, focusCaret: undefined });
		await waitFor(() => expect(input.selectionStart).toBe(buffer.text.length));
	});

	it("draws grey text between empty quotes without changing the input", async () => {
		const text = '/name name:""';
		const view = render(ShellComposer, {
			buffer: emptyShellBuffer(text),
			completionRange: { start: text.length, end: text.length },
			activeToken: "",
			emptyQuoteHints: [{ start: text.length - 1, text: "Your character's name" }],
			onTextChange: vi.fn(),
			onChoose: vi.fn(),
			onAttempt: vi.fn(),
		});
		expect(document.querySelector('[data-role="suggestion"]')?.textContent).toBe(
			"Your character's name",
		);
		expect(document.querySelector(".shell-composer__mirror")?.textContent).toBe(
			'›/name name:"Your character\'s name"',
		);
		expect(screen.getByRole<HTMLInputElement>("combobox").value).toBe(text);

		// The owner drops the hint with the first character; the closing quote stays.
		await view.rerender({ buffer: emptyShellBuffer('/name name:"B"'), emptyQuoteHints: [] });
		expect(document.querySelector('[data-role="suggestion"]')).toBeNull();
		expect(document.querySelector(".shell-composer__mirror")?.textContent).toBe('›/name name:"B"');
	});

	it("never accepts an invisible ghost after a space", async () => {
		const onChoose = vi.fn();
		const text = "/inspect ";
		render(ShellComposer, {
			buffer: emptyShellBuffer(text),
			completionRange: { start: text.length, end: text.length },
			activeToken: "",
			candidates: [chest, inspect],
			onTextChange: vi.fn(),
			onChoose,
			onAttempt: vi.fn(),
		});
		expect(document.querySelector('[data-role="suggestion"]')).toBeNull();
		const input = screen.getByRole<HTMLInputElement>("combobox");
		input.setSelectionRange(text.length, text.length);
		const event = new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true });
		input.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);
		expect(onChoose).not.toHaveBeenCalled();
	});

	it("ghosts a detail field after a space and accepts it with Right", async () => {
		const onChoose = vi.fn();
		const text = '/name @"Aldwin" ';
		const nameField: ShellFinderCandidate = {
			id: "field:name",
			text: 'name:""',
			kind: "field",
			canonical: "name",
			label: "Name",
			detail: "needed",
			source: "fields",
		};
		render(ShellComposer, {
			buffer: emptyShellBuffer(text),
			completionRange: { start: text.length, end: text.length },
			activeToken: "",
			candidates: [nameField, inspect],
			onTextChange: vi.fn(),
			onChoose,
			onAttempt: vi.fn(),
		});
		expect(document.querySelector('[data-role="suggestion"]')?.textContent).toBe('name:""');
		expect(document.querySelector(".shell-composer__mirror")?.textContent).toBe(
			'›/name @"Aldwin" name:""',
		);
		const input = screen.getByRole<HTMLInputElement>("combobox");
		input.setSelectionRange(text.length, text.length);
		await fireEvent.keyDown(input, { key: "ArrowRight" });
		expect(onChoose).toHaveBeenCalledWith(nameField);
	});

	it("shows an owner notice ahead of a blocker and drops it when the owner does", async () => {
		const view = render(ShellComposer, {
			buffer: emptyShellBuffer("/speak hello"),
			attemptDisabled: true,
			attemptBlock: { message: "Blocked for now.", invalid: false },
			notice: "You have unsent words in the box.",
			onTextChange: vi.fn(),
			onChoose: vi.fn(),
			onAttempt: vi.fn(),
		});
		const status = () => document.getElementById("play-shell-status")?.textContent ?? "";
		expect(status()).toContain("You have unsent words in the box.");
		await view.rerender({ notice: undefined });
		expect(status()).toContain("Blocked for now.");
	});

	it("follows the owner's legend state and names no picking key for a value", async () => {
		const base = {
			buffer: emptyShellBuffer('/speak "hello"'),
			candidates: [inspect, chest],
			onTextChange: vi.fn(),
			onChoose: vi.fn(),
			onAttempt: vi.fn(),
		};
		const view = render(ShellComposer, { ...base, legend: "value" as const });
		const legend = () => document.querySelector('[data-testid="dock-help-line"] span')?.textContent;
		expect(legend()).toBe("Enter send");
		await view.rerender({
			...base,
			legend: "write" as const,
			attemptDisabled: true,
			attemptBlock: { message: "Put what you say in quotes.", invalid: false },
		});
		expect(legend()).toBe("↑/↓ browse");
		// Blocked with the caret inside a value: no key is named at all.
		await view.rerender({
			...base,
			legend: "none" as const,
			attemptDisabled: true,
			attemptBlock: { message: "Speak to: who or what?", invalid: false },
		});
		expect(legend()).toBe("");
		expect(document.getElementById("play-shell-status")?.textContent).toContain(
			"Speak to: who or what?",
		);
	});

	it("tells the owner when Enter was stopped", async () => {
		const onAttemptBlocked = vi.fn();
		const onAttempt = vi.fn();
		render(ShellComposer, {
			buffer: emptyShellBuffer("/speak hello"),
			attemptDisabled: true,
			attemptBlock: { message: "Blocked for now.", invalid: false },
			onAttemptBlocked,
			onTextChange: vi.fn(),
			onChoose: vi.fn(),
			onAttempt,
		});
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
		expect(onAttemptBlocked).toHaveBeenCalledOnce();
		expect(onAttempt).not.toHaveBeenCalled();
	});

	it("drops the last outcome when text arrives from outside, and keeps it when the box is cleared", async () => {
		const props = {
			buffer: emptyShellBuffer("/inspect"),
			outcome: { kind: "accepted" as const, text: "Nothing you notice changes." },
			onTextChange: vi.fn(),
			onChoose: vi.fn(),
			onAttempt: vi.fn(),
		};
		const view = render(ShellComposer, props);
		const status = () => document.getElementById("play-shell-status")?.textContent ?? "";
		expect(status()).toContain("Nothing you notice changes.");
		await view.rerender({ ...props, buffer: emptyShellBuffer("") });
		expect(status()).toContain("Nothing you notice changes.");
		await view.rerender({ ...props, buffer: emptyShellBuffer("/go-stairs") });
		expect(status()).not.toContain("Nothing you notice changes.");
	});
	describe("inside a written value (sk-jay0.1.8.109)", () => {
		const cases = [
			{
				name: "a detail in quotes",
				text: '/name @"Aldwin" name:"Loc"',
				start: '/name @"Aldwin" '.length,
			},
			{ name: "spoken words", text: '/speak "Loc"', start: "/speak ".length },
			{ name: "a number detail", text: "/set count:4", start: "/set ".length },
		];
		for (const { name, text, start } of cases) {
			it(`never lets a completion key replace ${name}`, async () => {
				const onChoose = vi.fn();
				const onTextChange = vi.fn();
				const onFinderOpen = vi.fn();
				render(ShellComposer, {
					buffer: emptyShellBuffer(text),
					candidates: [chest],
					activeToken: text.slice(start),
					completionRange: { start, end: text.length },
					onTextChange,
					onChoose,
					onFinderOpen,
					onAttempt: vi.fn(),
				});
				const input = screen.getByRole<HTMLInputElement>("combobox");
				input.focus();
				// Tab picks nothing and stays native: the browser moves focus on.
				expect(await fireEvent.keyDown(input, { key: "Tab" })).toBe(true);
				await fireEvent.keyDown(input, { key: "ArrowDown" });
				expect(screen.queryByTestId("shell-finder")).toBeNull();
				await fireEvent.keyDown(input, { key: "ArrowRight" });
				expect(onChoose).not.toHaveBeenCalled();
				expect(onTextChange).not.toHaveBeenCalled();
				expect(onFinderOpen).not.toHaveBeenCalled();
				expect(input.value).toBe(text);
			});
		}

		it("leaves Tab native when nothing matches the value", async () => {
			const text = '/speak ""';
			render(ShellComposer, {
				buffer: emptyShellBuffer(text),
				candidates: [],
				completionRange: { start: "/speak ".length, end: text.length },
				onTextChange: vi.fn(),
				onChoose: vi.fn(),
				onAttempt: vi.fn(),
			});
			expect(await fireEvent.keyDown(screen.getByRole("combobox"), { key: "Tab" })).toBe(true);
		});

		it("reports the close when a focus request closes the open list", async () => {
			const onFinderClose = vi.fn();
			const props = {
				buffer: emptyShellBuffer(""),
				candidates: [chest],
				onTextChange: vi.fn(),
				onChoose: vi.fn(),
				onAttempt: vi.fn(),
				onFinderClose,
			};
			const view = render(ShellComposer, props);
			await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
			expect(screen.queryByTestId("shell-finder")).not.toBeNull();
			expect(onFinderClose).not.toHaveBeenCalled();
			await view.rerender({ ...props, focusToken: 1 });
			expect(screen.queryByTestId("shell-finder")).toBeNull();
			expect(onFinderClose).toHaveBeenCalledTimes(1);
		});

		it("leaves Shift+Tab to the browser, so the keyboard can still leave the box", () => {
			const text = '/speak "hello"';
			render(ShellComposer, {
				buffer: emptyShellBuffer(text),
				candidates: [chest],
				completionRange: { start: "/speak ".length, end: text.length },
				onTextChange: vi.fn(),
				onChoose: vi.fn(),
				onAttempt: vi.fn(),
			});
			const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, cancelable: true });
			screen.getByRole("combobox").dispatchEvent(event);
			expect(event.defaultPrevented).toBe(false);
		});

		it("still completes a quoted name, which is a pick and not a value", async () => {
			const onChoose = vi.fn();
			const text = '/inspect @"Loc"';
			render(ShellComposer, {
				buffer: emptyShellBuffer(text),
				candidates: [chest],
				completionRange: { start: "/inspect ".length, end: text.length },
				onTextChange: vi.fn(),
				onChoose,
				onAttempt: vi.fn(),
			});
			await fireEvent.keyDown(screen.getByRole("combobox"), { key: "Tab" });
			expect(onChoose).toHaveBeenCalledWith(chest);
		});
	});
});
