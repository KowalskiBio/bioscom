import type { Chemical, Container, Room } from "@bioscom/shared";
import { validateAttributes } from "@bioscom/shared";
import { openModal, closeModal } from "./modal.svelte";
import { showToast } from "./stores/toast.svelte";
import {
  opAddRoom,
  opEditRoom,
  opDeleteRoom,
  opAddContainer,
  opEditContainer,
  opAddDeepFreezer,
  opShareContainer,
  roleCanWrite,
  type ShelfSpec,
  type ChemicalFormValues,
  opAddChemical,
  opEditChemical,
  opAddShelf,
  opRenameShelf,
  opChangeBoxColor,
  opAddProtocol,
  opEditProtocol,
  opAddAssetRoom,
  opEditAssetRoom,
  opAddAsset,
  opEditAsset,
  resolveAutoShelf,
} from "./ops";
import { countWords, stripEmoji } from "./inventoryUtils";
import { verifyCaptchaAndExecute } from "./captcha";
import { router, navigateTo } from "./router.svelte";
import RoomFormModal from "../components/modals/RoomFormModal.svelte";
import ContainerFormModal from "../components/modals/ContainerFormModal.svelte";
import ChemicalFormModal from "../components/modals/ChemicalFormModal.svelte";
import SimplePromptModal from "../components/modals/SimplePromptModal.svelte";
import ProtocolFormModal from "../components/modals/ProtocolFormModal.svelte";
import AssetRoomFormModal from "../components/modals/AssetRoomFormModal.svelte";
import AssetFormModal from "../components/modals/AssetFormModal.svelte";
import NoticeFormModal from "../components/modals/NoticeFormModal.svelte";
import InstrumentFormModal from "../components/modals/InstrumentFormModal.svelte";
import BookingModal from "../components/modals/BookingModal.svelte";
import CatalogFormModal from "../components/modals/CatalogFormModal.svelte";
import PrintRequestModal from "../components/modals/PrintRequestModal.svelte";
import MaterialDetailModal from "../components/modals/MaterialDetailModal.svelte";
import MaterialMergeModal from "../components/modals/MaterialMergeModal.svelte";
import BulkImportModal from "../components/modals/BulkImportModal.svelte";
import StockLabelModal from "../components/modals/StockLabelModal.svelte";
import {
  opCreateNotice,
  opUpdateNotice,
  opCreateInstrument,
  opUpdateInstrument,
  opBookInstrument,
  opCreateCatalogItem,
  opUpdateCatalogItem,
  opCreatePrintRequest,
  opUpdateProfile,
} from "./featureOps";
import { session } from "./stores/session.svelte";
import { prefs } from "./stores/prefs.svelte";
import { catalog } from "./stores/catalog.svelte";
import { inventory } from "./stores/inventory.svelte";

function isBauhaus(): boolean {
  return document.body.dataset.design === "bauhaus";
}

export function openNoticeForm(edit?: { id: string; title: string; content: string; category: string }): void {
  const form = { title: edit?.title ?? "", content: edit?.content ?? "", category: edit?.category ?? "general" };
  openModal({
    title: edit === undefined ? "Add Note" : "Edit Notice",
    component: NoticeFormModal,
    props: { form },
    btnText: edit === undefined ? "Add" : "Save",
    onConfirm: async () => {
      const title = form.title.trim();
      const content = form.content.trim();
      if (title === "" || content === "") {
        showToast("Title and content are required", "error");
        return;
      }
      if (countWords(title) > 300 || countWords(content) > 300) {
        showToast("Title or content exceeds 300 words!", "error");
        return;
      }
      const ok =
        edit === undefined
          ? await opCreateNotice({ title, content, category: form.category })
          : await opUpdateNotice(edit.id, { title, content, category: form.category });
      if (ok) {
        closeModal();
        showToast(edit === undefined ? "Notice added successfully" : "Notice updated successfully");
      }
    },
  });
}

export function openInstrumentForm(edit?: { id: string; name: string; description: string; location: string; contactPerson: string; contactEmail: string }): void {
  const form = {
    name: edit?.name ?? "",
    description: edit?.description ?? "",
    location: edit?.location ?? "",
    contactPerson: edit?.contactPerson ?? "",
    contactEmail: edit?.contactEmail ?? "",
  };
  openModal({
    title: edit === undefined ? "Add Instrument" : "Edit Instrument",
    component: InstrumentFormModal,
    props: { form },
    btnText: edit === undefined ? "Add" : "Save",
    onConfirm: async () => {
      const name = form.name.trim();
      const location = form.location.trim();
      if (name === "" || location === "") {
        showToast("Name and location are required", "error");
        return;
      }
      const ok =
        edit === undefined
          ? await opCreateInstrument({ name, description: form.description.trim() || undefined, location, contactPerson: form.contactPerson.trim() || undefined, contactEmail: form.contactEmail.trim() || undefined })
          : await opUpdateInstrument(edit.id, { name, description: form.description.trim(), location, contactPerson: form.contactPerson.trim(), contactEmail: form.contactEmail.trim() });
      if (ok) {
        closeModal();
        showToast(edit === undefined ? "Instrument added" : "Instrument saved");
      }
    },
  });
}

