#!/usr/bin/env bash
# Acceptance check for "a card tile never hides a clipped remainder without
# saying so" (sk-jay0.7.32, found by the sk-jay0.1.8.18 verifier): jsdom does
# not lay out, so — like `no-scroll.sh` — this is the real-browser half of a
# check the jsdom smoke tests can't do themselves. `no-scroll.sh` only
# measures the PAGE's own outer scroll; a tile can clip its OWN content below
# its `.tile-body`'s fold while the page around it never scrolls at all
# (sk-jay0.1.8.18: Chronicle's "and N more" line pushed below a 167px card's
# fold at 1280x720 rest — `document.scrollingElement` never moved).
#
# For every selected `.tile-body` on the fight, fight-conditions, fight-crowd,
# talk-burst, place-long and hero-drafting beats (`sweepBeats`,
# tile-clip-selection.ts) (sk-jay0.1.8.18's own repro plus the burst-folding
# scenario, plus the S5-conditions and six-member-roster stresses for the
# card-density turn bar's own fixed-height budget, sk-jay0.1.8.37
# follow-up) at both viewports, skip the rest layout's one stage-level tile
# (the table — its `Thread` owns an intentional internal scroll host,
# `Thread.svelte`) and fail when
# scrollHeight exceeds clientHeight UNLESS the tile carries a `[data-tile-
# remainder]` element (the "<N> more" convention `Chronicle.svelte`'s
# `.play-chronicle__more` marks, sk-jay0.7.32 verifier finding) that is both
# NOT `display: none` and actually within the tile body's own visible
# bottom edge — a plain text match on "N more" alone is blind to visibility:
# the remainder line itself pushed below the fold (exactly sk-jay0.1.8.18's
# bug) would pass a text-only check, and so would unrelated card copy that
# happens to contain a number followed by "more".
#
# Rest state only (sk-jay0.7.32 verifier finding): at 390x844 every non-table
# tile is `data-zoom="strip"`, which is `display: none` (styles.css) — its
# `.tile-body` reads 0/0 and the sweep proves nothing about phone-width
# clipping today. A tapped/focused tile at phone width (the case that would
# actually exercise a `.tile-body` there) is future work, not covered here.
# Builds the demo once and checks isolated viewport frames concurrently in one
# named browser. PRs may narrow directly attributable widget cards; unknown
# inputs and main/manual runs retain every card. The driver fails on missing
# tiles and browser errors as well
# as clipping; no expected-failure list remains (it was empty).
#
# After the sweep, `tile-clip-layout.ts` runs the layout probes (batch 7, G6)
# for the selected cards at both viewports: Place card rows never clipped and
# only the description scrolling (place), no stream text under the filter bar
# with the Table stream scrolled to its middle (table), no vitals row on a
# drafting hero's You card (hero). At 390x844 a probe opens its tile and drags
# the divider below it until the tile is a card of size 0.675, the tallest a
# card can be: the phone rows prove that one card height, not every height a
# player can drag a card to. Lines read `ok layout {...}` / `FAIL layout {...}`.
set -euo pipefail
PLAY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PLAY_DIR"
# Keep port output numeric even when Nx forces terminal colors.
PORT="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')"
exec node scripts/tile-clip.ts "$PORT" "$@"
