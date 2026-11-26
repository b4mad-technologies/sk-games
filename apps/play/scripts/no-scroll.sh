#!/usr/bin/env bash
# Acceptance check for "no page scroll" (ledger/designs/play-zoomed-table.md,
# "Test method for 'no page scroll'"): jsdom does not lay out, so this is the
# real-browser half of the check the jsdom smoke tests can't do themselves.
#
# Serves apps/play's demo shell (no world, no credentials — see
# apps/play/docs/shell-behaviour.md) with `vite dev`,
# then for every beat x viewport combination opens `demo.html?beat=<beat>`
# and asserts `document.scrollingElement` never exceeds the viewport.
#
# `vite dev` rather than a `build` + `preview` pair: `demo.html` is a second
# development-only HTML entry; production bundles index and playground,
# so `dist/` has no `demo.html` to serve.
set -euo pipefail

PLAY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PLAY_DIR"

# One named agent-browser session per run: agent shells refuse unnamed calls
# (vega-browser shim), and `close` below must never close another session.
export AGENT_BROWSER_SESSION="${AGENT_BROWSER_SESSION:-play-no-scroll-$$}"

# shellcheck source=lib/proc-cleanup.sh
source "${PLAY_DIR}/scripts/lib/proc-cleanup.sh"

PORT="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')"
# Chromium on this host can resolve localhost to IPv4 while Vite's default
# listener is IPv6-only. Bind and address the same loopback family so this
# real-browser gate never races DNS-family selection.
BASE_URL="http://127.0.0.1:${PORT}"
LOG_FILE="$(mktemp -t play-no-scroll-vite.XXXXXX.log)"

echo "Starting vite dev on port ${PORT}..."
# `VITE_SPELLKAVE_GATEWAY_URL` (sk-jay0.1.15): the seat menu's "Send feedback"
# row (`App.svelte`) is disabled without a configured gateway origin, so the
# feedback-dialog case below needs one set to even open the dialog. Port 9 is
# the standard discard port — guaranteed connection-refused, never routed —
# since this check only opens the dialog and measures containment, it never
# calls Send.
VITE_SPELLKAVE_GATEWAY_URL="http://127.0.0.1:9" \
	pnpm exec vite dev --host 127.0.0.1 --port "${PORT}" --strictPort >"${LOG_FILE}" 2>&1 &
SERVER_PID=$!

# `SERVER_PID` is the pnpm exec wrapper, vite is its child: a bare
# `kill "${SERVER_PID}"` then `wait "${SERVER_PID}"` leaves vite listening
# and blocks `wait` forever under a direct `bash no-scroll.sh` invocation
# (sk-jay0.7.43, same shape as tile-clip.sh's sk-jay0.7.32 finding — see
# `lib/proc-cleanup.sh` for the full rationale). Walk the process tree
# instead.
cleanup() {
	kill_tree "${SERVER_PID}"
	wait "${SERVER_PID}" 2>/dev/null || true
	kill_port_owner "${PORT}" "${PLAY_DIR}"
	agent-browser close >/dev/null 2>&1 || true
	rm -f "${LOG_FILE}"
}
trap cleanup EXIT

echo "Waiting for ${BASE_URL}/demo.html..."
for _ in $(seq 1 60); do
	if curl -sf -o /dev/null "${BASE_URL}/demo.html"; then
		break
	fi
	sleep 0.5
done
if ! curl -sf -o /dev/null "${BASE_URL}/demo.html"; then
	echo "vite dev never came up; log:"
	cat "${LOG_FILE}"
	exit 1
fi