export function openBookingModal(instrumentId: string, instrumentName: string): void {
  const form = { date: new Date().toISOString().slice(0, 10), startTime: "09:00", endTime: "10:00", note: "" };
  openModal({
    title: isBauhaus() ? `Book: ${stripEmoji(instrumentName)}` : `Book: ${instrumentName}`,
    component: BookingModal,
    props: { form, instrumentId },
    btnText: "Book",
    onConfirm: async () => {
      if (form.date === "" || form.startTime === "" || form.endTime === "") {
        showToast("Date, start and end time are required", "error");
        return;
      }
      if (form.startTime >= form.endTime) {
        showToast("End time must be after start time", "error");
        return;
      }
      if (await opBookInstrument(instrumentId, { date: form.date, startTime: form.startTime, endTime: form.endTime, note: form.note.trim() || undefined })) {
        closeModal();
        showToast("Instrument booked");
      }
    },
  });
}

export function openCatalogForm(edit?: { id: string; name: string; description: string; category: string; material: string; estimatedTime: string }): void {
  const form = {
    name: edit?.name ?? "",
    description: edit?.description ?? "",
    category: edit?.category ?? "Others",
    material: edit?.material ?? "",
    estimatedTime: edit?.estimatedTime ?? "",
  };
  openModal({
    title: edit === undefined ? "Add to Catalog" : "Edit Catalog Item",
    component: CatalogFormModal,
    props: { form },
    btnText: edit === undefined ? "Add" : "Save",
    onConfirm: async () => {
      const name = form.name.trim();
      if (name === "") {
        showToast("Name is required", "error");
        return;
      }
      const body = { name, description: form.description.trim() || undefined, category: form.category || undefined, material: form.material.trim() || undefined, estimatedTime: form.estimatedTime.trim() || undefined };
      const ok = edit === undefined ? await opCreateCatalogItem(body) : await opUpdateCatalogItem(edit.id, body);
      if (ok) {
        closeModal();
        showToast(edit === undefined ? "Catalog item added" : "Catalog item saved");
      }
    },
  });
}

export function openPrintRequestModal(item?: { id: string; name: string }): void {
  const form = { note: "", quantity: 1 };
  openModal({
    title: item === undefined ? "Custom Print Request" : (isBauhaus() ? `Request: ${stripEmoji(item.name)}` : `Request: ${item.name}`),
    component: PrintRequestModal,
    props: { form, custom: item === undefined },
    btnText: "Send Request",
    onConfirm: async () => {
      const ok = await opCreatePrintRequest(
        item === undefined
          ? { customDesign: true, note: form.note.trim() || undefined, quantity: form.quantity }
          : { catalogItemId: item.id, catalogItemName: item.name, note: form.note.trim() || undefined, quantity: form.quantity },
      );
      if (ok) {
        closeModal();
        showToast("Print request sent");
      }
    },
  });
}

export function openMaterialDetailModal(materialId: string): void {
  const material = catalog.items.find((item) => item.id === materialId);
  openModal({
    title: material?.name ?? "Material",
    size: "xwide",
    component: MaterialDetailModal,
    props: { materialId },
    btnText: null,
  });
}

export function openMaterialMergeModal(sourceMaterialId: string, sourceMaterialName: string): void {
  openModal({
    title: "Merge material",
    size: "xwide",
    component: MaterialMergeModal,
    props: { sourceMaterialId, sourceMaterialName },
    btnText: null,
  });
}

export function openStockLabelModal(input: {
  name: string;
  barcode: string;
  type?: string;
  locationText?: string;
  position?: string | null;
  lotCode?: string | null;
  expiresAt?: number | null;
}): void {
  openModal({
    title: "Stock label",
    size: "wide",
    component: StockLabelModal,
    props: input,
    btnText: null,
  });
}

export function openBulkImportModal(room: Room, container: Container): void {
  openModal({
    title: `Import items into ${container.name}`,
    size: "xwide",
    component: BulkImportModal,
    props: { room, container },
    btnText: null,
  });
}

export function openProfileModal(): void {
  const form = { name: session.user?.name ?? "" };
  openModal({
    title: "Edit Profile",
    bodyHtml: `<div class="form-group"><label class="form-label">Full Name</label><input class="form-input" id="pf-name" value="${form.name.replaceAll('"', "&quot;")}"></div>`,
    btnText: "Save",
    onConfirm: async () => {
      const input = document.getElementById("pf-name") as HTMLInputElement | null;
      const name = (input?.value ?? "").trim();
      if (name === "") {
        showToast("Enter name", "error");
        return;
      }
      if (await opUpdateProfile({ name })) {
        closeModal();
        showToast("Profile updated");
      }
    },
  });
}

