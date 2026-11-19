import { mount } from "svelte";
import type { Chemical, Container, InventoryTree, Room } from "@bioscom/shared";
import Toasts from "../../src/components/Toasts.svelte";
import { setUser } from "../../src/lib/stores/session.svelte";
import { setCurrentGroup } from "../../src/lib/stores/currentGroup.svelte";
import { applyBroadcast } from "../../src/lib/stores/inventory.svelte";
import { setDesign } from "../../src/lib/theme.svelte";
import "../../src/app.css";

const params = new URLSearchParams(window.location.search);
const role = params.get("role") ?? "member";
const view = params.get("view") === "containers" ? "containers" : "rooms";
const roomId = params.get("room") ?? "room-main";
const roomGridEnabled = params.get("roomGrid") !== "off";
const containerGridEnabled = params.get("containerGrid") !== "off";
const hideEmptySlots = params.get("hideEmpty") === "on";

setUser({
  uid: "synthetic-room-grid-user",
  name: "Synthetic Room Grid User",
  role,
  groupId: "group-a",
  email: null,
});
setCurrentGroup("group-a", "Synthetic Lab A");
setDesign(params.get("design") === "bauhaus" ? "bauhaus" : "original");

function container(
  id: string,
  name: string,
  type: Container["type"],
  description: string,
  chemicals: Chemical[] = [],
): Container {
  return {
    id,
    name,
    type,
    description,
    chemicals,
    shelves: [],
  } as Container;
}

function mainContainers(): Container[] {
  const cabinet = container("c-cabinet", "Main Cabinet", "cabinet", "Synthetic cabinet");
  cabinet.shelves = [
    { id: "shelf-main", name: "Main shelf", chemicals: [] } as Container["shelves"][number],
  ];
  return [
    cabinet,
    container("c-fridge", "Main Fridge", "fridge", "Synthetic fridge"),
    container("c-freezer", "Main Freezer", "freezer", "Synthetic freezer"),
  ];
}

function directChemical(): Chemical {
  return {
    id: "chem-direct",
    name: "Direct room reagent",
    type: "chemical",
    quantity: 4,
    unit: "mL",
    note: "Stored directly in the room, not in a container",
  } as Chemical;
}

function mainRoom(): Room {
  const room: Room = {
    id: "room-main",
    name: "Main Test Room",
    description: "Synthetic physical room with direct chemicals",
    chemicals: [directChemical()],
    containers: mainContainers(),
  } as Room;
  if (containerGridEnabled) {
    room.containerGrid = {
      rows: 2,
      columns: 3,
      positions: { "c-cabinet": 0, "c-fridge": 1, "c-freezer": 3 },
      ...(hideEmptySlots ? { hideEmptySlots: true } : {}),
    };
  }
  return room;
}

function fixtureTree(): InventoryTree {
  const roomB: Room = {
    id: "room-b",
    name: "Beta Room",
    description: "Synthetic second room",
    chemicals: [],
    containers: [],
  } as Room;
  const roomC: Room = {
    id: "room-c",
    name: "Gamma Room",
    description: "Synthetic third room",
    chemicals: [],
    containers: [],
  } as Room;
  // Deliberately unpositioned so the overflow strip has real content.
  const roomD: Room = {
    id: "room-d",
    name: "Delta Room",
    description: "Synthetic unplaced room",
    chemicals: [],
    containers: [],
  } as Room;

  const tree: InventoryTree = {
    rooms: [mainRoom(), roomB, roomC, roomD],
    deepFreezers: [
      container("freezer-root", "Standalone Root Freezer", "deepfreezer", "Synthetic deep freezer"),
    ],
    assetRooms: [],
    assets: [],
    protocols: [],
  } as InventoryTree;

  if (roomGridEnabled) {
    tree.roomGrid = {
      rows: 2,
      columns: 3,
      positions: { "room-main": 0, "room-b": 1, "room-c": 3 },
      ...(hideEmptySlots ? { hideEmptySlots: true } : {}),
    };
  }
  return tree;
}

let currentTree = fixtureTree();
let version = 1;
applyBroadcast({ groupId: "group-a", version, tree: currentTree }, "group-a");

const app = document.getElementById("app");
const toastApp = document.getElementById("toast-app");
if (app === null || toastApp === null) {
  throw new Error("Missing room grid fixture target");
}

window.location.hash = view === "containers" ? `#containers/${roomId}` : "#rooms";
const { default: AppShell } = await import("../../src/components/AppShell.svelte");
mount(AppShell, { target: app });
mount(Toasts, { target: toastApp });

Object.assign(window, {
  __roomGridTree(): InventoryTree {
    return structuredClone(currentTree);
  },
  __roomGridVersion(): number {
    return version;
  },
  __roomGridApply(tree: InventoryTree, nextVersion: number): void {
    currentTree = structuredClone(tree);
    version = nextVersion;
    applyBroadcast({ groupId: "group-a", version, tree: currentTree }, "group-a");
  },
});
