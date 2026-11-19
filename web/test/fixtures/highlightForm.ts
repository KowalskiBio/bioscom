import { mount } from "svelte";
import RoomFormModal from "../../src/components/modals/RoomFormModal.svelte";
import ContainerFormModal from "../../src/components/modals/ContainerFormModal.svelte";
import SimplePromptModal from "../../src/components/modals/SimplePromptModal.svelte";
import type { HighlightFormValue } from "../../src/lib/highlight";

const roomForm: { name: string; description: string; highlightColor: HighlightFormValue } = {
  name: "A301",
  description: "Organic chemistry",
  highlightColor: "default",
};
const containerForm = {
  type: "cabinet" as const,
  name: "Cabinet 1",
  description: "Acid storage",
  emoji: "",
  highlightColor: "default" as HighlightFormValue,
  system: "numerical",
  countNum: 4,
  countAlpha: 4,
  customRangeType: "alphabetical",
  customRanges: [] as Array<{ start: string; end: string }>,
  customExtraNames: "",
  doorCount: 2,
  isShared: false,
  sharedGroups: {} as Record<string, boolean>,
};
const editContainerForm = {
  name: "Fridge 1",
  description: "DNA samples",
  emoji: "",
  highlightColor: "orange" as HighlightFormValue,
};
const deepFreezerForm = {
  name: "Deep freezer",
  description: "",
  emoji: "",
  rackRows: 4,
  rackColumns: 4,
  rackShelves: 3,
};
const shelfForm = { name: "Shelf 1" };

(globalThis as unknown as { __highlightForms?: unknown }).__highlightForms = {
  room: roomForm,
  addContainer: containerForm,
  editContainer: editContainerForm,
};

function target(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing ${id} fixture target`);
  return element;
}

mount(RoomFormModal, { target: target("room-form"), props: { form: roomForm, mode: "add" } });
mount(ContainerFormModal, { target: target("container-form"), props: { form: containerForm } });
mount(SimplePromptModal, {
  target: target("edit-container-form"),
  props: { form: editContainerForm, kind: "container", showHighlightPicker: true },
});
mount(SimplePromptModal, {
  target: target("deep-freezer-form"),
  props: { form: deepFreezerForm, kind: "container", showRackGrid: true, showShelfCount: true },
});
mount(SimplePromptModal, {
  target: target("shelf-form"),
  props: { form: shelfForm, kind: "shelf" },
});
