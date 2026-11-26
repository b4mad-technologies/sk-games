import type { StreamFn } from "@earendil-works/pi-agent-core";

export type LoadProgress = {
	/** 0–1, matching WebLLM's InitProgressReport.progress. */
	progress: number;
	text: string;
};

/**
 * Pluggable in-browser (or later hosted) model seam.
 * Agent, tools, and chat UI talk only to this interface.
 */
export interface BrowserModelProvider {
	id: string;
	label: string;
	supportsTools: boolean;
	load(onProgress: (progress: LoadProgress) => void): Promise<void>;
	createStreamFn(): StreamFn;
	dispose(): void;
}
