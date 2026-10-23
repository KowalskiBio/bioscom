<script lang="ts">
  import { router, navigateTo, TOP_VIEWS, type TopView } from "../lib/router.svelte";
  import { session } from "../lib/stores/session.svelte";
  import { groupList } from "../lib/stores/groups.svelte";
  import { currentGroup } from "../lib/stores/currentGroup.svelte";
  import { inventory } from "../lib/stores/inventory.svelte";
  import { searchState } from "../lib/stores/search.svelte";
  import { logout } from "../lib/app";
  import { toggleTheme } from "../lib/theme.svelte";
  import { showToast } from "../lib/stores/toast.svelte";
  import { exportPDF, exportContainerPDF } from "../lib/exports";
  import { opDeleteContainer, roleCanWrite } from "../lib/ops";
  import { verifyCaptchaAndExecute } from "../lib/captcha";
  import {
    openRoomForm,
    openDeleteRoomConfirm,
    openContainerForm,
    openEditContainerForm,
    openAddShelfForm,
    openChemicalRadioPrompt,
    openProtocolForm,
    openAssetRoomForm,
    openAssetForm,
  } from "../lib/forms";
  import { openModal, closeModal } from "../lib/modal.svelte";
  import Modal from "./Modal.svelte";
  import GlobalSearch from "./GlobalSearch.svelte";
  import RoomsView from "./views/RoomsView.svelte";
  import ContainersView from "./views/ContainersView.svelte";
  import DetailView from "./views/DetailView.svelte";
  import ProtocolsView from "./views/ProtocolsView.svelte";
  import AssetsView from "./views/AssetsView.svelte";

  let assetSearch = $state("");

  const TAB_MAP: Record<string, string> = {
    rooms: "tab-inventory",
    containers: "tab-inventory",
    detail: "tab-inventory",
    protocols: "tab-protocols",
    assets: "tab-assets",
    noticeboard: "tab-noticeboard",
    instruments: "tab-instruments",
    printing: "tab-printing",
    history: "tab-history",
    minigames: "tab-minigames",
  };

  const route = $derived(router.route);
  const isTopView = $derived((TOP_VIEWS as readonly string[]).includes(route.view));
  const activeTab = $derived(TAB_MAP[route.view] ?? "tab-inventory");
  const badgeGroup = $derived(groupList.items.find((g) => g.id === session.user?.groupId));
  const badgeVisible = $derived(session.user !== null);
  const isReader = $derived(session.user?.role === "reader");

  const containersRoomId = $derived(route.view === "containers" || route.view === "detail" ? route.roomId : "");
  const containersRoom = $derived(
    containersRoomId === "shared-assets" ? undefined : inventory.tree?.rooms.find((r) => r.id === containersRoomId),
  );
  const detailRoom = $derived(inventory.tree?.rooms.find((r) => r.id === (route.view === "detail" ? route.roomId : "")));
  const detailCont = $derived(detailRoom?.containers.find((c) => c.id === (route.view === "detail" ? route.containerId : "")));
  const isVirtualShared = $derived(containersRoomId === "shared-assets");

  $effect(() => {
    if (route.view === "assets" && isReader) {
      showToast("Access Denied", "error");
      navigateTo("rooms");
    }
  });

  function onTabClick(view: TopView): void {
    navigateTo(view);
  }

  function copyJoinCode(): void {
    const code = badgeGroup?.joinCode;
    if (code === undefined) {
      return;
    }
    void navigator.clipboard.writeText(code).then(() => {
      showToast("Join code copied to clipboard!", "info");
    });
  }

  function onAddRoom(): void {
    if (isReader) {
      showToast("Access Denied", "error");
      return;
    }
    openRoomForm("add");
  }

  function onExportPdf(): void {
    if (inventory.tree !== null) {
      exportPDF(inventory.tree);
    }
  }

  function onEditRoom(): void {
    if (containersRoom === undefined) {
      return;
    }
    openRoomForm("edit", containersRoom, () => {
      navigateTo("rooms");
      navigateTo("containers", { roomId: containersRoom.id });
    });
  }

  function onDeleteRoom(): void {
    if (containersRoom === undefined) {
      return;
    }
    openDeleteRoomConfirm(containersRoom, () => navigateTo("rooms"));
  }

  function onAddContainer(type: "cabinet" | "fridge" | "freezer"): void {
    if (isReader) {
      showToast("Access Denied", "error");
      return;
    }
    if (containersRoom === undefined) {
      return;
    }
    openContainerForm(type);
  }

  function onAddShelf(): void {
    if (detailRoom === undefined || detailCont === undefined) {
      return;
    }
    openAddShelfForm(detailRoom, detailCont);
  }

  function onExportContainerPdf(): void {
    if (detailRoom !== undefined && detailCont !== undefined) {
      exportContainerPDF(detailRoom, detailCont);
    }
  }

  function onEditContainer(): void {
    if (detailRoom === undefined || detailCont === undefined) {
      return;
    }
    openEditContainerForm(detailRoom, detailCont);
  }

  function onDeleteContainer(): void {
    if (detailRoom === undefined || detailCont === undefined) {
      return;
    }
    openModal({
      title: "Delete Container",
      bodyHtml: `<p>Delete <strong>${escapeHtmlText(detailCont.name ?? "")}</strong> and all its contents?</p>`,
      btnText: "Delete",
      onConfirm: () => {
        verifyCaptchaAndExecute(async () => {
          if (await opDeleteContainer(detailRoom.id, detailCont.id)) {
            closeModal();
            navigateTo("containers", { roomId: detailRoom.id });
          }
        });
      },
    });
  }

  function onAddChemical(): void {
    if (detailRoom === undefined || detailCont === undefined) {
      return;
    }
    if (isReader) {
      showToast("Access Denied", "error");
      return;
    }
    openChemicalRadioPrompt(detailRoom, detailCont);
  }

  function onAddProtocol(): void {
    if (isReader) {
      showToast("Access Denied", "error");
      return;
    }
    openProtocolForm();
  }

  function onAddAssetRoom(): void {
    if (isReader) {
      showToast("Access Denied", "error");
      return;
    }
    openAssetRoomForm();
  }

  function onAddAsset(): void {
    if (isReader) {
      showToast("Access Denied", "error");
      return;
    }
    openAssetForm(inventory.tree?.assetRooms ?? []);
  }

  function escapeHtmlText(text: string): string {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }
</script>

<header id="app-header">
    <div class="header-inner">
        <div class="header-top">
            <div class="logo" id="logo-home">
                <div class="logo-icon">
                    <svg viewBox="0 0 40 40" fill="none"><path d="M20 6 L32 13 L32 27 L20 34 L8 27 L8 13 Z" fill="none" stroke="url(#g1)" stroke-width="2"/><circle cx="20" cy="6" r="3" fill="url(#g1)"/><circle cx="32" cy="13" r="3" fill="url(#g1)"/><circle cx="32" cy="27" r="3" fill="url(#g1)"/><circle cx="20" cy="34" r="3" fill="url(#g1)"/><circle cx="8" cy="27" r="3" fill="url(#g1)"/><circle cx="8" cy="13" r="3" fill="url(#g1)"/><circle cx="20" cy="20" r="3" fill="url(#g1)"/><path d="M20 6 L20 20 M32 13 L20 20 M32 27 L20 20 M20 34 L20 20 M8 27 L20 20 M8 13 L20 20" stroke="url(#g1)" stroke-width="1.5" opacity="0.5"/><defs><linearGradient id="g1" x1="8" y1="6" x2="32" y2="34"><stop offset="0%" stop-color="#0ea5e9"/><stop offset="100%" stop-color="#c084fc"/></linearGradient></defs></svg>
                </div>
                <div style="display: flex; flex-direction: column;">
                    <span class="logo-text">BioSCom</span>
                    <span style="font-size: 0.55rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; line-height: 1; margin-top: 1px;">Biomolecular structures<br>in cellular communication</span>
                </div>
            </div>
            <div class="header-actions">
                <div id="superadmin-console" style="display: none; align-items: center; gap: 0.5rem; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.25); padding: 0.25rem 0.65rem; border-radius: var(--radius-xl); margin-right: 0.5rem;">
                        <span style="font-size: 0.65rem; text-transform: uppercase; font-weight: 700; color: var(--accent-blue); letter-spacing: 0.05em;">Super Admin</span>
                        <select id="superadmin-lab-select" style="padding: 0.2rem 0.4rem; font-size: 0.75rem; width: 140px; background: var(--bg-card); border: 1px solid var(--border-subtle); color: var(--text-primary); border-radius: var(--radius-sm); outline: none; cursor: pointer;"></select>
                        <button id="btn-superadmin-members" class="btn-icon" style="width: 24px; height: 24px; padding: 0; border-radius: 50%; display: inline-flex;" title="View Laboratory Members">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                        </button>
                        <button id="btn-superadmin-labs" class="btn-icon" style="width: 24px; height: 24px; padding: 0; border-radius: 50%; display: inline-flex;" title="Manage Laboratories">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                        </button>
                    </div>
                    <GlobalSearch />
                    <div class="dropdown" id="user-dropdown-container">
                        <button class="dropdown-btn" id="btn-user-menu" title="User Menu">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                        </button>
                        <div class="dropdown-content" id="user-dropdown-content">
                            <div class="user-badge" id="user-badge" style={`display: ${badgeVisible ? "flex" : "none"}; flex-direction: column; padding: 1rem; line-height: 1.3;`}>
                                <span id="user-badge-name" style="font-size: 0.9rem; font-weight: 700; color: var(--text-primary);">{session.user?.name ?? "Jane Doe"}</span>
                                <span id="user-badge-lab" style="font-size: 0.75rem; color: var(--accent-blue); font-weight: 500;">{badgeGroup?.name ?? currentGroup.groupName ?? "Organic Chemistry Lab"}</span>
                                <span id="user-badge-code" style="font-size: 0.65rem; color: var(--text-muted); cursor: pointer; margin-top: 0.25rem;" title="Click to copy join code" onclick={copyJoinCode}>Code: {badgeGroup?.joinCode ?? "—"}</span>
                            </div>
                            <div class="dropdown-divider"></div>
                            <a class="dropdown-item" id="btn-group-members" style="display: none;">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                                Manage Members
                            </a>

                            <a class="dropdown-item" id="btn-edit-profile">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                                Edit Profile
                            </a>

                            <a class="dropdown-item" id="btn-toggle-theme" onclick={toggleTheme}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                                Toggle Lite Mode
                            </a>
                            <div class="dropdown-divider"></div>
                            <a class="dropdown-item" id="btn-logout" style="color: var(--accent-red);" onclick={() => void logout()}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                                Log Out
                            </a>
                        </div>
                    </div>
                    <input type="file" id="import-input" accept=".json" style="display:none">
                </div>
            </div>
            <div class="header-bottom">
                <nav class="main-nav" style="display: {isTopView ? 'flex' : 'none'}; align-items: center; justify-content: flex-start; padding: 0.5rem 0;">
                    <div class="nav-tabs-bar" id="nav-tabs-bar">
                        <a class="nav-tab" id="tab-inventory" data-label="List of Chemicals" class:active={activeTab === "tab-inventory"} role="button" tabindex="0" onclick={() => onTabClick("rooms")} onkeydown={(e) => e.key === "Enter" && onTabClick("rooms")}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                            List of Chemicals
                        </a>
                        <a class="nav-tab" id="tab-protocols" data-label="Solutions & Protocols" class:active={activeTab === "tab-protocols"} role="button" tabindex="0" onclick={() => onTabClick("protocols")} onkeydown={(e) => e.key === "Enter" && onTabClick("protocols")}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                            Solutions &amp; Protocols
                        </a>
                        <a class="nav-tab" id="tab-assets" data-label="Inventory" class:active={activeTab === "tab-assets"} role="button" tabindex="0" onclick={() => onTabClick("assets")} onkeydown={(e) => e.key === "Enter" && onTabClick("assets")}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 9V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><circle cx="12" cy="13" r="4"/></svg>
                            Inventory
                        </a>
                        <a class="nav-tab" id="tab-noticeboard" data-label="Notice Board" class:active={activeTab === "tab-noticeboard"} role="button" tabindex="0" onclick={() => onTabClick("noticeboard")} onkeydown={(e) => e.key === "Enter" && onTabClick("noticeboard")}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                            Notice Board
                        </a>
                        <a class="nav-tab" id="tab-instruments" data-label="Instruments" class:active={activeTab === "tab-instruments"} role="button" tabindex="0" onclick={() => onTabClick("instruments")} onkeydown={(e) => e.key === "Enter" && onTabClick("instruments")}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                            Instruments
                        </a>
                        <a class="nav-tab" id="tab-printing" data-label="3D Print" class:active={activeTab === "tab-printing"} role="button" tabindex="0" onclick={() => onTabClick("printing")} onkeydown={(e) => e.key === "Enter" && onTabClick("printing")}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                            3D Print
                        </a>
                        <a class="nav-tab" id="tab-history" data-label="History & Backups" class:active={activeTab === "tab-history"} role="button" tabindex="0" onclick={() => onTabClick("history")} onkeydown={(e) => e.key === "Enter" && onTabClick("history")}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                            History &amp; Backups
                        </a>
                        <a class="nav-tab" id="tab-minigames" data-label="Mini-games" class:active={activeTab === "tab-minigames"} role="button" tabindex="0" onclick={() => onTabClick("minigames")} onkeydown={(e) => e.key === "Enter" && onTabClick("minigames")}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/></svg>
                            Mini-games
                        </a>
                    </div>
                </nav>
                <nav id="breadcrumb" class="breadcrumb" style="display: {isTopView ? 'none' : 'flex'};"></nav>
            </div>
        </div>
    </header>

    <main id="app-main">
        <!-- Rooms View -->
        <section id="view-rooms" class="view" class:active={route.view === "rooms"}>
            <div class="view-header">
                <div><h1>Rooms</h1><p class="view-subtitle">Select a room to view its cabinets and fridges</p></div>
                <div class="view-header-actions">
                    <button id="btn-export-pdf" class="btn-secondary" onclick={onExportPdf}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Export PDF</span></button>
                    <button id="btn-add-room" class="btn-primary" onclick={onAddRoom}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add Room</span></button>
                </div>
            </div>
            <RoomsView />
        </section>

        <!-- Containers View (Cabinets + Fridges) -->
        <section id="view-containers" class="view" class:active={route.view === "containers"}>
            <div class="view-header">
                <div><h1 id="containers-title">{isVirtualShared ? "Room: Shared Assets" : `Room: ${containersRoom?.name ?? "Containers"}`}</h1><p class="view-subtitle" id="containers-subtitle">{isVirtualShared ? "Containers shared from neighboring laboratories" : (containersRoom?.description ?? "")}</p></div>
                <div class="view-header-actions">
                    <button id="btn-edit-room" class="btn-secondary" title="Edit room" style={`display: ${isVirtualShared ? "none" : "inline-flex"};`} onclick={onEditRoom}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                    <button id="btn-delete-room" class="btn-danger-outline" title="Delete room" style={`display: ${isVirtualShared ? "none" : "inline-flex"};`} onclick={onDeleteRoom}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                    <button id="btn-add-cabinet" class="btn-primary" style={`display: ${isVirtualShared ? "none" : "inline-flex"};`} onclick={() => onAddContainer("cabinet")}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add Cabinet</span></button>
                    <button id="btn-add-fridge" class="btn-primary btn-fridge" style={`display: ${isVirtualShared ? "none" : "inline-flex"};`} onclick={() => onAddContainer("fridge")}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add Fridge</span></button>
                    <button id="btn-add-freezer" class="btn-primary" style={`display: ${isVirtualShared ? "none" : "inline-flex"}; background: linear-gradient(135deg, #6366f1, #4f46e5); border: 1px solid rgba(99, 102, 241, 0.25);`} onclick={() => onAddContainer("freezer")}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add Freezer</span></button>
                </div>
            </div>
            <ContainersView />
        </section>

        <!-- Detail View (Shelves + Chemicals) -->
        <section id="view-detail" class="view" class:active={route.view === "detail"}>
            <div class="view-header">
                <div><h1 id="detail-title">{#if detailCont?.emoji}<span style="margin-right:0.5rem;">{detailCont.emoji}</span>{/if}{detailCont?.name ?? "Detail"}</h1><p class="view-subtitle" id="detail-subtitle">{detailRoom?.name ?? "Room"} → {detailCont?.name ?? ""}{#if detailCont && detailCont.sharedWithGroupIds && detailCont.sharedWithGroupIds.length > 0} | 🔗 Shared to: {detailCont.sharedWithGroupIds.map((gid) => groupList.items.find((g) => g.id === gid)?.name ?? gid).join(", ")}{/if}</p></div>
                <div class="view-header-actions">
                    <button id="btn-add-shelf" class="btn-secondary" style={`display: ${!isReader && detailCont !== undefined && detailCont.type !== "deepfreezer" ? "inline-flex" : "none"};`} onclick={onAddShelf}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add Shelf</span></button>
                    <button id="btn-export-container-pdf" class="btn-secondary" onclick={onExportContainerPdf}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Export PDF</span></button>
                    <button id="btn-edit-container" class="btn-secondary" title="Edit container" style={`display: ${!isReader && detailCont !== undefined ? "inline-flex" : "none"};`} onclick={onEditContainer}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                    <button id="btn-delete-container" class="btn-danger-outline" title="Delete container" style={`display: ${!isReader && detailCont !== undefined ? "inline-flex" : "none"};`} onclick={onDeleteContainer}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                    <button id="btn-add-chemical" class="btn-primary" onclick={onAddChemical}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add Chemical</span></button>
                </div>
            </div>
            <DetailView searchQuery={searchState.query} />
        </section>

        <!-- Protocols View -->
        <section id="view-protocols" class="view" class:active={route.view === "protocols"}>
            <div class="view-header">
                <div><h1>Standard Laboratory Solutions &amp; Stock Preparations</h1><p class="view-subtitle">Manage laboratory protocols and recipes</p></div>
                <div class="view-header-actions">
                    <button id="btn-add-protocol" class="btn-primary" onclick={onAddProtocol}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add Protocol</span></button>
                </div>
            </div>
            <ProtocolsView />
        </section>

        <!-- Assets/Inventory View -->
        <section id="view-assets" class="view" class:active={route.view === "assets"}>
            <div class="view-header">
                <div><h1>Laboratory Equipment &amp; Assets Inventory</h1><p class="view-subtitle">Manage laboratory equipment, devices, and assets with barcode tracking</p></div>
                <div class="view-header-actions" style="display: flex; gap: 1rem; align-items: center;">
                    <div class="search-box" style="min-width: 250px;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        <input type="text" id="assets-search-input" placeholder="Search inventory..." autocomplete="off" bind:value={assetSearch}>
                    </div>
                    <button id="btn-add-asset-room" class="btn-secondary" style="margin-right: 0.5rem;" onclick={onAddAssetRoom}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add Room</span></button>
                    <button id="btn-add-asset" class="btn-primary" onclick={onAddAsset}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add Asset</span></button>
                </div>
            </div>
            <AssetsView bind:searchQuery={assetSearch} />
        </section>

        <!-- Notice Board View -->
        <section id="view-noticeboard" class="view" class:active={route.view === "noticeboard"}>
            <div class="view-header">
                <div><h1>📋 Notice Board</h1><p class="view-subtitle">Share suggestions and notes with your laboratory team</p></div>
                <div class="view-header-actions">
                    <button id="btn-add-notice" class="btn-primary"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add Note</span></button>
                </div>
            </div>
            <div id="noticeboard-container" class="protocols-container"></div>
            <div id="noticeboard-empty" class="empty-state" style="display:none;">
                <div class="empty-icon">📝</div><h2>No notes yet</h2><p>Add the first note or suggestion for your lab team</p>
            </div>
        </section>

        <!-- Instruments View -->
        <section id="view-instruments" class="view" class:active={route.view === "instruments"}>
            <div class="view-header">
                <div><h1>🔬 Laboratory Instruments</h1><p class="view-subtitle">Browse instruments and book time slots</p></div>
                <div class="view-header-actions">
                    <div class="search-box" style="min-width: 250px;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        <input type="text" id="instruments-search-input" placeholder="Search instruments..." autocomplete="off">
                    </div>
                    <button id="btn-add-instrument" class="btn-primary"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add Instrument</span></button>
                </div>
            </div>
            <div id="instruments-grid" class="assets-grid"></div>
            <div id="instruments-empty" class="empty-state" style="display:none;">
                <div class="empty-icon">🔬</div><h2>No instruments yet</h2><p>Add your first laboratory instrument</p>
                <button class="btn-primary" id="btn-add-instrument-empty"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add Instrument</span></button>
            </div>
        </section>

        <!-- 3D Print View -->
        <section id="view-printing" class="view" class:active={route.view === "printing"}>
            <div class="view-header">
                <div><h1>🖨️ 3D Print Service</h1><p class="view-subtitle">Browse catalog and request 3D prints for your lab</p></div>
                <div class="view-header-actions">
                    <button id="btn-add-catalog-item" class="btn-primary"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add to Catalog</span></button>
                    <button id="btn-custom-print-request" class="btn-primary" style="background: linear-gradient(135deg, #f59e0b, #ef4444);"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Custom Request</span></button>
                </div>
            </div>

            <!-- Print View Tabs -->
            <div class="print-tabs-nav">
                <button class="print-tab-btn active" id="print-tab-catalog-btn">📚 Catalog</button>
                <button class="print-tab-btn" id="print-tab-requests-btn">📋 Print Requests</button>
            </div>

            <!-- Tab Content 1: Catalog -->
            <div id="print-catalog-tab-content">
                <div class="filter-pills-container" id="print-category-filters">
                    <button class="filter-pill active">All</button>
                    <button class="filter-pill">Racks &amp; Holders</button>
                    <button class="filter-pill">Adapters &amp; Clamps</button>
                    <button class="filter-pill">Fluidics &amp; Tubing</button>
                    <button class="filter-pill">Enclosures &amp; Boxes</button>
                    <button class="filter-pill">Safety Gears</button>
                    <button class="filter-pill">Others</button>
                </div>
                <div id="print-catalog-grid" class="assets-grid"></div>
                <div id="print-catalog-empty" class="empty-state" style="display:none;">
                    <div class="empty-icon">🖨️</div><h2>No items in catalog yet</h2><p>Add your first 3D printable design to the catalog</p>
                </div>
            </div>

            <!-- Tab Content 2: Requests -->
            <div id="print-requests-tab-content" style="display: none;">
                <div id="print-requests-list" class="booking-list" style="margin-top: 0;"></div>
                <div id="print-requests-empty" class="empty-state" style="display:none;">
                    <div class="empty-icon">📋</div><h2>No print requests yet</h2><p>Request print from the catalog or submit a custom request</p>
                </div>
            </div>
        </section>

        <!-- History & Backups View -->
        <section id="view-history" class="view" class:active={route.view === "history"}>
            <div class="view-header">
                <div><h1>⏱️ History &amp; Backups</h1><p class="view-subtitle">Audit log and system backups</p></div>
                <div class="view-header-actions" id="history-superadmin-actions" style="display:none;">
                    <select id="history-lab-select" class="form-select" style="max-width:200px; display:none;"></select>
                </div>
            </div>

            <div class="print-tabs-nav">
                <button class="print-tab-btn active" id="history-tab-log-btn">📝 Audit Log</button>
                <button class="print-tab-btn" id="history-tab-backups-btn">💾 Auto-Backups</button>
            </div>

            <div id="history-log-tab-content">
                <div id="history-log-list" class="protocols-container" style="margin-top: 1rem;"></div>
                <div id="history-log-empty" class="empty-state" style="display:none;">
                    <div class="empty-icon">📝</div><h2>No history events</h2><p>Actions performed in the lab will appear here</p>
                </div>
            </div>

            <div id="history-backups-tab-content" style="display: none;">
                <div id="history-backups-actions" style="margin-bottom: 1rem; margin-top: 1rem; display: none;">
                    <button class="btn-primary"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg><span style="margin-left:6px;">Create Manual Backup</span></button>
                </div>
                <div id="history-backups-list" class="protocols-container" style="margin-top: 1rem;"></div>
                <div id="history-backups-empty" class="empty-state" style="display:none;">
                    <div class="empty-icon">💾</div><h2>No backups yet</h2><p>Auto-backups are generated every 30 minutes of active use</p>
                </div>
            </div>
        </section>

        <!-- Mini-games View -->
        <section id="view-minigames" class="view" class:active={route.view === "minigames"}>
            <div class="view-header">
                <div><h1>🎮 Biochemical Lab Games</h1><p class="view-subtitle">Challenge colleagues to games and captcha quizzes</p></div>
            </div>

            <div class="minigames-container" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 1.5rem;">
                <!-- Left: Challenges panel -->
                <div class="minigames-panel" style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem;">
                    <h2>Challenge a Colleague</h2>
                    <div class="form-group">
                        <label class="form-label">Select Colleague</label>
                        <select class="form-select" id="game-opponent-select"></select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Select Game</label>
                        <select class="form-select" id="game-type-select">
                            <option value="frog">🐸 Frog CAPTCHA Quiz</option>
                            <option value="chess">🧬 Biochemical Chess</option>
                        </select>
                    </div>
                    <button class="btn-primary" id="btn-send-game-challenge" style="margin-top: 0.5rem; width: 100%;">🚀 Send Challenge</button>

                    <h2 style="margin-top: 1rem; border-top: 1px solid var(--border-subtle); padding-top: 1rem;">Pending Challenges</h2>
                    <div id="game-pending-list" style="display: flex; flex-direction: column; gap: 0.5rem; max-height: 200px; overflow-y: auto;"></div>
                </div>

                <!-- Right: Active & Past Games -->
                <div class="minigames-panel" style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem;">
                    <h2>Active Matches</h2>
                    <div id="game-active-list" style="display: flex; flex-direction: column; gap: 0.5rem; max-height: 250px; overflow-y: auto;"></div>

                    <h2 style="margin-top: 1rem; border-top: 1px solid var(--border-subtle); padding-top: 1rem;">Completed Matches</h2>
                    <div id="game-completed-list" style="display: flex; flex-direction: column; gap: 0.5rem; max-height: 200px; overflow-y: auto;"></div>
                </div>
            </div>

            <!-- Game Workspace Container (Frog Quiz / Chess Board renders here) -->
            <div id="active-game-workspace" style="display: none; background: var(--bg-card); border: 1.5px solid var(--accent-blue); border-radius: var(--radius-lg); padding: 2rem; margin-top: 2rem; box-shadow: 0 4px 20px rgba(59, 130, 246, 0.15);"></div>
        </section>
    </main>

    <Modal />
    <!-- Persistent Lab Radio Widget -->
    <div id="lab-radio-widget" class="lab-radio-widget hidden">
        <div class="radio-content">
            <div class="radio-header">
                <span class="radio-title">📻 Lab Radio</span>
                <button class="radio-close" id="btn-radio-close" title="Close Radio">×</button>
            </div>
            <div class="radio-body">
                <div class="vinyl-container">
                    <span class="vinyl-disc">💿</span>
                </div>
                <div class="radio-info">
                    <div class="station-name" id="radio-station">Radio Folk</div>
                    <div class="song-title">Playing traditional tunes...</div>
                </div>
            </div>
            <div class="radio-controls">
                <button class="btn-radio-play" id="btn-radio-play">⏸️</button>
                <input type="range" class="radio-volume" id="radio-volume" min="0" max="1" step="0.05" value="0.5">
            </div>
        </div>
        <audio id="lab-radio-audio"></audio>
    </div>
