import { describe, expect, it, vi } from "vitest";
import { createShapeDiagnosticSink } from "./contract-shape";

describe("createShapeDiagnosticSink", () => {
	it("forwards each contract_shape_mismatch line to RUM and logs every line", () => {
		const rum = { contractShapeMismatch: vi.fn() };
		const log = vi.fn();
		const sink = createShapeDiagnosticSink(rum, log);
		sink({ kind: "binding_drift_additive", additions: { tables: [], reducers: [] } });
		sink({
			kind: "contract_shape_mismatch",
			shape_mode: "warn",
			shape_database: "elven-mini-1",
			shape_item: "table actor",
			shape_detail: "column 2 changed: name: String -> name: U32",
			client_epoch: 1,
		});
		expect(log).toHaveBeenCalledTimes(2);
		expect(rum.contractShapeMismatch).toHaveBeenCalledOnce();
		expect(rum.contractShapeMismatch).toHaveBeenCalledWith({
			shape_item: "table actor",
			shape_detail: "column 2 changed: name: String -> name: U32",
			shape_database: "elven-mini-1",
			client_epoch: 1,
		});
	});
});
