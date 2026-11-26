<script lang="ts">
	// A "?" beside something the world names by definition id (`srd/class/fighter`).
	//
	// It opens the same reference preview Play shows: a short text from the
	// public reference guide and a link to the full entry. The lookup is by
	// exact definition id against the guide's public list; nothing is asked of
	// the world. Without a matching entry nothing is drawn.
	//
	// The preview and the list reader are Play's own files. That is the same
	// debt as the session library (bead sk-jay0.1.76.7): they move into a
	// package with it.
	import ReferencePreview from "../../../play/src/components/ReferencePreview.svelte";
	import {
		findReferenceTargetByRef,
		type PlayReferenceTarget,
		referenceVocabularyUrl,
		safeReferenceHref,
	} from "../../../play/src/lib/reference-vocabulary";

	let { definitionRef, label }: { definitionRef?: string; label: string } = $props();

	const listUrl = referenceVocabularyUrl(import.meta.env as Record<string, string | undefined>);
	const docsOrigin = new URL(listUrl).origin;

	let found = $state<{ ref: string; target: PlayReferenceTarget; href: string } | null>(null);
	$effect(() => {
		const ref = definitionRef;
		if (!ref) return;
		let stale = false;
		void findReferenceTargetByRef(listUrl, ref).then((target) => {
			if (stale || !target) return;
			const href = safeReferenceHref(target.href, docsOrigin);
			if (href) found = { ref, target, href };
		});
		return () => {
			stale = true;
		};
	});
	// A card that now shows another definition never keeps the old entry.
	const shown = $derived(found && found.ref === definitionRef ? found : null);
</script>

{#if shown}
	<ReferencePreview text="?" target={shown.target} href={shown.href} triggerAriaLabel={`What is ${label}?`} triggerClass="cm-help" />
{/if}