# place-long, hero-drafting and stream-detail are the layout-stress beats of
# batch 7 (G6): a Place card with a long description, occupants and five ways
# out, a hero still being drafted, and a long Table stream. This script proves
# ONLY that the page itself never scrolls with them, at rest here and with the
# Place and You tiles opened further down. It cannot see a clipped way-out
# row, stream text under the filter bar or a vitals row: at 390x844 the Place
# and You tiles rest as hidden strips, and no stream is scrolled. The G6
# evidence for those three is `check:tile-clip`'s `ok layout` rows
# (`tile-clip-layout.ts`), never an `ok` line printed here.
BEATS=(explore talk talk-burst talk-group fight fight-conditions fight-crowd reaction brawl place-long hero-drafting stream-detail)
VIEWPORTS=("1280x720" "390x844")
FAILED=0

for beat in "${BEATS[@]}"; do
	for viewport in "${VIEWPORTS[@]}"; do
		width="${viewport%x*}"
		height="${viewport#*x}"

		agent-browser open "${BASE_URL}/demo.html?beat=${beat}" >/dev/null
		agent-browser set viewport "${width}" "${height}" >/dev/null
		agent-browser wait '[data-tile="table"]' >/dev/null

		scroll_height="$(agent-browser eval 'document.scrollingElement.scrollHeight')"
		scroll_width="$(agent-browser eval 'document.scrollingElement.scrollWidth')"
		ok="$(agent-browser eval 'document.scrollingElement.scrollHeight <= window.innerHeight && document.scrollingElement.scrollWidth <= window.innerWidth')"

		if [ "${ok}" = "true" ]; then
			status="ok"
		else
			status="FAIL"
			FAILED=1
		fi
		echo "${status}  beat=${beat} viewport=${viewport} scrollHeight=${scroll_height} scrollWidth=${scroll_width}"
	done
done

# One extra combination (sk-jay0.1.8.9): the map tile's stage level mounts
# `@spellkave/map-canvas` (MapLibre) instead of the static SVG plate — a
# taller DOM subtree than every other beat/tile combination above, so it gets
# its own check rather than trusting the untouched-tile beats to cover it.
for viewport in "${VIEWPORTS[@]}"; do
	width="${viewport%x*}"
	height="${viewport#*x}"

	agent-browser open "${BASE_URL}/demo.html?beat=explore" >/dev/null
	agent-browser set viewport "${width}" "${height}" >/dev/null
	agent-browser wait '[data-tile="table"]' >/dev/null
	agent-browser find role button click --name "Open Map" >/dev/null
	agent-browser wait '[data-testid="map-tile-canvas-mount"]' >/dev/null

	scroll_height="$(agent-browser eval 'document.scrollingElement.scrollHeight')"
	scroll_width="$(agent-browser eval 'document.scrollingElement.scrollWidth')"
	ok="$(agent-browser eval 'document.scrollingElement.scrollHeight <= window.innerHeight && document.scrollingElement.scrollWidth <= window.innerWidth')"

	if [ "${ok}" = "true" ]; then
		status="ok"
	else
		status="FAIL"
		FAILED=1
	fi
	echo "${status}  beat=explore viewport=${viewport} tile=map-open scrollHeight=${scroll_height} scrollWidth=${scroll_width}"
done

# Two more combinations (sk-jay0.1.8.6): the You tile's full sheet (six
# abilities, skills/masteries chips, appearance/backstory prose) and the Pack
# tile's item list + on-demand detail — both taller DOM subtrees than the
# untouched-tile beats above, same rationale as the map-open block.
for tile in hero pack; do
	tile_name="You"
	[ "${tile}" = "pack" ] && tile_name="Pack"

	for viewport in "${VIEWPORTS[@]}"; do
		width="${viewport%x*}"
		height="${viewport#*x}"

		agent-browser open "${BASE_URL}/demo.html?beat=explore" >/dev/null
		agent-browser set viewport "${width}" "${height}" >/dev/null
		agent-browser wait '[data-tile="table"]' >/dev/null
		agent-browser find role button click --name "Open ${tile_name}" >/dev/null
		agent-browser wait "[data-tile=\"${tile}\"][data-zoom=\"stage\"]" >/dev/null

		scroll_height="$(agent-browser eval 'document.scrollingElement.scrollHeight')"
		scroll_width="$(agent-browser eval 'document.scrollingElement.scrollWidth')"
		ok="$(agent-browser eval 'document.scrollingElement.scrollHeight <= window.innerHeight && document.scrollingElement.scrollWidth <= window.innerWidth')"

		if [ "${ok}" = "true" ]; then
			status="ok"
		else
			status="FAIL"
			FAILED=1
		fi
		echo "${status}  beat=explore viewport=${viewport} tile=${tile}-open scrollHeight=${scroll_height} scrollWidth=${scroll_width}"
	done
