import { mount } from "svelte";
import { MATERIAL_TYPES, type InventoryTree } from "@bioscom/shared";
import "../../src/app.css";
import { setUser } from "../../src/lib/stores/session.svelte";
import { setCurrentGroup } from "../../src/lib/stores/currentGroup.svelte";
import { applyBroadcast } from "../../src/lib/stores/inventory.svelte";
import { setDesign } from "../../src/lib/theme.svelte";

const params = new URLSearchParams(window.location.search);
const role = params.get("role") ?? "editor";
const uid = params.get("uid") ?? "synthetic-room-user-a";

setUser({
  uid,
  name: "Room Column Test User",
  role,
  groupId: "group-a",
  email: null,
});
setCurrentGroup("group-a", "Synthetic Lab");
setDesign(params.get("design") === "bauhaus" ? "bauhaus" : "original");

const tree = {
  rooms: [
    {
      id: "room-main",
      name: "Main Test Room",
      containers: [
        {
          id: "cont-main",
          name: "Main Cabinet",
          type: "cabinet",
          chemicals: [
            {
              id: "container-chem",
              name: "Container direct stock",
              type: "chemical",
              quantity: 4,
              unit: "mL",
              position: "C-Direct",
              note: "Container direct note",
            },
            {
              id: "container-chip-chemical",
              name: "Chip chemical",
              type: "chemical",
              quantity: 1,
              unit: "mL",
              note: "Synthetic inline chemical chip",
            },
            {
              id: "container-chip-bio",
              name: "Chip bio",
              type: "biological_stock",
              quantity: 1,
              unit: "pcs",
              note: "Synthetic inline biological chip",
            },
            {
              id: "container-chip-legacy",
              name: "Chip legacy",
              quantity: 1,
              unit: "pcs",
              note: "Synthetic legacy chemical chip",
            },
          ],
          shelves: [
            {
              id: "shelf-main",
              name: "Shelf A",
              type: "shelf",
              chemicals: [
                {
                  id: "shelf-chem",
                  name: "Shelf stock",
                  type: "chemical",
                  quantity: 3,
                  unit: "g",
                  position: "S-3",
                  note: "Shelf note",
                },
                {
                  id: "shelf-chip-chemical",
                  name: "Chip chemical",
                  type: "chemical",
                  quantity: 1,
                  unit: "mL",
                  note: "Synthetic shelf chemical chip",
                },
                {
                  id: "shelf-chip-bio",
                  name: "Chip bio",
                  type: "biological_stock",
                  quantity: 1,
                  unit: "pcs",
                  note: "Synthetic shelf biological chip",
                },
              ],
            },
            {
              id: "nested-box",
              name: "Nested Box B",
              type: "box",
              parentShelfId: "shelf-main",
              chemicals: [
                {
                  id: "nested-chem",
                  name: "Nested stock",
                  type: "primer",
                  quantity: 2,
                  unit: "nmol",
                  position: "N-2",
                  note: "Nested box note",
                  attributes: { target_species: "zebrafish" },
                },
                {
                  id: "nested-chip-chemical",
                  name: "Chip chemical",
                  type: "chemical",
                  quantity: 1,
                  unit: "mL",
                  note: "Synthetic box chemical chip",
                },
                {
                  id: "nested-chip-bio",
                  name: "Chip bio",
                  type: "biological_stock",
                  quantity: 1,
                  unit: "pcs",
                  note: "Synthetic box biological chip",
                },
              ],
            },
          ],
        },
        {
          id: "cont-freezer",
          name: "Deep Freezer T",
          type: "deepfreezer",
          chemicals: [],
          rackRows: 1,
          rackColumns: 1,
          rackShelves: 2,
          rackPositions: { "7": 0 },
          shelves: [
            {
              id: "box-cryo",
              name: "Rack 7 / Box B4",
              rackName: "7",
              boxName: "B4",
              rackShelf: 1,
              chemicals: [
                {
                  id: "deep-chem",
                  name: "Deep searchable stock",
                  type: "primer",
                  quantity: 1,
                  unit: "nmol",
                  position: "D-1",
                  concentration: 0,
                  concUnit: "µM",
                  note: "Deep freezer note",
                  attributes: { target_species: "mouse", sequence: "acgt" },
                  product: { manufacturer: "Cold Products", catalogNumber: "CRYO-1" },
                  batchInfo: { lotCode: "DEEP-LOT", receivedAt: 0, expiresAt: Date.UTC(2028, 1, 3) },
                },
                {
                  id: "deep-chip-chemical",
                  name: "Chip chemical",
                  type: "chemical",
                  quantity: 1,
                  unit: "mL",
                  note: "Synthetic deep chemical chip",
                },
                {
                  id: "deep-chip-bio",
                  name: "Chip bio",
                  type: "biological_stock",
                  quantity: 1,
                  unit: "pcs",
                  note: "Synthetic deep biological chip",
                },
              ],
            },
          ],
        },
      ],
      chemicals: [
        ...(params.get("palette") === "room" ? MATERIAL_TYPES.map(({ key }) => ({
          id: `palette-room-${key}`,
          name: `Palette ${key}`,
          type: key,
          quantity: 1,
          unit: "pcs",
          note: `Synthetic ${key} type accent`,
        })) : []),
        {
          id: "room-chem",
          name: "Room primer stock",
          type: "primer",
          quantity: 8,
          unit: "nmol",
          position: "R-9",
          concentration: 0,
          concUnit: "mM",
          note: "Actual room stock note",
          barcode: "ROOM-BARCODE",
          status: "on hold",
          cas: "50-00-0",
          formula: "H2O",
          attributes: {
            cas_number: "77-86-1",
            molecular_formula: "C6H12O6",
            target_species: " tobacco ",
            custom_notes: "Primer descriptor must not replace stock Note",
          },
          product: { manufacturer: "Room Products", catalogNumber: "ROOM-1" },
          batchInfo: { lotCode: "ROOM-LOT", receivedAt: 0, expiresAt: Date.UTC(2027, 0, 2) },
        },
        {
          id: "room-blank",
          name: "Room blank stock",
          type: "chemical",
          quantity: 10,
          unit: "g",
          note: null,
          cas: "50-00-0",
          formula: "H2O",
          target_species: "guessed top-level descriptor",
          attributes: { custom_notes: "Chemical descriptor must not leak" },
        },
        {
          id: "room-other",
          name: "Room Other stock",
          type: "other",
          quantity: 1,
          unit: "pcs",
          note: null,
          attributes: { custom_notes: "Other room descriptor fallback" },
        },
        {
          id: "room-chip-bio",
          name: "Chip room bio",
          type: "biological_stock",
          quantity: 1,
          unit: "pcs",
          note: "Synthetic room biological type",
        },
      ],
    },
  ],
} as InventoryTree;

applyBroadcast({ groupId: "group-a", version: 1, tree }, "group-a");

const target = document.getElementById("app");
if (target === null) {
  throw new Error("Missing chemical view test target");
}

if (window.location.hash === "#catalog") {
  const { default: CatalogView } = await import("../../src/components/views/CatalogView.svelte");
  mount(CatalogView, { target });
} else if (window.location.hash.startsWith("#detail/")) {
  const { default: DetailView } = await import("../../src/components/views/DetailView.svelte");
  mount(DetailView, { target, props: { searchQuery: params.get("q") ?? "" } });
} else {
  if (!window.location.hash.startsWith("#containers/")) {
    window.location.hash = "#containers/room-main";
  }
  const { default: ContainersView } = await import("../../src/components/views/ContainersView.svelte");
  mount(ContainersView, { target });
}
