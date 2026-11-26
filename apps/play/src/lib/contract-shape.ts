// Forwards the SDK's connect-time shape-check diagnostics (sk-jay0.7.389.3).
// In "warn" mode (hosted Play: VITE_SPELLKAVE_SHAPE_CHECK=warn, see main.ts)
// the SDK connects past a world-module shape this build cannot decode and
// emits one `contract_shape_mismatch` line per mismatch; Play turns each into
// a `play_contract_shape_mismatch` RUM action so the release check is one
// OpenObserve query. Every line is still written to the console, as the SDK's
// default sink would.
import type { PlayContractShapeMismatch, PlayRumProducer } from "./play-rum";

export function createShapeDiagnosticSink(
	rum: Pick<PlayRumProducer, "contractShapeMismatch">,
	log: (line: string) => void = (line) => console.warn(line),
): (line: object) => void {
	return (line) => {
		log(JSON.stringify(line));
		const l = line as Partial<PlayContractShapeMismatch> & { kind?: unknown };
		if (
			l.kind === "contract_shape_mismatch" &&
			typeof l.shape_item === "string" &&
			typeof l.shape_detail === "string" &&
			typeof l.shape_database === "string" &&
			typeof l.client_epoch === "number"
		) {
			rum.contractShapeMismatch?.({
				shape_item: l.shape_item,
				shape_detail: l.shape_detail,
				shape_database: l.shape_database,
				client_epoch: l.client_epoch,
			});
		}
	};
}
