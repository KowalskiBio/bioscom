<script lang="ts">
  import { inventory } from "../lib/stores/inventory.svelte";
  import { instrumentList } from "../lib/stores/instruments.svelte";
  import { printData } from "../lib/stores/print.svelte";
  import { searchState } from "../lib/stores/search.svelte";
  import { navigateTo, router } from "../lib/router.svelte";
  import {
    computePositions,
    chemMatchesQuery,
    highlightHtml,
    normalizeFormula,
  } from "../lib/inventoryUtils";
  import { theme } from "../lib/theme.svelte";

  let inputEl = $state<HTMLInputElement | null>(null);
  let open = $state(false);

  const route = $derived(router.route);
  const q = $derived(searchState.query.trim().toLowerCase());
  const design = $derived(theme.design);

  interface SearchItem {
    kind: "chemical" | "protocol" | "asset" | "instrument" | "printCatalog" | "printRequest";
    name: string;
    detail: string;
    badge: string;
    roomId?: string;
    containerId?: string;
    chemId?: string;
    itemId?: string;
  }

  const results = $derived.by(() => {
    if (q === "") {
      return [] as SearchItem[];
    }
    const items: SearchItem[] = [];
    for (const room of inventory.tree?.rooms ?? []) {
      for (const cont of room.containers ?? []) {
        const posMap = computePositions(cont);
        for (const sh of cont.shelves ?? []) {
          for (const ch of sh.chemicals ?? []) {
            if (chemMatchesQuery(ch, q)) {
              items.push({
                kind: "chemical",
                name: ch.name ?? "",
                detail: `${room.name} › ${cont.name} › ${sh.name}`,
                badge: posMap[ch.id] ?? "?",
                roomId: room.id,
                containerId: cont.id,
                chemId: ch.id,
              });
            }
          }
        }
      }
    }
    for (const p of inventory.tree?.protocols ?? []) {
      if ((p.title ?? "").toLowerCase().includes(q) || (p.content ?? "").toLowerCase().includes(q)) {
        items.push({
          kind: "protocol",
          name: p.title ?? "",
          detail: (p.content ?? "").replace(/\n/g, " ").slice(0, 60),
          badge: design === "bauhaus" ? "Protocol" : "📖 Protocol",
          itemId: p.id,
        });
      }
    }
    for (const a of inventory.tree?.assets ?? []) {
      if (
        (a.name ?? "").toLowerCase().includes(q) ||
        (a.model ?? "").toLowerCase().includes(q) ||
        (a.description ?? "").toLowerCase().includes(q)
      ) {
        items.push({
          kind: "asset",
          name: a.name ?? "",
          detail: a.model ?? "Asset",
          badge: design === "bauhaus" ? "Asset" : "📦 Asset",
          itemId: a.id,
        });
      }
    }
    for (const inst of instrumentList.items) {
      if (
        (inst.name ?? "").toLowerCase().includes(q) ||
        (inst.description ?? "").toLowerCase().includes(q) ||
        (inst.location ?? "").toLowerCase().includes(q)
      ) {
        items.push({
          kind: "instrument",
          name: inst.name ?? "",
          detail: inst.location ?? "",
          badge: design === "bauhaus" ? "Instrument" : "🔬 Instrument",
          itemId: inst.id,
        });
      }
    }
    for (const item of printData.catalog) {
      if (
        (item.name ?? "").toLowerCase().includes(q) ||
        (item.description ?? "").toLowerCase().includes(q) ||
        (item.category ?? "").toLowerCase().includes(q) ||
        (item.material ?? "").toLowerCase().includes(q)
      ) {
        items.push({
          kind: "printCatalog",
          name: item.name ?? "",
          detail: `${item.category ?? ""} | ${item.material ?? ""}`,
          badge: design === "bauhaus" ? "3D Catalog" : "🖨️ 3D Catalog",
          itemId: item.id,
        });
      }
    }
    for (const r of printData.requests) {
      if (
        (r.catalogItemName ?? "").toLowerCase().includes(q) ||
        (r.note ?? "").toLowerCase().includes(q)
      ) {
        items.push({
          kind: "printRequest",
          name: r.catalogItemName ?? "",
          detail: r.note ?? "",
          badge: design === "bauhaus" ? "3D Request" : "🖨️ 3D Request",
          itemId: r.id,
        });
      }
    }
    return items.slice(0, 12);
  });

  function onInput(event: Event): void {
    searchState.set((event.target as HTMLInputElement).value.trim());
    open = true;
  }

  function onDocClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest(".search-wrap") === null) {
      open = false;
    }
  }

  function pick(item: SearchItem): void {
    searchState.set("");
    open = false;
    if (inputEl !== null) {
      inputEl.value = "";
    }
    if (item.kind === "chemical" && item.roomId !== undefined && item.containerId !== undefined) {
      navigateTo("detail", { roomId: item.roomId, containerId: item.containerId });
      setTimeout(() => {
        const row = document.querySelector(`[data-chemid="${item.chemId}"]`);
        if (row !== null) {
          row.scrollIntoView({ behavior: "smooth", block: "center" });
          row.classList.add("highlight-row");
          setTimeout(() => row.classList.remove("highlight-row"), 2000);
        }
      }, 100);
    } else if (item.kind === "protocol") {
      navigateTo("protocols");
    } else if (item.kind === "asset") {
      navigateTo("assets");
    } else if (item.kind === "instrument") {
      navigateTo("instruments");
    } else if (item.kind === "printCatalog" || item.kind === "printRequest") {
      navigateTo("printing");
    }
  }

  $effect(() => {
    document.addEventListener("click", onDocClick);
    return () => {
      document.removeEventListener("click", onDocClick);
    };
  });
</script>

<div class="search-wrap">
    <div class="search-box">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="search-input" placeholder="Search global inventory..." autocomplete="off" bind:this={inputEl} oninput={onInput}>
    </div>
    <div id="autocomplete-list" class="autocomplete-list" class:open={open && q !== ""}>
        {#if q !== ""}
            {#if results.length === 0}
                <div class="autocomplete-no-result">No results for "{searchState.query.trim()}"</div>
            {:else}
                {#each results as item (item.kind + item.name + item.detail)}
                    <div class="autocomplete-item" onclick={() => pick(item)}>
                        <div style="display:flex;align-items:center;gap:0.5rem">
                            <span class="autocomplete-item-name"><!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html highlightHtml(item.name, q)}</span>
                            <span class={`autocomplete-item-pos ${item.kind === "protocol" ? "protocol-badge" : ""} ${item.kind === "asset" ? "asset-badge" : ""}`}>{item.badge}</span>
                        </div>
                        <span class="autocomplete-item-shelf">{item.detail}</span>
                    </div>
                {/each}
            {/if}
        {/if}
    </div>
</div>
