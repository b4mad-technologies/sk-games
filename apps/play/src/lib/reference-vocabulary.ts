import {
	compileReferenceMatcher,
	type ReferenceTarget,
} from "@spellkave/ui-widgets/reference-matching";

export interface PlayReferenceTarget extends ReferenceTarget {
	previewHref?: string;
}
export interface ReferenceVocabulary {
	version: 1;
	targets: PlayReferenceTarget[];
}

const vocabularyCache = new Map<string, Promise<ReferenceVocabulary | null>>();
const matcherCache = new Map<
	string,
	Promise<ReturnType<typeof compileReferenceMatcher<PlayReferenceTarget>> | null>
>();

function isTarget(value: unknown): value is ReferenceTarget {
	if (typeof value !== "object" || value === null) return false;
	const row = value as Record<string, unknown>;
	return (
		typeof row.label === "string" &&
		typeof row.kind === "string" &&
		typeof row.ref === "string" &&
		typeof row.href === "string"
	);
}

function readVocabulary(value: unknown): ReferenceVocabulary | null {
	if (typeof value !== "object" || value === null) return null;
	const row = value as Record<string, unknown>;
	if (row.version !== 1 || !Array.isArray(row.targets)) return null;
	const targets = row.targets.filter(isTarget);
	return targets.length === row.targets.length ? { version: 1, targets } : null;
}

/**
 * Fetch the public, static reference vocabulary once per URL. A failed or
 * malformed endpoint is deliberately cached as unavailable for this page;
 * prose remains plain text and no world/mock transport is involved. Shared
 * by `loadReferenceMatcher` (name matching) and `findReferenceTargetByRef`
 * (exact definition-id matching, sk-jay0.1.8.63.9) so both draw from the
 * same one-fetch-per-URL cache.
 */
function loadVocabulary(
	url: string,
	fetchImpl: typeof fetch = fetch,
): Promise<ReferenceVocabulary | null> {
	let pending = vocabularyCache.get(url);
	if (pending !== undefined) return pending;
	const controller = new AbortController();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<null>((resolve) => {
		timeout = setTimeout(() => {
			controller.abort();
			resolve(null);
		}, 2_000);
	});
	const request = Promise.resolve()
		.then(() =>
			fetchImpl(url, {
				cache: "default",
				credentials: "omit",
				referrerPolicy: "no-referrer",
				signal: controller.signal,
			}),
		)
		.then(async (response) => (response.ok ? readVocabulary(await response.json()) : null))
		.catch(() => null);
	pending = Promise.race([request, deadline]).finally(() => clearTimeout(timeout));
	vocabularyCache.set(url, pending);
	return pending;
}

export function loadReferenceMatcher(
	url: string,
	fetchImpl: typeof fetch = fetch,
): Promise<ReturnType<typeof compileReferenceMatcher<PlayReferenceTarget>> | null> {
	let pending = matcherCache.get(url);
	if (pending !== undefined) return pending;
	pending = loadVocabulary(url, fetchImpl)
		.then((vocabulary) =>
			vocabulary === null ? null : compileReferenceMatcher(vocabulary.targets),
		)
		// `compileReferenceMatcher` throws on an unsafe/empty target field (a
		// malformed feed) — this stays "no matcher", never an unhandled
		// rejection, matching every other malformed-feed shape here.
		.catch(() => null);
	matcherCache.set(url, pending);
	return pending;
}

/**
 * Exact lookup by authored definition id (e.g. `srd/creature/goblin-warrior`)
 * against the SAME public vocabulary `loadReferenceMatcher` compiles —
 * `ref` is the website's own catalogue reference (verified against
 * `apps/website/src/compendium/reference-vocabulary.ts` and its tests: a
 * creature's `ref` is exactly its `entity_def_id`, e.g.
 * `srd/creature/goblin-warrior`), so no id-form mapping is needed. Returns
 * `null` when the vocabulary is unavailable or carries no exact match.
 */
export async function findReferenceTargetByRef(
	url: string,
	ref: string,
	fetchImpl: typeof fetch = fetch,
): Promise<PlayReferenceTarget | null> {
	const vocabulary = await loadVocabulary(url, fetchImpl);
	return vocabulary?.targets.find((target) => target.ref === ref) ?? null;
}

export function referenceVocabularyUrl(env: Record<string, string | undefined>): string {
	const configured = env.VITE_SPELLKAVE_DOCS_URL?.trim() ?? "";
	let base = "https://spellkave.com";
	if (configured !== "") {
		try {
			const parsed = new URL(configured);
			if (parsed.protocol === "https:" || parsed.protocol === "http:") base = parsed.origin;
		} catch {
			// Fall back to the known public docs origin.
		}
	}
	return `${base}/compendium/docs/references.json`;
}

/**
 * Public reference entries are only actionable when they remain on the
 * configured documentation origin and beneath its player-readable docs tree.
 * Keep this guard shared by prose and action-adjacent reference affordances.
 */
export function safeReferenceHref(href: string, docsOrigin: string): string | null {
	try {
		const resolved = new URL(href, docsOrigin);
		return resolved.origin === docsOrigin && resolved.pathname.startsWith("/docs/")
			? resolved.href
			: null;
	} catch {
		return null;
	}
}

export function clearReferenceVocabularyCache(): void {
	vocabularyCache.clear();
	matcherCache.clear();
}
