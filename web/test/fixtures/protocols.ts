import { mount } from "svelte";
import type { InventoryTree } from "@bioscom/shared";
import "../../src/app.css";
import Toasts from "../../src/components/Toasts.svelte";
import { applyBroadcast } from "../../src/lib/stores/inventory.svelte";
import { setCurrentGroup } from "../../src/lib/stores/currentGroup.svelte";
import { setUser } from "../../src/lib/stores/session.svelte";
import { setDesign } from "../../src/lib/theme.svelte";

const params = new URLSearchParams(window.location.search);
const role = params.get("role") === "reader" ? "reader" : "member";
setDesign(params.get("design") === "bauhaus" ? "bauhaus" : "original");
setUser({
  uid: "synthetic-protocol-user",
  name: "Protocol Test User",
  role,
  groupId: "group-a",
  email: null,
});
setCurrentGroup("group-a", "Protocol Test Lab");

const tree = {
  rooms: [],
  deepFreezers: [],
  assetRooms: [],
  assets: [],
  protocols: [
    {
      id: "protocol-described",
      title: "Protein assay",
      description: "Quantify protein with a standard curve.",
      tags: ["assay", "protein", "buffer"],
      content: [
        "## Preparation",
        "",
        "- **Mix** the buffer",
        "- ~~Discard~~ incubate",
        "",
        "[Assay guide](https://example.test/protocol)",
        "",
        "<script>window.__protocolXss = true</script>",
        '<img src="x" onerror="window.__protocolXss = true">',
      ].join("\n"),
    },
    {
      id: "protocol-fallback",
      title: "DNA extraction",
      description: null,
      tags: [
        "DNA",
        "this-is-an-extremely-long-tag-designed-to-wrap-without-forcing-the-card-or-page-wide-at-narrow-widths",
      ],
      content: "## Quick start\n\n**Prepare** the sample, then follow the remaining steps carefully.",
    },
    {
      id: "protocol-script",
      title: "Sanitized fallback",
      description: "",
      tags: [],
      content: "Before <script>window.__protocolXss = true</script> after",
    },
    {
      id: "protocol-empty",
      title: "Empty protocol",
      description: null,
      tags: null,
      content: "",
    },
  ],
} as InventoryTree;
applyBroadcast({ groupId: "group-a", version: 1, tree }, "group-a");

const app = document.getElementById("app");
const toastApp = document.getElementById("toast-app");
if (app === null || toastApp === null) throw new Error("Missing protocol fixture target");

window.location.hash = "#protocols";
const { default: AppShell } = await import("../../src/components/AppShell.svelte");
mount(AppShell, { target: app });
mount(Toasts, { target: toastApp });
