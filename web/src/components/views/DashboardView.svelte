<script lang="ts">
  import type { Chemical, Room } from "@bioscom/shared";
  import { inventory } from "../../lib/stores/inventory.svelte";
  import { instrumentList } from "../../lib/stores/instruments.svelte";
  import { historyData } from "../../lib/stores/history.svelte";
  import { currentGroup } from "../../lib/stores/currentGroup.svelte";
  import { quantityClass } from "../../lib/inventoryUtils";
  import { exportPDF } from "../../lib/exports";
  import { navigateTo } from "../../lib/router.svelte";

  const tree = $derived(inventory.tree);
  const rooms = $derived<Room[]>(tree?.rooms ?? []);

  function allChems(rooms_: Room[]): Array<{ ch: Chemical; path: string }> {
    const out: Array<{ ch: Chemical; path: string }> = [];
    for (const room of rooms_) {
      for (const cont of room.containers ?? []) {
        for (const shelf of cont.shelves ?? []) {
          for (const ch of shelf.chemicals ?? []) {
            out.push({ ch, path: `${room.name ?? room.id} · ${cont.name ?? cont.id}` });
          }
        }
      }
    }
    return out;
  }

  const chems = $derived(allChems(rooms));
  const chemCount = $derived(chems.length);
  const contCount = $derived(rooms.reduce((sum, r) => sum + (r.containers ?? []).length, 0));
  const instCount = $derived(instrumentList.items.length);

  interface AttentionItem {
    name: string;
    path: string;
    qty: number;
    unit: string;
    level: "low" | "medium";
  }
  const attention = $derived.by<AttentionItem[]>(() => {
    const out: AttentionItem[] = [];
    for (const { ch, path } of chems) {
      const lvl = quantityClass(ch.quantity);
      if (lvl === "ok") continue;
      out.push({
        name: ch.name ?? "—",
        path,
        qty: parseFloat(String(ch.quantity ?? 0)) || 0,
        unit: ch.unit ?? "",
        level: lvl as "low" | "medium",
      });
    }
    return out.sort((a, b) => a.qty - b.qty).slice(0, 8);
  });

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

  function fmtQty(q: number): string {
    return Number.isInteger(q) ? String(q) : q.toFixed(1);
  }
</script>

<div class="view-header">
    <div>
        <h1 id="dashboard-title">Dashboard</h1>
        <p class="view-subtitle" id="dashboard-subtitle">{labName} · {dateLine}</p>
    </div>
    <div class="view-header-actions">
        <button class="btn-secondary" id="btn-dash-export" onclick={() => { if (inventory.tree !== null) exportPDF(inventory.tree); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Inventory report</span>
        </button>
        <button class="btn-primary" id="btn-dash-reserve" onclick={() => navigateTo("instruments")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span>New reservation</span>
        </button>
    </div>
</div>

<!-- Stats -->
<section class="dash-stats" id="dash-stats">
    <div class="card stat-card s-red" id="stat-chems">
        <div class="stat-head"><p class="stat-lbl">Chemicals</p><span class="stat-glyph g-circle g-red"></span></div>
        <p class="stat-value">{chemCount}</p>
        <p class="stat-meta">across {contCount} containers</p>
    </div>
    <div class="card stat-card s-blue" id="stat-containers">
        <div class="stat-head"><p class="stat-lbl">Containers</p><span class="stat-glyph g-square g-blue"></span></div>
        <p class="stat-value">{contCount}</p>
        <p class="stat-meta">{rooms.length} rooms · {sharedCount} shared in</p>
    </div>
    <div class="card stat-card s-yellow" id="stat-instruments">
        <div class="stat-head"><p class="stat-lbl">Instruments</p><span class="stat-glyph g-tri g-yellow"></span></div>
        <p class="stat-value">{instCount}</p>
        <p class="stat-meta">bookable resources</p>
    </div>
    <div class="card stat-card s-ink" id="stat-bookings">
        <div class="stat-head"><p class="stat-lbl">Bookings</p><span class="stat-glyph g-square g-ink"></span></div>
        <p class="stat-value">{weekBookings}</p>
        <p class="stat-meta">this week · {reservationsToday.length} today</p>
    </div>
</section>

<!-- Row 2 -->
<section class="dash-grid" id="dash-row2">
    <div class="card dash-card dash-span2" id="dash-attention">
        <div class="dash-card-head">
            <span class="stat-glyph g-square g-red"></span>
            <h2 class="dash-card-title">Attention required</h2>
            {#if attention.length > 0}<span class="dash-count">{attention.length}</span>{/if}
        </div>
        {#if attention.length === 0}
            <p class="dash-empty" id="dash-attention-empty">All levels nominal — nothing below par.</p>
        {:else}
            <ul class="dash-list">
                {#each attention as item (item.name + item.path)}
                    <li class="dash-item">
                        <span class="stat-glyph {item.level === "low" ? "g-square g-red" : "g-tri g-yellow"}"></span>
                        <span class="dash-item-main">
                            <span class="dash-item-title">{item.name}</span>
                            <span class="dash-item-sub">{item.path}</span>
                        </span>
                        <span class="dash-qty {item.level}">{fmtQty(item.qty)} {item.unit}</span>
                    </li>
                {/each}
            </ul>
        {/if}
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
                            <span class="dash-item-title">{r.instrument}</span>
                            <span class="dash-item-sub">{r.user}</span>
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
                            <span class="dash-item-title"><strong>{entry.user}</strong> {entry.action}</span>
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
                            <span class="dash-item-title">{s.container.name}</span>
                            <span class="dash-item-sub">from {s.ownerGroupName ?? "—"} · {s.roomName}</span>
                        </span>
                    </li>
                {/each}
            </ul>
        {/if}
    </div>
</section>
