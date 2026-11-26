/// <reference types="vite/client" />

declare module "virtual:spellkave-local-rum" {
	const config: import("./lib/local-rum-config").LocalRumConfig | null;
	export default config;
}

interface ImportMetaEnv {
	readonly VITE_SPELLKAVE_API_URL?: string;
	readonly VITE_SPELLKAVE_GATEWAY_URL?: string;
	readonly VITE_SPELLKAVE_PUBLIC_SITE_URL?: string;
	readonly VITE_SPELLKAVE_DOCS_URL?: string;
	/** `warn` downgrades the SDK connect-time shape check to a diagnostic (emergency lever). */
	readonly VITE_SPELLKAVE_SHAPE_CHECK?: string;
	readonly VITE_SPELLKAVE_RUM_APPLICATION_ID?: string;
	readonly VITE_SPELLKAVE_RUM_CLIENT_TOKEN?: string;
	readonly VITE_SPELLKAVE_RUM_VERSION?: string;
	readonly VITE_SPELLKAVE_RUM_SESSION_SAMPLE_RATE?: string;
	readonly VITE_SPELLKAVE_WORLD_URL?: string;
	readonly VITE_WORKOS_CLIENT_ID?: string;
	readonly VITE_WORKOS_ISSUER?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

/**
 * DEV-only local-play config, served by `vite.config.ts` from a `just
 * play-stage` profile. A JSON string, or `null` in any build where no profile
 * resolved — always so in production. See `src/lib/dev-local.ts`.
 */
declare module "virtual:spellkave-dev-local" {
	const devLocal: string | null;
	export default devLocal;
}

/**
 * Local/dev world-actor run-events producer config, served by
 * `vite.config.ts` from shell env (`VITE_SPELLKAVE_RUN_EVENTS` /
 * `SPELLKAVE_RUN_EVENTS`, `SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT`,
 * `SPELLKAVE_WORLD_SLUG`). A JSON string, or `null` when unconfigured or in
 * production. See `src/lib/play-telemetry.ts` (sk-jay0.6.39).
 */
declare module "virtual:spellkave-run-events-config" {
	const runEventsConfig: string | null;
	export default runEventsConfig;
}
