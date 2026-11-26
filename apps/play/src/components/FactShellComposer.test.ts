import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import FactShellComposer from "./FactShellComposer.svelte";

vi.mock("../lib/reference-adapter", () => ({
	readDefinitionCard: vi.fn(async (ref: string) =>
		ref === "exact/definition"
			? { title: "Exact", description: "Exact authored description" }
			: null,
	),
}));

const actions = [
	{
		id: "inspect",
		label: "Inspect",
		value: {
			actionId: "srd/inspect",
			displayName: "Inspect",
			tags: [],
			selfOnly: false,
			selfEligible: false,
		},
	},
];
const targets = [
	{
		id: "chest",
		label: "Locked chest",
		value: {
			targetFactId: "chest",
			targetRef: "entity:chest",
			targetName: "Locked chest",
			tags: [],
		},
	},
];

describe("FactShellComposer", () => {
	it("asks for a target in player words and names the chosen action", () => {
		render(FactShellComposer, {
			draft: {
				actionId: "srd/inspect",
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "target",
			},
			actions,
			targets,
			revision: 1,
			onAttempt: vi.fn(),
		});
		const status = document.getElementById("play-shell-status")?.textContent ?? "";
		expect(status).toContain(
			"Inspect: who or what? Type @ for someone here, # for a place or thing.",
		);
		expect(status).not.toMatch(/fact|draft|target with/i);
	});

	it("asks for an action in player words when nothing is chosen", () => {
		render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions,
			targets,
			revision: 1,
			onAttempt: vi.fn(),
		});
		expect(document.getElementById("play-shell-status")?.textContent).toContain(
			"What do you do? Type / and press Tab to pick, then Enter to send.",
		);
	});

	it("never ghosts or lists a raw target reference as a finder label", async () => {
		render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions,
			targets: [
				{
					id: "self",
					label: "entity:168",
					value: {
						targetFactId: "self",
						targetRef: "entity:168",
						targetName: "entity:168",
						tags: [],
					},
				},
			],
			revision: 1,
			onAttempt: vi.fn(),
		});
		await fireEvent.input(screen.getByRole("combobox"), { target: { value: "@" } });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		expect(screen.queryByText(/entity:168/)).toBeNull();
	});

	it("inserts an explicit detail action and bound target without dispatch", async () => {
		const onAttempt = vi.fn();
		const onExecutableChange = vi.fn();
		const { rerender } = render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions,
			targets,
			revision: 1,
			onAttempt,
			onExecutableChange,
		});
		await rerender({ insertion: { token: 1, actionId: "srd/inspect", targetRef: "entity:chest" } });
		const input = screen.getByRole<HTMLInputElement>("combobox");
		expect(input.value).toBe('/inspect @"Locked chest"');
		expect(document.activeElement).toBe(input);
		expect(onAttempt).not.toHaveBeenCalled();
		expect(onExecutableChange).toHaveBeenLastCalledWith(
			expect.objectContaining({ actionId: "srd/inspect", targetRef: "entity:chest" }),
		);
		await rerender({
			draft: {
				actionId: "srd/inspect",
				targetRef: "entity:chest",
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
		});
		await fireEvent.keyDown(input, { key: "Enter" });
		expect(onAttempt).toHaveBeenCalledOnce();
	});

	it("marks an unobserved typed action as unresolved and explains why Attempt is disabled", async () => {
		render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions,
			targets,
			revision: 1,
			onAttempt: vi.fn(),
		});
		await fireEvent.input(screen.getByRole("combobox"), { target: { value: "/imaginary" } });
		expect(document.querySelector('[data-role="error"]')?.textContent).toBe("/imaginary");
		expect(document.getElementById("play-shell-status")?.textContent).toContain(
			"No observed action matches",
		);
		expect((screen.getByRole("button", { name: "Attempt" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	});

	it("binds independently disclosed action and target facts before explicit attempt", async () => {
		const onChooseAction = vi.fn();
		const onChooseTarget = vi.fn();
		const onAttempt = vi.fn();
		render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions,
			targets,
			revision: 1,
			onChooseAction,
			onChooseTarget,
			onAttempt,
		});
		await fireEvent.input(screen.getByRole("combobox"), { target: { value: "/" } });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		await fireEvent.click(screen.getByRole("option", { name: /Inspect/ }));
		expect(onChooseAction).toHaveBeenCalledWith("srd/inspect");
		const input = screen.getByRole("combobox");
		await fireEvent.input(input, { target: { value: "/srd/inspect @locked" } });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		await fireEvent.click(screen.getByRole("option", { name: /Locked chest/ }));
		expect(onChooseTarget).toHaveBeenCalledWith("entity:chest");
		expect(onAttempt).not.toHaveBeenCalled();
	});

	it("shows an authored action description in the finder preview while retaining its factual cue", async () => {
		const inspect = actions[0];
		if (inspect === undefined) throw new Error("fixture needs inspect");
		render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions: [{ ...inspect, value: { ...inspect.value, description: "Study visible details." } }],
			targets,
			revision: 1,
			onAttempt: vi.fn(),
		});
		await fireEvent.input(screen.getByRole("combobox"), { target: { value: "/" } });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		expect(screen.getByText("Study visible details.")).toBeTruthy();
		// No authored reason: the row carries no invented filler line.
		expect(screen.queryByText("Observed action syntax.")).toBeNull();
		expect(screen.getByRole("option", { name: /Inspect/ }).querySelector("small")).toBeNull();
	});

	it("uses an author-published default only after the player binds its action", async () => {
		const onExecutableChange = vi.fn();
		const inspect = actions[0];
		if (inspect === undefined) throw new Error("fixture needs inspect");
		render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions: [
				{
					...inspect,
					value: {
						...inspect.value,
						defaults: {
							target: { targetRef: "entity:chest", kind: "reference" as const },
							provenance: {
								namespace: "ui.affordance_defaults",
								templateId: "demo",
								attachmentId: "1",
								contentKey: "1",
							},
						},
					},
				},
			],
			targets,
			revision: 1,
			onExecutableChange,
			onAttempt: vi.fn(),
		});
		await fireEvent.input(screen.getByRole("combobox"), { target: { value: "/" } });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		await fireEvent.click(screen.getByRole("option", { name: /Inspect/ }));
		expect(onExecutableChange).toHaveBeenLastCalledWith({
			actionId: "srd/inspect",
			targetRef: "entity:chest",
		});
		expect(screen.getByText('Suggested: @"Locked chest"')).toBeTruthy();
	});

	it("renders effective authored target and field defaults without rewriting the sentence", async () => {
		const inspect = actions[0];
		if (inspect === undefined) throw new Error("fixture needs inspect");
		render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions: [
				{
					...inspect,
					value: {
						...inspect.value,
						defaults: {
							target: { targetRef: "entity:chest", kind: "reference" as const },
							inputValues: { count: 2, note: "carefully" },
							provenance: {
								namespace: "ui.affordance_defaults",
								templateId: "demo",
								attachmentId: "1",
								contentKey: "1",
							},
						},
					},
				},
			],
			targets,
			revision: 1,
			onAttempt: vi.fn(),
		});
		await fireEvent.input(screen.getByRole("combobox"), { target: { value: "/" } });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		await fireEvent.click(screen.getByRole("option", { name: /Inspect/ }));
		expect(screen.getByRole<HTMLInputElement>("combobox").value).toBe("/inspect");
		expect(
			screen.getByText('Suggested: @"Locked chest" · count:2 · note:"carefully"'),
		).toBeTruthy();
	});

	it("never silently replaces a bound author default after its provenance changes", async () => {
		const inspect = actions[0];
		if (inspect === undefined) throw new Error("fixture needs inspect");
		const withDefault = {
			...inspect,
			value: {
				...inspect.value,
				defaults: {
					target: { targetRef: "entity:chest", kind: "reference" as const },
					provenance: {
						namespace: "ui.affordance_defaults",
						templateId: "demo",
						attachmentId: "1",
						contentKey: "v1",
					},
				},
			},
		};
		const view = render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions: [withDefault],
			targets,
			revision: 1,
			onAttempt: vi.fn(),
		});
		await fireEvent.input(screen.getByRole("combobox"), { target: { value: "/" } });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		await fireEvent.click(screen.getByRole("option", { name: /Inspect/ }));
		const defaults = withDefault.value.defaults;
		if (defaults === undefined) throw new Error("fixture needs defaults");
		await view.rerender({
			actions: [
				{
					...withDefault,
					value: {
						...withDefault.value,
						defaults: {
							...defaults,
							provenance: { ...defaults.provenance, contentKey: "v2" },
						},
					},
				},
			],
			revision: 2,
		});
		expect(
			screen.getByText(/That suggestion has changed\. Choose what to do again\./),
		).toBeTruthy();
		expect((screen.getByRole("button", { name: "Attempt" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	});

	it("keeps the visible finder identity frozen through a fact replacement until explicit refresh", async () => {
		const strike = {
			id: "strike",
			label: "Strike",
			value: {
				actionId: "srd/strike",
				displayName: "Strike",
				tags: [],
				selfOnly: false,
				selfEligible: false,
			},
		};
		const view = render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions,
			targets,
			revision: 1,
			onChooseAction: vi.fn(),
			onChooseTarget: vi.fn(),
			onAttempt: vi.fn(),
		});
		await fireEvent.input(screen.getByRole("combobox"), { target: { value: "/" } });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		await view.rerender({ actions: [strike], revision: 2 });
		expect(screen.getByRole("option", { name: /Inspect/ })).toBeTruthy();
		expect(screen.queryByRole("option", { name: /Strike/ })).toBeNull();
		await fireEvent.click(screen.getByRole("button", { name: "Show current choices" }));
		expect(screen.queryByRole("option", { name: /Inspect/ })).toBeNull();
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		expect(screen.getByRole("option", { name: /Strike/ })).toBeTruthy();
		expect(screen.getByText(/Inspect is no longer available/).textContent).toContain(
			"Suggestions updated. Inspect is no longer available.",
		);
	});

	it("revokes executable action and prompt context when a bound token is replaced", async () => {
		const onExecutableChange = vi.fn();
		render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions,
			targets,
			prompts: [
				{
					occurrenceId: "answer-1",
					promptDefId: "dm/prompt/inspect",
					contractVersion: 1,
					sourceRef: "entity:chest",
					sourceName: "Chest",
					responseActionIds: ["srd/inspect"],
					openedAtTick: 1,
					consumed: false,
					presentation: { labels: { "srd/inspect": "Inspect now" } },
				},
			],
			revision: 1,
			onAttempt: vi.fn(),
			onExecutableChange,
		});
		await fireEvent.input(screen.getByRole("combobox"), { target: { value: "/" } });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		await fireEvent.click(screen.getByRole("option", { name: /Inspect now/ }));
		expect(onExecutableChange).toHaveBeenLastCalledWith({
			actionId: "srd/inspect",
			targetRef: "entity:chest",
			semanticContext: { source_ref: "entity:chest", occurrence_id: "answer-1" },
		});
		const input = screen.getByRole<HTMLInputElement>("combobox");
		await fireEvent.input(input, { target: { value: "plain text" } });
		expect(onExecutableChange).toHaveBeenLastCalledWith({
			actionId: null,
			targetRef: null,
		});
	});

	it("marks an occurrence-bound response non-executable when its target changes", async () => {
		const onExecutableChange = vi.fn();
		render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions,
			targets: [
				...targets,
				{
					id: "mira",
					label: "Mira",
					value: { targetFactId: "mira", targetRef: "entity:mira", targetName: "Mira", tags: [] },
				},
			],
			prompts: [
				{
					occurrenceId: "answer-1",
					promptDefId: "dm/prompt/inspect",
					contractVersion: 1,
					sourceRef: "entity:chest",
					sourceName: "Chest",
					responseActionIds: ["srd/inspect"],
					openedAtTick: 1,
					consumed: false,
					presentation: { labels: { "srd/inspect": "Inspect now" } },
				},
			],
			revision: 1,
			onAttempt: vi.fn(),
			onExecutableChange,
		});
		const input = screen.getByRole<HTMLInputElement>("combobox");
		await fireEvent.input(input, { target: { value: "/" } });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		await fireEvent.click(screen.getByRole("option", { name: /Inspect now/ }));
		await fireEvent.input(input, { target: { value: "/inspect-now @" } });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		await fireEvent.click(screen.getByRole("option", { name: /Mira/ }));
		expect(onExecutableChange).toHaveBeenLastCalledWith({
			actionId: null,
			targetRef: "entity:mira",
		});
		expect(screen.getByText(/That answer is for someone else/)).toBeTruthy();
		expect((screen.getByRole("button", { name: "Attempt" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	});

	it("binds target-first and action-first sentences to the same executable draft", async () => {
		const onExecutableChange = vi.fn();
		render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions,
			targets,
			revision: 1,
			onAttempt: vi.fn(),
			onExecutableChange,
		});
		const input = screen.getByRole<HTMLInputElement>("combobox");
		await fireEvent.input(input, { target: { value: "@locked" } });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		await fireEvent.click(screen.getByRole("option", { name: /Locked chest/ }));
		await fireEvent.input(input, { target: { value: '@"Locked chest" /' } });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		await fireEvent.click(screen.getByRole("option", { name: /^Inspect/ }));
		expect(onExecutableChange).toHaveBeenLastCalledWith({
			actionId: "srd/inspect",
			targetRef: "entity:chest",
		});
	});

	it("inserts the prompt source visibly when completing a response", async () => {
		render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions,
			targets,
			prompts: [
				{
					occurrenceId: "answer-1",
					promptDefId: "dm/prompt/inspect",
					contractVersion: 1,
					sourceRef: "entity:chest",
					sourceName: "Chest",
					responseActionIds: ["srd/inspect"],
					openedAtTick: 1,
					consumed: false,
					presentation: { labels: { "srd/inspect": "Inspect now" } },
				},
			],
			revision: 1,
			onAttempt: vi.fn(),
		});
		const input = screen.getByRole<HTMLInputElement>("combobox");
		await fireEvent.input(input, { target: { value: "/" } });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		await fireEvent.click(screen.getByRole("option", { name: /Inspect now/ }));
		expect(input.value).toBe('/inspect-now @"Locked chest"');
	});

	it("shows the selected occurrence's authored question rather than inferring one from action text", () => {
		render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: "entity:aldwin",
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions,
			targets,
			revision: 1,
			prompts: [
				{
					occurrenceId: "42",
					promptDefId: "dm/prompt/name",
					contractVersion: 1,
					sourceRef: "entity:aldwin",
					sourceName: "Aldwin",
					responseActionIds: ["srd/inspect"],
					openedAtTick: 3,
					consumed: false,
					presentation: { question: "What is your name?", labels: {} },
				},
			],
			selectedPromptId: "42",
			onChooseAction: vi.fn(),
			onChooseTarget: vi.fn(),
			onAttempt: vi.fn(),
		});
		expect(screen.getByText(/From Aldwin: What is your name/)).toBeTruthy();
	});

	it("accepts a fuzzy prompt label with Tab without exposing its canonical action id", async () => {
		const onChooseAction = vi.fn();
		const onChoosePrompt = vi.fn();
		render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions,
			targets,
			prompts: [
				{
					occurrenceId: "class",
					promptDefId: "dm/prompt/class",
					contractVersion: 1,
					sourceRef: "entity:aldwin",
					sourceName: "Aldwin",
					responseActionIds: ["srd/inspect"],
					openedAtTick: 3,
					consumed: false,
					presentation: { labels: { "srd/inspect": "Barbarian" } },
				},
			],
			revision: 1,
			onChooseAction,
			onChooseTarget: vi.fn(),
			onChoosePrompt,
			onAttempt: vi.fn(),
		});
		const input = screen.getByRole<HTMLInputElement>("combobox");
		await fireEvent.input(input, { target: { value: "/bar" } });
		await fireEvent.keyDown(input, { key: "Tab" });
		expect(input.value).toBe("/barbarian");
		expect(onChoosePrompt).toHaveBeenCalledWith("class");
		expect(onChooseAction).toHaveBeenCalledWith("srd/inspect");
	});

	it("completes only the token under a mid-sentence native caret", async () => {
		render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions,
			targets,
			revision: 1,
			onChooseAction: vi.fn(),
			onChooseTarget: vi.fn(),
			onAttempt: vi.fn(),
		});
		const input = screen.getByRole<HTMLInputElement>("combobox");
		await fireEvent.input(input, { target: { value: "/inspect @Loc payload" } });
		input.setSelectionRange(10, 10);
		await fireEvent.select(input);
		await fireEvent.keyDown(input, { key: "Tab" });
		expect(input.value).toBe('/inspect @"Locked chest" payload');
	});

	it("replaces only the native selection rather than the sentence tail", async () => {
		render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions,
			targets,
			revision: 1,
			onChooseAction: vi.fn(),
			onChooseTarget: vi.fn(),
			onAttempt: vi.fn(),
		});
		const input = screen.getByRole<HTMLInputElement>("combobox");
		await fireEvent.input(input, { target: { value: "/inspect @Loc payload" } });
		input.setSelectionRange(9, 13);
		await fireEvent.select(input);
		await fireEvent.keyDown(input, { key: "Tab" });
		expect(input.value).toBe('/inspect @"Locked chest" payload');
	});

	it("replaces a duplicate ordinary action with the occurrence-bound response", async () => {
		render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: "entity:aldwin",
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions: [
				{
					id: "yes",
					label: "Yes",
					value: {
						actionId: "dm/yes",
						displayName: "Yes",
						tags: [],
						selfOnly: false,
						selfEligible: false,
					},
				},
			],
			targets,
			prompts: [
				{
					occurrenceId: "42",
					promptDefId: "dm/prompt/yes",
					contractVersion: 1,
					sourceRef: "entity:aldwin",
					sourceName: "Aldwin",
					responseActionIds: ["dm/yes"],
					openedAtTick: 3,
					consumed: false,
					presentation: { labels: { "dm/yes": "Yes" } },
				},
			],
			revision: 1,
			onChooseAction: vi.fn(),
			onChooseTarget: vi.fn(),
			onAttempt: vi.fn(),
		});
		await fireEvent.input(screen.getByRole("combobox"), { target: { value: "/" } });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		expect(screen.getByRole("option", { name: /^Yes — answer to Aldwin/ })).toBeTruthy();
		// Prompt answers share the intent grammar but retain an occurrence-specific
		// finder identity; its duplicate ordinary row is hidden.
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		expect(screen.queryByRole("option", { name: /^Yes actions/ })).toBeNull();
	});

	it("forwards only authored field names and quoted payload as draft details", async () => {
		const onChangeDetails = vi.fn();
		const inspect = actions[0];
		if (inspect === undefined) throw new Error("fixture needs inspect");
		render(FactShellComposer, {
			draft: {
				actionId: "srd/inspect",
				targetRef: "entity:chest",
				inputValues: {},
				utterance: "",
				activePart: "details",
			},
			actions: [
				{
					...inspect,
					value: {
						...inspect.value,
						input: { fields: [{ name: "count", label: "Count", control: "number" }] },
					},
				},
			],
			targets,
			revision: 1,
			onChooseAction: vi.fn(),
			onChooseTarget: vi.fn(),
			onAttempt: vi.fn(),
			onChangeDetails,
		});
		await fireEvent.input(screen.getByRole("combobox"), {
			target: { value: '/srd/inspect #"Locked chest" count:2 unknown:drop "look closely"' },
		});
		expect(onChangeDetails).toHaveBeenLastCalledWith({
			inputValues: { count: 2 },
			utterance: "look closely",
		});
	});

	it("keeps room speech as a quoted payload, not a client-invented target field", async () => {
		const onChangeDetails = vi.fn();
		render(FactShellComposer, {
			draft: {
				actionId: "srd/speak-room",
				targetRef: "place_node:limbo",
				inputValues: {},
				utterance: "",
				activePart: "details",
			},
			actions: [
				{
					id: "speak-room",
					label: "Speak",
					value: {
						actionId: "srd/speak-room",
						displayName: "Speak",
						tags: [],
						selfOnly: false,
						selfEligible: false,
						acceptsUtterance: true,
					},
				},
			],
			targets,
			revision: 1,
			onChooseAction: vi.fn(),
			onChooseTarget: vi.fn(),
			onAttempt: vi.fn(),
			onChangeDetails,
		});
		await fireEvent.input(screen.getByRole("combobox"), {
			target: { value: '/srd/speak-room "Welcome, everyone."' },
		});
		expect(onChangeDetails).toHaveBeenLastCalledWith({
			inputValues: {},
			utterance: "Welcome, everyone.",
		});
	});

	it("holds a disclosed sensing query until explicit Attempt", async () => {
		const onAttemptSense = vi.fn();
		render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions,
			targets,
			senseActions: [
				{
					id: "sense:look:local",
					label: "Look around",
					descriptor: "look",
					verb: "sensing",
					targetName: "",
					targetRef: "",
					acceptsUtterance: false,
					senseVisibility: "Local",
				},
			],
			revision: 1,
			onChooseAction: vi.fn(),
			onChooseTarget: vi.fn(),
			onAttempt: vi.fn(),
			onAttemptSense,
		});
		await fireEvent.input(screen.getByRole("combobox"), { target: { value: "/" } });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		await fireEvent.click(screen.getByRole("option", { name: /Look around/ }));
		expect(onAttemptSense).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole("button", { name: "Attempt" }));
		expect(onAttemptSense).toHaveBeenCalledWith("sense:look:local");
	});

	it("holds an exit handle until explicit Attempt", async () => {
		const onAttemptMove = vi.fn();
		render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions,
			targets,
			exits: [
				{ handle: "exit:north", rev: "3", label: "North", to: "inn", toName: "The Inn", gates: [] },
			],
			revision: 1,
			onChooseAction: vi.fn(),
			onChooseTarget: vi.fn(),
			onAttempt: vi.fn(),
			onAttemptMove,
		});
		await fireEvent.input(screen.getByRole("combobox"), { target: { value: "/" } });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		await fireEvent.click(screen.getByRole("option", { name: /Go — The Inn/ }));
		expect(onAttemptMove).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole("button", { name: "Attempt" }));
		expect(onAttemptMove).toHaveBeenCalledWith("exit:north");
	});

	it("clears a submitted shell sentence only when its owner advances the accepted clear token", async () => {
		const view = render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions,
			targets,
			revision: 1,
			clearToken: 0,
			onChooseAction: vi.fn(),
			onChooseTarget: vi.fn(),
			onAttempt: vi.fn(),
		});
		const input = screen.getByRole<HTMLInputElement>("combobox");
		await fireEvent.input(input, { target: { value: "/unbound repair text" } });
		await view.rerender({ clearToken: 1 });
		expect(input.value).toBe("");
	});

	it("does not dispatch a route that disappeared under the draft", async () => {
		const onAttemptMove = vi.fn();
		const view = render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions,
			targets,
			exits: [
				{ handle: "exit:north", rev: "3", label: "North", to: "inn", toName: "The Inn", gates: [] },
			],
			revision: 1,
			onChooseAction: vi.fn(),
			onChooseTarget: vi.fn(),
			onAttempt: vi.fn(),
			onAttemptMove,
		});
		await fireEvent.input(screen.getByRole("combobox"), { target: { value: "/" } });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		await fireEvent.click(screen.getByRole("option", { name: /Go — The Inn/ }));
		await view.rerender({ exits: [] });
		expect(screen.getByText(/That is no longer possible here/)).toBeTruthy();
		expect(screen.getByRole("button", { name: "Attempt" })).toHaveProperty("disabled", true);
		expect(onAttemptMove).not.toHaveBeenCalled();
	});

	it("holds the active turn until explicit Attempt", async () => {
		const onAttemptEndTurn = vi.fn();
		render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions,
			targets,
			canEndTurn: true,
			revision: 1,
			onChooseAction: vi.fn(),
			onChooseTarget: vi.fn(),
			onAttempt: vi.fn(),
			onAttemptEndTurn,
		});
		await fireEvent.input(screen.getByRole("combobox"), { target: { value: "/" } });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		await fireEvent.click(screen.getByRole("option", { name: /End turn/ }));
		expect(onAttemptEndTurn).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole("button", { name: "Attempt" }));
		expect(onAttemptEndTurn).toHaveBeenCalledTimes(1);
	});

	it("suspends and restores the ordinary shell draft without dispatching it", async () => {
		const onAttempt = vi.fn();
		const view = render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions,
			targets,
			revision: 1,
			suspended: false,
			onChooseAction: vi.fn(),
			onChooseTarget: vi.fn(),
			onAttempt,
		});
		const input = screen.getByRole<HTMLInputElement>("combobox");
		await fireEvent.input(input, { target: { value: '/srd/inspect @"Locked chest"' } });
		await view.rerender({ suspended: true });
		expect(input.disabled).toBe(true);
		expect(input.value).toBe('/srd/inspect @"Locked chest"');
		await view.rerender({ suspended: false });
		expect(input.disabled).toBe(false);
		expect(input.value).toBe('/srd/inspect @"Locked chest"');
		expect(onAttempt).not.toHaveBeenCalled();
	});

	it("marks an occurrence-bound answer stale when that occurrence disappears", async () => {
		const answer = {
			id: "answer",
			label: "Yes",
			value: {
				actionId: "dm/yes",
				displayName: "Yes",
				tags: [],
				selfOnly: false,
				selfEligible: false,
			},
		};
		const prompt = {
			occurrenceId: "42",
			promptDefId: "dm/prompt/yes",
			contractVersion: 1,
			sourceRef: "entity:aldwin",
			sourceName: "Aldwin",
			responseActionIds: ["dm/yes"],
			openedAtTick: 3,
			consumed: false,
			presentation: { labels: { "dm/yes": "Yes" } },
		};
		const onChooseAction = vi.fn();
		const onChoosePrompt = vi.fn();
		const view = render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: "entity:aldwin",
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions: [answer],
			targets,
			prompts: [prompt],
			revision: 1,
			onChooseAction,
			onChooseTarget: vi.fn(),
			onChoosePrompt,
			onAttempt: vi.fn(),
		});
		await fireEvent.input(screen.getByRole("combobox"), { target: { value: "/" } });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		const promptOption = screen.getAllByRole("option", { name: /Yes/ })[0];
		if (promptOption === undefined) throw new Error("prompt option missing");
		await fireEvent.click(promptOption);
		expect(onChoosePrompt).toHaveBeenCalledWith("42");
		expect(onChooseAction).toHaveBeenCalledWith("dm/yes");
		await view.rerender({ prompts: [], selectedPromptId: null });
		expect(screen.getByText(/That question has changed/)).toBeTruthy();
	});

	it("binds the selected occurrence rather than guessing between concurrent prompt labels", async () => {
		const onChooseAction = vi.fn();
		const onChoosePrompt = vi.fn();
		render(FactShellComposer, {
			draft: {
				actionId: null,
				targetRef: null,
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions,
			targets,
			prompts: [
				{
					occurrenceId: "first",
					promptDefId: "dm/prompt/first",
					contractVersion: 1,
					sourceRef: "entity:aldwin",
					sourceName: "Aldwin",
					responseActionIds: ["srd/inspect"],
					openedAtTick: 3,
					consumed: false,
					presentation: { labels: { "srd/inspect": "Ask about the road" } },
				},
				{
					occurrenceId: "second",
					promptDefId: "dm/prompt/second",
					contractVersion: 1,
					sourceRef: "entity:aldwin",
					sourceName: "Aldwin",
					responseActionIds: ["srd/inspect"],
					openedAtTick: 4,
					consumed: false,
					presentation: { labels: { "srd/inspect": "Ask about the key" } },
				},
			],
			revision: 1,
			onChooseAction,
			onChooseTarget: vi.fn(),
			onChoosePrompt,
			onAttempt: vi.fn(),
		});
		await fireEvent.input(screen.getByRole("combobox"), { target: { value: "/" } });
		await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		await fireEvent.click(
			screen.getByRole("option", { name: /^Ask about the key — answer to Aldwin/ }),
		);
		expect(onChoosePrompt).toHaveBeenCalledWith("second");
		expect(onChooseAction).toHaveBeenCalledWith("srd/inspect");
	});

	it("presents admission, refusal, and unobserved outcomes without clearing a repairable draft", async () => {
		const view = render(FactShellComposer, {
			draft: {
				actionId: "srd/inspect",
				targetRef: "entity:chest",
				inputValues: {},
				utterance: "",
				activePart: "action",
			},
			actions,
			targets,
			revision: 1,
			onAttempt: vi.fn(),
			outcome: { kind: "accepted", text: "The world accepted your attempt." },
		});
		expect(screen.getByText("The world accepted your attempt.")).toBeTruthy();
		expect(screen.queryByText(/Admission observed/)).toBeNull();
		// The outcome belongs to the sentence that was sent: an edit dismisses
		// it so the hints for the next sentence can show.
		await fireEvent.input(screen.getByRole("combobox"), {
			target: { value: '/inspect @"Locked chest"' },
		});
		expect(screen.queryByText("The world accepted your attempt.")).toBeNull();
		await view.rerender({ outcome: { kind: "rejected", text: "The chest is sealed." } });
		expect(screen.getByText(/The chest is sealed\. Refused — your words are kept/)).toBeTruthy();
		expect(screen.getByRole<HTMLInputElement>("combobox").value).toBe('/inspect @"Locked chest"');
		await view.rerender({ outcome: { kind: "unobserved", text: "No receipt arrived." } });
		expect(
			screen.getByText(/No receipt arrived\. Result unknown — your words are kept/),
		).toBeTruthy();
	});
});

