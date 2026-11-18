import { mount } from "svelte";
import type { Chemical, InventoryTree } from "@bioscom/shared";
import "../../src/app.css";
import { setUser } from "../../src/lib/stores/session.svelte";
import { setCurrentGroup } from "../../src/lib/stores/currentGroup.svelte";
import { applyBroadcast } from "../../src/lib/stores/inventory.svelte";
import { setDesign } from "../../src/lib/theme.svelte";

const params = new URLSearchParams(window.location.search);
const uid = params.get("uid") ?? "synthetic-dashboard-reader";
const requestedGroupId = params.get("group") ?? "group-a";
const groupId = requestedGroupId === "none" ? null : requestedGroupId;
const fixtureCase = params.get("case") ?? "main";
const design = params.get("design") === "original" ? "original" : "bauhaus";
// "delayed" mimics the real app: App/Dashboard mount first, and the lab's
// inventory tree arrives afterwards (fetchInventory/applyBroadcast) while the
// selected group ID stays unchanged.
const loadMode = params.get("load") ?? "eager";
const currentDate = new Date();
const todayUtc = Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate());
const day = 86_400_000;
const expiryDay = (offset: number): number => todayUtc + offset * day + 12 * 60 * 60 * 1000;

function stock(id: string, name: string, quantity: unknown, expiresAt?: number): Chemical {
  return {
    id,
    name,
    type: "chemical",
    quantity,
    unit: "mL",
    ...(expiresAt === undefined ? {} : { batchInfo: { expiresAt } }),
  } as Chemical;
}

function mainTree(): InventoryTree {
  return {
    protocols: [
      { id: "protocol-alpha", title: "Synthetic Protocol Alpha" },
      { id: "protocol-beta", title: "Synthetic Protocol Beta", content: "Steps for beta." },
    ],
    rooms: [
      {
        id: "room-main",
        name: "Main 🧪 Room",
        chemicals: [stock("room-direct", "Room direct stock 🧫", "not numeric")],
        containers: [
          {
            id: "cont-main",
            name: "Main Cabinet",
            type: "cabinet",
            chemicals: [stock("container-direct", "Container direct stock", 4)],
            shelves: [
              {
                id: "shelf-main",
                name: "Shelf A",
                type: "shelf",
                chemicals: [stock("shelf-stock", "Shelf expiry stock", 20, expiryDay(30))],
              },
              {
                id: "nested-box",
                name: "Nested Box B",
                type: "box",
                parentShelfId: "shelf-main",
                chemicals: [stock("nested-stock", "Nested two-reason stock", 2, expiryDay(2))],
              },
            ],
          },
        ],
      },
    ],
    deepFreezers: [
      {
        id: "freezer-root",
        name: "Root Freezer",
        type: "deepfreezer",
        chemicals: [stock("freezer-direct", "Nominal freezer stock", 20)],
        shelves: [
          {
            id: "freezer-box",
            name: "Rack A 2 / Box B 4",
            rackName: "A 2",
            boxName: "B 4",
            rackShelf: 1,
            chemicals: [stock("freezer-stock", "Expired freezer stock", 20, expiryDay(-1))],
          },
        ],
      },
    ],
  } as InventoryTree;
}

function capTree(): InventoryTree {
  return {
    rooms: [
      {
        id: "room-cap",
        name: "Capacity Room",
        containers: [],
        chemicals: Array.from({ length: 10 }, (_, index) =>
          stock(`cap-${index}`, `Capacity stock ${index}`, 0),
        ),
      },
    ],
    deepFreezers: [],
  } as InventoryTree;
}

function otherGroupTree(): InventoryTree {
  return {
    rooms: [
      {
        id: "room-b",
        name: "Other Lab Room",
        containers: [],
        chemicals: [stock("other-lab-stock", "Other lab only stock", 0)],
      },
    ],
    deepFreezers: [],
  } as InventoryTree;
}

const view = params.get("view") === "noticeboard" ? "noticeboard" : "dashboard";
window.location.hash = view === "noticeboard" ? "#noticeboard" : "#dashboard";
setDesign(design);
setUser({
  uid,
  name: "Synthetic Dashboard User",
  role: params.get("role") ?? "reader",
  groupId,
  email: null,
});
setCurrentGroup(groupId, groupId === null ? null : groupId === "group-a" ? "Synthetic Lab A" : "Synthetic Lab B");
let version = 0;
function treeFor(nextGroupId: string): InventoryTree {
  return nextGroupId === "group-b" ? otherGroupTree() : fixtureCase === "cap" ? capTree() : mainTree();
}
function installGroupTree(nextGroupId: string): void {
  const tree = treeFor(nextGroupId);
  version += 1;
  applyBroadcast({ groupId: nextGroupId, version, tree }, nextGroupId);
}
if (groupId !== null && loadMode !== "delayed") installGroupTree(groupId);

function groupLabel(nextGroupId: string): string {
  return nextGroupId === "group-a" ? "Synthetic Lab A" : "Synthetic Lab B";
}

Object.assign(window, {
  __dashboardFixtureSwitch(next: { uid: string; groupId: string }): void {
    setUser({
      uid: next.uid,
      name: "Synthetic Dashboard User",
      role: "reader",
      groupId: next.groupId,
      email: null,
    });
    setCurrentGroup(next.groupId, groupLabel(next.groupId));
    installGroupTree(next.groupId);
  },
  // Change the selected lab without delivering its inventory yet, so tests can
  // prove the previous lab's stock is never shown for the newly selected one.
  __dashboardFixtureSelectGroup(nextGroupId: string): void {
    setUser({
      uid,
      name: "Synthetic Dashboard User",
      role: "reader",
      groupId: nextGroupId,
      email: null,
    });
    setCurrentGroup(nextGroupId, groupLabel(nextGroupId));
  },
  // Deliver a lab's inventory after mount, keeping the selected group unchanged.
  __dashboardFixtureDeliver(nextGroupId: string = groupId ?? "group-a"): void {
    installGroupTree(nextGroupId);
  },
});

const target = document.getElementById("app");
if (target === null) throw new Error("Missing dashboard test target");
if (view === "noticeboard") {
  const { fetchNotices } = await import("../../src/lib/stores/notices.svelte");
  await fetchNotices();
  const { default: NoticeboardView } = await import("../../src/components/views/NoticeboardView.svelte");
  mount(NoticeboardView, { target });
} else {
  const { default: DashboardView } = await import("../../src/components/views/DashboardView.svelte");
  mount(DashboardView, { target });
}
