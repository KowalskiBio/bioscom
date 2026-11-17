import { mount } from "svelte";
import type { InventoryTree } from "@bioscom/shared";
import ContainersView from "../../src/components/views/ContainersView.svelte";
import Modal from "../../src/components/Modal.svelte";
import Toasts from "../../src/components/Toasts.svelte";
import { setUser } from "../../src/lib/stores/session.svelte";
import { setCurrentGroup } from "../../src/lib/stores/currentGroup.svelte";
import { applyBroadcast, fetchInventory, inventory, inventoryFor } from "../../src/lib/stores/inventory.svelte";
import { currentGroup } from "../../src/lib/stores/currentGroup.svelte";
import { fetchInstruments } from "../../src/lib/stores/instruments.svelte";
import { loadSession } from "../../src/lib/stores/session.svelte";
import { navPrefs } from "../../src/lib/stores/navPrefs.svelte";
import { setDesign } from "../../src/lib/theme.svelte";
import { openAssetForm, openAssetRoomForm, openInstrumentForm } from "../../src/lib/forms";
import "../../src/app.css";

const params = new URLSearchParams(window.location.search);
const role = params.get("role") ?? "member";
const inventoryMode = params.get("inventory") ?? "loaded";
const instrumentMode = params.get("instruments") ?? "success";
// Opt-in harness for the real AppShell navigation regression. The room
// equipment tests below mount the focused ContainersView by default so their
// API isolation stays strict.
const mountShell = params.get("shell") === "1";

setUser({
  uid: "synthetic-room-equipment-user",
  name: "Synthetic Room Equipment User",
  role,
  groupId: "group-a",
  email: null,
});
setCurrentGroup("group-a", "Synthetic Lab A");
setDesign(params.get("design") === "bauhaus" ? "bauhaus" : "original");

if (!mountShell && !window.location.hash.startsWith("#containers/")) {
  window.location.hash = "#containers/room-main";
}

function fixtureTree(): InventoryTree {
  return {
    rooms: [
      {
        id: "room-main",
        name: "Main Test Room",
        description: "Synthetic physical room",
        chemicals: [
          {
            id: "room-stock-with-legacy-barcode",
            name: "Room primer stock",
            type: "primer",
            quantity: 2,
            unit: "nmol",
            barcode: "CHEMICAL-ONLY-999",
            note: "Chemical barcode must stay in the legacy stock row only",
          },
        ],
        containers: [
          {
            id: "cont-main",
            name: "Main Cabinet",
            type: "cabinet",
            chemicals: [],
            shelves: [],
          },
        ],
      },
      {
        id: "room-other",
        name: "Other Test Room",
        description: "Another real physical room",
        chemicals: [],
        containers: [],
      },
    ],
    deepFreezers: [
      {
        id: "freezer-root",
        name: "Standalone Root Freezer",
        type: "deepfreezer",
        chemicals: [],
        shelves: [],
      },
    ],
    assetRooms: [
      { id: "asset-room-main", name: "Main Inventory Room", linkedRoomId: "room-main" },
      { id: "asset-room-unmapped", name: "Main Test Room", linkedRoomId: null },
      { id: "asset-room-other", name: "Other Inventory Room", linkedRoomId: "room-other" },
    ],
    assets: [
      {
        id: "asset-main",
        name: "Canonical microscope",
        model: "Model M-1",
        barcode: "ASSET-001",
        roomId: "room-main",
      },
      {
        id: "asset-duplicate-a",
        name: "Duplicate reader A",
        model: "Reader A",
        barcode: "DUP-001",
        roomId: "room-main",
      },
      {
        id: "asset-duplicate-b",
        name: "Duplicate reader B",
        model: "Reader B",
        barcode: "DUP-001",
        roomId: "room-main",
      },
      {
        id: "asset-blank",
        name: "Blank barcode asset",
        barcode: "   ",
        roomId: "room-main",
      },
      {
        id: "asset-newly-linked",
        name: "Newly linked balance",
        model: "Balance B-2",
        barcode: "NEWLY-LINKED-002",
        roomId: "asset-room-unmapped",
      },
      {
        id: "asset-other-room",
        name: "Other room centrifuge",
        barcode: "OTHER-ROOM-003",
        roomId: "room-other",
      },
      {
        id: "asset-orphan",
        name: "Orphan asset",
        barcode: "ORPHAN-004",
        roomId: "missing-asset-room",
      },
      {
        id: "asset-freezer",
        name: "Root freezer substitute",
        barcode: "FREEZER-005",
        roomId: "freezer-root",
      },
      {
        id: "asset-name-only",
        name: "Main Test Room",
        barcode: "NAME-ONLY-006",
        roomId: null,
      },
    ],
    protocols: [],
  } as InventoryTree;
}

let currentTree = fixtureTree();
let version = 1;
if (inventoryMode === "no-rooms") currentTree.rooms = [];
if (inventoryMode === "error") {
  void fetchInventory("group-a").catch(() => undefined);
} else if (inventoryMode !== "empty") {
  applyBroadcast({ groupId: "group-a", version, tree: currentTree }, "group-a");
}

