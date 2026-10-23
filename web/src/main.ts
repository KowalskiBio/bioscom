import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { initTheme } from "./lib/theme.svelte";
import { loadSession } from "./lib/stores/session.svelte";

initTheme();
void loadSession();

const app = mount(App, { target: document.getElementById("app")! });

export default app;
