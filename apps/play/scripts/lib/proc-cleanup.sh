#!/usr/bin/env bash
# Shared process-cleanup helpers for gate scripts that background a
# `pnpm exec vite dev` server and must guarantee no listener survives the
# script (sk-jay0.7.32 verifier finding; ported into `no-scroll.sh` as
# sk-jay0.7.43). `pnpm exec vite dev` forks vite as a CHILD of pnpm, not
# pnpm itself, and vite can fork its own children in turn — a bare
# `kill "${SERVER_PID}"` only reaches the top of that chain, and a direct
# `bash <script>.sh` invocation then hangs forever on `wait "${SERVER_PID}"`
# because vite is still listening (reproduced twice for tile-clip.sh; a
# `pnpm run check:*` wrapper happens to exit anyway because ITS OWN teardown
# catches the orphan by luck, not because this cleanup reached it). macOS
# has no `setsid`/process-group isolation available to a plain script, so
# the portable option is walking the tree with `pgrep -P` instead.
#
# Source this file; it only defines functions, no side effects. Callers own
# `trap cleanup EXIT`, `SERVER_PID`, and `PORT` — this file stays agnostic
# of both so it has nothing script-specific to keep in sync.

# Every live descendant of $1 (order doesn't matter, just the full set).
collect_descendants() {
	local parent="$1" child
	for child in $(pgrep -P "${parent}" 2>/dev/null); do
		echo "${child}"
		collect_descendants "${child}"
	done
}

# TERM the whole tree rooted at $1 together, a short grace period, then KILL
# anything still alive — TERM first so vite/esbuild get a chance to close
# their own listening sockets cleanly before the hard stop.
kill_tree() {
	local root="$1" pid
	local -a pids
	pids=("${root}")
	while IFS= read -r pid; do
		[ -n "${pid}" ] && pids+=("${pid}")
	done < <(collect_descendants "${root}")
	for pid in "${pids[@]}"; do
		kill -TERM "${pid}" >/dev/null 2>&1 || true
	done
	sleep 0.5
	for pid in "${pids[@]}"; do
		kill -KILL "${pid}" >/dev/null 2>&1 || true
	done
}

# Fallback safety net, not the primary mechanism: something can still hold
# the port outside `${SERVER_PID}`'s own tree if it reparented before
# `kill_tree` walked it. Only touch it after confirming its OWN cwd is
# `$2` (rig discipline: never kill a process this script did not start) —
# `lsof -p <pid> | grep cwd` is the same check the rig discipline note
# itself uses. An unset `$2` already fails loudly under `set -euo pipefail`
# (unbound variable); the explicit empty-string guard below closes the
# other gap: an empty `expected_cwd` must never match an empty `cwd` lookup
# (a permission edge case, or a pid that died mid-check) and kill whatever
# it finds — fail closed, refuse to kill, rather than fall through to a
# broader match.
kill_port_owner() {
	local port="$1" expected_cwd="$2" pid cwd
	[ -n "${expected_cwd}" ] || return 1
	for pid in $(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null); do
		cwd="$(lsof -p "${pid}" 2>/dev/null | awk '$4 == "cwd" { print $NF }')"
		if [ "${cwd}" = "${expected_cwd}" ]; then
			kill -TERM "${pid}" >/dev/null 2>&1 || true
			sleep 0.3
			kill -KILL "${pid}" >/dev/null 2>&1 || true
		fi
	done
}
