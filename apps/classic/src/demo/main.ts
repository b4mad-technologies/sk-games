import "@fontsource-variable/newsreader";
import "../app.css";

import { mount } from "svelte";
import DemoApp from "./DemoApp.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("mount target #app is missing");
mount(DemoApp, { target });
