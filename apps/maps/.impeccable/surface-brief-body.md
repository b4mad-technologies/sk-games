# World Map Surface

- Mode: operate
- Audience: split by login — player, observer/DM, or signed-out visitor at `maps.spellkave.com`
- Job: read a living world on a full-viewport map; layers follow the grant
- Primary action: pick a place on the map
- Proof: live catalog worlds, gateway MVT geometry, real seats; occupancy/radar only when `overlayAdmitted()`
- Constraints: AuthKit gate, deep-link `?world=&place=`, DEV token in DEV only, connect the selected world only, MapLibre `style.json` colours are gateway-owned, CC-BY attribution remains visible. No Play mosaic. No glass/blur overlays.

## Direction contract

**THESIS:** Maps is a picker on a living map. It refuses Play’s equal mosaic tiles and a GIS layer stack.

**OWN-WORLD:** Midnight jacquard map plate, cream ink, woven gold as the only action thread. Square loom-card picker; circular form only for the seat seal. No glass, no blur.

**STORY:** You see the world, pick a place, know your seat. If the grant allows, one gold commit inspects who stands there.

**FIRST VIEWPORT:** Full-bleed MapLibre. Lower-third loom-card: place name, my-seat line, floor as depth. Grant-gated chips under the card (occupancy on for observers, radar off). Seat seal top-right. No masthead.

**FORM:** Picker first (grounded list #5). Seed `ea32f85f`. Signature: map pick updates the card; gold commit opens the observer inspect drawer.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
