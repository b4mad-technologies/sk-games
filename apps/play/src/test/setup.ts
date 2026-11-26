if (typeof URL.createObjectURL !== "function") URL.createObjectURL = () => "blob:test";
if (typeof URL.revokeObjectURL !== "function") URL.revokeObjectURL = () => {};

// Keep browser tests offline while allowing the same static reference renderer
// used by production Play and the Creation playground. Individual tests may
// replace this with their own fetch mock.
const nativeFetch = globalThis.fetch;
if (nativeFetch) {
	globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		if (String(input).endsWith("/compendium/docs/references.json"))
			return Promise.resolve(
				new Response(JSON.stringify({ version: 1, targets: [] }), { status: 200 }),
			);
		return nativeFetch(input, init);
	}) as typeof fetch;
}