export function openRoomForm(mode: "add" | "edit", room?: Room, onDone?: () => void): void {
  const form = { name: room?.name ?? "", description: room?.description ?? "" };
  openModal({
    title: mode === "add" ? "Add Room" : "Edit Room",
    component: RoomFormModal,
    props: { form, mode },
    btnText: mode === "add" ? "Add" : "Save",
    onConfirm: async () => {
      if (!roleCanWrite()) {
        showToast("Access Denied", "error");
        return;
      }
      const n = form.name.trim();
      if (n === "" || n.length > 50) {
        showToast("Room name is required (max 50 chars)", "error");
        return;
      }
      const desc = form.description.trim();
      if (countWords(n) > 300 || countWords(desc) > 300) {
        showToast("Text exceeds the 300-word limit!", "error");
        return;
      }
      const ok =
        mode === "add"
          ? await opAddRoom(n, desc === "" ? undefined : desc)
          : room !== undefined && (await opEditRoom(room.id, n, desc));
      if (ok) {
        closeModal();
        showToast(mode === "add" ? `Room "${isBauhaus() ? stripEmoji(n) : n}" added` : "Saved");
        onDone?.();
      }
    },
  });
}

export function openDeleteRoomConfirm(room: Room, onDone?: () => void): void {
  openModal({
    title: "Delete Room",
    bodyHtml: `<p>Delete <strong>${escapeHtmlText(isBauhaus() ? stripEmoji(room.name) : room.name)}</strong> and all its contents?</p>`,
    btnText: "Delete",
    onConfirm: () => {
      verifyCaptchaAndExecute(async () => {
        if (await opDeleteRoom(room.id)) {
          onDone?.();
        }
      });
    },
  });
}