done

# The batch 7 layout-stress fixtures with their own tile opened (G6): the long
# Place card and the drafting hero's sheet at stage level. Page-level scroll
# only, like every block here; the in-tile rules are `check:tile-clip`'s.
for pair in "place-long:place:Place" "hero-drafting:hero:You"; do
	IFS=: read -r beat tile tile_name <<<"${pair}"

	for viewport in "${VIEWPORTS[@]}"; do
		width="${viewport%x*}"
		height="${viewport#*x}"

		agent-browser open "${BASE_URL}/demo.html?beat=${beat}" >/dev/null
		agent-browser set viewport "${width}" "${height}" >/dev/null
		agent-browser wait '[data-tile="table"]' >/dev/null
		agent-browser find role button click --name "Open ${tile_name}" >/dev/null
		agent-browser wait "[data-tile=\"${tile}\"][data-zoom=\"stage\"]" >/dev/null

		scroll_height="$(agent-browser eval 'document.scrollingElement.scrollHeight')"
		scroll_width="$(agent-browser eval 'document.scrollingElement.scrollWidth')"
		ok="$(agent-browser eval 'document.scrollingElement.scrollHeight <= window.innerHeight && document.scrollingElement.scrollWidth <= window.innerWidth')"

		if [ "${ok}" = "true" ]; then
			status="ok"
		else
			status="FAIL"
			FAILED=1
		fi
		echo "${status}  beat=${beat} viewport=${viewport} tile=${tile}-open scrollHeight=${scroll_height} scrollWidth=${scroll_width}"
	done
done

# The stream's filters share the same viewport budget as the full chronology.
# Cover speech-rich and fight-rich scenes at both responsive widths.
for beat in talk-burst fight fight-conditions; do
	for viewport in "${VIEWPORTS[@]}"; do
		width="${viewport%x*}"
		height="${viewport#*x}"

		agent-browser open "${BASE_URL}/demo.html?beat=${beat}" >/dev/null
		agent-browser set viewport "${width}" "${height}" >/dev/null
		agent-browser wait '[data-tile="table"]' >/dev/null

		agent-browser find role button click --name "Speech" --exact >/dev/null
		agent-browser wait '[aria-label="Filter the stream"]' >/dev/null

		scroll_height="$(agent-browser eval 'document.scrollingElement.scrollHeight')"
		scroll_width="$(agent-browser eval 'document.scrollingElement.scrollWidth')"
		ok="$(agent-browser eval 'document.scrollingElement.scrollHeight <= window.innerHeight && document.scrollingElement.scrollWidth <= window.innerWidth')"

		if [ "${ok}" = "true" ]; then
			status="ok"
		else
			status="FAIL"
			FAILED=1
		fi
		echo "${status}  beat=${beat} viewport=${viewport} stream=speech-filter scrollHeight=${scroll_height} scrollWidth=${scroll_width}"
	done
done

