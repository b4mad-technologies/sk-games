/**
 * Curated WebLLM models. Tool support is WebLLM 0.2.84 `functionCallingModelIds`.
 * VRAM from `prebuiltAppConfig.model_list[].vram_required_MB`:
 *   Hermes-2-Pro-Mistral-7B-q4f16_1-MLC     4033.28  ← selected (smallest)
 *   Hermes-3-Llama-3.1-8B-q4f16_1-MLC       4876.13
 *   Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC     4976.13
 *   Hermes-3-Llama-3.1-8B-q4f32_1-MLC       5779.27
 *   Hermes-2-Pro-Llama-3-8B-q4f32_1-MLC     6051.27
 * One entry so a later swap is a one-line change.
 */

export type CatalogEntry = {
	id: string;
	label: string;
	supportsTools: boolean;
	contextWindow: number;
	maxTokens: number;
	/** WebLLM `vram_required_MB`. */
	vramMb: number;
	sizeLabel: string;
};

const HERMES_2_PRO_MISTRAL_7B: CatalogEntry = {
	id: "Hermes-2-Pro-Mistral-7B-q4f16_1-MLC",
	label: "Hermes 2 Pro Mistral 7B",
	supportsTools: true,
	contextWindow: 4096,
	maxTokens: 1024,
	vramMb: 4033.28,
	sizeLabel: "4.0 GB VRAM",
};

export const CATALOG: readonly CatalogEntry[] = [HERMES_2_PRO_MISTRAL_7B];

export const DEFAULT_MODEL_ID = HERMES_2_PRO_MISTRAL_7B.id;

export function catalogEntry(id: string = DEFAULT_MODEL_ID): CatalogEntry {
	const entry = CATALOG.find((item) => item.id === id);
	if (entry === undefined) {
		throw new Error(`Unknown catalog model: ${id}`);
	}
	return entry;
}