function escapeHtmlText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function openContainerForm(type: "cabinet" | "fridge" | "freezer", onDone?: () => void): void {
  const typeLabel = type === "cabinet" ? "Cabinet" : type === "fridge" ? "Fridge" : "Freezer";
  const form = {
    name: "",
    description: "",
    emoji: "",
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
  openModal({
    title: `Add ${typeLabel}`,
    component: ContainerFormModal,
    props: { form, type },
    btnText: "Add",
    onConfirm: async () => {
      if (!roleCanWrite()) {
        showToast("Access Denied", "error");
        return;
      }
      const name = form.name.trim();
      if (name === "" || name.length > 50) {
        showToast("Container name is required (max 50 chars)", "error");
        return;
      }
      const shelves: ShelfSpec[] = [];
      let cabinetMethod: "numerical" | "alphabetical" | "custom" = "numerical";
      let customRangeType: "alphabetical" | "numerical" = "numerical";
      if (type === "cabinet") {
        cabinetMethod = form.system as "numerical" | "alphabetical" | "custom";
        if (cabinetMethod === "numerical") {
          for (let i = 0; i < form.countNum; i += 1) {
            shelves.push(`Shelf ${i + 1}`);
          }
        } else if (cabinetMethod === "alphabetical") {
          for (let i = 0; i < form.countAlpha; i += 1) {
            shelves.push(`Shelf ${String.fromCharCode(65 + i)}`);
          }
        } else {
          customRangeType = form.customRangeType as "alphabetical" | "numerical";
          for (const range of form.customRanges) {
            shelves.push({
              name: `Shelf ${range.start}–${range.end}`,
              isRangeShelf: true,
              rangeStart: range.start,
              rangeEnd: range.end,
            });
          }
          if (form.customExtraNames.trim() !== "") {
            for (const line of form.customExtraNames.split("\n").map((l) => l.trim()).filter((l) => l !== "")) {
              shelves.push(line);
            }
          }
        }
      } else {
        for (let i = 0; i < form.countNum; i += 1) {
          shelves.push(`Shelf ${i + 1}`);
        }
        if (type === "fridge" || type === "freezer") {
          for (let i = 1; i <= form.doorCount; i += 1) {
            shelves.push(`Door shelf ${i}`);
          }
        }
      }
      const roomId = currentRoomIdSafe();
      if (roomId === null) {
        return;
      }
      const created = await opAddContainer({
        roomId,
        name,
        description: form.description.trim() === "" ? undefined : form.description.trim(),
        emoji: form.emoji.trim() === "" ? undefined : form.emoji.trim(),
        type,
        cabinetMethod: type === "cabinet" ? cabinetMethod : undefined,
        customRangeType: type === "cabinet" && cabinetMethod === "custom" ? customRangeType : undefined,
        shelves,
      });
      if (!created) {
        return;
      }
      if (form.isShared) {
        const checked = Object.entries(form.sharedGroups)
          .filter(([, checked]) => checked)
          .map(([id]) => id);
        if (checked.length > 0) {
          const containerId = await findNewestContainerId(roomId, name);
          if (containerId !== null) {
            for (const target of checked) {
              await opShareContainer(roomId, containerId, target);
            }
          }
        }
      }
      closeModal();
      showToast(`${typeLabel} "${isBauhaus() ? stripEmoji(name) : name}" added`);
      onDone?.();
    },
  });
}

export function openDeepFreezerForm(): void {
  if (!roleCanWrite()) {
    showToast("Access Denied", "error");
    return;
  }
  const form = { name: "", description: "", emoji: "" };
  openModal({
    title: "Add Deep Freezer",
    component: SimplePromptModal,
    props: { form, kind: "container" as const },
    btnText: "Add",
    onConfirm: async () => {
      const name = form.name.trim();
      if (name === "" || name.length > 100) {
        showToast("Deep freezer name is required (max 100 chars)", "error");
        return;
      }
      const description = form.description.trim();
      if (description.length > 500) {
        showToast("Description must be 500 characters or fewer", "error");
        return;
      }
      const emoji = form.emoji.trim();
      if (emoji.length > 16) {
        showToast("Emoji must be 16 characters or fewer", "error");
        return;
      }
      const id = await opAddDeepFreezer(
        name,
        description === "" ? undefined : description,
        emoji === "" ? undefined : emoji,
      );
      if (id !== null) {
        closeModal();
        showToast(`Deep freezer "${isBauhaus() ? stripEmoji(name) : name}" added`);
        navigateTo("detail", { roomId: id, containerId: id });
      }
    },
  });
}

async function findNewestContainerId(roomId: string, name: string): Promise<string | null> {
  const { inventory, fetchInventory } = await import("./stores/inventory.svelte");
  const { currentGroup } = await import("./stores/currentGroup.svelte");
  const groupId = currentGroup.groupId;
  if (groupId === null) {
    return null;
  }
  await fetchInventory(groupId);
  const room = inventory.tree?.rooms.find((r) => r.id === roomId);
  const cont = [...(room?.containers ?? [])].reverse().find((c) => c.name === name);
  return cont?.id ?? null;
}

function currentRoomIdSafe(): string | null {
  const route = router.route;
  return route.view === "containers" || route.view === "detail" ? route.roomId : null;
}

export function openEditContainerForm(room: Room, cont: Container, onDone?: () => void): void {
  const form = { name: cont.name ?? "", description: cont.description ?? "", emoji: cont.emoji ?? "" };
  openModal({
    title: "Edit Container",
    component: SimplePromptModal,
    props: { form, kind: "container" as const },
    btnText: "Save",
    onConfirm: async () => {
      const name = form.name.trim();
      if (name === "" || name.length > 50) {
        showToast("Container name is required (max 50 chars)", "error");
        return;
      }
      if (await opEditContainer(room.id, cont.id, { name, description: form.description.trim(), emoji: form.emoji.trim() })) {
        closeModal();
        showToast("Saved");
        onDone?.();
      }
    },
  });
}

export function openAddShelfForm(room: Room, cont: Container, onDone?: () => void): void {
  const form = { name: "" };
  openModal({
    title: "Add Shelf",
    component: SimplePromptModal,
    props: { form, kind: "shelf" as const },
    btnText: "Add",
    onConfirm: async () => {
      const name = form.name.trim();
      if (name === "") {
        showToast("Enter shelf name", "error");
        return;
      }
      const shelfType = cont.type === "cabinet" || cont.type === "deepfreezer" ? undefined : "shelf";
      if (await opAddShelf({ roomId: room.id, containerId: cont.id, name, type: shelfType })) {
        closeModal();
        showToast(`Shelf "${isBauhaus() ? stripEmoji(name) : name}" added`);
        onDone?.();
      }
    },
  });
}

export function openAddBoxForm(room: Room, cont: Container, parentShelfId: string, onDone?: () => void): void {
  const form = { name: "" };
  openModal({
    title: "Add Box",
    component: SimplePromptModal,
    props: { form, kind: "box" as const },
    btnText: "Add",
    onConfirm: async () => {
      const name = form.name.trim();
      if (name === "") {
        showToast("Enter box name", "error");
        return;
      }
      if (await opAddShelf({ roomId: room.id, containerId: cont.id, name, type: "box", parentShelfId })) {
        closeModal();
        showToast(`Box "${isBauhaus() ? stripEmoji(name) : name}" added`);
        onDone?.();
      }
    },
  });
}

export function openRenameShelfForm(room: Room, cont: Container, shelfId: string, currentName: string, onDone?: () => void): void {
  const form = { name: currentName };
  openModal({
    title: "Rename Shelf",
    component: SimplePromptModal,
    props: { form, kind: "shelf" as const },
    btnText: "Save",
    onConfirm: async () => {
      const name = form.name.trim();
      if (name === "") {
        showToast("Enter name", "error");
        return;
      }
      if (await opRenameShelf(room.id, cont.id, shelfId, name)) {
        closeModal();
        showToast("Saved");
        onDone?.();
      }
    },
  });
}

export function openChangeBoxColorForm(room: Room, cont: Container, shelfId: string, onDone?: () => void): void {
  const form = { color: "#3b82f6" };
  openModal({
    title: "Change Box Color",
    component: SimplePromptModal,
    props: { form, kind: "color" as const },
    btnText: "Save",
    onConfirm: async () => {
      if (await opChangeBoxColor(room.id, cont.id, shelfId, form.color)) {
        closeModal();
        showToast("Color updated");
        onDone?.();
      }
    },
  });
}

function epochToDateInput(value: number | null | undefined): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return "";
  }
  return new Date(value).toISOString().slice(0, 10);
}

