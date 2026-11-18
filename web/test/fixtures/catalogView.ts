import { mount } from "svelte";
import { setUser } from "../../src/lib/stores/session.svelte";
import { setCurrentGroup } from "../../src/lib/stores/currentGroup.svelte";

// Set the route before CatalogView loads the router module so the view effect
// performs the normal stock and preference fetch against the mocked API.
window.location.hash = "#catalog";
setUser({
  uid: "synthetic-catalog-user",
  name: "Catalog Test User",
  role: "editor",
  groupId: "group-a",
  email: null,
});
setCurrentGroup("group-a", "Lab A");

const { default: CatalogView } = await import("../../src/components/views/CatalogView.svelte");

const target = document.getElementById("app");
if (target === null) {
  throw new Error("Missing catalog test target");
}

mount(CatalogView, { target });
