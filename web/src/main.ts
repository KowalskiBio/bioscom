import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { initTheme } from "./lib/theme.svelte";
import { startApp } from "./lib/app";

initTheme();
startApp();

const app = mount(App, { target: document.getElementById("app")! });

export default app;
