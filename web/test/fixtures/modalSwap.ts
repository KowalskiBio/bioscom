import { mount } from "svelte";
import Modal from "../../src/components/Modal.svelte";
import SettingsModal from "../../src/components/modals/SettingsModal.svelte";
import { openModal } from "../../src/lib/modal.svelte";
import { setUser } from "../../src/lib/stores/session.svelte";

setUser({
  uid: "synthetic-modal-user",
  name: "Modal Test User",
  role: "member",
  groupId: null,
  email: null,
});

const target = document.getElementById("app");
if (target === null) {
  throw new Error("Missing modal test target");
}

mount(Modal, { target });
openModal({ title: "Settings", component: SettingsModal, btnText: null });
