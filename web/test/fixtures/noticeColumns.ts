import { mount } from "svelte";
import type { InventoryTree } from "@bioscom/shared";
import "../../src/app.css";
import Toasts from "../../src/components/Toasts.svelte";
import { applyBroadcast } from "../../src/lib/stores/inventory.svelte";
import { setCurrentGroup } from "../../src/lib/stores/currentGroup.svelte";
import { setUser } from "../../src/lib/stores/session.svelte";
import { fetchNotices } from "../../src/lib/stores/notices.svelte";
import { setDesign } from "../../src/lib/theme.svelte";

const params = new URLSearchParams(window.location.search);
setDesign(params.get("design") === "bauhaus" ? "bauhaus" : "original");
setUser({
  uid: "synthetic-notice-user",
  name: "Notice Test User",
  role: "member",
  groupId: "group-a",
  email: null,
});
setCurrentGroup("group-a", "Notice Test Lab");

const tree = {
  rooms: [],
  deepFreezers: [],
  assetRooms: [],
  assets: [],
  protocols: [{ id: "protocol-layout-reference", title: "Layout reference" }],
} as InventoryTree;
applyBroadcast({ groupId: "group-a", version: 1, tree }, "group-a");
await fetchNotices();

const app = document.getElementById("app");
const toastApp = document.getElementById("toast-app");
if (app === null || toastApp === null) throw new Error("Missing notice column fixture target");

window.location.hash = "#noticeboard";
const { default: AppShell } = await import("../../src/components/AppShell.svelte");
mount(AppShell, { target: app });
mount(Toasts, { target: toastApp });