it("hides only exact response action IDs while an open prompt exists", async () => {
	const base = actions[0];
	if (base === undefined) throw new Error("fixture needs an action");
	const responseAction = {
		...base,
		id: "slot",
		label: "Generic option",
		value: { ...base.value, actionId: "answer/opaque" },
	};
	const prompt = {
		occurrenceId: "o1",
		promptDefId: "p1",
		contractVersion: 1,
		sourceRef: "entity:chest",
		sourceName: "Chest",
		responseActionIds: ["answer/opaque"],
		openedAtTick: 1,
		consumed: false,
		presentation: {
			question: "Question including 1: wording",
			labels: { "answer/opaque": "Short label" },
		},
	};
	const view = render(FactShellComposer, {
		draft: {
			actionId: null,
			targetRef: null,
			inputValues: {},
			utterance: "",
			activePart: "action",
		},
		actions: [
			responseAction,
			{
				...responseAction,
				id: "unrelated",
				label: "Answer 99",
				value: { ...responseAction.value, actionId: "other/answer" },
			},
			...actions,
		],
		targets,
		prompts: [prompt],
		revision: 1,
		onAttempt: vi.fn(),
	});
	const input = screen.getByRole("combobox");
	await fireEvent.keyDown(input, { key: "ArrowDown" });
	expect(screen.queryByRole("option", { name: /Generic option/ })).toBeNull();
	expect(screen.getByRole("option", { name: /Answer 99/ })).toBeTruthy();
	await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
	expect(screen.getByRole("option", { name: /Short label/ })).toBeTruthy();
	await fireEvent.keyDown(input, { key: "Escape" });
	await view.rerender({ prompts: [], revision: 2 });
	await fireEvent.keyDown(input, { key: "ArrowDown" });
	await fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
	expect(screen.getByRole("option", { name: /Generic option/ })).toBeTruthy();
});

