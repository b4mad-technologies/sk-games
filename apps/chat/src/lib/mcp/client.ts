import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { type ListedMcpTool, mcpToolsToAgentTools } from "./agent-tools.ts";
import { curatedToolSet, DEFAULT_CURATED_MCP_TOOLS } from "./curated.ts";
import { DEFAULT_SPELLKAVE_MCP_URL, resolveMcpRequestUrl } from "./url.ts";

export { attachMcpTools } from "./attach.ts";
export {
	DEFAULT_SPELLKAVE_MCP_URL,
	readMcpResource,
	readMcpUrl,
	resolveMcpRequestUrl,
} from "./url.ts";

export interface SpellkaveMcpClient {
	listTools(): Promise<ListedMcpTool[]>;
	agentTools(): AgentTool[];
	callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
	disconnect(): Promise<void>;
}

interface ConnectOptions {
	url?: string;
	accessToken: string;
	/** Read the current credential for each request without rebuilding the agent. */
	getAccessToken?: () => string | null;
	allowlist?: readonly string[];
	fetchImpl?: typeof fetch;
}

export async function connectSpellkaveMcp(options: ConnectOptions): Promise<SpellkaveMcpClient> {
	const configured = options.url ?? DEFAULT_SPELLKAVE_MCP_URL;
	const origin =
		typeof window !== "undefined" && window.location?.origin
			? window.location.origin
			: "http://127.0.0.1";
	const url = resolveMcpRequestUrl(configured, origin);
	const allowlist = curatedToolSet(options.allowlist ?? DEFAULT_CURATED_MCP_TOOLS);
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	const transport = new StreamableHTTPClientTransport(new URL(url), {
		fetch: (input, init) => {
			const headers = new Headers(input instanceof Request ? input.headers : undefined);
			new Headers(init?.headers).forEach((value, name) => {
				headers.set(name, value);
			});
			const token = options.getAccessToken ? options.getAccessToken() : options.accessToken;
			const target = new URL(input instanceof Request ? input.url : String(input), url);
			if (target.origin === new URL(url).origin && token)
				headers.set("Authorization", `Bearer ${token}`);
			else headers.delete("Authorization");
			return fetchImpl(input, { ...init, headers });
		},
	});
	const mcp = new Client({ name: "spellkave-chat", version: "0.0.0" });
	await mcp.connect(transport);
	let listed: ListedMcpTool[] = [];
	let tools: AgentTool[] = [];

	const client: SpellkaveMcpClient = {
		async listTools() {
			const result = await mcp.listTools();
			listed = result.tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema,
			}));
			tools = mcpToolsToAgentTools(listed, client, allowlist);
			return listed;
		},
		agentTools() {
			return tools;
		},
		async callTool(name, args) {
			return mcp.callTool({ name, arguments: args });
		},
		async disconnect() {
			await mcp.close();
		},
	};
	await client.listTools();
	return client;
}