function parseDateInputUtc(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match === null) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return Date.UTC(year, month - 1, day);
}

type ChemicalFormState = ChemicalFormValues & {
  shelfId: string;
  cabinetShelf: string;
  roomId: string;
  contId: string;
  product: { manufacturer: string; catalogNumber: string };
  batch: { lotCode: string; originType: string; expiresAt: string; receivedAt: string; preparedBy: string };
  safetyNotes: string[];
};

function parseSafetyTags(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of value.split(/[\s,]+/)) {
    const tag = part.replace(/^#+/, "").trim();
    if (tag === "") {
      continue;
    }
    const key = tag.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

interface ContainerChemicalMatch {
  ch: Chemical;
  /** Value used by the placement select (shelf id, box id, or container id for direct stock). */
  placement: string;
  /** Resolvable shelf id for the API (parent shelf when the chemical sits in a box). */
  shelfId: string;
  boxId?: string;
}

function findChemicalInContainer(cont: Container, chemicalId: string): ContainerChemicalMatch | undefined {
  for (const shelf of cont.shelves ?? []) {
    for (const ch of shelf.chemicals ?? []) {
      if (ch.id === chemicalId) {
        const parentId = shelf.parentShelfId;
        if (parentId !== undefined && parentId !== null && parentId !== "") {
          return { ch, placement: shelf.id, shelfId: parentId, boxId: shelf.id };
        }
        return { ch, placement: shelf.id, shelfId: shelf.id };
      }
    }
  }
  for (const ch of cont.chemicals ?? []) {
    if (ch.id === chemicalId) {
      return { ch, placement: cont.id, shelfId: "" };
    }
  }
  return undefined;
}

function defaultPlacementFor(cont?: Container): string {
  if (cont === undefined) {
    return "";
  }
  if (cont.type === "deepfreezer") {
    return (cont.shelves ?? [])[0]?.id ?? "";
  }
  if (cont.type === "cabinet") {
    return "";
  }
  // Matrioshka containers default to their first top-level shelf, or the
  // container itself when it has no shelves (direct placement).
  return (cont.shelves ?? []).find((shelf) => !shelf.parentShelfId && shelf.type !== "box")?.id ?? cont.id;
}

export function openChemicalForm(
  room?: Room,
  cont?: Container,
  opts: { shelfId?: string; editChemId?: string } = {},
): void {
  const contextRooms =
    cont === undefined
      ? [...(inventory.tree?.rooms ?? [])].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
      : [];
  const editMatch =
    opts.editChemId !== undefined && cont !== undefined
      ? findChemicalInContainer(cont, opts.editChemId)
      : undefined;
  const editChem = editMatch;
  const initialShelf = opts.shelfId ?? editMatch?.placement ?? defaultPlacementFor(cont);
  const hadProduct = editChem?.ch.product !== undefined && editChem?.ch.product !== null;
  const initialAttributes = { ...(editChem?.ch.attributes ?? {}) };
  const safetyNotes = parseSafetyTags(initialAttributes.safety_notes);
  delete initialAttributes.safety_notes;
  const form: ChemicalFormState = {
    shelfId: initialShelf,
    cabinetShelf: "auto",
    roomId: room?.id ?? "",
    contId: cont?.id ?? "",
    name: editChem?.ch.name ?? "",
    formula: editChem?.ch.formula ?? "",
    quantity: editChem?.ch.quantity ?? null,
    unit: editChem?.ch.unit ?? "pcs",
    concentration: editChem?.ch.concentration ?? null,
    concUnit: editChem?.ch.concUnit ?? "",
    cas: editChem?.ch.cas ?? "",
    note: editChem?.ch.note ?? "",
    customPosition: editChem?.ch.customPosition ?? "",
    type: editChem?.ch.type ?? "chemical",
    attributes: initialAttributes,
    safetyNotes,
    product: {
      manufacturer: editChem?.ch.product?.manufacturer ?? "",
      catalogNumber: editChem?.ch.product?.catalogNumber ?? "",
    },
    batchInfo: {
      lotCode: editChem?.ch.batchInfo?.lotCode ?? undefined,
      originType: editChem?.ch.batchInfo?.originType ?? undefined,
      receivedAt: editChem?.ch.batchInfo?.receivedAt ?? undefined,
      preparedAt: editChem?.ch.batchInfo?.preparedAt ?? undefined,
      preparedBy: editChem?.ch.batchInfo?.preparedBy ?? undefined,
      expiresAt: editChem?.ch.batchInfo?.expiresAt ?? undefined,
    },
    batch: {
      lotCode: editChem?.ch.batchInfo?.lotCode ?? "",
      originType: editChem?.ch.batchInfo?.originType ?? "",
      expiresAt: epochToDateInput(editChem?.ch.batchInfo?.expiresAt),
      receivedAt: epochToDateInput(editChem?.ch.batchInfo?.receivedAt),
      preparedBy: editChem?.ch.batchInfo?.preparedBy ?? "",
    },
  };
  openModal({
    title: opts.editChemId !== undefined ? "Edit Chemical" : "Add Chemical",
    component: ChemicalFormModal,
    props: { form, container: cont, rooms: cont === undefined ? contextRooms : undefined },
    btnText: opts.editChemId !== undefined ? "Save" : "Add",
    size: "xwide",
    onConfirm: async () => {
      const attributes: Record<string, string | number | boolean | null> = {};
      for (const [key, value] of Object.entries(form.attributes)) {
        if (value === "" || value === undefined) {
          continue;
        }
        attributes[key] = value;
      }
      // CAS/formula are legacy dedicated fields on chemicals; sync derives the
      // canonical attributes from them, so never send them from the descriptor map.
      delete attributes.cas_number;
      delete attributes.molecular_formula;
      // The tag editor stores safety notes as string[] in form state; the
      // payload/validator contract stays a single whitespace-joined string.
      const safetyNotes = form.safetyNotes.map((tag) => tag.trim()).filter((tag) => tag !== "");
      if (form.type === "chemical" && safetyNotes.length > 0) {
        attributes.safety_notes = safetyNotes.join(" ");
      } else {
        delete attributes.safety_notes;
      }
      const attributeValidation = validateAttributes(form.type, attributes);
      if (!attributeValidation.ok) {
        showToast(`Invalid fields: ${attributeValidation.errors.join("; ")}`, "error");
        return;
      }
      const name = form.name.trim();
      if (name === "" || name.length > 100) {
        showToast("Chemical name is required (max 100 chars)", "error");
        return;
      }
      if (countWords(name) > 300 || countWords(form.note) > 300 || countWords(form.customPosition) > 300) {
        showToast("Name, note or custom position exceeds 300 words!", "error");
        return;
      }
      const casVal = form.cas.trim();
      if (form.type === "chemical" && casVal !== "" && !/^\d{1,7}-\d{2}-\d$/.test(casVal)) {
        showToast("Invalid CAS number format (e.g. 7647-01-0)", "error");
        return;
      }
      if (form.quantity !== null && (Number.isNaN(form.quantity) || form.quantity < 0)) {
        showToast("Quantity must be a non-negative number", "error");
        return;
      }
      const productDraft: NonNullable<ChemicalFormValues["product"]> = {};
      let hasProduct = false;
      for (const key of ["manufacturer", "catalogNumber"] as const) {
        const value = form.product[key].trim();
        if (value !== "") {
          productDraft[key] = value;
          hasProduct = true;
        }
      }
      const productValue: ChemicalFormValues["product"] | undefined = hasProduct
        ? productDraft
        : opts.editChemId !== undefined && hadProduct
          ? null
          : undefined;
      const batchDraft: NonNullable<ChemicalFormValues["batchInfo"]> = {};
      const lotCode = form.batch.lotCode.trim();
      if (lotCode !== "") {
        batchDraft.lotCode = lotCode;
      }
      const originType = form.batch.originType.trim();
      if (originType !== "") {
        batchDraft.originType = originType as NonNullable<ChemicalFormValues["batchInfo"]>["originType"];
      }
      const expiresAt = parseDateInputUtc(form.batch.expiresAt);
      if (expiresAt !== undefined) {
        batchDraft.expiresAt = expiresAt;
      }
      const receivedAt = parseDateInputUtc(form.batch.receivedAt);
      if (receivedAt !== undefined) {
        batchDraft.receivedAt = receivedAt;
      }
      const preparedBy = form.batch.preparedBy.trim();
      if (preparedBy !== "") {
        batchDraft.preparedBy = preparedBy;
      }
      const existingPreparedAt = editChem?.ch.batchInfo?.preparedAt;
      if (typeof existingPreparedAt === "number") {
        batchDraft.preparedAt = existingPreparedAt;
      }
      const batchValue = Object.keys(batchDraft).length > 0 ? batchDraft : undefined;
      const values: ChemicalFormValues = {
        name,
        formula: form.type === "chemical" ? form.formula.trim() : "",
        quantity: form.quantity,
        unit: form.unit,
        concentration: form.concentration,
        concUnit: form.concUnit,
        cas: form.type === "chemical" ? casVal : "",
        note: form.note.trim(),
        customPosition: form.customPosition.trim(),
        type: form.type,
        attributes: attributeValidation.value,
        product: productValue,
        batchInfo: batchValue,
      };
      const activeRoom = cont !== undefined ? room : contextRooms.find((r) => r.id === form.roomId);
      const activeCont = cont ?? (activeRoom?.containers ?? []).find((c) => c.id === form.contId);
      if (activeRoom === undefined) {
        showToast("Select a room before adding a chemical", "error");
        return;
      }
      // Resolve the placement select into explicit location ids. Empty strings
      // mean "not at that level"; the ops omit blank ids from the payload.
      // A blank container choice is a valid room-level placement (room.chemicals):
      // keep container/shelf/box ids empty so the server records it directly in
      // the room. Only an explicit container choice runs the cascade branches.
      let targetShelfId = "";
      let targetBoxId: string | undefined;
      if (activeCont !== undefined) {
        if (activeCont.type === "cabinet") {
          const isAlphabetical =
            activeCont.cabinetMethod === "alphabetical" ||
            (activeCont.cabinetMethod === "custom" && activeCont.customRangeType === "alphabetical");
          const hasRangeShelves = (activeCont.shelves ?? []).some((s) => s.isRangeShelf === true);
          const canAuto = isAlphabetical || hasRangeShelves;
          targetShelfId = form.shelfId;
          if (form.cabinetShelf === "auto") {
            if (canAuto) {
              targetShelfId = resolveAutoShelf(activeCont, name) ?? targetShelfId;
            } else if (targetShelfId === "" || targetShelfId === "auto") {
              targetShelfId = (activeCont.shelves ?? [])[0]?.id ?? "";
            }
          } else if (form.cabinetShelf !== "") {
            targetShelfId = form.cabinetShelf;
          }
        } else if (activeCont.type === "deepfreezer") {
          // Deep freezer boxes are flat shelves; keep the existing rack/box flow.
          targetShelfId = form.shelfId;
        } else {
          const choice = form.shelfId;
          const isDirect = choice === "" || choice === activeCont.id || choice.startsWith(`${activeCont.id}:`);
          if (!isDirect) {
            const placementShelf = (activeCont.shelves ?? []).find((candidate) => candidate.id === choice);
            if (placementShelf === undefined) {
              showToast("Select a placement", "error");
              return;
            }
            const parentId = placementShelf.parentShelfId;
            if (parentId !== undefined && parentId !== null && parentId !== "") {
              targetShelfId = parentId;
              targetBoxId = placementShelf.id;
            } else {
              targetShelfId = placementShelf.id;
            }
          }
        }
        if (activeCont.type === "cabinet" && targetShelfId === "") {
          showToast("Select a shelf placement", "error");
          return;
        }
        if (activeCont.type === "deepfreezer" && targetShelfId === "") {
          showToast("Select a box placement", "error");
          return;
        }
      }
      if (opts.editChemId !== undefined) {
        if (editMatch === undefined || activeCont === undefined) {
          showToast("Chemical not found", "error");
          return;
        }
        const ok = await opEditChemical(
          activeRoom.id,
          activeCont.id,
          editMatch.shelfId,
          opts.editChemId,
          values,
          targetShelfId,
          targetBoxId,
          editMatch.boxId,
        );
        if (ok) {
          closeModal();
          showToast("Chemical saved");
        }
      } else {
        const ok = await opAddChemical(activeRoom.id, activeCont?.id ?? "", targetShelfId, values, targetBoxId);
        if (ok) {
          closeModal();
          showToast(`Chemical "${isBauhaus() ? stripEmoji(name) : name}" added`);
        }
      }
    },
  });
}

export function openChemicalRadioPrompt(room: Room, cont: Container, preSelectedShelfId?: string): void {
  if (prefs.radioMode === "never") {
    openChemicalForm(room, cont, { shelfId: preSelectedShelfId });
    return;
  }
  const bauhaus = document.body.dataset.design === "bauhaus";
  openModal({
    title: "Laboratory Background Radio",
    bodyHtml: `<div style="text-align: center; padding: 1rem 0;">
      <div style="font-size: 3rem; margin-bottom: 1rem; animation: floatBlob 2s ease-in-out infinite alternate;">${bauhaus ? '<span class="glyph glyph-circle-ink" aria-hidden="true"></span>' : "🎵"}</div>
      <h3 style="margin-bottom: 0.5rem; color: var(--text-primary);">Laboratory Background Radio</h3>
      <p style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 1.5rem; max-width: 320px; margin-left: auto; margin-right: auto;">
        Would you like to play some background folk music while you add this chemical?
      </p>
      <div style="display: flex; flex-direction: column; gap: 0.75rem; max-width: 280px; margin: 0 auto;">
        <button class="btn-primary" data-radio-action="cechomor" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.75rem; background: linear-gradient(135deg, var(--accent-blue), #3b82f6); border: none;">
          <span>${bauhaus ? "" : "🎻 "}Play Čechomor (String Folk)</span>
        </button>
        <button class="btn-primary" data-radio-action="moravanka" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.75rem; background: linear-gradient(135deg, var(--accent-purple), #8b5cf6); border: none;">
          <span>${bauhaus ? "" : "🎺 "}Play Moravanka (Brass Band)</span>
        </button>
        <button class="btn-secondary" data-radio-action="none" style="width: 100%; padding: 0.75rem;">
          <span>${bauhaus ? "" : "🔇 "}No music, thanks</span>
        </button>
      </div>
    </div>`,
    btnText: null,
  });
  queueMicrotask(() => {
    const buttons = document.querySelectorAll("#modal-body [data-radio-action]");
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-radio-action");
        if (action !== null && action !== "none") {
          void import("./radio").then((radio) => radio.startLabRadio(action));
        }
        closeModal();
        openChemicalForm(room, cont, { shelfId: preSelectedShelfId });
      });
    });
  });
}

