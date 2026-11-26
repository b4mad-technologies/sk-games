import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import { TRANSCRIPT_FIXTURE } from "../../lib/transcript.fixture";
import Transcript from "./Transcript.svelte";

describe("Transcript", () => {
	it("renders each recorded message kind", () => {
		render(Transcript, { props: { messages: TRANSCRIPT_FIXTURE } });
		expect(screen.getByTestId("chat-user").textContent).toMatch(/Look around/);
		expect(screen.getAllByTestId("chat-assistant")[0]?.textContent).toMatch(/Checking the scene/);
		expect(screen.getByTestId("chat-tool-call").textContent).toMatch(/spellkave_orient/);
		expect(screen.getByTestId("chat-tool-call").textContent).toMatch(/← ok/);
		expect(screen.getByTestId("chat-aborted").textContent).toMatch(/aborted/i);
		expect(screen.getByTestId("chat-error").textContent).toMatch(/model failed/);
	});
});
