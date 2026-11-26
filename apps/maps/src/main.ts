// maplibre-gl and its stylesheet are loaded lazily by @spellkave/map-canvas's
// MapCanvas component on mount, not eagerly here.
import "./styles.css";

import { mount } from "svelte";
import App from "./App.svelte";
import { applyShapeCheckBuildMode } from "./lib/shape-check-mode";

// SDK connect-time shape check mode (sk-jay0.7.389.3), from the build:
// VITE_SPELLKAVE_SHAPE_CHECK=warn (hosted publish) connects past a world-module
// shape mismatch and reports it; unset or strict refuses.
applyShapeCheckBuildMode(import.meta.env.VITE_SPELLKAVE_SHAPE_CHECK);

const target = document.getElementById("app");
if (!target) {
	throw new Error("maps mount target #app is missing");
}
mount(App, { target });