const app = document.getElementById("app");
const modalApp = document.getElementById("modal-app");
const toastApp = document.getElementById("toast-app");
if (app === null || modalApp === null || toastApp === null) {
  throw new Error("Missing room equipment fixture target");
}
if (mountShell) {
  const { default: AppShell } = await import("../../src/components/AppShell.svelte");
  mount(AppShell, { target: app });
} else {
  if (params.get("shell") === "1") {
  await loadSession();
  window.location.hash = "#rooms";
  const { default: AppShell } = await import("../../src/components/AppShell.svelte");
  mount(AppShell, { target: app });
} else if (params.get("view") === "assets") {
  const { default: AssetsView } = await import("../../src/components/views/AssetsView.svelte");
  mount(AssetsView, { target: app });
} else if (instrumentMode === "empty-view" || instrumentMode === "view") {
  const { default: InstrumentsView } = await import("../../src/components/views/InstrumentsView.svelte");
  mount(InstrumentsView, { target: app });
} else {
  mount(ContainersView, { target: app });
}
  mount(Modal, { target: modalApp });
}
mount(Toasts, { target: toastApp });

if (instrumentMode !== "manual") {
  void fetchInstruments();
}

Object.assign(window, {
  __roomEquipmentFetchInstruments(): void {
    void fetchInstruments();
  },
  __roomEquipmentOpenNewInstrument(): void {
    openInstrumentForm();
  },
  __roomEquipmentOpenAssignedInstrument(): void {
    openInstrumentForm({
      id: "inst-main",
      name: "Assigned centrifuge",
      description: "Existing description",
      location: "Legacy bench / keep me",
      contactPerson: "Synthetic Owner",
      contactEmail: "owner@example.test",
      roomGroupId: "group-a",
      roomId: "room-main",
    });
  },
  __roomEquipmentOpenLegacyInstrument(): void {
    openInstrumentForm({
      id: "inst-name-only",
      name: "Legacy name-only instrument",
      description: "Legacy description",
      location: "Main Test Room",
      contactPerson: "Legacy Owner",
      contactEmail: "legacy@example.test",
    });
  },
  __roomEquipmentOpenNewAsset(): void {
    openAssetForm();
  },
  __roomEquipmentOpenLegacyAsset(): void {
    openAssetForm({
      id: "asset-orphan",
      name: "Legacy orphan centrifuge",
      model: "Legacy Model L-1",
      barcode: "LEGACY-DUPLICATE-001",
      description: "Keep every descriptive field",
      roomId: "missing-asset-room",
    });
  },
  __roomEquipmentOpenCanonicalAsset(): void {
    openAssetForm({
      id: "asset-main",
      name: "Canonical microscope",
      model: "Model M-1",
      barcode: "DUP-001",
      description: "Canonical descriptive note",
      roomId: "room-main",
    });
  },
  __roomEquipmentOpenAddAssetRoom(): void {
    openAssetRoomForm();
  },
  __roomEquipmentConfirmAssetRoomMapping(assetRoomId: string, linkedRoomId: string | null): void {
    currentTree = structuredClone(currentTree);
    const assetRoom = currentTree.assetRooms.find((candidate) => candidate.id === assetRoomId);
    if (assetRoom === undefined) throw new Error("Unknown synthetic asset room");
    assetRoom.linkedRoomId = linkedRoomId;
    for (const asset of currentTree.assets) {
      if (asset.roomId === assetRoomId) asset.roomId = linkedRoomId ?? "";
    }
    version += 1;
    applyBroadcast({ groupId: "group-a", version, tree: currentTree }, "group-a");
  },
  __roomEquipmentConfirmedAssetRoomId(assetId: string): string | null {
    return currentTree.assets.find((asset) => asset.id === assetId)?.roomId ?? null;
  },
  __roomEquipmentTree(): InventoryTree {
    return structuredClone(currentTree);
  },
  __roomEquipmentFetchInventory(): Promise<void> {
    return fetchInventory("group-a").catch(() => undefined);
  },
  __roomEquipmentSetCatalogVisible(visible: boolean): void {
    navPrefs.setVisible("catalog", visible);
  },
  __roomEquipmentCatalogVisible(): boolean {
    return navPrefs.visible("catalog");
  },
  __roomEquipmentInventoryVersion(): number {
    return inventory.version;
  },
  __roomEquipmentCurrentRoomName(): string | null {
    return inventoryFor(currentGroup.groupId)?.rooms.find((room) => room.id === "room-main")?.name ?? null;
  },
  __roomEquipmentSelectGroup(groupId: string): void {
    setUser({ uid: "synthetic-room-equipment-user", name: "Synthetic Room Equipment User", role, groupId, email: null });
    setCurrentGroup(groupId, groupId === "group-b" ? "Synthetic Lab B" : "Synthetic Lab A");
  },
  __roomEquipmentDeliverGroup(groupId: string): void {
    version += 1;
    const tree = structuredClone(currentTree);
    if (groupId === "group-b") {
      tree.rooms = [{ id: "room-main", name: "Lab B physical room", description: "Other lab", containers: [], chemicals: [] }];
      tree.assetRooms = [];
      tree.assets = [];
      tree.deepFreezers = [];
    }
    applyBroadcast({ groupId, version, tree }, groupId);
  },
  __roomEquipmentInventoryTree(): InventoryTree | null {
    return inventory.tree === null ? null : structuredClone(inventory.tree);
  },
  __roomEquipmentInventoryState(): {
    loaded: boolean;
    version: number;
    loadError: string;
    roomIds: string[];
    assetRoomLinks: Record<string, string | null>;
  } {
    return {
      loaded: inventory.loaded,
      version: inventory.version,
      loadError: inventory.loadError,
      roomIds: (inventory.tree?.rooms ?? []).map((room) => room.id),
      assetRoomLinks: Object.fromEntries(
        (inventory.tree?.assetRooms ?? []).map((assetRoom) => [assetRoom.id, assetRoom.linkedRoomId ?? null]),
      ),
    };
  },
  async __roomEquipmentReloadInventory(): Promise<boolean> {
    try {
      await fetchInventory("group-a");
      return true;
    } catch {
      return false;
    }
  },
});