export function openProtocolForm(edit?: { id: string; title: string; content: string }): void {
  const form = { title: edit?.title ?? "", content: edit?.content ?? "" };
  openModal({
    title: edit === undefined ? "Add Protocol" : "Edit Protocol",
    component: ProtocolFormModal,
    props: { form },
    btnText: edit === undefined ? "Add" : "Save",
    onConfirm: async () => {
      const title = form.title.trim();
      if (title === "") {
        showToast("Enter title", "error");
        return;
      }
      if (countWords(title) > 300 || countWords(form.content) > 300) {
        showToast("Title or content exceeds 300 words!", "error");
        return;
      }
      const ok = edit === undefined ? await opAddProtocol(title, form.content) : await opEditProtocol(edit.id, title, form.content);
      if (ok) {
        closeModal();
        showToast(edit === undefined ? "Protocol added" : "Protocol saved");
      }
    },
  });
}

export function openAssetRoomForm(edit?: { id: string; name: string }): void {
  const form = { name: edit?.name ?? "" };
  openModal({
    title: edit === undefined ? "Add Asset Room" : "Edit Asset Room",
    component: AssetRoomFormModal,
    props: { form },
    btnText: edit === undefined ? "Add" : "Save",
    onConfirm: async () => {
      const name = form.name.trim();
      if (name === "") {
        showToast("Enter name", "error");
        return;
      }
      const ok = edit === undefined ? await opAddAssetRoom(name) : await opEditAssetRoom(edit.id, name);
      if (ok) {
        closeModal();
        showToast(edit === undefined ? "Asset room added" : "Asset room updated");
      }
    },
  });
}

