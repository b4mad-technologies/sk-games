/**
 * The seam between the Table stream/dock, Place details and the website's public
 * compendium vocabulary. `def:<entityDefId>` info cards, and the stream's
 * own free-prose term matching, resolve through this module and this module
 * alone — no other file backing the stream or the dock may import
 * `reference-vocabulary.ts` or `ReferencePreview` directly (apps/play/
 * CLAUDE.md, "Public reference links"). This is a TEMPORARY source: the
 * world has no read for entity/definition prose yet
 * (sk-jay0.1.8.63.11 tracks moving `def:` cards to one), so it stands in
 * with the same static, display-only, credential-free feed every other Play
 * reference affordance already uses.
 *
 * Other Play tiles (Thread's card-level quote) are unaffected — they keep reading `reference-vocabulary.ts` and
 * `ReferencePreview` directly, exactly as they do today.
 */

import type { DefinitionCardSource } from "./info-cards";
import { loadReferencePreview, previewUrl } from "./reference-preview";
import {
	findReferenceTargetByRef,
	loadReferenceMatcher,
	referenceVocabularyUrl,
	safeReferenceHref,
} from "./reference-vocabulary";

const docsUrl = referenceVocabularyUrl(import.meta.env as Record<string, string | undefined>);
const docsOrigin = new URL(docsUrl).origin;

/** `def:<entityDefId>` → title/description/link, or `null` when the public
 * vocabulary has no exact match (or is unavailable) — the card renders its
 * own not-found state, never an invented title. */
export async function readDefinitionCard(
	entityDefId: string,
): Promise<DefinitionCardSource | null> {
	const target = await findReferenceTargetByRef(docsUrl, entityDefId);
	if (target === null) return null;
	const href = safeReferenceHref(target.href, docsOrigin);
	if (href === null) return null;
	const previewSourceUrl = previewUrl(target.previewHref, new URL(href).origin);
	const preview = previewSourceUrl ? await loadReferencePreview(previewSourceUrl) : null;
	return {
		title: preview?.title ?? target.label,
		...(preview?.description ? { description: preview.description } : {}),
		href,
	};
}

/** The compiled term matcher `DefLinkText.svelte` matches free prose
 * against — the SAME one-fetch-per-URL cache every other Play reference
 * affordance already shares, pre-bound to the one docs origin so no caller
 * outside this module ever passes `reference-vocabulary.ts`'s own URL/fetch
 * plumbing around. */
export function loadDefLinkMatcher(fetchImpl: typeof fetch = fetch) {
	return loadReferenceMatcher(docsUrl, fetchImpl);
}

export type { PlayReferenceTarget } from "./reference-vocabulary";
