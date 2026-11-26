import "./styles.css";

import devLocalRaw from "virtual:spellkave-dev-local";
import { SESSION_STORAGE_KEY } from "@spellkave/authkit";
import { mount } from "svelte";
import App from "./App.svelte";
import { devLocalProps, devLocalSession, parseDevLocalConfig } from "./lib/dev-local";
import { playRumProducer } from "./lib/play-rum";
import { applyShapeCheckBuildMode } from "./lib/shape-check-mode";

// SDK connect-time shape check mode (sk-jay0.7.389.3), from the build:
// VITE_SPELLKAVE_SHAPE_CHECK=warn (hosted publish) connects past a world-module
// shape mismatch and reports it; unset or strict refuses.
applyShapeCheckBuildMode(import.meta.env.VITE_SPELLKAVE_SHAPE_CHECK);

const target = document.getElementById("app");
if (target === null) throw new Error("play mount target #app is missing");

// Begin the asynchronous SDK load early enough to capture hosted performance,
// but keep consent withheld until App resolves a pseudonymous account + world.
playRumProducer.initialize();

/**
 * DEV-only: play the world `just play-stage` just staged, on this machine.
 *
 * Stands in for WorkOS and the Account API — nothing else. The world session,
 * the SDK and every reducer below it are the shipped ones, so a beat clicked
 * here is a beat a hosted player can click. Inert in production: the virtual
 * module resolves to `null` there, and `import.meta.env.DEV` is false.
 */
const devLocal = import.meta.env.DEV ? parseDevLocalConfig(devLocalRaw) : null;

if (devLocal === null) {
	mount(App, { target });
} else {
	window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(devLocalSession(devLocal)));
	mount(App, { target, props: devLocalProps(devLocal) });
}
