/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_WORKOS_CLIENT_ID?: string;
	readonly VITE_WORKOS_ISSUER?: string;
	readonly VITE_SPELLKAVE_MCP_URL?: string;
	readonly VITE_SPELLKAVE_MCP_RESOURCE?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
