import "./styles.css";
import { mount } from "svelte";
import Playground from "./playground/Playground.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("Playground mount target #app is missing");
mount(Playground, { target });