it("updates the closed ghost when its prompt disappears", async () => {
	const view = render(FactShellComposer, {
		draft: {
			actionId: null,
			targetRef: null,
			inputValues: {},
			utterance: "",
			activePart: "action",
		},
		actions,
		targets,
		revision: 1,
		onAttempt: vi.fn(),
		prompts: [
			{
				occurrenceId: "o",
				promptDefId: "p",
				contractVersion: 1,
				sourceRef: "entity:chest",
				sourceName: "Chest",
				responseActionIds: ["srd/inspect"],
				openedAtTick: 1,
				consumed: false,
				presentation: { labels: { "srd/inspect": "Reply" } },
			},
		],
	});
	expect(
		document.querySelector('.shell-composer__mirror [data-role="suggestion"]')?.textContent,
	).toBe("/reply");
	await view.rerender({ prompts: [], revision: 2 });
	expect(document.querySelector('.shell-composer__mirror [data-role="suggestion"]')).toBeNull();
});

it("replaces the structured prompt with the outcome in one help line", async () => {
	const view = render(FactShellComposer, {
		draft: {
			actionId: null,
			targetRef: null,
			inputValues: {},
			utterance: "",
			activePart: "action",
		},
		actions,
		targets,
		revision: 1,
		onAttempt: vi.fn(),
		prompts: [
			{
				occurrenceId: "help",
				promptDefId: "help",
				contractVersion: 1,
				sourceRef: "entity:chest",
				sourceName: "Chest",
				responseActionIds: ["srd/inspect"],
				openedAtTick: 1,
				consumed: false,
				presentation: { question: "An opaque question?", labels: { "srd/inspect": "Reply" } },
			},
		],
	});
	expect(screen.getByTestId("dock-help-line").textContent).toContain("An opaque question?");
	await view.rerender({ outcome: { kind: "accepted", text: "Recorded outcome." } });
	expect(screen.getByTestId("dock-help-line").textContent).toContain("Recorded outcome.");
	expect(screen.getByTestId("dock-help-line").textContent).not.toContain("An opaque question?");
});

it("puts a connection or long-wait message ahead of an old outcome", () => {
	render(FactShellComposer, {
		draft: {
			actionId: null,
			targetRef: null,
			inputValues: {},
			utterance: "",
			activePart: "action",
		},
		actions,
		targets,
		revision: 1,
		onAttempt: vi.fn(),
		outcome: { kind: "accepted", text: "Old outcome" },
		statusMessage: { text: "Reconnecting to the world…", tone: "stale" },
	});
	expect(screen.getByTestId("dock-help-line").textContent).toContain("Reconnecting to the world…");
	expect(screen.getByTestId("dock-help-line").textContent).not.toContain("Old outcome");
});

