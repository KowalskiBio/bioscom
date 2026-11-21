import { mount } from "svelte";
import MaterialMergeModal from "../../src/components/modals/MaterialMergeModal.svelte";
import Toasts from "../../src/components/Toasts.svelte";
import { currentGroup, setCurrentGroup } from "../../src/lib/stores/currentGroup.svelte";
import { setUser } from "../../src/lib/stores/session.svelte";

setUser({
  uid: "synthetic-merge-user",
  name: "Merge Test User",
  role: "admin",
  groupId: "group-a",
  email: null,
});
setCurrentGroup("group-a", "Merge Test Lab");
(window as unknown as { __mergeGroupId?: () => string | null }).__mergeGroupId = () => currentGroup.groupId;

const app = document.getElementById("app");
const toastApp = document.getElementById("toast-app");
if (app === null || toastApp === null) throw new Error("Missing material merge fixture target");

mount(MaterialMergeModal, {
  target: app,
  props: {
    sourceMaterialId: "m-source",
    sourceMaterialName: "Acetone source",
  },
});
mount(Toasts, { target: toastApp });
