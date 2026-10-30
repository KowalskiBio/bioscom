import type { Container, Room } from "@bioscom/shared";
import { openModal, closeModal } from "./modal.svelte";
import { showToast } from "./stores/toast.svelte";
import {
  opAddRoom,
  opEditRoom,
  opDeleteRoom,
  opAddContainer,
  opEditContainer,
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
import { router } from "./router.svelte";
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
    freezerType: "standard",
    rackCount: 4,
    boxCount: 5,
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
      let actualType: "cabinet" | "fridge" | "freezer" | "deepfreezer" = type;
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
        if (type === "freezer" && form.freezerType === "deepfreezer") {
          actualType = "deepfreezer";
          for (let r = 1; r <= form.rackCount; r += 1) {
            for (let b = 1; b <= form.boxCount; b += 1) {
              shelves.push(`Rack ${r} / Box ${b}`);
            }
          }
        } else {
          for (let i = 0; i < form.countNum; i += 1) {
            shelves.push(`Shelf ${i + 1}`);
          }
          if (type === "fridge") {
            for (let i = 1; i <= form.doorCount; i += 1) {
              shelves.push(`Door shelf ${i}`);
            }
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
        type: actualType,
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
      if (await opAddShelf({ roomId: room.id, containerId: cont.id, name })) {
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
      if (await opAddShelf({ roomId: room.id, containerId: cont.id, name, parentShelfId })) {
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

export function openChemicalForm(
  room: Room,
  cont: Container,
  opts: { shelfId?: string; editChemId?: string } = {},
): void {
  const editChem =
    opts.editChemId !== undefined
      ? (cont.shelves ?? []).flatMap((sh) => (sh.chemicals ?? []).map((ch) => ({ sh, ch }))).find((e) => e.ch.id === opts.editChemId)
      : undefined;
  const initialShelf = opts.shelfId ?? editChem?.sh.id ?? (cont.shelves ?? [])[0]?.id ?? "";
  const form: ChemicalFormValues & { shelfId: string; cabinetShelf: string } = {
    shelfId: initialShelf,
    cabinetShelf: "auto",
    name: editChem?.ch.name ?? "",
    formula: editChem?.ch.formula ?? "",
    quantity: editChem?.ch.quantity ?? null,
    unit: editChem?.ch.unit ?? "pcs",
    concentration: editChem?.ch.concentration ?? null,
    concUnit: editChem?.ch.concUnit ?? "",
    cas: editChem?.ch.cas ?? "",
    note: editChem?.ch.note ?? "",
    customPosition: editChem?.ch.customPosition ?? "",
  };
  openModal({
    title: opts.editChemId !== undefined ? "Edit Chemical" : "Add Chemical",
    component: ChemicalFormModal,
    props: { form, container: cont },
    btnText: opts.editChemId !== undefined ? "Save" : "Add",
    onConfirm: async () => {
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
      if (casVal !== "" && !/^\d{1,7}-\d{2}-\d$/.test(casVal)) {
        showToast("Invalid CAS number format (e.g. 7647-01-0)", "error");
        return;
      }
      if (form.quantity !== null && (Number.isNaN(form.quantity) || form.quantity < 0)) {
        showToast("Quantity must be a non-negative number", "error");
        return;
      }
      const values: ChemicalFormValues = {
        name,
        formula: form.formula.trim(),
        quantity: form.quantity,
        unit: form.unit,
        concentration: form.concentration,
        concUnit: form.concUnit,
        cas: casVal,
        note: form.note.trim(),
        customPosition: form.customPosition.trim(),
      };
      let shelfId = form.shelfId;
      if (cont.type === "cabinet") {
        const isAlphabetical =
          cont.cabinetMethod === "alphabetical" ||
          (cont.cabinetMethod === "custom" && cont.customRangeType === "alphabetical");
        const hasRangeShelves = (cont.shelves ?? []).some((s) => s.isRangeShelf === true);
        const canAuto = isAlphabetical || hasRangeShelves;
        if (form.cabinetShelf === "auto" && canAuto) {
          shelfId = resolveAutoShelf(cont, name) ?? shelfId;
        } else {
          shelfId = form.cabinetShelf;
        }
      }
      if (opts.editChemId !== undefined) {
        const ok = await opEditChemical(room.id, cont.id, editChem!.sh.id, opts.editChemId, values, shelfId);
        if (ok) {
          closeModal();
          showToast("Chemical saved");
        }
      } else {
        const ok = await opAddChemical(room.id, cont.id, shelfId, values);
        if (ok) {
          closeModal();
          showToast(`Chemical "${isBauhaus() ? stripEmoji(name) : name}" added`);
        }
      }
    },
  });
}

export function openChemicalRadioPrompt(room: Room, cont: Container, preSelectedShelfId?: string): void {
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