it("a referenced answer previews exact authored prose and an unreferenced answer has no description", async () => {
	const firstAction = actions[0];
	if (firstAction === undefined) throw new Error("Missing action fixture");
	render(FactShellComposer, {
		draft: {
			actionId: null,
			targetRef: null,
			inputValues: {},
			utterance: "",
			activePart: "action",
		},
		actions: ["with", "without"].map((id) => ({
			id,
			label: id,
			value: { ...firstAction.value, actionId: id },
		})),
		targets,
		revision: 1,
		onAttempt: vi.fn(),
		prompts: [
			{
				occurrenceId: "refs",
				promptDefId: "refs",
				contractVersion: 1,
				sourceRef: "entity:chest",
				sourceName: "Chest",
				responseActionIds: ["with", "without"],
				openedAtTick: 1,
				consumed: false,
				presentation: {
					question: "Choose",
					labels: { with: "With ref", without: "Without ref" },
					responseRefs: { with: "exact/definition" },
				},
			},
		],
	});
	const input = screen.getByRole("combobox");
	await fireEvent.keyDown(input, { key: "ArrowDown" });
	await waitFor(() =>
		expect(document.querySelector(".shell-composer__preview")?.textContent).toContain(
			"Exact authored description",
		),
	);
	await fireEvent.keyDown(input, { key: "ArrowDown" });
	expect(document.querySelector(".shell-composer__preview")?.textContent).toContain("Without ref");
	expect(document.querySelector(".shell-composer__preview p")).toBeNull();
});

/* ── Dogfood 2026-11-12 (sk-jay0.1.8.92/.93/.98/.99): everything stays in the
 * one text box. These tests drive the composer with a parent that follows
 * `onExecutableChange`, as PlayTable does. */
