/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** The world's gateway, for authored pictures. Unset: SRD art and glyphs only. */
	readonly VITE_SPELLKAVE_GATEWAY_URL?: string;
}

/** The staged local world, or null. Served by `vite.config.ts` in dev only. */
declare module "virtual:classic-dev-local" {
	const config: { url: string; db: string; actorId: string; token: string; slug: string } | null;
	export default config;
}

// The Play session library reads these two; `vite.config.ts` turns both off.
declare module "virtual:spellkave-run-events-config" {
	const runEventsConfig: string | null;
	export default runEventsConfig;
}

declare module "virtual:spellkave-local-rum" {
	const config: import("../../play/src/lib/local-rum-config").LocalRumConfig | null;
	export default config;
}
