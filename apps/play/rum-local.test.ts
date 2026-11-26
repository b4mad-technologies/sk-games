// @vitest-environment node
import { createServer, type IncomingMessage, request, type ServerResponse } from "node:http";
import type { ViteDevServer } from "vite";
import { afterEach, expect, it, vi } from "vitest";
import { localRumPlugin } from "./rum-local";

afterEach(() => vi.unstubAllGlobals());

it("bounds the private relay and rejects foreign origins before forwarding", async () => {
	const upstream = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
	vi.stubGlobal("fetch", upstream);
	const server = createServer();
	const plugin = localRumPlugin({
		applicationId: "public",
		clientToken: "public",
		version: "test",
		environment: "local-test",
		worldSlug: "test",
	}, "https://rum.example.test:15443/rum/v1/default/rum");
	const configure = plugin.configureServer;
	if (typeof configure !== "function") throw new Error("Expected middleware hook");
	configure.call(
		{} as never,
		{
			middlewares: {
				use(handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) {
					server.on("request", (req, res) =>
						handler(req, res, () => {
							res.statusCode = 404;
							res.end();
						}),
					);
				},
			},
		} as unknown as ViteDevServer,
	);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (address === null || typeof address === "string") throw new Error("Missing port");
	const origin = `http://127.0.0.1:${address.port}`;
	const send = (from: string, body = "{}", method = "POST") =>
		new Promise<number>((resolve, reject) => {
			const req = request(
				`${origin}/__rum?token=public`,
				{ method, headers: { origin: from } },
				(res) => {
					res.resume();
					res.on("end", () => resolve(res.statusCode!));
				},
			);
			req.on("error", reject);
			req.end(body);
		});
	try {
		expect(await send("https://foreign.example")).toBe(403);
		expect(await send(origin, "", "GET")).toBe(403);
		expect(await send(origin, "x".repeat(256001))).toBe(413);
		expect(upstream).not.toHaveBeenCalled();
		expect(await send(origin)).toBe(202);
		expect(String(upstream.mock.calls[0]?.[0])).toBe(
			"https://rum.example.test:15443/rum/v1/default/rum?token=public",
		);
	} finally {
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
});

it("takes the relay destination only from an https operator setting", async () => {
	const { readLocalRumUpstream } = await import("./src/lib/local-rum-config");
	expect(readLocalRumUpstream({})).toBeNull();
	expect(readLocalRumUpstream({ SPELLKAVE_RUM_DIAGNOSTIC_UPSTREAM: "http://rum.example.test/rum" })).toBeNull();
	expect(readLocalRumUpstream({ SPELLKAVE_RUM_DIAGNOSTIC_UPSTREAM: "https://rum.example.test/rum?x=1" })).toBeNull();
	expect(readLocalRumUpstream({ SPELLKAVE_RUM_DIAGNOSTIC_UPSTREAM: " https://rum.example.test/rum " })).toBe(
		"https://rum.example.test/rum",
	);
	expect(localRumPlugin(null, "https://rum.example.test/rum").configureServer).toBeTypeOf("function");
});
