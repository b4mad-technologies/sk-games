/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** `warn` downgrades the SDK connect-time shape check to a log line (sk-jay0.7.389.3). */
	readonly VITE_SPELLKAVE_SHAPE_CHECK?: string;
	readonly VITE_SPELLKAVE_GATEWAY_URL?: string;
	readonly VITE_SPELLKAVE_PUBLIC_SITE_URL?: string;
	readonly VITE_SPELLKAVE_PLAY_URL?: string;
	readonly VITE_WORKOS_CLIENT_ID?: string;
	readonly VITE_WORKOS_ISSUER?: string;
	/** DEV-only: absolute path to a play-stage token file (read by vite.config). */
	readonly VITE_SPELLKAVE_DEV_TOKEN_FILE?: string;
	/** DEV-only: token contents injected by vite.config from the file above. */
	readonly VITE_SPELLKAVE_DEV_TOKEN?: string;
	/** DEV-only: override catalog world db name for the local node. */
	readonly VITE_SPELLKAVE_DEV_DB?: string;
	readonly DEV: boolean;
	readonly PROD: boolean;
	readonly MODE: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
