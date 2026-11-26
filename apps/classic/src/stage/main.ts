import "@fontsource-variable/newsreader";
import "@fontsource-variable/newsreader/wght-italic.css";
import "./stage.css";

import config from "virtual:classic-dev-local";
import { mount } from "svelte";
import App from "./App.svelte";
import type { World } from "./model";

const target = document.getElementById("app");
if (!target) throw new Error("mount target #app is missing");
const query = new URLSearchParams(location.search);

// A staged local world (`just play-host`) is played live; without one, or
// with stage.html?mock, the fixture world stands in.
async function world(): Promise<World> {
	if (config && !query.has("mock")) {
		const [{ LiveWorld }, { liveDeps }] = await Promise.all([
			import("./session/world.svelte"),
			import("./session/deps"),
		]);
		const live = new LiveWorld(
			config,
			liveDeps(
				config,
				import.meta.env.VITE_SPELLKAVE_GATEWAY_URL,
				import.meta.env as Record<string, string | undefined>,
			),
		);
		// DEV aid: the current view, for poking at it from the browser console.
		if (import.meta.env.DEV) (window as unknown as { __stageWorld?: unknown }).__stageWorld = live;
		return live;
	}
	// The fixture world says so in the tab, too.
	document.title = "Spellkave Classic — stage mock";
	const { MockWorld } = await import("./mock/world.svelte");
	const mock = new MockWorld();
	// stage.html?world starts in the world with a ready-made hero.
	if (query.has("world")) mock.skipCreation();
	return mock;
}

void world().then((it) => mount(App, { target, props: { world: it } }));
