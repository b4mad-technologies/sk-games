---
version: 1
slug: "apps-maps-src-app-svelte"
primary_target: "apps/maps/src/App.svelte"
related_targets: ["apps/maps/src/components/MapCanvas.svelte","apps/maps/src/components/SeatBoard.svelte","apps/maps/src/components/MapsTable.svelte","apps/maps/src/components/MapsGate.svelte"]
---

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

**FIRST VIEWPORT:** Full-bleed MapLibre in the Google Maps frame: search pill top-left, results as a left rail, place preview card on the map, seat seal top-right, Layers bottom-left, zoom+compass bottom-right, indoor floor picker next to zoom when multi-level. People chip when overlay-admitted. Radar is a bottom timeline, off by default. Hover infobox at the pointer. No masthead, no mosaic, no covering sheet.

**FORM:** Picker first (grounded list #5). Seed `ea32f85f`. Signature: map pick opens the preview card; occupancy inspect uses the same card.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
