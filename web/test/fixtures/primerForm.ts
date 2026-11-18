import { mount } from "svelte";
import ChemicalFormModal from "../../src/components/modals/ChemicalFormModal.svelte";

const form = {
  shelfId: "shelf-1",
  cabinetShelf: "auto",
  name: "Species primer",
  formula: "",
  quantity: 10,
  unit: "nmol",
  concentration: null,
  concUnit: "",
  cas: "",
  note: "",
  customPosition: "",
  type: "primer",
  attributes: { sequence: "ACGT", target_species: "tobacco" } as Record<string, string | number | boolean | null>,
  safetyNotes: [] as string[],
  product: { manufacturer: "", catalogNumber: "" },
  batch: { lotCode: "", originType: "", expiresAt: "", receivedAt: "", preparedBy: "" },
};

const container = {
  id: "container-1",
  name: "Fridge",
  type: "fridge",
  shelves: [{ id: "shelf-1", name: "Shelf 1", chemicals: [] }],
};

(globalThis as unknown as { __primerForm?: typeof form }).__primerForm = form;

const target = document.getElementById("app");
if (target === null) {
  throw new Error("Missing primer form test target");
}

mount(ChemicalFormModal, { target, props: { form, container } });
