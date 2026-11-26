import { requireLoginOrigin } from "@spellkave/authkit/vite";
import { spellkaveThemeBoot } from "@spellkave/ui/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig, type ViteUserConfig } from "vitest/config";
import { prepareMcpProxyRequest } from "./src/lib/mcp/dev-proxy.ts";

const isolationHeaders = {
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Embedder-Policy": "credentialless",
};

function mcpDevProxy(): Record<string, object> | undefined {
	const target = process.env.SPELLKAVE_MCP_DEV_PROXY_TARGET?.trim() ?? "";
	if (target === "") return undefined;
	const host = process.env.SPELLKAVE_MCP_DEV_PROXY_HOST?.trim() || "mcp.spellkave.com";
	return {
		"/mcp": {
			target,
			changeOrigin: false,
			secure: false,
			timeout: 0,
			proxyTimeout: 0,
			headers: { host },
			configure(proxy: {
				on: (
					event: string,
					listener: (proxyReq: {
						removeHeader: (name: string) => void;
						setHeader: (name: string, value: string) => void;
					}) => void,
				) => void;
			}) {
				proxy.on("proxyReq", (proxyReq) => {
					prepareMcpProxyRequest(proxyReq, host);
				});
			},
		},
	};
}

const proxy = mcpDevProxy();

export default defineConfig({
	plugins: [
		requireLoginOrigin(),
		spellkaveThemeBoot(),
		tailwindcss(),
		svelte(),
		svelteTesting(),
	] as ViteUserConfig["plugins"],
	worker: { format: "es" },
	server: { headers: isolationHeaders, ...(proxy === undefined ? {} : { proxy }) },
	preview: { headers: isolationHeaders, ...(proxy === undefined ? {} : { proxy }) },
	test: {
		environment: "jsdom",
		include: ["src/**/*.test.ts"],
		setupFiles: ["src/test/setup.ts", "@spellkave/ui/vitest-jsdom-teardown"],
	},
});
