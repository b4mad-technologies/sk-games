import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { SubmitFeedbackResult } from "../lib/feedback";
import { type PlayObservation, playObservation } from "../lib/play-observation";
import FeedbackDialog from "./FeedbackDialog.svelte";

type Submit = (
	input: { message: string; category: string },
	opts: { gatewayOrigin: string; accessToken: string },
) => Promise<SubmitFeedbackResult>;

/**
 * `open` starts `true`: `App.svelte` owns the trigger row and this prop
 * (`bind:open`), so this component's OWN tests exercise it already open — the
 * row/trigger and the App-level open/close round trip are covered where they
 * actually live, `App.smoke.test.ts`.
 */
function renderOpenDialog(options: { submit?: Submit } = {}): void {
	render(FeedbackDialog, {
		open: true,
		gatewayOrigin: "https://mcp.spellkave.test",
		accessToken: "seat-token",
		// biome-ignore lint/suspicious/noExplicitAny: test seam, loosely typed on purpose
		submit: options.submit as any,
	});
}

describe("FeedbackDialog", () => {
	it("explains the automatic report without an opt-out and starts with Send disabled", () => {
		renderOpenDialog();
		expect(screen.getByRole("heading", { name: "Send feedback" })).toBeTruthy();
		expect(screen.queryByRole("checkbox")).toBeNull();
		expect(screen.getByText(/A diagnostic report is attached automatically/)).toBeTruthy();
		expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
	});

	it("keeps Send disabled until a category and a message are both present", async () => {
		renderOpenDialog();
		const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
		expect(send.disabled).toBe(true);
		await fireEvent.click(screen.getByRole("radio", { name: "Bug" }));
		expect(send.disabled).toBe(true);
		await fireEvent.input(screen.getByLabelText("What happened?"), {
			target: { value: "The exit chip clips on my phone." },
		});
		expect(send.disabled).toBe(false);
	});

	it("submits the message and records status without exposing feedback text", async () => {
		const events: PlayObservation[] = [];
		playObservation.subscribe((e) => events.push(e));
		const submit = vi.fn(async () => ({ ok: true as const, issueUrl: "local-feedback-1" }));
		renderOpenDialog({ submit });
		await fireEvent.click(screen.getByRole("radio", { name: "Bug" }));
		await fireEvent.input(screen.getByLabelText("What happened?"), {
			target: { value: "The exit chip clips on my phone." },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Send" }));
		expect(submit).toHaveBeenCalledWith(
			{ message: "The exit chip clips on my phone.", category: "bug" },
			{ gatewayOrigin: "https://mcp.spellkave.test", accessToken: "seat-token" },
		);
		expect(events.filter((e) => e.phase === "feedback").map((e) => e.feedback_state)).toEqual([
			"opened",
			"sending",
			"sent",
		]);
		expect(JSON.stringify(events)).not.toContain("The exit chip");
		playObservation.subscribe(() => {});
	});

	it("shows the created issue link as a text-backed result on success", async () => {
		const submit = vi.fn(async () => ({
			ok: true as const,
			issueUrl: "https://github.com/b4mad-technologies/sk-games/issues/9001",
		}));
		renderOpenDialog({ submit });
		await fireEvent.click(screen.getByRole("radio", { name: "Idea" }));
		await fireEvent.input(screen.getByLabelText("What happened?"), {
			target: { value: "A pack sort would help." },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Send" }));
		const link = await screen.findByRole("link", { name: "View the issue" });
		expect(link.getAttribute("href")).toBe("https://github.com/b4mad-technologies/sk-games/issues/9001");
	});

	it("shows a reference without a link when the sink returns a non-URL reference", async () => {
		const submit = vi.fn(async () => ({ ok: true as const, issueUrl: "local-feedback-1" }));
		renderOpenDialog({ submit });
		await fireEvent.click(screen.getByRole("radio", { name: "Idea" }));
		await fireEvent.input(screen.getByLabelText("What happened?"), {
			target: { value: "A pack sort would help." },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Send" }));
		expect(await screen.findByText("local-feedback-1")).toBeTruthy();
		expect(screen.queryByRole("link", { name: "View the issue" })).toBeNull();
	});

	it("shows a text-backed rate-limited state", async () => {
		const submit = vi.fn(async () => ({
			ok: false as const,
			reason: "rate_limited" as const,
			message: "Feedback rate limit reached for this seat. Try again in about 12s.",
		}));
		renderOpenDialog({ submit });
		await fireEvent.click(screen.getByRole("radio", { name: "Confusing" }));
		await fireEvent.input(screen.getByLabelText("What happened?"), {
			target: { value: "Where did my hero go?" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Send" }));
		expect(
			await screen.findByText("Feedback rate limit reached for this seat. Try again in about 12s."),
		).toBeTruthy();
	});

	it("shows a text-backed failed state", async () => {
		const submit = vi.fn(async () => ({
			ok: false as const,
			reason: "failed" as const,
			message: "Could not send feedback right now. Try again in a moment.",
		}));
		renderOpenDialog({ submit });
		await fireEvent.click(screen.getByRole("radio", { name: "Bug" }));
		await fireEvent.input(screen.getByLabelText("What happened?"), {
			target: { value: "It broke." },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Send" }));
		expect(
			await screen.findByText("Could not send feedback right now. Try again in a moment."),
		).toBeTruthy();
	});

	it("does not submit when Cancel is clicked", async () => {
		const submit = vi.fn();
		renderOpenDialog({ submit });
		await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(submit).not.toHaveBeenCalled();
	});
});
