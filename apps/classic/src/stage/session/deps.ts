// What the live world reaches outside itself, for real: the Play session, its
// trail, the bundled SRD sprites and the world's gateway.
//
// Kept apart from `world.svelte.ts` so a test can drive that class without
// opening a session.

import { openPlaySession } from "../../../../play/src/lib/play-session";
// Known debt (sk-jay0.1.76.7): the handle returns only the answer's sentence,
// so "was that a refusal" is read from the session's own trail, the way
// apps/play's App.svelte does. It moves into the package with the session.
import { playTrail } from "../../../../play/src/lib/play-trail";
// The guide's short text of a definition: the same loader the reference
// preview uses, and the same debt (sk-jay0.1.76.7).
import { loadReferencePreview, previewUrl } from "../../../../play/src/lib/reference-preview";
import {
	findReferenceTargetByRef,
	referenceVocabularyUrl,
	safeReferenceHref,
} from "../../../../play/src/lib/reference-vocabulary";
import { srdArtUrl } from "../../lib/srd-art";
import { gatewayFetch, gatewayOrigin, worldArtStore } from "../../lib/world-art";
import type { LiveConfig, LiveDeps } from "./world.svelte";

function browserStore(store: Storage): NonNullable<LiveDeps["storage"]> {
	return {
		getItem: (key) => store.getItem(key),
		setItem: (key, value) => store.setItem(key, value),
		removeItem: (key) => store.removeItem(key),
		keys: () => Object.keys(store),
	};
}

/** `gatewayUrl` is `VITE_SPELLKAVE_GATEWAY_URL`; unset means SRD art and glyphs only. */
export function liveDeps(
	config: LiveConfig,
	gatewayUrl: string | undefined,
	env: Record<string, string | undefined> = {},
): LiveDeps {
	const origin = gatewayOrigin(gatewayUrl);
	// The public reference guide's list: a page per definition id.
	const listUrl = referenceVocabularyUrl(env);
	const docsOrigin = new URL(listUrl).origin;
	const store = origin ? worldArtStore(gatewayFetch(origin, config.slug, config.token)) : null;
	return {
		open: openPlaySession,
		lastOutcome() {
			const acts = playTrail.entries().filter((entry) => entry.kind === "act");
			return acts.at(-1)?.outcome ?? null;
		},
		srdArt: srdArtUrl,
		worldArt: store ? (art) => store.load(art) : null,
		// The atlas outlives the tab and the browser: the hero does not forget
		// a place because a window was closed.
		storage: typeof window === "undefined" ? null : browserStore(window.localStorage),
		async reference(definitionRef) {
			const target = await findReferenceTargetByRef(listUrl, definitionRef).catch(() => null);
			if (!target) return undefined;
			const href = safeReferenceHref(target.href, docsOrigin) ?? undefined;
			const url = previewUrl(target.previewHref, docsOrigin);
			const about = url ? (await loadReferencePreview(url))?.description : undefined;
			return { ...(href ? { href } : {}), ...(about ? { about } : {}) };
		},
		close: () => store?.close(),
	};
}