# The Send feedback dialog (sk-jay0.1.15): reached through the seat menu, not
# a tile — the seal button then the "Send feedback" row, the same two clicks
# `App.smoke.test.ts` exercises ("opens the feedback dialog through the seat
# menu when a gateway is configured"). `beat=explore` only: the seal's own
# accessible name is built from `sampleView`'s hero name ("Renn the
# Roadwarden, seat menu"), and this script's vite carries
# `VITE_SPELLKAVE_GATEWAY_URL` (set above) so the row is not disabled.
for viewport in "${VIEWPORTS[@]}"; do
	width="${viewport%x*}"
	height="${viewport#*x}"

	agent-browser open "${BASE_URL}/demo.html?beat=explore" >/dev/null
	agent-browser set viewport "${width}" "${height}" >/dev/null
	agent-browser wait '[data-tile="table"]' >/dev/null
	agent-browser find role button click --name "Renn the Roadwarden, seat menu" >/dev/null
	agent-browser find role menuitem click --name "Send feedback" >/dev/null
	agent-browser wait 'dialog[aria-labelledby="feedback-dialog-title"]' >/dev/null

	scroll_height="$(agent-browser eval 'document.scrollingElement.scrollHeight')"
	scroll_width="$(agent-browser eval 'document.scrollingElement.scrollWidth')"
	ok="$(agent-browser eval 'document.scrollingElement.scrollHeight <= window.innerHeight && document.scrollingElement.scrollWidth <= window.innerWidth')"

	if [ "${ok}" = "true" ]; then
		status="ok"
	else
		status="FAIL"
		FAILED=1
	fi
	echo "${status}  beat=explore viewport=${viewport} tile=feedback-dialog-open scrollHeight=${scroll_height} scrollWidth=${scroll_width}"
done

# Long reading content now lives in the shared non-modal info card, rather
# than the retired modal dialog.  Its own reading pane must scroll while the
# page and card frame remain contained.  An info card deliberately leaves
# focus on its opening link: Table-level shortcuts remain available while the
# player reads, and Escape closes the card without losing that anchor.
for viewport in "${VIEWPORTS[@]}"; do
	width="${viewport%x*}"
	height="${viewport#*x}"
	agent-browser open "${BASE_URL}/demo.html?beat=field-detail-long" >/dev/null
	agent-browser set viewport "${width}" "${height}" >/dev/null
	agent-browser wait '[data-tile="table"]' >/dev/null
	"${PLAY_DIR}/../../.agents/skills/sk-playtest/scripts/browser-click.sh" "${AGENT_BROWSER_SESSION:-default}" \
		'button[aria-label="Open You"]' 'document.querySelector("[data-tile=hero]")?.dataset.zoom === "stage"' >/dev/null
	"${PLAY_DIR}/../../.agents/skills/sk-playtest/scripts/browser-click.sh" "${AGENT_BROWSER_SESSION:-default}" \
		'[data-tile="hero"] .sk-vitals-grid dt button' 'Boolean(document.querySelector("[data-slot=info-card]"))' >/dev/null
	ok="$(agent-browser eval '(() => { const card=document.querySelector("[data-slot=info-card]"); const body=card?.children[1]; if (!(card instanceof HTMLElement) || !(body instanceof HTMLElement)) return false; const r=card.getBoundingClientRect(); return r.x>=0 && r.y>=0 && r.right<=innerWidth && r.bottom<=innerHeight && card.scrollWidth<=card.clientWidth && body.scrollWidth<=body.clientWidth && body.scrollHeight>body.clientHeight && body.scrollTop===0 && document.scrollingElement.scrollHeight<=innerHeight && document.scrollingElement.scrollWidth<=innerWidth && card.textContent.includes("Paragraph 24."); })()')"
	focus_ok="$(agent-browser eval 'document.activeElement?.textContent?.trim() === "Field detail example"')"
	agent-browser press Escape >/dev/null
	agent-browser wait --fn '!document.querySelector("[data-slot=info-card]")' >/dev/null
	return_ok="$(agent-browser eval 'document.activeElement.textContent.trim()==="Field detail example"')"
	if [ "${ok}" = "true" ] && [ "${focus_ok}" = "true" ] && [ "${return_ok}" = "true" ]; then
		status="ok"
	else
		status="FAIL"
		FAILED=1
	fi
	echo "${status}  beat=field-detail-long viewport=${viewport} card-contained=${ok} focus-retained=${focus_ok} focus-returned=${return_ok}"
done

exit "${FAILED}"