export function openAssetForm(assetRooms: Array<{ id: string; name: string }>, edit?: { id: string; name: string; model?: string | null; barcode?: string | null; description?: string | null; roomId?: string | null }): void {
  const form = {
    name: edit?.name ?? "",
    model: edit?.model ?? "",
    barcode: edit?.barcode ?? "",
    description: edit?.description ?? "",
    roomId: edit?.roomId ?? "",
  };
  openModal({
    title: edit === undefined ? "Add Asset Item" : "Edit Asset Item",
    component: AssetFormModal,
    props: { form, assetRooms },
    btnText: edit === undefined ? "Add" : "Save",
    onConfirm: async () => {
      const name = form.name.trim();
      if (name === "") {
        showToast("Enter name", "error");
        return;
      }
      const ok =
        edit === undefined
          ? await opAddAsset({
              name,
              model: form.model.trim() === "" ? undefined : form.model.trim(),
              barcode: form.barcode.trim() === "" ? undefined : form.barcode.trim(),
              description: form.description.trim() === "" ? undefined : form.description.trim(),
              roomId: form.roomId,
            })
          : await opEditAsset(edit.id, {
              name,
              model: form.model.trim(),
              barcode: form.barcode.trim(),
              description: form.description.trim(),
              roomId: form.roomId,
            });
      if (ok) {
        closeModal();
        showToast(edit === undefined ? "Asset added" : "Asset saved");
      }
    },
  });
}

