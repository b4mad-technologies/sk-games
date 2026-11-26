import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import { catalogEntry } from "../lib/llm/catalog";
import ModelPicker from "./ModelPicker.svelte";

describe("ModelPicker", () => {
	it("shows the single catalog model name, size, and a Load model button", () => {
		const entry = catalogEntry();
		render(ModelPicker, { onReady: () => undefined });
		expect(screen.getByTestId("model-picker")).toBeTruthy();
		expect(screen.getByTestId("model-name").textContent).toContain(entry.label);
		expect(screen.getByTestId("model-name").textContent).toContain(entry.sizeLabel);
		expect(screen.queryByRole("combobox")).toBeNull();
		expect(screen.queryByTestId("model-select")).toBeNull();
		expect(screen.getByTestId("model-load").textContent).toMatch(/load model/i);
	});
});
