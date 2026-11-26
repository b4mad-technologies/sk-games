import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { Answer, Round } from "./model";
import TalkPanel from "./TalkPanel.svelte";

// The talk panel alone: how the answers are laid out for what they carry.
function shown(answers: Answer[]) {
	const round: Round = {
		id: "round",
		speakerId: "keeper",
		speakerName: "The keeper",
		question: "Which one?",
		answers,
		freeSpeech: false,
		outline: [{ id: "0", label: "Class", current: true }],
	};
	const noop = () => {};
	render(TalkPanel, {
		props: {
			round,
			busy: false,
			onanswer: noop,
			onsay: noop,
			onback: noop,
			onforward: noop,
			onleave: noop,
		},
	});
	return screen.getByRole("list");
}

const answer = (index: number, extra: Partial<Answer> = {}): Answer => ({
	id: `a${index}`,
	label: `Answer ${index}`,
	...extra,
});

describe("the talk panel's answers", () => {
	it("puts the text and the link on the card when a handful of answers say what they are", () => {
		const list = shown([
			answer(1, {
				blurb: "Meets danger head-on.",
				href: "https://docs.example/one",
				ref: "srd/one",
			}),
			answer(2),
		]);
		expect(list.dataset.shape).toBe("tall");
		expect(screen.getByRole("button", { name: /Answer 1/ }).textContent).toContain(
			"Meets danger head-on.",
		);
		expect(screen.getByRole("link", { name: "Read more" }).getAttribute("href")).toBe(
			"https://docs.example/one",
		);
		// Nothing has to be pointed at: the line for the pointed-at answer is gone.
		expect(screen.queryByText(/Point at an answer/)).toBeNull();
	});

	it("keeps a crowd as small cards with one line for the answer pointed at", () => {
		const list = shown(
			Array.from({ length: 8 }, (_, index) => answer(index, { blurb: `Text ${index}.` })),
		);
		expect(list.dataset.shape).toBe("cards");
		expect(screen.getByText(/Point at an answer/)).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Read more" })).toBeNull();
	});
});

describe("the talk panel's numbers", () => {
	it("sets each number by clicks within its bounds and hands them over by name", async () => {
		const onfill = vi.fn();
		const noop = () => {};
		const round: Round = {
			id: "scores",
			speakerId: "keeper",
			speakerName: "The keeper",
			question: "Which scores?",
			answers: [answer(1)],
			freeSpeech: false,
			outline: [{ id: "0", label: "Ability scores", current: true }],
			numbers: {
				title: "Set ability scores",
				submit: "Propose ability scores",
				fields: [
					{ name: "str", label: "Strength", min: 8, max: 15 },
					{ name: "dex", label: "Dexterity", min: 8, max: 15 },
				],
			},
		};
		render(TalkPanel, {
			props: {
				round,
				busy: false,
				onanswer: noop,
				onsay: noop,
				onfill,
				onback: noop,
				onforward: noop,
				onleave: noop,
			},
		});
		// At its least a number cannot go down.
		expect(screen.getByRole("button", { name: "Strength down" })).toHaveProperty("disabled", true);
		for (let click = 0; click < 9; click++)
			await fireEvent.click(screen.getByRole("button", { name: "Strength up" }));
		expect(screen.getByRole("status", { name: "Strength" }).textContent).toBe("15");
		expect(screen.getByRole("button", { name: "Strength up" })).toHaveProperty("disabled", true);
		expect(screen.getByText("9 of 27 points spent")).toBeTruthy();
		await fireEvent.click(screen.getByRole("button", { name: "Propose ability scores" }));
		expect(onfill).toHaveBeenCalledWith({ str: 15, dex: 8 });
	});
});

describe("starting a guided talk over", () => {
	it("asks once more before it throws the answers away", async () => {
		const onrestart = vi.fn();
		const noop = () => {};
		const round: Round = {
			id: "round",
			speakerId: "keeper",
			speakerName: "The keeper",
			question: "Which one?",
			answers: [answer(1)],
			freeSpeech: false,
			outline: [{ id: "0", label: "Class", value: "Fighter", current: false }],
			canRestart: true,
		};
		render(TalkPanel, {
			props: {
				round,
				busy: false,
				onanswer: noop,
				onsay: noop,
				onback: noop,
				onforward: noop,
				onrestart,
				onleave: noop,
			},
		});
		await fireEvent.click(screen.getByRole("button", { name: "Start over" }));
		expect(onrestart).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole("button", { name: "Really start over?" }));
		expect(onrestart).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("button", { name: "Start over" })).toBeTruthy();
	});
});
