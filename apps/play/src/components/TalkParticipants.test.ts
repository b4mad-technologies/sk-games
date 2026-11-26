import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import TalkParticipants from "./TalkParticipants.svelte";

describe("TalkParticipants (sk-jay0.1.8.12, extracted at sk-jay0.1.8.63.1 Part B)", () => {
	it("participant head: a first tap targets, a second tap on the SAME already-targeted participant toggles the view filter", async () => {
		const onSetTarget = vi.fn();
		const onToggleFilter = vi.fn();
		render(TalkParticipants, {
			participants: [
				{ id: "4", name: "Aldwin, keeper of the hearth-ledger", kind: "person" },
				{ id: "9", name: "Brother Caddoc", kind: "person" },
			],
			targetName: "Brother Caddoc",
			onSetTarget,
			filterId: null,
			onToggleFilter,
		});
		// Not yet the target: tapping Aldwin sets him as the target and clears
		// any filter — never toggles a filter on the first tap.
		await fireEvent.click(
			screen.getByRole("button", { name: /Aldwin, keeper of the hearth-ledger/ }),
		);
		expect(onSetTarget).toHaveBeenCalledWith(
			expect.objectContaining({ id: "4", name: "Aldwin, keeper of the hearth-ledger" }),
		);
		expect(onToggleFilter).toHaveBeenCalledWith(null);

		onToggleFilter.mockClear();
		// Already the target (Brother Caddoc, per `targetName`): tapping him
		// again is the SECOND tap — the view filter, not another target-set.
		await fireEvent.click(screen.getByRole("button", { name: "Brother Caddoc" }));
		expect(onToggleFilter).toHaveBeenCalledWith("9");
	});

	it("shows the 'everyone still hears everything' notice only while filtered", () => {
		const { rerender } = render(TalkParticipants, {
			participants: [{ id: "4", name: "Aldwin, keeper of the hearth-ledger", kind: "person" }],
			targetName: "Aldwin, keeper of the hearth-ledger",
			filterId: null,
		});
		expect(screen.queryByText(/everyone here still hears everything/)).toBeNull();
		rerender({
			participants: [{ id: "4", name: "Aldwin, keeper of the hearth-ledger", kind: "person" }],
			targetName: "Aldwin, keeper of the hearth-ledger",
			filterId: "4",
		});
		expect(screen.getByText(/everyone here still hears everything/)).toBeTruthy();
	});

	it("renders nothing when nobody addressable is here", () => {
		const { container } = render(TalkParticipants, { participants: [] });
		expect(container.querySelector('[data-slot="talk-participants"]')).toBeNull();
	});
});