describe("one text box for forms, speech and ways out", () => {
	const action = (label: string, actionId: string, extra: Record<string, unknown> = {}) => ({
		id: actionId,
		label,
		value: {
			actionId,
			displayName: label,
			tags: [],
			selfOnly: false,
			selfEligible: false,
			...extra,
		},
	});
	const person = (name: string, ref: string) => ({
		id: ref,
		label: name,
		value: { targetFactId: ref, targetRef: ref, targetName: name, tags: [] },
	});
	const nameField = {
		name: "name",
		label: "Name",
		control: "text" as const,
		required: true,
		placeholder: "Your character's name",
	};
	const nameAction = action("Name your character", "dm/name", { input: { fields: [nameField] } });
	const scoresAction = action("Set scores", "dm/scores", {
		input: {
			fields: [
				{ name: "str", label: "Strength", control: "number" as const, min: 8, max: 15 },
				{ name: "note", label: "Note", control: "text" as const },
				nameField,
			],
		},
	});
	const speak = action("Speak to", "core/act/speak-to", { communicationSpeechActId: "speak" });
	const inspectAction = action("Inspect", "srd/inspect");
	const aldwin = person("Aldwin", "entity:aldwin");
	const caddoc = person("Brother Caddoc", "entity:caddoc");
	const namePrompt = {
		occurrenceId: "name-1",
		promptDefId: "dm/prompt/name",
		contractVersion: 1,
		sourceRef: "entity:aldwin",
		sourceName: "Aldwin",
		responseActionIds: ["dm/name"],
		openedAtTick: 1,
		consumed: false,
		presentation: { question: "What is your name?", labels: {} },
	};
	const exits = [
		{ handle: "exit:north", rev: "3", label: "North", to: "stairs", toName: "Stairs", gates: [] },
		{ handle: "exit:down", rev: "3", label: "Down", to: "cellar", toName: "Cellar", gates: [] },
	];

	function mount(props: Record<string, unknown>) {
		const calls = {
			onAttempt: vi.fn(),
			onAttemptMove: vi.fn(),
			onChooseAction: vi.fn(),
			onChangeDetails: vi.fn(),
		};
		let draft = {
			actionId: null as string | null,
			targetRef: null as string | null,
			inputValues: {} as Record<string, string | number | boolean>,
			utterance: "",
			activePart: "action" as const,
		};
		const view = render(FactShellComposer, {
			draft,
			targets: [aldwin, caddoc],
			revision: 1,
			...calls,
			onExecutableChange: (next: { actionId: string | null; targetRef: string | null }) => {
				draft = { ...draft, actionId: next.actionId, targetRef: next.targetRef };
			},
			onChangeDetails: (details: { inputValues: typeof draft.inputValues; utterance: string }) => {
				calls.onChangeDetails(details);
				draft = { ...draft, ...details };
			},
			...props,
			// biome-ignore lint/suspicious/noExplicitAny: fixtures are deliberately partial
		} as any);
		const input = screen.getAllByRole<HTMLInputElement>("combobox").at(-1) as HTMLInputElement;
		// biome-ignore lint/suspicious/noExplicitAny: partial rerender props
		const rerender = (next: Record<string, unknown>) => view.rerender(next as any);
		const within = view.container;
		return {
			...calls,
			input,
			rerender,
			draft: () => draft,
			/** The parent hands the executable draft back, as PlayTable does. */
			sync: () => rerender({ draft }),
			type: (value: string) => fireEvent.input(input, { target: { value } }),
			/** Type, open the list, and click one suggestion. */
			pick: async (value: string, option: RegExp) => {
				await fireEvent.input(input, { target: { value } });
				await fireEvent.keyDown(input, { key: "ArrowDown" });
				const row = Array.from(within.querySelectorAll<HTMLElement>('[role="option"]')).find(
					(entry) => option.test(entry.textContent ?? ""),
				);
				if (row === undefined) throw new Error(`no suggestion matches ${option}`);
				await fireEvent.click(row);
				await rerender({ draft });
			},
			rows: () =>
				Array.from(within.querySelectorAll<HTMLElement>('[role="option"]')).map(
					(row) => row.textContent ?? "",
				),
			row: (option: RegExp) => {
				const found = Array.from(within.querySelectorAll<HTMLElement>('[role="option"]')).find(
					(entry) => option.test(entry.textContent ?? ""),
				);
				if (found === undefined) throw new Error(`no suggestion matches ${option}`);
				return found;
			},
			attemptButton: () =>
				Array.from(within.querySelectorAll<HTMLButtonElement>("button")).find(
					(button) => button.textContent?.trim() === "Attempt",
				) as HTMLButtonElement,
			enter: () => fireEvent.keyDown(input, { key: "Enter" }),
			status: () => within.querySelector("#play-shell-status")?.textContent ?? "",
			legend: () => within.querySelector('[data-testid="dock-help-line"] span')?.textContent,
			greyText: () =>
				Array.from(within.querySelectorAll('.shell-composer__mirror [data-role="suggestion"]')).map(
					(node) => node.textContent,
				),
			boundTexts: () =>
				Array.from(
					within.querySelectorAll(
						'.shell-composer__mirror [data-role^="bound-"], .shell-composer__mirror [data-role="prompt"]',
					),
				).map((node) => node.textContent),
			errorMarks: () =>
				within.querySelectorAll('.shell-composer__mirror [data-role="error"]').length,
			fieldMarks: () =>
				within.querySelectorAll('.shell-composer__mirror [data-role="field"]').length,
		};
	}
	const caretInsideQuotes = async (input: HTMLInputElement) => {
		await waitFor(() => expect(input.selectionStart).toBe(input.value.length - 1));
		expect(input.selectionEnd).toBe(input.value.length - 1);
		expect(document.activeElement).toBe(input);
	};

	describe("world forms (D1)", () => {
		it("appends the missing detail when an answer is picked, with the caret between the quotes", async () => {
			const t = mount({ actions: [nameAction], prompts: [namePrompt] });
			await t.type("/na");
			await fireEvent.keyDown(t.input, { key: "Tab" });
			expect(t.input.value).toBe('/name-your-character @"Aldwin" name:""');
			await caretInsideQuotes(t.input);
			expect(t.onChangeDetails).toHaveBeenLastCalledWith({
				inputValues: { name: "" },
				utterance: "",
			});
			expect(t.greyText()).toEqual(["Your character's name"]);
			expect(t.status()).toContain("Write the Name between the quotes, then press Enter to send.");
			expect(t.onAttempt).not.toHaveBeenCalled();
		});

		it("stops Enter on a blank needed detail, names it, and sends once it has a value", async () => {
			const t = mount({ actions: [nameAction], prompts: [namePrompt] });
			await t.pick("/", /Name your character/);
			expect(t.input.value).toBe('/name-your-character @"Aldwin" name:""');
			await t.enter();
			expect(t.onAttempt).not.toHaveBeenCalled();
			expect(t.status()).toContain('“Name” is missing. Add it as name:"…".');
			expect(t.input.getAttribute("aria-invalid")).toBeNull();

			// The template may be deleted; the blocker still names the detail.
			await t.type('/name-your-character @"Aldwin"');
			await t.sync();
			await t.enter();
			expect(t.onAttempt).not.toHaveBeenCalled();
			expect(t.status()).toContain("“Name” is missing.");

			await t.type('/name-your-character @"Aldwin" name:"Brannoch the Bold"');
			await t.sync();
			expect(t.greyText()).toEqual([]);
			expect(t.status()).toContain("Press Enter to send.");
			expect(t.attemptButton().disabled).toBe(false);
			expect(t.draft().inputValues).toEqual({ name: "Brannoch the Bold" });
			await t.enter();
			expect(t.onAttempt).toHaveBeenCalledOnce();
		});

		it("ghosts the next detail after a space and Right takes it without picking anything", async () => {
			const t = mount({ actions: [nameAction], prompts: [namePrompt] });
			await t.pick("/", /Name your character/);
			await t.type('/name-your-character @"Aldwin" ');
			const bound = t.boundTexts();
			expect(bound).toEqual(["/name-your-character", '@"Aldwin"']);
			expect(t.greyText()).toEqual(['name:""']);
			const chosen = t.onChooseAction.mock.calls.length;
			t.input.setSelectionRange(t.input.value.length, t.input.value.length);
			await fireEvent.keyDown(t.input, { key: "ArrowRight" });
			expect(t.input.value).toBe('/name-your-character @"Aldwin" name:""');
			await caretInsideQuotes(t.input);
			expect(t.boundTexts()).toEqual(bound);
			expect(t.fieldMarks()).toBeGreaterThan(0);
			expect(t.onChooseAction.mock.calls.length).toBe(chosen);
			expect(t.onAttempt).not.toHaveBeenCalled();

			// A hand-typed start of the detail ghosts its rest.
			await t.type('/name-your-character @"Aldwin" na');
			expect(t.greyText()).toEqual(['me:""']);
		});

		it("lists open details first, needed before optional, and drops one that is written", async () => {
			const t = mount({ actions: [scoresAction] });
			await t.pick("/", /Set scores/);
			await t.pick("/set-scores @", /Aldwin/);
			// The needed detail was appended on that completion.
			expect(t.input.value).toBe('/set-scores @"Aldwin" name:""');
			await t.type('/set-scores @"Aldwin" ');
			await fireEvent.keyDown(t.input, { key: "ArrowDown" });
			const rows = t.rows();
			expect(rows[0]).toContain("Name");
			expect(rows[0]).toContain("Fill in");
			expect(rows[0]).toContain("needed · Your character's name");
			expect(rows[1]).toContain("Strength");
			expect(rows[1]).toContain("optional · from 8 to 15");
			expect(rows[2]).toContain("Note");
			await fireEvent.click(t.row(/Strength/));
			expect(t.input.value).toBe('/set-scores @"Aldwin" str:');
			await waitFor(() => expect(t.input.selectionStart).toBe(t.input.value.length));

			await t.type('/set-scores @"Aldwin" str:15 ');
			await fireEvent.keyDown(t.input, { key: "ArrowDown" });
			const left = t.rows();
			expect(left.some((row) => row.includes("Strength"))).toBe(false);
			expect(left[0]).toContain("Name");
			expect(t.draft().inputValues).toEqual({ str: 15 });
		});

		it("says where a bare word belongs instead of sending it", async () => {
			const t = mount({ actions: [nameAction], prompts: [namePrompt] });
			await t.pick("/", /Name your character/);
			await t.type('/name-your-character @"Aldwin" Brannoch');
			await t.sync();
			await t.enter();
			expect(t.onAttempt).not.toHaveBeenCalled();
			expect(t.status()).toContain(
				'“Brannoch” is not part of anything yet. For the Name, write name:"Brannoch".',
			);
		});

		it("uses a suggested value instead of asking for the detail", async () => {
			const withDefault = action("Rename", "dm/rename", {
				input: { fields: [nameField] },
				defaults: {
					target: { targetRef: "entity:aldwin", kind: "actor" as const },
					inputValues: { name: "Old Tom" },
					provenance: { namespace: "ui", templateId: "t", attachmentId: "1", contentKey: "1" },
				},
			});
			const t = mount({ actions: [withDefault] });
			await t.pick("/", /Rename/);
			expect(t.input.value).toBe("/rename");
			await t.enter();
			expect(t.onAttempt).toHaveBeenCalledOnce();
		});

		it("offers no details for a way out or before anything is picked", async () => {
			const t = mount({ actions: [nameAction], exits });
			await t.type(" ");
			expect(t.greyText()).toEqual([]);
			await t.pick("/", /Stairs/);
			await t.type("/go-stairs ");
			expect(t.greyText()).toEqual([]);
			await fireEvent.keyDown(t.input, { key: "ArrowDown" });
			expect(t.rows().some((row) => row.includes("Fill in"))).toBe(false);
		});
	});

	describe("picking stays explicit (D2)", () => {
		it("never turns an exactly typed word into a choice, and says Tab then Enter", async () => {
			const t = mount({ actions: [inspectAction] });
			await t.type("/inspect");
			await t.enter();
			expect(t.input.value).toBe("/inspect");
			expect(t.status()).toContain(
				"“/inspect” is not picked yet. Press Tab to pick it from the suggestions, then Enter to send.",
			);
			expect(t.boundTexts()).toEqual([]);
			expect(t.draft().actionId).toBeNull();
			expect(t.onChooseAction).not.toHaveBeenCalled();
			expect(t.onAttempt).not.toHaveBeenCalled();
		});

		it("names an unpicked person the same way", async () => {
			const t = mount({ actions: [inspectAction] });
			await t.pick("/", /Inspect/);
			await t.type("/inspect @Aldwin");
			await t.sync();
			await t.enter();
			expect(t.status()).toContain("“@Aldwin” is not picked yet. Press Tab to pick it");
			expect(t.onAttempt).not.toHaveBeenCalled();
		});

		it("does not take a digit as an answer to an open question", async () => {
			const t = mount({ actions: [nameAction], prompts: [namePrompt] });
			await t.type("4");
			await t.enter();
			expect(t.status()).toContain(
				"Pick an answer: press Tab to see the answers, then Enter to send.",
			);
			expect(t.boundTexts()).toEqual([]);
			expect(t.onAttempt).not.toHaveBeenCalled();
		});

		it("says Enter sends once nothing is in the way, with the matching key legend", async () => {
			const t = mount({ actions: [inspectAction] });
			expect(t.legend()).toBe("Tab pick · → take grey text · ↑/↓ browse");
			await t.pick("/", /Inspect/);
			await t.pick("/inspect @", /Aldwin/);
			expect(t.status()).toContain("Press Enter to send.");
			expect(t.legend()).toBe("Enter send · Tab more choices");
			expect(t.status()).not.toMatch(/ready/i);
		});
	});

	describe("a way out fills the box (D3)", () => {
		it("writes the go sentence into an empty box, focuses it, and moves only on Enter", async () => {
			const t = mount({ actions: [inspectAction], exits });
			await t.rerender({ insertion: { token: 1, exitHandle: "exit:north" } });
			expect(t.input.value).toBe("/go-stairs");
			await waitFor(() => expect(document.activeElement).toBe(t.input));
			expect(t.boundTexts()).toEqual(["/go-stairs"]);
			expect(t.status()).toContain("Go to Stairs. Press Enter to set off.");
			expect(t.onAttemptMove).not.toHaveBeenCalled();
			await t.sync();
			await t.enter();
			expect(t.onAttemptMove).toHaveBeenCalledExactlyOnceWith("exit:north");
			expect(t.onAttempt).not.toHaveBeenCalled();
		});

		it("swaps an earlier go sentence and replaces names a click put there", async () => {
			const t = mount({ actions: [inspectAction], exits });
			await t.rerender({ insertion: { token: 1, exitHandle: "exit:north" } });
			await t.rerender({ insertion: { token: 2, exitHandle: "exit:down" } });
			expect(t.input.value).toBe("/go-cellar");
			expect(t.boundTexts()).toEqual(["/go-cellar"]);
			expect(t.status()).toContain("Go to Cellar.");

			await t.type("");
			await t.rerender({ prefillTargetRef: "entity:aldwin" });
			expect(t.input.value).toBe('@"Aldwin"');
			await t.rerender({ insertion: { token: 3, exitHandle: "exit:north" } });
			expect(t.input.value).toBe("/go-stairs");
			// Exactly one picked piece: a second one would disarm the way out.
			expect(t.boundTexts()).toEqual(["/go-stairs"]);
			await t.sync();
			await t.enter();
			expect(t.onAttemptMove).toHaveBeenCalledExactlyOnceWith("exit:north");
		});

		it("keeps typed words, says why, and drops the note on the next edit", async () => {
			const t = mount({ actions: [speak], exits });
			await t.pick("/", /Speak to/);
			await t.pick("/speak-to @", /Brother Caddoc/);
			const typed = '/speak-to @"Brother Caddoc" "Good mor';
			await t.type(typed);
			const bound = t.boundTexts();
			expect(bound).toEqual(["/speak-to", '@"Brother Caddoc"']);
			await t.rerender({ insertion: { token: 1, exitHandle: "exit:north" } });
			expect(t.input.value).toBe(typed);
			expect(t.boundTexts()).toEqual(bound);
			await waitFor(() => expect(document.activeElement).toBe(t.input));
			expect(t.status()).toContain(
				"You have unsent words in the box. Send or clear them, then choose Stairs again.",
			);
			expect(t.onAttemptMove).not.toHaveBeenCalled();
			await t.type(`${typed}n`);
			expect(t.status()).not.toContain("unsent words");

			// A verb insertion from a detail button follows the same rule.
			await t.rerender({
				insertion: { token: 2, actionId: "core/act/speak-to", targetRef: "entity:aldwin" },
			});
			expect(t.input.value).toBe(`${typed}n`);
			expect(t.status()).toContain("then choose Speak to again.");
		});

		it("drops the grey suggestion when a clicked name lands behind a bare slash", async () => {
			// Seen 2026-11-12: "/" with the grey "go-stairs" behind it, then a map
			// click added a place. The box read /go-stairs #"Cellar" while the help
			// line said that "/" is not picked yet.
			const cellar = person("Cellar", "place_node:cellar");
			const t = mount({
				actions: [inspectAction],
				exits: exits.slice(0, 1),
				targets: [aldwin, cellar],
			});
			await t.type("/");
			expect(t.greyText()).toEqual(["go-stairs"]);
			await t.rerender({ prefillTargetRef: "place_node:cellar" });
			expect(t.input.value).toBe('/ #"Cellar"');
			const mirror = () => document.querySelector(".shell-composer__mirror")?.textContent;
			// Nothing grey is left between the slash and the place, and the help
			// line asks for the pick instead of naming the bare slash.
			expect(t.greyText()).toEqual([]);
			expect(mirror()).toContain('/ #"Cellar"');
			expect(mirror()).not.toContain("go-stairs");
			expect(t.status()).not.toContain("is not picked yet");
			expect(t.status()).toContain("What do you do? Type / and press Tab to pick");
			expect(t.boundTexts()).toEqual(['#"Cellar"']);
		});

		it("does not treat a go sentence with extra typed words as replaceable", async () => {
			const t = mount({ actions: [inspectAction], exits });
			await t.rerender({ insertion: { token: 1, exitHandle: "exit:north" } });
			await t.type("/go-stairs quickly");
			await t.rerender({ insertion: { token: 2, exitHandle: "exit:down" } });
			expect(t.input.value).toBe("/go-stairs quickly");
			expect(t.status()).toContain("then choose Cellar again.");
		});
	});

	describe("speech needs quotes, and the box offers them (D4)", () => {
		it("appends empty quotes once the action and the person are picked", async () => {
			const t = mount({ actions: [speak] });
			await t.pick("/", /Speak to/);
			expect(t.input.value).toBe("/speak-to");
			expect(t.status()).toContain("Speak to: who or what?");
			await t.pick("/speak-to @Bro", /Brother Caddoc/);
			expect(t.input.value).toBe('/speak-to @"Brother Caddoc" ""');
			await caretInsideQuotes(t.input);
			expect(t.greyText()).toEqual(["what you say"]);
			expect(t.status()).toContain(
				"Write what you say between the quotes, then press Enter to send.",
			);
			expect(t.onAttempt).not.toHaveBeenCalled();

			// Typing keeps the closing quote; the grey text goes with the first letter.
			await t.type('/speak-to @"Brother Caddoc" "G"');
			expect(t.greyText()).toEqual([]);
			expect(t.draft().utterance).toBe("G");
		});

		it("appends the quotes when the person was picked first", async () => {
			const t = mount({ actions: [speak] });
			await t.pick("@", /Brother Caddoc/);
			expect(t.input.value).toBe('@"Brother Caddoc"');
			await t.pick('@"Brother Caddoc" /spe', /Speak to/);
			expect(t.input.value).toBe('@"Brother Caddoc" /speak-to ""');
			await caretInsideQuotes(t.input);
		});

		it("offers the quotes after a detail button inserts the sentence", async () => {
			const t = mount({ actions: [speak] });
			await t.rerender({
				insertion: { token: 1, actionId: "core/act/speak-to", targetRef: "entity:caddoc" },
			});
			expect(t.input.value).toBe('/speak-to @"Brother Caddoc" ""');
			await caretInsideQuotes(t.input);
			expect(t.onAttempt).not.toHaveBeenCalled();
		});

		it("blocks loose words with a sentence that asks for quotes, and keeps them", async () => {
			const t = mount({ actions: [speak] });
			await t.pick("/", /Speak to/);
			await t.pick("/speak-to @Bro", /Brother Caddoc/);
			const loose = '/speak-to @"Brother Caddoc" Good morning, brother.';
			await t.type(loose);
			await t.sync();
			await t.enter();
			expect(t.onAttempt).not.toHaveBeenCalled();
			expect(t.input.value).toBe(loose);
			expect(t.status()).toContain('Put what you say in quotes: "Good morning, brother."');
			expect(t.input.getAttribute("aria-invalid")).toBeNull();
			expect(t.errorMarks()).toBe(0);

			// One loose word beside a quoted sentence still blocks.
			await t.type('/speak-to @"Brother Caddoc" "Good morning" brother');
			await t.sync();
			await t.enter();
			expect(t.onAttempt).not.toHaveBeenCalled();
			// The loose word is not echoed: a second pair of quotes would drop the first.
			expect(t.status()).toContain("Put all of what you say inside one pair of quotes.");
			expect(t.status()).not.toContain('"brother"');

			// Two quoted parts: only one would be sent, so nothing is.
			await t.type('/speak-to @"Brother Caddoc" "Good morning" "brother"');
			await t.sync();
			await t.enter();
			expect(t.onAttempt).not.toHaveBeenCalled();
			expect(t.status()).toContain("Put all of what you say inside one pair of quotes.");

			await t.type('/speak-to @"Brother Caddoc" "Good morning, brother."');
			await t.sync();
			await t.enter();
			expect(t.onAttempt).toHaveBeenCalledOnce();
			expect(t.draft().utterance).toBe("Good morning, brother.");
		});

		it("appends no quotes when loose words are already there", async () => {
			const t = mount({ actions: [speak] });
			await t.pick("/", /Speak to/);
			await t.pick("/speak-to Good morning @Cad", /Brother Caddoc/);
			expect(t.input.value).toBe('/speak-to Good morning @"Brother Caddoc"');
			await t.enter();
			expect(t.status()).toContain('Put what you say in quotes: "Good morning"');
		});

		it("never brings deleted quotes back and still sends empty ones", async () => {
			const t = mount({ actions: [speak] });
			await t.pick("/", /Speak to/);
			await t.pick("/speak-to @Bro", /Brother Caddoc/);
			await t.enter();
			// Empty quotes are not blocked: some such actions carry no words at all.
			expect(t.onAttempt).toHaveBeenCalledOnce();
			await t.type('/speak-to @"Brother Caddoc" ');
			await t.type('/speak-to @"Brother Caddoc"');
			expect(t.input.value).toBe('/speak-to @"Brother Caddoc"');
			expect(t.greyText()).toEqual([]);
		});

		it("adds a clicked name without quotes and without taking focus", async () => {
			const t = mount({ actions: [speak] });
			await t.pick("/", /Speak to/);
			t.input.blur();
			await t.rerender({ prefillTargetRef: "entity:caddoc" });
			expect(t.input.value).toBe('/speak-to @"Brother Caddoc"');
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(document.activeElement).not.toBe(t.input);
		});

		it("leaves an action without words alone", async () => {
			const t = mount({ actions: [inspectAction] });
			await t.pick("/", /Inspect/);
			await t.pick("/inspect @", /Aldwin/);
			expect(t.input.value).toBe('/inspect @"Aldwin"');
			await t.type('/inspect @"Aldwin" carefully');
			await t.sync();
			await t.enter();
			// Unchanged: loose words beside an action that takes no words do not block.
			expect(t.onAttempt).toHaveBeenCalledOnce();
		});

		it("appends no quotes to an answer to an open question", async () => {
			const spokenAnswer = action("Yes", "dm/yes", { communicationSpeechActId: "speak" });
			const t = mount({
				actions: [spokenAnswer],
				prompts: [{ ...namePrompt, responseActionIds: ["dm/yes"] }],
			});
			await t.pick("/", /Yes/);
			expect(t.input.value).toBe('/yes @"Aldwin"');
		});
	});

	describe("review repairs (2026-11-12)", () => {
		const caretTo = async (input: HTMLInputElement, at: number) => {
			input.setSelectionRange(at, at);
			await fireEvent.keyUp(input, { key: "ArrowRight" });
		};

		it("drops the kept-words note on Enter, so the reason nothing was sent shows", async () => {
			const t = mount({ actions: [speak], exits });
			await t.type("unfinished words");
			await t.rerender({ insertion: { token: 1, exitHandle: "exit:north" } });
			expect(t.status()).toContain("You have unsent words in the box.");
			await t.enter();
			expect(t.onAttempt).not.toHaveBeenCalled();
			expect(t.status()).not.toContain("unsent words");
			expect(t.status()).toContain("What do you do?");
		});

		it("shows the world's refusal after a kept sentence is sent", async () => {
			const t = mount({ actions: [speak], exits });
			await t.pick("/", /Speak to/);
			await t.pick("/speak-to @Bro", /Brother Caddoc/);
			await t.type('/speak-to @"Brother Caddoc" "hi"');
			await t.sync();
			await t.rerender({ insertion: { token: 1, exitHandle: "exit:north" } });
			expect(t.status()).toContain("You have unsent words in the box.");
			await t.enter();
			expect(t.onAttempt).toHaveBeenCalledOnce();
			await t.rerender({ outcome: { text: "Brother Caddoc turns away.", kind: "rejected" } });
			expect(t.status()).toContain("Brother Caddoc turns away.");
			expect(t.status()).not.toContain("unsent words");
		});

		it("draws the grey words only while the caret waits between the quotes", async () => {
			const t = mount({ actions: [speak] });
			await t.pick("/", /Speak to/);
			await t.pick("/speak-to @Bro", /Brother Caddoc/);
			await caretInsideQuotes(t.input);
			expect(t.greyText()).toEqual(["what you say"]);
			// Inside a value no picking key is named: Tab there would replace the quotes.
			expect(t.legend()).toBe("Enter send");
			// With the caret elsewhere the grey words would push the letters away from it.
			await caretTo(t.input, 3);
			expect(t.greyText()).toEqual([]);
			expect(t.status()).toContain("Write what you say between the quotes");
			await caretTo(t.input, t.input.value.length - 1);
			expect(t.greyText()).toEqual(["what you say"]);
		});

		it("names no picking key for a blocker that asks for written words", async () => {
			const t = mount({ actions: [speak, nameAction], prompts: [namePrompt] });
			await t.pick("/", /Speak to/);
			await t.pick("/speak-to @Bro", /Brother Caddoc/);
			await t.type('/speak-to @"Brother Caddoc" Good morning');
			await t.sync();
			await t.enter();
			expect(t.status()).toContain("Put what you say in quotes");
			expect(t.legend()).toBe("↑/↓ browse");

			await t.type("");
			await t.pick("/", /Name your character/);
			await caretInsideQuotes(t.input);
			// The needed detail is still empty: Enter is stopped, so no key is named.
			expect(t.legend()).toBe("");
			await t.type('/name-your-character @"Aldwin" ');
			expect(t.greyText()).toEqual(['name:""']);
			expect(t.legend()).toBe("→ take grey text · ↑/↓ browse");
		});

		it("replaces a picked sentence whose offered quotes are still empty", async () => {
			const t = mount({ actions: [speak], exits });
			await t.rerender({
				insertion: { token: 1, actionId: "core/act/speak-to", targetRef: "entity:caddoc" },
			});
			expect(t.input.value).toBe('/speak-to @"Brother Caddoc" ""');
			await t.rerender({ insertion: { token: 2, exitHandle: "exit:north" } });
			expect(t.input.value).toBe("/go-stairs");
			expect(t.status()).not.toContain("unsent words");
		});

		it("keeps a picked sentence without an empty offer", async () => {
			const t = mount({ actions: [inspectAction], exits });
			await t.pick("/", /Inspect/);
			await t.pick("/inspect @", /Aldwin/);
			await t.rerender({ insertion: { token: 1, exitHandle: "exit:north" } });
			expect(t.input.value).toBe('/inspect @"Aldwin"');
			expect(t.status()).toContain("then choose Stairs again.");
		});

		it("replaces a go sentence whose way out has gone", async () => {
			const t = mount({ actions: [inspectAction], exits });
			await t.rerender({ insertion: { token: 1, exitHandle: "exit:north" } });
			expect(t.input.value).toBe("/go-stairs");
			await t.rerender({ exits: [exits[1]] });
			expect(t.status()).toContain("That is no longer possible here.");
			await t.rerender({ insertion: { token: 2, exitHandle: "exit:down" } });
			expect(t.input.value).toBe("/go-cellar");
			expect(t.status()).toContain("Go to Cellar.");
		});

		it("tells the owner when an insertion was refused", async () => {
			const onInsertionKept = vi.fn();
			const t = mount({ actions: [inspectAction], exits, onInsertionKept });
			await t.rerender({ insertion: { token: 1, exitHandle: "exit:north" } });
			expect(onInsertionKept).not.toHaveBeenCalled();
			await t.type("/go-stairs quickly");
			await t.rerender({ insertion: { token: 2, exitHandle: "exit:down" } });
			expect(onInsertionKept).toHaveBeenCalledExactlyOnceWith("exit:down");
		});

		it("does not suggest a number detail for a bare word", async () => {
			const t = mount({ actions: [scoresAction] });
			await t.pick("/", /Set scores/);
			await t.pick("/set-scores @", /Aldwin/);
			await t.type('/set-scores @"Aldwin" name:"Tom" Brannoch');
			await t.sync();
			await t.enter();
			expect(t.onAttempt).not.toHaveBeenCalled();
			expect(t.status()).toContain(
				'“Brannoch” is not part of anything yet. For the Note, write note:"Brannoch".',
			);
		});

		it("echoes a bare word into a number detail only when it is a number", async () => {
			const roll = action("Roll", "dm/roll", {
				input: { fields: [{ name: "str", label: "Strength", control: "number" as const }] },
			});
			const t = mount({ actions: [roll] });
			await t.pick("/", /Roll/);
			await t.pick("/roll @", /Aldwin/);
			await t.type('/roll @"Aldwin" strong');
			await t.sync();
			await t.enter();
			expect(t.status()).toContain("For the Strength, write str:….");
			await t.type('/roll @"Aldwin" 15');
			await t.enter();
			expect(t.status()).toContain("For the Strength, write str:15.");
			expect(t.onAttempt).not.toHaveBeenCalled();
		});
	});

	describe("a completion key never replaces a written value (sk-jay0.1.8.109)", () => {
		const caretBeforeClosingQuote = async (input: HTMLInputElement) => {
			input.setSelectionRange(input.value.length - 1, input.value.length - 1);
			await fireEvent.select(input);
		};

		it("keeps spoken words when Tab meets a sole fuzzy match inside the quotes", async () => {
			const t = mount({ actions: [speak] });
			await t.pick("/", /Speak to/);
			await t.pick("/speak-to @", /Brother Caddoc/);
			// `"ald"` fuzzy-matches exactly one row: @"Aldwin".
			const typed = '/speak-to @"Brother Caddoc" "ald"';
			await t.type(typed);
			await caretBeforeClosingQuote(t.input);
			const native = await fireEvent.keyDown(t.input, { key: "Tab" });
			expect(t.input.value).toBe(typed);
			expect(t.boundTexts()).toEqual(["/speak-to", '@"Brother Caddoc"']);
			// Tab picks nothing and stays native, so it can move focus on.
			expect(native).toBe(true);
			await fireEvent.keyDown(t.input, { key: "ArrowDown" });
			expect(t.rows()).toEqual([]);
			await t.sync();
			await t.enter();
			expect(t.onAttempt).toHaveBeenCalledTimes(1);
			expect(t.draft().utterance).toBe("ald");
		});

		it("keeps a written detail when Tab meets a sole fuzzy match inside its quotes", async () => {
			const rename = action('Rename: "quick"', "dm/rename");
			const t = mount({ actions: [nameAction, rename], prompts: [namePrompt] });
			await t.pick("/", /Name your character/);
			// `name:"qu"` fuzzy-matches exactly one row: Rename: "quick".
			const typed = '/name-your-character @"Aldwin" name:"qu"';
			await t.type(typed);
			await caretBeforeClosingQuote(t.input);
			const native = await fireEvent.keyDown(t.input, { key: "Tab" });
			expect(t.input.value).toBe(typed);
			expect(native).toBe(true);
			expect(t.legend()).toBe("Enter send");
			// The caret behind the closing quote still owns the whole detail.
			t.input.setSelectionRange(typed.length, typed.length);
			await fireEvent.select(t.input);
			await fireEvent.keyDown(t.input, { key: "Tab" });
			expect(t.input.value).toBe(typed);
			await t.sync();
			await t.enter();
			expect(t.draft().inputValues).toEqual({ name: "qu" });
		});

		it("leaves Tab native between empty quotes, where nothing matches", async () => {
			const t = mount({ actions: [nameAction], prompts: [namePrompt] });
			await t.pick("/", /Name your character/);
			await caretInsideQuotes(t.input);
			expect(await fireEvent.keyDown(t.input, { key: "Tab" })).toBe(true);
			expect(t.input.value).toBe('/name-your-character @"Aldwin" name:""');
		});

		it("names no picking key inside a value while a pick is still missing", async () => {
			const t = mount({ actions: [speak] });
			await t.pick("/", /Speak to/);
			// No person is picked; the caret sits behind the closing quote.
			await t.type('/speak-to "hi"');
			await t.sync();
			expect(t.status()).toContain("Speak to: who or what?");
			// Tab is native there and Enter is stopped: the legend names no key
			// at all and the blocker speaks alone (owner ruling 2026-11-13).
			expect(t.legend()).toBe("");
			// Outside the value the picking keys are named again.
			t.input.setSelectionRange(3, 3);
			await fireEvent.select(t.input);
			expect(t.legend()).toContain("Tab pick");
		});

		it("still completes a quoted name outside a value", async () => {
			const t = mount({ actions: [speak] });
			await t.pick("/", /Speak to/);
			await t.type('/speak-to @"Bro');
			await fireEvent.keyDown(t.input, { key: "Tab" });
			expect(t.input.value).toContain('/speak-to @"Brother Caddoc"');
		});

		it("hands an escaped quote in a detail and in speech to the attempt as written", async () => {
			const t = mount({ actions: [nameAction, speak], prompts: [namePrompt] });
			await t.pick("/", /Name your character/);
			await t.type('/name-your-character @"Aldwin" name:"Bran \\"the Bold\\" \\\\ Ash"');
			expect(t.fieldMarks()).toBe(1);
			expect(t.draft().inputValues).toEqual({ name: 'Bran "the Bold" \\ Ash' });
			await t.sync();
			await t.enter();
			expect(t.onAttempt).toHaveBeenCalledTimes(1);

			await t.type("");
			await t.pick("/", /Speak to/);
			await t.pick("/speak-to @", /Brother Caddoc/);
			await t.type('/speak-to @"Brother Caddoc" "He said \\"wait\\" twice"');
			expect(t.draft().utterance).toBe('He said "wait" twice');
			expect(t.status()).not.toContain("one pair of quotes");
		});
	});

	describe("a way out with an extra picked name (sk-jay0.1.8.109)", () => {
		const cellar = person("Cellar", "place_node:cellar");
		// Since the owner ruling of 2026-11-13 a click beside a way out only
		// selects, so the extra name here is one the player completed himself.

		it("names the extra piece instead of calling the way out gone, and goes once it is removed", async () => {
			const t = mount({ actions: [inspectAction], exits, targets: [aldwin, cellar] });
			await t.rerender({ insertion: { token: 1, exitHandle: "exit:north" } });
			await t.pick("/go-stairs #", /Cellar/);
			expect(t.input.value).toBe('/go-stairs #"Cellar"');
			expect(t.status()).not.toContain("no longer possible");
			expect(t.status()).toContain(
				'“/go-stairs” takes nothing else. Remove #"Cellar", then press Enter to send.',
			);
			expect(t.attemptButton().disabled).toBe(true);
			await t.enter();
			expect(t.onAttemptMove).not.toHaveBeenCalled();

			await t.type("/go-stairs");
			expect(t.status()).toContain("Go to Stairs.");
			await t.enter();
			expect(t.onAttemptMove).toHaveBeenCalledExactlyOnceWith("exit:north");
		});

		it("keeps the way out armed through an edit that leaves the extra name", async () => {
			const t = mount({ actions: [inspectAction], exits, targets: [aldwin, cellar] });
			await t.rerender({ insertion: { token: 1, exitHandle: "exit:north" } });
			await t.pick("/go-stairs #", /Cellar/);
			await t.type('/go-stairs #"Cellar" ');
			expect(t.status()).toContain("takes nothing else");
			await t.type("/go-stairs ");
			await t.sync();
			await t.enter();
			expect(t.onAttemptMove).toHaveBeenCalledExactlyOnceWith("exit:north");
		});

		it("replaces a go sentence and the name picked beside it", async () => {
			const t = mount({ actions: [inspectAction], exits, targets: [aldwin, cellar] });
			await t.rerender({ insertion: { token: 1, exitHandle: "exit:north" } });
			await t.pick("/go-stairs #", /Cellar/);
			expect(t.input.value).toBe('/go-stairs #"Cellar"');
			await t.rerender({ insertion: { token: 2, exitHandle: "exit:down" } });
			expect(t.input.value).toBe("/go-cellar");
			expect(t.boundTexts()).toEqual(["/go-cellar"]);
			expect(t.status()).not.toContain("unsent words");
			await t.sync();
			await t.enter();
			expect(t.onAttemptMove).toHaveBeenCalledExactlyOnceWith("exit:down");
		});

		it("follows the new place after a way-out click closed an open list", async () => {
			const t = mount({ actions: [inspectAction], exits });
			await t.type("/");
			await fireEvent.keyDown(t.input, { key: "Tab" });
			expect(t.rows().length).toBeGreaterThan(0);
			await t.rerender({ insertion: { token: 1, exitHandle: "exit:north" } });
			expect(t.rows()).toEqual([]);
			// The hero arrives: new facts, new ways out.
			await t.rerender({
				revision: 2,
				exits: [
					{ handle: "exit:up", rev: "4", label: "Up", to: "attic", toName: "Attic", gates: [] },
				],
			});
			await t.type("/go-a");
			expect(t.greyText()).toEqual(["ttic"]);
			await t.type("/go-attic");
			expect(t.errorMarks()).toBe(0);
			expect(t.status()).not.toContain("No observed action");
		});

		it("still says a way out is gone when it is, extra piece or not", async () => {
			const t = mount({ actions: [inspectAction], exits, targets: [aldwin, cellar] });
			await t.rerender({ insertion: { token: 1, exitHandle: "exit:north" } });
			await t.pick("/go-stairs #", /Cellar/);
			await t.rerender({ exits: [exits[1]] });
			expect(t.status()).toContain("That is no longer possible here.");
		});
	});

	describe("owner decisions of 2026-11-12, batch 3", () => {
		const slot = (n: number) =>
			action(`Answer ${n}`, `dm/dialog/choice/${n}`, {
				responseSlot: n,
				communicationSpeechActId: "dm/answer",
			});
		const classPrompt = {
			...namePrompt,
			occurrenceId: "class-1",
			responseActionIds: ["dm/dialog/choice/1"],
			presentation: {
				question: "What were you before?",
				labels: { "dm/dialog/choice/1": "Soldier" },
			},
		};

		it("lists no numbered answer slot while no open question names it", async () => {
			const t = mount({ actions: [inspectAction, slot(1), slot(2)] });
			await fireEvent.keyDown(t.input, { key: "ArrowDown" });
			expect(t.rows().some((row) => /Inspect/.test(row))).toBe(true);
			expect(t.rows().some((row) => /Answer \d/.test(row))).toBe(false);
			// Typed by hand it is not picked silently either.
			await fireEvent.keyDown(t.input, { key: "Escape" });
			await t.type("/answer-2");
			expect(t.status()).toContain("No observed action matches this text.");
			expect(t.boundTexts()).toEqual([]);
		});

		it("shows a slot only as the named answer of an open question", async () => {
			const t = mount({ actions: [inspectAction, slot(1), slot(2)], prompts: [classPrompt] });
			await fireEvent.keyDown(t.input, { key: "ArrowDown" });
			expect(t.rows().some((row) => /Soldier/.test(row))).toBe(true);
			expect(t.rows().some((row) => /Answer \d/.test(row))).toBe(false);
			expect(t.rows().some((row) => /Inspect/.test(row))).toBe(true);
			// A consumed question names nothing any more.
			await fireEvent.keyDown(t.input, { key: "Escape" });
			await t.rerender({ prompts: [{ ...classPrompt, consumed: true }], revision: 2 });
			await fireEvent.keyDown(t.input, { key: "ArrowDown" });
			expect(t.rows().some((row) => /Soldier|Answer \d/.test(row))).toBe(false);
		});

		it("keeps the answers of every open question, not only the first", async () => {
			const second = {
				...classPrompt,
				occurrenceId: "kit-1",
				responseActionIds: ["dm/dialog/choice/2"],
				presentation: { question: "Which kit?", labels: { "dm/dialog/choice/2": "Kit A" } },
			};
			const t = mount({ actions: [slot(1), slot(2), slot(3)], prompts: [classPrompt, second] });
			await fireEvent.keyDown(t.input, { key: "ArrowDown" });
			expect(t.rows().some((row) => /Soldier/.test(row))).toBe(true);
			expect(t.rows().some((row) => /Kit A/.test(row))).toBe(true);
			expect(t.rows().some((row) => /Answer \d/.test(row))).toBe(false);
			await t.pick("/", /Kit A/);
			expect(t.draft().actionId).toBe("dm/dialog/choice/2");
		});

		it("cuts a long answer's command text, keeps its full label, and still binds it", async () => {
			const kitA = "(A) Chain Mail, Greatsword, Flail, 8 Javelins, Dungeoneer's Pack, and 4 GP";
			const kitB = "(A) Chain Mail, Greatsword, Shortbow, 20 Arrows, and 11 GP";
			const longAction = action("Search every shelf of the old library", "srd/search-library");
			const kitPrompt = {
				...classPrompt,
				occurrenceId: "kit-1",
				responseActionIds: ["dm/dialog/choice/1", "dm/dialog/choice/2"],
				presentation: {
					question: "Which kit?",
					labels: { "dm/dialog/choice/1": kitA, "dm/dialog/choice/2": kitB },
				},
			};
			const longExits = [
				{
					handle: "exit:up",
					rev: "3",
					label: "Up",
					to: "loft",
					toName: "The Guest Loft Above The Common Room",
					gates: [],
				},
			];
			const t = mount({
				actions: [slot(1), slot(2), longAction],
				prompts: [kitPrompt],
				exits: longExits,
			});
			await fireEvent.keyDown(t.input, { key: "ArrowDown" });
			// The row keeps the whole label.
			expect(t.rows().some((row) => row.includes(kitA))).toBe(true);
			expect(t.rows().some((row) => row.includes(kitB))).toBe(true);
			await fireEvent.keyDown(t.input, { key: "Escape" });
			await t.pick("/", /Shortbow/);
			// Cut at a word boundary, and told apart from the other cut answer.
			expect(t.input.value).toBe('/a-chain-mail-greatsword-2 @"Aldwin"');
			expect(t.boundTexts()).toEqual(["/a-chain-mail-greatsword-2", '@"Aldwin"']);
			expect(t.draft().actionId).toBe("dm/dialog/choice/2");

			// Typing on past the cut still finds the answer by its full spelling,
			// and the token is not flagged as unknown.
			await t.type("/a-chain-mail-greatsword-shortbow");
			expect(t.status()).not.toContain("No observed action matches");
			await t.pick("/a-chain-mail-greatsword-shortbow", /Shortbow/);
			expect(t.boundTexts()).toContain("/a-chain-mail-greatsword-2");
			expect(t.draft().actionId).toBe("dm/dialog/choice/2");

			// Actions and ways out are not cut.
			await t.type("");
			await t.pick("/", /Search every shelf/);
			expect(t.input.value.startsWith("/search-every-shelf-of-the-old-library")).toBe(true);
			await t.type("");
			await t.pick("/", /Guest Loft/);
			expect(t.input.value).toBe("/go-the-guest-loft-above-the-common-room");
		});

		it("spells a way out by where it leads and keeps the direction in the row", async () => {
			const t = mount({ actions: [inspectAction], exits });
			await t.type("/stai");
			await fireEvent.keyDown(t.input, { key: "ArrowDown" });
			const row = t.row(/Stairs/).textContent ?? "";
			expect(row).toContain("Go — Stairs (North)");
			await fireEvent.click(t.row(/Stairs/));
			expect(t.input.value).toBe("/go-stairs");
			expect(t.boundTexts()).toEqual(["/go-stairs"]);
			await t.sync();
			await t.enter();
			expect(t.onAttemptMove).toHaveBeenCalledExactlyOnceWith("exit:north");
		});

		it("gives both ways out to the same place their direction", async () => {
			const twin = [
				{
					handle: "exit:north",
					rev: "3",
					label: "North",
					to: "stairs",
					toName: "Stairs",
					gates: [],
				},
				{
					handle: "exit:east",
					rev: "3",
					label: "East",
					to: "stairs-2",
					toName: "Stairs",
					gates: [],
				},
				{ handle: "exit:down", rev: "3", label: "Down", to: "cellar", toName: "Cellar", gates: [] },
			];
			const t = mount({ actions: [inspectAction], exits: twin });
			await t.rerender({ insertion: { token: 1, exitHandle: "exit:north" } });
			expect(t.input.value).toBe("/go-stairs-north");
			await t.rerender({ insertion: { token: 2, exitHandle: "exit:east" } });
			expect(t.input.value).toBe("/go-stairs-east");
			expect(t.boundTexts()).toEqual(["/go-stairs-east"]);
			await t.rerender({ insertion: { token: 3, exitHandle: "exit:down" } });
			expect(t.input.value).toBe("/go-cellar");
			await t.rerender({ insertion: { token: 4, exitHandle: "exit:east" } });
			await t.sync();
			await t.enter();
			expect(t.onAttemptMove).toHaveBeenCalledExactlyOnceWith("exit:east");
		});

		it("says the hero is down, and still leaves every attempt to the world", async () => {
			const t = mount({ actions: [inspectAction] });
			expect(t.status()).not.toContain("You are down");
			await t.rerender({ downed: true });
			expect(t.status()).toContain("You are down and cannot act right now.");
			await t.pick("/", /Inspect/);
			await t.pick("/inspect @", /Aldwin/);
			expect(t.status()).toContain("You are down and cannot act right now.");
			expect(t.status()).not.toContain("Press Enter to send.");
			expect(t.input.disabled).toBe(false);
			await t.enter();
			expect(t.onAttempt).toHaveBeenCalledOnce();
			// The world's own answer to an attempt is shown first.
			await t.rerender({ outcome: { text: "You are unconscious.", kind: "rejected" } });
			expect(t.status()).toContain("You are unconscious.");
			await t.rerender({ outcome: null, downed: false });
			expect(t.status()).not.toContain("You are down");
		});

		it("keeps an open question and a blocker ahead of the downed line", async () => {
			const question = {
				occurrenceId: "42",
				promptDefId: "dm/prompt/yes",
				contractVersion: 1,
				sourceRef: "entity:aldwin",
				sourceName: "Aldwin",
				responseActionIds: ["dm/yes"],
				openedAtTick: 3,
				consumed: false,
				presentation: { question: "Will you help?", labels: { "dm/yes": "Yes" } },
			};
			const t = mount({ actions: [inspectAction], prompts: [question], downed: true });
			// Empty box, question open: the question is the help line.
			expect(t.status()).toContain("From Aldwin: Will you help?");
			expect(t.status()).not.toContain("You are down");
			// A complete sentence: the downed line stands where "press Enter" would.
			await t.pick("/", /Inspect/);
			await t.pick("/inspect @", /Aldwin/);
			expect(t.status()).toContain("You are down and cannot act right now.");
			expect(t.status()).not.toContain("Press Enter to send.");
			// No question, half a sentence: the blocker says what is missing.
			await t.rerender({ prompts: [] });
			await t.type("/inspect");
			await t.sync();
			expect(t.status()).not.toContain("You are down");
			expect(t.status()).not.toBe("");
		});
	});

	describe("owner decisions of 2026-11-13, batch 7", () => {
		const cellar = person("Cellar", "place_node:cellar");
		const look = {
			id: "sense:look:local",
			label: "Look around",
			descriptor: "look",
			verb: "sensing",
			targetName: "",
			targetRef: "",
			acceptsUtterance: false,
			senseVisibility: "Local",
		};

		it("only selects when a name or map click meets an armed go sentence (G1)", async () => {
			const t = mount({ actions: [inspectAction], exits, targets: [aldwin, cellar] });
			await t.rerender({ insertion: { token: 1, exitHandle: "exit:north" } });
			await t.rerender({ prefillTargetRef: "place_node:cellar" });
			expect(t.input.value).toBe("/go-stairs");
			expect(t.boundTexts()).toEqual(["/go-stairs"]);
			expect(t.status()).toContain("Go to Stairs. Press Enter to set off.");
			// A second selection, and a typed-and-completed go sentence, behave alike.
			await t.rerender({ prefillTargetRef: "entity:aldwin" });
			expect(t.input.value).toBe("/go-stairs");
			await t.sync();
			await t.enter();
			expect(t.onAttemptMove).toHaveBeenCalledExactlyOnceWith("exit:north");
		});

		it("only selects beside a go sentence the player completed himself (G1)", async () => {
			const t = mount({ actions: [inspectAction], exits, targets: [aldwin, cellar] });
			await t.pick("/go-st", /Stairs/);
			await t.rerender({ prefillTargetRef: "place_node:cellar" });
			expect(t.input.value).toBe("/go-stairs");
			await t.enter();
			expect(t.onAttemptMove).toHaveBeenCalledExactlyOnceWith("exit:north");
		});

		it("only selects when a click meets an armed look sentence (G1)", async () => {
			const onAttemptSense = vi.fn();
			const t = mount({
				actions: [inspectAction],
				senseActions: [look],
				targets: [aldwin, cellar],
				onAttemptSense,
			});
			await t.pick("/", /Look around/);
			expect(t.input.value).toBe("/look");
			await t.rerender({ prefillTargetRef: "entity:aldwin" });
			expect(t.input.value).toBe("/look");
			expect(t.status()).not.toContain("takes nothing else");
			await t.enter();
			expect(onAttemptSense).toHaveBeenCalledExactlyOnceWith("sense:look:local");
		});

		it("only selects when a click meets an armed end-turn sentence (G1)", async () => {
			const onAttemptEndTurn = vi.fn();
			const t = mount({
				actions: [inspectAction],
				canEndTurn: true,
				targets: [aldwin, cellar],
				onAttemptEndTurn,
			});
			await t.pick("/", /End turn/);
			expect(t.input.value).toBe("/end-turn");
			await t.rerender({ prefillTargetRef: "place_node:cellar" });
			expect(t.input.value).toBe("/end-turn");
			await t.enter();
			expect(onAttemptEndTurn).toHaveBeenCalledTimes(1);
		});

		it("does not add the skipped name later, and prefills again once no route stands (G1)", async () => {
			const t = mount({ actions: [inspectAction], exits, targets: [aldwin, cellar] });
			await t.rerender({ insertion: { token: 1, exitHandle: "exit:north" } });
			await t.rerender({ prefillTargetRef: "place_node:cellar" });
			// Removing the way out does not bring the earlier selection into the box.
			await t.type("");
			expect(t.input.value).toBe("");
			// The next selection prefills as before.
			await t.rerender({ prefillTargetRef: "entity:aldwin" });
			expect(t.input.value).toBe('@"Aldwin"');
		});

		it("prefills again beside a route the world has withdrawn (G1)", async () => {
			const t = mount({ actions: [inspectAction], exits, targets: [aldwin, cellar] });
			await t.rerender({ insertion: { token: 1, exitHandle: "exit:north" } });
			expect(t.input.value).toBe("/go-stairs");
			// The Stairs way out goes while the sentence stands unchanged.
			await t.rerender({ exits: [exits[1]] });
			expect(t.status()).toContain("That is no longer possible here.");
			// No armed route stands any more, so the click's name reaches the box.
			await t.rerender({ prefillTargetRef: "entity:aldwin" });
			expect(t.input.value).toContain('@"Aldwin"');
			expect(t.onAttemptMove).not.toHaveBeenCalled();
		});

		it("still prefills beside an ordinary picked action (G1)", async () => {
			const t = mount({ actions: [inspectAction], exits, targets: [aldwin, cellar] });
			await t.pick("/", /Inspect/);
			await t.rerender({ prefillTargetRef: "place_node:cellar" });
			expect(t.input.value).toBe('/inspect #"Cellar"');
		});

		it("keeps the blocker for a name the player completed beside a route (G1)", async () => {
			const onAttemptEndTurn = vi.fn();
			const t = mount({
				actions: [inspectAction],
				exits,
				canEndTurn: true,
				targets: [aldwin, cellar],
				onAttemptEndTurn,
			});
			await t.rerender({ insertion: { token: 1, exitHandle: "exit:north" } });
			await t.pick("/go-stairs #", /Cellar/);
			expect(t.input.value).toBe('/go-stairs #"Cellar"');
			expect(t.status()).toContain(
				'“/go-stairs” takes nothing else. Remove #"Cellar", then press Enter to send.',
			);
			await t.enter();
			expect(t.onAttemptMove).not.toHaveBeenCalled();

			await t.type("");
			await t.pick("/", /End turn/);
			await t.pick("/end-turn @", /Aldwin/);
			expect(t.status()).toContain(
				'“/end-turn” takes nothing else. Remove @"Aldwin", then press Enter to send.',
			);
			await t.enter();
			expect(onAttemptEndTurn).not.toHaveBeenCalled();
		});

		it("drops a route whose own word a completion replaced (G1)", async () => {
			const t = mount({ actions: [inspectAction], exits, targets: [aldwin, cellar] });
			await t.rerender({ insertion: { token: 1, exitHandle: "exit:north" } });
			await t.pick("@", /Aldwin/);
			expect(t.input.value).toBe('@"Aldwin"');
			expect(t.status()).not.toContain("no longer possible");
			// No route stands any more, so a selection prefills again.
			await t.rerender({ prefillTargetRef: "place_node:cellar" });
			expect(t.input.value).toBe('#"Cellar"');
		});

		it("shows no key legend inside a value while the sentence is blocked (G2)", async () => {
			const t = mount({ actions: [speak] });
			await t.pick("/", /Speak to/);
			// A pick is missing and the caret sits behind the closing quote: Tab
			// picks nothing there and Enter is stopped.
			await t.type('/speak-to "hi"');
			await t.sync();
			expect(t.status()).toContain("Speak to: who or what?");
			expect(t.legend()).toBe("");
			// Outside the value the picking keys are named again.
			t.input.setSelectionRange(3, 3);
			await fireEvent.select(t.input);
			expect(t.legend()).toBe("Tab pick · → take grey text · ↑/↓ browse");

			// A needed detail is still empty: Enter is stopped there too.
			await t.type("");
			await t.rerender({ actions: [speak, nameAction], prompts: [namePrompt] });
			await t.pick("/", /Name your character/);
			await caretInsideQuotes(t.input);
			expect(t.status()).toContain("Write the Name between the quotes");
			expect(t.legend()).toBe("");
			// Once the value is written nothing stops Enter, and the legend says so.
			await t.type('/name-your-character @"Aldwin" name:"Bran"');
			await t.sync();
			expect(t.legend()).toBe("Enter send");
		});
	});
});
