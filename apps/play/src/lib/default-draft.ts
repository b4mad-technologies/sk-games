import type { PlayManipulationAction } from "./play-view";

/**
 * A local snapshot of one author-published default binding.  It is deliberately
 * not a ShellBuffer token: the player did not type it.  Keeping the snapshot
 * prevents a refreshed world observation from silently changing an in-flight
 * draft underneath the player.
 */
export interface DefaultDraft {
	actionId: string;
	contentKey: string;
	targetRef?: string;
	inputValues: Readonly<Record<string, string | number>>;
	targetSuppressed: boolean;
	suppressedInputNames: readonly string[];
}

export function beginDefaultDraft(
	action: PlayManipulationAction | undefined,
	options: { explicitTarget: boolean },
): DefaultDraft | undefined {
	if (action?.defaults === undefined) return undefined;
	return {
		actionId: action.actionId,
		contentKey: action.defaults.provenance.contentKey,
		...(action.defaults.target === undefined
			? {}
			: { targetRef: action.defaults.target.targetRef }),
		inputValues: { ...(action.defaults.inputValues ?? {}) },
		targetSuppressed: options.explicitTarget,
		suppressedInputNames: [],
	};
}

/** The snapshot is stale rather than replaced when its authoring provenance,
 * action, or disclosed target disappears. */
export function defaultDraftIsCurrent(
	draft: DefaultDraft | undefined,
	action: PlayManipulationAction | undefined,
	visibleTargetRefs: ReadonlySet<string>,
): boolean {
	if (draft === undefined) return true;
	if (action?.actionId !== draft.actionId || action.defaults === undefined) return false;
	if (action.defaults.provenance.contentKey !== draft.contentKey) return false;
	if (action.defaults.target?.targetRef !== draft.targetRef) return false;
	if (draft.targetRef !== undefined && !visibleTargetRefs.has(draft.targetRef)) return false;
	return (
		Object.entries(action.defaults.inputValues ?? {}).every(
			([name, value]) => draft.inputValues[name] === value,
		) &&
		Object.keys(draft.inputValues).length === Object.keys(action.defaults.inputValues ?? {}).length
	);
}

export function suppressDefaultTarget(draft: DefaultDraft | undefined): DefaultDraft | undefined {
	return draft === undefined ? undefined : { ...draft, targetSuppressed: true };
}

/** Once a player has supplied a field, removing that spelling is an explicit
 * choice too.  It must not resurrect the author value until the action changes. */
export function suppressDefaultInputs(
	draft: DefaultDraft | undefined,
	presentInputNames: ReadonlySet<string>,
): DefaultDraft | undefined {
	if (draft === undefined) return undefined;
	const suppressed = new Set(draft.suppressedInputNames);
	for (const name of Object.keys(draft.inputValues)) {
		if (presentInputNames.has(name)) suppressed.add(name);
	}
	return { ...draft, suppressedInputNames: [...suppressed].sort() };
}

export function effectiveDefaultTarget(draft: DefaultDraft | undefined): string | undefined {
	return draft?.targetSuppressed ? undefined : draft?.targetRef;
}

export function effectiveDefaultInputs(
	draft: DefaultDraft | undefined,
): Record<string, string | number> {
	if (draft === undefined) return {};
	const suppressed = new Set(draft.suppressedInputNames);
	return Object.fromEntries(
		Object.entries(draft.inputValues).filter(([name]) => !suppressed.has(name)),
	);
}
