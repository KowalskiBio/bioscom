<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { inventory, inventoryFor } from "../../lib/stores/inventory.svelte";
  import { instrumentList } from "../../lib/stores/instruments.svelte";
  import { historyData } from "../../lib/stores/history.svelte";
  import { currentGroup } from "../../lib/stores/currentGroup.svelte";
  import { session } from "../../lib/stores/session.svelte";
  import { fetchNotices, noticeList } from "../../lib/stores/notices.svelte";
  import {
    dashboardDismissals,
    dismissDashboardAlert,
    loadDashboardDismissals,
  } from "../../lib/stores/dashboardDismissals.svelte";
  import {
    buildDashboardNoticeAlerts,
    buildDashboardStockAlerts,
    collectDashboardStockLocations,
    DASHBOARD_STOCK_ALERT_LIMIT,
    withoutDismissedAlerts,
  } from "../../lib/dashboardAttention";
  import { stripEmoji } from "../../lib/inventoryUtils";
  import { openChemicalForm } from "../../lib/forms";
  import { navigateTo } from "../../lib/router.svelte";
  import { theme } from "../../lib/theme.svelte";

  const design = $derived(theme.design);
  const userId = $derived(session.user?.uid ?? null);
  const tree = $derived(inventoryFor(currentGroup.groupId));
  const rooms = $derived(tree?.rooms ?? []);
  const stockLocations = $derived(collectDashboardStockLocations(tree));
  const chemCount = $derived(stockLocations.length);
  const contCount = $derived(
    rooms.reduce((sum, room) => sum + (room.containers ?? []).length, 0) +
      (tree?.deepFreezers?.length ?? 0),
  );
  const protocolCount = $derived(tree?.protocols?.length ?? 0);

  let noticesLoading = $state(false);
  let noticesError = $state("");
  let noticesAttemptedUid = $state<string | null>(null);
  let noticeRequest = 0;
  let announcement = $state("");

  async function loadDashboardNotices(): Promise<void> {
    if (noticesLoading || noticeList.loaded) return;
    const request = ++noticeRequest;
    noticesLoading = true;
    noticesError = "";
    try {
      await fetchNotices();
    } catch {
      if (request === noticeRequest) {
        noticesError = "Couldn’t load board posts. The notice-board list is not confirmed yet.";
      }
    } finally {
      if (request === noticeRequest) noticesLoading = false;
    }
  }

  function requestDashboardNotices(force = false): void {
    const uid = userId;
    if (
      uid === null ||
      noticeList.loaded ||
      noticesLoading ||
      (!force && noticesAttemptedUid === uid)
    ) {
      return;
    }
    // Mark the attempt before clearing errors or starting the request so a
    // failure cannot re-trigger this effect as a background retry loop.
    noticesAttemptedUid = uid;
    void loadDashboardNotices();
  }

  $effect(() => {
    const uid = userId;
    void loadDashboardDismissals(uid);
    if (uid !== null) requestDashboardNotices();
  });

  onDestroy(() => {
    noticeRequest += 1;
  });

  const dismissalsConfirmed = $derived(
    userId !== null && dashboardDismissals.accountId === userId && dashboardDismissals.confirmed,
  );
  const stockSourcesConfirmed = $derived(dismissalsConfirmed && tree !== null);
  const boardSourcesConfirmed = $derived(
    dismissalsConfirmed && noticeList.loaded && !noticesLoading,
  );
  const activeStockAlerts = $derived.by(() => {
    if (!stockSourcesConfirmed || userId === null) return [];
    return withoutDismissedAlerts(
      buildDashboardStockAlerts(tree),
      dashboardDismissals.dismissalsFor(userId),
    );
  });
  const visibleStockAlerts = $derived(activeStockAlerts.slice(0, DASHBOARD_STOCK_ALERT_LIMIT));
  const noticeAlerts = $derived.by(() => {
    if (!boardSourcesConfirmed || userId === null) return [];
    return withoutDismissedAlerts(
      buildDashboardNoticeAlerts(noticeList.items),
      dashboardDismissals.dismissalsFor(userId),
    );
  });
  const shownAttentionCount = $derived(visibleStockAlerts.length + noticeAlerts.length);

  function retryAttentionSources(): void {
    void loadDashboardDismissals(userId, true);
    if (!noticeList.loaded) requestDashboardNotices(true);
  }

  function nextDismissControl(key: string): string | null {
    const controls = [...document.querySelectorAll<HTMLElement>("[data-dashboard-dismiss]")];
    const index = controls.findIndex((control) => control.dataset.dismissalKey === key);
    if (index < 0) return null;
    return controls[index + 1]?.dataset.dismissalKey ?? controls[index - 1]?.dataset.dismissalKey ?? null;
  }

  async function onDismiss(event: MouseEvent, key: string, name: string): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const uid = userId;
    if (uid === null || dashboardDismissals.pendingFor(uid, key)) return;
    const nextControl = nextDismissControl(key);
    announcement = `Dismissing ${name} for you. The item stays visible until the save is confirmed.`;
    const saved = await dismissDashboardAlert(uid, key);
    if (!saved) {
      announcement = `Couldn’t dismiss ${name} for you. It remains visible.`;
      return;
    }
    announcement = `Dismissed ${name} for you. Other users are not affected.`;
    await tick();
    const controls = [...document.querySelectorAll<HTMLElement>("[data-dashboard-dismiss]")];
    const target = controls.find((control) => control.dataset.dismissalKey === nextControl);
    (target ?? document.getElementById("dash-attention-title"))?.focus();
  }

  function todayLocal(): string {
    const d = new Date();
    const p = (n: number): string => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function isoWeek(d: Date): number {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - day + 3);
    const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    return 1 + Math.round((t.getTime() - first.getTime()) / 604800000);
  }

  interface ReservationItem {
    instrument: string;
    time: string;
    user: string;
    status: "live" | "queued" | "done";
  }
  const reservationsToday = $derived.by<ReservationItem[]>(() => {
    const today = todayLocal();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const toMin = (t: string | null | undefined): number => {
      const [h = "0", m = "0"] = (t ?? "").split(":");
      return parseInt(h, 10) * 60 + parseInt(m, 10);
    };
    const items: ReservationItem[] = [];
    for (const inst of instrumentList.items) {
      for (const b of inst.bookings ?? []) {
        if (b.date !== today) continue;
        const start = toMin(b.startTime);
        const end = toMin(b.endTime);
        items.push({
          instrument: inst.name ?? "—",
          time: `${b.startTime ?? "?"} – ${b.endTime ?? "?"}`,
          user: b.userName ?? b.labName ?? "—",
          status: nowMin >= start && nowMin < end ? "live" : nowMin >= end ? "done" : "queued",
        });
      }
    }
    return items.sort((a, b) => a.time.localeCompare(b.time)).slice(0, 8);
  });

  const weekBookings = $derived.by<number>(() => {
    const now = new Date();
    const day = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - day);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const within = (ds: string | null | undefined): boolean => {
      if (ds === undefined || ds === null) return false;
      const d = new Date(`${ds}T00:00:00`);
      return d >= new Date(monday.getFullYear(), monday.getMonth(), monday.getDate()) && d <= sunday;
    };
    let n = 0;
    for (const inst of instrumentList.items) {
      for (const b of inst.bookings ?? []) {
        if (within(b.date)) n += 1;
      }
    }
    return n;
  });

  const activity = $derived(historyData.entries.slice(0, 7));
  const sharedCount = $derived(inventory.sharedContainers.length);
  const sharedTop = $derived(inventory.sharedContainers.slice(0, 6));

  const labName = $derived(currentGroup.groupName ?? "—");
  const dateLine = $derived(
    `Week ${isoWeek(new Date())} · ${new Date().toLocaleDateString("en-GB", { weekday: "long" })} · ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}`,
  );

  function timeOf(ts: number): string {
    const d = new Date(ts);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const p = (n: number): string => String(n).padStart(2, "0");
    if (sameDay) return `${p(d.getHours())}:${p(d.getMinutes())}`;
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "YDY";
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.`;
  }

  function noticeMeta(authorName: string | null, authorLab: string | null, date: string | null): string {
    return [authorName, authorLab, date].filter((part): part is string => part !== null).join(" · ");
  }
</script>

<div class="view-header">
    <div>
        <h1 id="dashboard-title">Dashboard</h1>
        <p class="view-subtitle" id="dashboard-subtitle">{design === "bauhaus" ? stripEmoji(labName) : labName} · {dateLine}</p>
    </div>
    <div class="view-header-actions">
        <button class="btn-secondary" id="btn-dash-add-chemical" onclick={() => openChemicalForm()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span>Add chemical</span>
        </button>
        <button class="btn-primary" id="btn-dash-reserve" onclick={() => navigateTo("instruments")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span>New reservation</span>
        </button>
    </div>
</div>

<!-- Stats -->
<section class="dash-stats" id="dash-stats">
    <a class="card stat-card s-red" id="stat-chems" href="#catalog" title="Open Catalog">
        <div class="stat-head"><p class="stat-lbl">Chemicals</p><span class="stat-glyph g-circle g-red"></span></div>
        <p class="stat-value">{chemCount}</p>
        <p class="stat-meta">across {contCount} containers</p>
    </a>
    <a class="card stat-card s-blue" id="stat-containers" href="#rooms" title="Open Chemicals / Rooms">
        <div class="stat-head"><p class="stat-lbl">Containers</p><span class="stat-glyph g-square g-blue"></span></div>
        <p class="stat-value">{contCount}</p>
        <p class="stat-meta">{rooms.length} rooms · {sharedCount} shared in</p>
    </a>
    <a class="card stat-card s-yellow" id="stat-protocols" href="#protocols" title="Open Protocols">
        <div class="stat-head"><p class="stat-lbl">Protocols</p><span class="stat-glyph g-tri g-yellow"></span></div>
        <p class="stat-value">{protocolCount}</p>
        <p class="stat-meta">documented procedures</p>
    </a>
    <a class="card stat-card s-ink" id="stat-bookings" href="#instruments" title="Open Reservations">
        <div class="stat-head"><p class="stat-lbl">Bookings</p><span class="stat-glyph g-square g-ink"></span></div>
        <p class="stat-value">{weekBookings}</p>
        <p class="stat-meta">this week · {reservationsToday.length} today</p>
    </a>
</section>

<!-- Row 2 -->
<section class="dash-grid" id="dash-row2">
    <div class="card dash-card dash-span2" id="dash-attention" data-stock-ready={stockSourcesConfirmed ? "true" : "false"} data-board-ready={boardSourcesConfirmed ? "true" : "false"}>
        <div class="dash-card-head">
            <span class="stat-glyph g-square g-red" aria-hidden="true"></span>
            <h2 class="dash-card-title" id="dash-attention-title" tabindex="-1">Attention required</h2>
            {#if (stockSourcesConfirmed || boardSourcesConfirmed) && shownAttentionCount > 0}
                <span class="dash-count" id="dash-attention-count" title="Attention rows currently shown" aria-label={`${shownAttentionCount} attention rows shown`}>{shownAttentionCount}</span>
            {/if}
        </div>
        <p class="dash-sr-only" role="status" aria-live="polite">{announcement}</p>

        {#if dashboardDismissals.loadError !== "" || noticesError !== ""}
            <div class="dash-attention-message warning" id="dash-attention-error" role="alert">
                <div>
                    {#if dashboardDismissals.loadError !== ""}<p>{dashboardDismissals.loadError}</p>{/if}
                    {#if noticesError !== ""}<p>{noticesError}</p>{/if}
                    {#if stockSourcesConfirmed || boardSourcesConfirmed}<p>Showing the available sections from the last confirmed data.</p>{/if}
                </div>
                <button type="button" class="btn-inline" id="dash-attention-retry" onclick={retryAttentionSources}>Try again</button>
            </div>
        {/if}

        {#if stockSourcesConfirmed && boardSourcesConfirmed && activeStockAlerts.length === 0 && noticeAlerts.length === 0}
            <p class="dash-empty" id="dash-attention-empty">You’re caught up — no active stock, expiry, or notice-board items remain after your personal dismissals.</p>
        {/if}

            <section class="dash-attention-section" aria-labelledby="dash-stock-attention-title">
                <div class="dash-attention-section-head">
                    <h3 id="dash-stock-attention-title">Stock &amp; expiry</h3>
                    <p id="dash-stock-attention-summary">
                        {#if !stockSourcesConfirmed}
                            Stock alerts are not confirmed yet.
                        {:else if activeStockAlerts.length > DASHBOARD_STOCK_ALERT_LIMIT}
                            Showing {visibleStockAlerts.length} of {activeStockAlerts.length} stock alerts · the stock list is limited to {DASHBOARD_STOCK_ALERT_LIMIT} rows.
                        {:else}
                            {activeStockAlerts.length} {activeStockAlerts.length === 1 ? "stock alert" : "stock alerts"} shown.
                        {/if}
                    </p>
                </div>
                {#if !stockSourcesConfirmed}
                    <p class="dash-attention-group-empty" id="dash-stock-attention-loading" role="status">
                        {#if currentGroup.groupId === null}
                            Select a lab to confirm its stock and expiry alerts. No stock empty state is assumed.
                        {:else if dashboardDismissals.loading}
                            Loading your personal dismissals before showing stock alerts…
                        {:else if dashboardDismissals.loadError !== ""}
                            Stock alerts stay unconfirmed until your personal dismissals load successfully.
                        {:else}
                            Waiting for confirmed inventory for this lab. No stock empty state is assumed.
                        {/if}
                    </p>
                {:else if visibleStockAlerts.length === 0}
                    <p class="dash-attention-group-empty">No active stock or expiry alerts.</p>
                {:else}
                    <ul class="dash-list" id="dash-stock-attention-list">
                        {#each visibleStockAlerts as item (item.dismissalKey)}
                            {@const pending = userId !== null && dashboardDismissals.pendingFor(userId, item.dismissalKey)}
                            {@const error = userId !== null ? dashboardDismissals.errorFor(userId, item.dismissalKey) : ""}
                            <li class="dash-item dash-attention-item" data-attention-key={item.dismissalKey} data-stock-id={item.chemicalId} data-alert-kind={item.kind}>
                                <a class="dash-attention-link" href={item.href} aria-label={`${item.name}. ${item.detail}. Open stock location`}>
                                    <span class="stat-glyph {item.level === "low" ? "g-square g-red" : "g-tri g-yellow"}" aria-hidden="true"></span>
                                    <span class="dash-item-main">
                                        <span class="dash-item-title">{item.name}</span>
                                        <span class="dash-item-sub">{item.path}</span>
                                        <span class="dash-attention-detail {item.level}">{item.detail}</span>
                                    </span>
                                </a>
                                <div class="dash-attention-action">
                                    <button
                                        type="button"
                                        class="btn-inline dash-dismiss-button"
                                        data-dashboard-dismiss
                                        data-dismissal-key={item.dismissalKey}
                                        aria-label={pending ? `Dismissing ${item.name} for me` : `Dismiss ${item.name} for me`}
                                        aria-describedby={error !== "" ? `attention-error-${item.dismissalKey}` : undefined}
                                        aria-busy={pending}
                                        title="Dismiss for me (does not affect other users)"
                                        disabled={pending}
                                        onclick={(event) => void onDismiss(event, item.dismissalKey, item.name)}
                                    >{pending ? "Dismissing…" : "Dismiss"}</button>
                                    {#if error !== ""}<span class="dash-attention-row-error" id={`attention-error-${item.dismissalKey}`} role="alert">{error}</span>{/if}
                                </div>
                            </li>
                        {/each}
                    </ul>
                {/if}
            </section>

            <section class="dash-attention-section" aria-labelledby="dash-notice-attention-title">
                <div class="dash-attention-section-head">
                    <h3 id="dash-notice-attention-title">Notice board</h3>
                    <p id="dash-notice-attention-summary">
                        {#if boardSourcesConfirmed}
                            {noticeAlerts.length} current {noticeAlerts.length === 1 ? "post" : "posts"} shown · all shared board posts are included.
                        {:else}
                            Board posts are not confirmed yet.
                        {/if}
                    </p>
                </div>
                {#if !boardSourcesConfirmed}
                    <p class="dash-attention-group-empty" id="dash-board-attention-loading" role="status">
                        {#if noticesLoading}
                            Loading shared board posts…
                        {:else if noticesError !== ""}
                            Board posts stay unconfirmed until the shared board loads successfully.
                        {:else if dashboardDismissals.loading}
                            Loading shared board posts and your personal dismissals…
                        {:else}
                            Board posts stay unconfirmed until your personal dismissals load successfully.
                        {/if}
                    </p>
                {:else if noticeAlerts.length === 0}
                    <p class="dash-attention-group-empty">No current board posts after your personal dismissals.</p>
                {:else}
                    <!-- svelte-ignore a11y_no_noninteractive_tabindex -- focusable scroll region is intentional -->
                    <div class="dash-attention-notice-scroll" tabindex="0" role="group" aria-label="Scrollable notice-board posts">
                        <ul class="dash-list" id="dash-notice-attention-list">
                            {#each noticeAlerts as item (item.dismissalKey)}
                                {@const pending = userId !== null && dashboardDismissals.pendingFor(userId, item.dismissalKey)}
                                {@const error = userId !== null ? dashboardDismissals.errorFor(userId, item.dismissalKey) : ""}
                                <li class="dash-item dash-attention-item dash-notice-item" data-attention-key={item.dismissalKey} data-notice-id={item.noticeId} data-notice-category={item.category.toLowerCase()}>
                                    <a class="dash-attention-link dash-notice-link" href={item.href} aria-label={`${item.title}. Open notice board`}>
                                        <span class="stat-glyph g-square g-blue" aria-hidden="true"></span>
                                        <span class="dash-item-main">
                                            <span class="dash-notice-heading"><span class="dash-notice-category">{item.category}</span><span class="dash-item-title">{item.title}</span></span>
                                            {#if item.content !== ""}<span class="dash-notice-content">{item.content}</span>{/if}
                                            {#if noticeMeta(item.authorName, item.authorLab, item.date) !== ""}<span class="dash-item-sub">{noticeMeta(item.authorName, item.authorLab, item.date)}</span>{/if}
                                        </span>
                                    </a>
                                    <div class="dash-attention-action">
                                        <button
                                            type="button"
                                            class="btn-inline dash-dismiss-button"
                                            data-dashboard-dismiss
                                            data-dismissal-key={item.dismissalKey}
                                            aria-label={pending ? `Dismissing ${item.title} for me` : `Dismiss ${item.title} for me`}
                                            aria-describedby={error !== "" ? `attention-error-${item.dismissalKey}` : undefined}
                                            aria-busy={pending}
                                            title="Dismiss for me (does not affect other users)"
                                            disabled={pending}
                                            onclick={(event) => void onDismiss(event, item.dismissalKey, item.title)}
                                        >{pending ? "Dismissing…" : "Dismiss"}</button>
                                        {#if error !== ""}<span class="dash-attention-row-error" id={`attention-error-${item.dismissalKey}`} role="alert">{error}</span>{/if}
                                    </div>
                                </li>
                            {/each}
                        </ul>
                    </div>
                {/if}
            </section>
    </div>

    <div class="card dash-card" id="dash-reservations">
        <div class="dash-card-head">
            <span class="stat-glyph g-square g-ink"></span>
            <h2 class="dash-card-title">Today's reservations</h2>
        </div>
        {#if reservationsToday.length === 0}
            <p class="dash-empty" id="dash-reservations-empty">Nothing booked today — every instrument is free.</p>
        {:else}
            <ul class="dash-list">
                {#each reservationsToday as r (r.instrument + r.time + r.user)}
                    <li class="dash-item">
                        <span class="dash-time">{r.time}</span>
                        <span class="dash-item-main">
                            <span class="dash-item-title">{design === "bauhaus" ? stripEmoji(r.instrument) : r.instrument}</span>
                            <span class="dash-item-sub">{design === "bauhaus" ? stripEmoji(r.user) : r.user}</span>
                        </span>
                        <span class="status-badge {r.status === "live" ? "printing" : r.status === "done" ? "done" : "pending"}">{r.status === "done" ? "Done" : r.status === "live" ? "Live" : "Queued"}</span>
                    </li>
                {/each}
            </ul>
        {/if}
    </div>
</section>

<!-- Row 3 -->
<section class="dash-grid" id="dash-row3">
    <div class="card dash-card dash-span2" id="dash-activity">
        <div class="dash-card-head">
            <span class="stat-glyph g-tri g-ink"></span>
            <h2 class="dash-card-title">Activity log</h2>
        </div>
        {#if activity.length === 0}
            <p class="dash-empty" id="dash-activity-empty">No changes recorded yet.</p>
        {:else}
            <ul class="dash-list">
                {#each activity as entry, i (entry.timestamp + String(i))}
                    <li class="dash-item">
                        <span class="dash-time">{timeOf(entry.timestamp)}</span>
                        <span class="dash-item-main">
                            <span class="dash-item-title"><strong>{design === "bauhaus" ? stripEmoji(entry.user) : entry.user}</strong> {design === "bauhaus" ? stripEmoji(entry.action) : entry.action}</span>
                        </span>
                    </li>
                {/each}
            </ul>
        {/if}
    </div>

    <div class="card dash-card" id="dash-shared">
        <div class="dash-card-head">
            <span class="stat-glyph g-square g-blue"></span>
            <h2 class="dash-card-title">Shared containers</h2>
        </div>
        {#if sharedTop.length === 0}
            <p class="dash-empty" id="dash-shared-empty">No containers shared from neighboring labs.</p>
        {:else}
            <ul class="dash-list">
                {#each sharedTop as s (s.container.id)}
                    <li class="dash-item">
                        <span class="dash-item-main">
                            <span class="dash-item-title">{design === "bauhaus" ? stripEmoji(s.container.name) : s.container.name}</span>
                            <span class="dash-item-sub">from {design === "bauhaus" ? stripEmoji(s.ownerGroupName ?? "—") : (s.ownerGroupName ?? "—")} · {design === "bauhaus" ? stripEmoji(s.roomName) : s.roomName}</span>
                        </span>
                    </li>
                {/each}
            </ul>
        {/if}
    </div>
</section>
