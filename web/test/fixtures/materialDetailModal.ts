import { mount } from "svelte";
import type { Chemical, InventoryTree } from "@bioscom/shared";
import Modal from "../../src/components/Modal.svelte";
import Toasts from "../../src/components/Toasts.svelte";
import { openMaterialDetailModal } from "../../src/lib/forms";
import { setUser } from "../../src/lib/stores/session.svelte";
import { setCurrentGroup } from "../../src/lib/stores/currentGroup.svelte";
import { applyBroadcast } from "../../src/lib/stores/inventory.svelte";
import "../../src/app.css";

const params = new URLSearchParams(window.location.search);
const materialId = params.get("material") ?? "m-stock-primary";
const role = params.get("role") ?? "editor";
const variant = params.get("variant") ?? "default";
const location = params.get("location") ?? "room";

setUser({
  uid: "synthetic-material-detail-user",
  name: "Material Detail Test User",
  role,
  groupId: "group-a",
  email: null,
});
setCurrentGroup("group-a", "Synthetic Lab");

function primaryStock(): Chemical {
  return {
    id: "stock-primary",
    name: "Tris base original",
    type: "chemical",
    quantity: 250,
    unit: "g",
    concentration: 1.5,
    concUnit: "mol/L",
    customPosition: "A-17",
    note: "Original stock note",
    cas: "77-86-1",
    formula: "C4H11NO3",
    attributes: {
      molecular_weight: 121.14,
      safety_notes: "corrosive",
    },
    product: {
      manufacturer: "Original manufacturer",
      catalogNumber: "TRIS-100",
      productName: "Tris laboratory product",
      variant: "Ultra pure",
    },
    batchInfo: {
      lotCode: "LOT-ORIGINAL",
      originType: "purchased",
      receivedAt: Date.UTC(2026, 0, 2),
      preparedAt: Date.UTC(2026, 0, 3),
      preparedBy: "Original preparer",
      expiresAt: Date.UTC(2028, 0, 4),
    },
  } as Chemical;
}

function secondaryStock(): Chemical {
  return {
    id: "stock-secondary",
    name: "Secondary package",
    type: "chemical",
    quantity: 25,
    unit: "g",
    concentration: 0.5,
    concUnit: "mol/L",
    customPosition: "C-9",
    note: "Secondary stock note",
    cas: "77-86-1",
    formula: "C4H11NO3",
    attributes: { molecular_weight: 121.14 },
    product: {
      manufacturer: "Secondary manufacturer",
      catalogNumber: "TRIS-SECONDARY",
    },
    batchInfo: {
      lotCode: "LOT-SECONDARY",
      originType: "purchased",
      receivedAt: Date.UTC(2026, 1, 2),
      expiresAt: Date.UTC(2029, 1, 2),
    },
  } as Chemical;
}

function buildTree(): InventoryTree {
  // Deliberately store the secondary package first in the tree and in the
  // material detail response, so the modal must resolve the canonical
  // `m-${stock.id}` package instead of simply taking the first stock.
  const chemicals = [secondaryStock(), primaryStock()];
  if (variant === "no-stock") {
    return {
      rooms: [
        {
          id: "room-main",
          name: "Material Detail Room",
          containers: [],
          chemicals: [],
        },
      ],
      deepFreezers: [],
    } as InventoryTree;
  }
  if (location === "freezer") {
    return {
      rooms: [],
      deepFreezers: [
        {
          id: "freezer-main",
          name: "Material Detail Freezer",
          type: "deepfreezer",
          chemicals: [],
          shelves: [
            {
              id: "freezer-box",
              name: "Rack A / Box 1",
              type: "box",
              chemicals,
            },
          ],
        },
      ],
    } as InventoryTree;
  }
  return {
    rooms: [
      {
        id: "room-main",
        name: "Material Detail Room",
        containers: [],
        chemicals,
      },
    ],
    deepFreezers: [],
  } as InventoryTree;
}

let version = 1;
let activeTree = buildTree();
applyBroadcast({ groupId: "group-a", version, tree: activeTree }, "group-a");

const modalTarget = document.getElementById("modal-app");
const toastTarget = document.getElementById("toast-app");
if (modalTarget === null || toastTarget === null) {
  throw new Error("Missing material detail test targets");
}

mount(Modal, { target: modalTarget });
mount(Toasts, { target: toastTarget });

Object.assign(window, {
  openMaterialDetailFixture: (id = materialId) => openMaterialDetailModal(id),
  materialDetailFixtureTree: () => activeTree,
  materialDetailFixtureInstallTree: (next: InventoryTree) => {
    version += 1;
    activeTree = next;
    applyBroadcast({ groupId: "group-a", version, tree: next }, "group-a");
  },
});
openMaterialDetailModal(materialId);
