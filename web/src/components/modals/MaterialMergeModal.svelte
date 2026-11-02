<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { materialTypeLabels } from "@bioscom/shared";
  import { api, ApiError } from "../../lib/api";
  import { catalog, type CatalogMaterial } from "../../lib/stores/catalog.svelte";
  import { currentGroup } from "../../lib/stores/currentGroup.svelte";
  import { showToast } from "../../lib/stores/toast.svelte";
  import { closeModal } from "../../lib/modal.svelte";

  let { sourceMaterialId, sourceMaterialName }: { sourceMaterialId: string; sourceMaterialName: string } = $props();

  const labels = materialTypeLabels();

  let sourceType = $state("");
  let resolving = $state(true);
  let query = $state("");
  let candidates = $state<CatalogMaterial[]>([]);
  let loading = $state(false);
  let listError = $state("");
  let selectedId = $state<string | null>(null);
  let submitting = $state(false);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let requestSeq = 0;

  onMount(() => {
    void resolveSourceType();
  });

  onDestroy(() => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    requestSeq += 1;
  });

  async function resolveSourceType(): Promise<void> {
    try {
      const known = catalog.detail;
      if (known !== null && known.material.id === sourceMaterialId) {
        sourceType = known.material.type;
      } else {
        const groupId = currentGroup.groupId;
        if (groupId === null) {
          return;
        }
        const body = await api.get<{ material: { type: string } }>(
          `/api/groups/${encodeURIComponent(groupId)}/materials/${encodeURIComponent(sourceMaterialId)}`,
        );
        sourceType = body.material.type;
      }
    } catch {
      showToast("Failed to load material", "error");
    } finally {
      resolving = false;
    }
    if (sourceType !== "") {
      await loadCandidates();
    }
  }

  async function loadCandidates(): Promise<void> {
    const groupId = currentGroup.groupId;
    if (groupId === null || sourceType === "") {
      return;
    }
    const requestId = ++requestSeq;
    loading = true;
    listError = "";
    try {
      const params = new URLSearchParams({ type: sourceType, limit: "25" });
      if (query.trim() !== "") {
        params.set("q", query.trim());
      }
      const body = await api.get<{ materials: CatalogMaterial[] }>(
        `/api/groups/${encodeURIComponent(groupId)}/materials?${params.toString()}`,
      );
      if (requestId !== requestSeq) {
        return;
      }
      candidates = body.materials.filter((material) => material.id !== sourceMaterialId);
      if (selectedId !== null && !candidates.some((material) => material.id === selectedId)) {
        selectedId = null;
      }
    } catch {
      if (requestId === requestSeq) {
        candidates = [];
        listError = "Failed to load candidate materials.";
      }
    } finally {
      if (requestId === requestSeq) {
        loading = false;
      }
    }
  }

  function onSearchInput(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      void loadCandidates();
    }, 250);
  }

  function selectCandidate(id: string): void {
    selectedId = id;
  }

  async function confirmMerge(): Promise<void> {
    const groupId = currentGroup.groupId;
    if (groupId === null || selectedId === null || submitting) {
      return;
    }
    const target = candidates.find((material) => material.id === selectedId);
    submitting = true;
    try {
      const body = await api.post<{
        source: { id: string; name: string; archived: boolean };
        target: { id: string; name: string };
        moved: { products: number; batches: number; stocks: number };
      }>(`/api/groups/${encodeURIComponent(groupId)}/materials/merge`, {
        sourceMaterialId,
        targetMaterialId: selectedId,
      });
      const targetName = body.target.name || target?.name || "selected material";
      showToast(`Merged into "${targetName}" (${body.moved.batches} batches, ${body.moved.stocks} stocks)`, "info");
      closeModal();
      void catalog.fetchCatalog(catalog.page);
    } catch (error) {
      const message =
        error instanceof ApiError && error.message !== ""
          ? error.message
          : "Merge failed";
      showToast(message, "error");
    } finally {
      submitting = false;
    }
  }
</script>

<p style="font-size: 0.85rem; line-height: 1.5; color: var(--text-secondary); margin-bottom: 1rem;">
    All batches, stocks and commercial products of «{sourceMaterialName}» are moved into the selected target material. «{sourceMaterialName}» is then archived. This cannot be undone from the UI.
</p>

<div class="form-group">
    <label class="form-label" for="merge-target-search">Target material</label>
    <input
        class="form-input"
        id="merge-target-search"
        type="search"
        placeholder="Search materials of the same type..."
        autocomplete="off"
        bind:value={query}
        oninput={onSearchInput}
    >
</div>

{#if resolving}
    <p style="font-size: 0.85rem; color: var(--text-muted);">Loading…</p>
{:else if sourceType === ""}
    <p style="font-size: 0.85rem; color: var(--text-muted);">Unable to determine the material type. Close this dialog and try again.</p>
{:else}
    <div
        role="radiogroup"
        aria-label="Merge target candidates"
        style="display: flex; flex-direction: column; gap: 0.4rem; max-height: 300px; overflow-y: auto; padding-right: 0.15rem; margin-bottom: 0.25rem;"
    >
        {#if loading && candidates.length === 0}
            <p style="font-size: 0.85rem; color: var(--text-muted);">Loading…</p>
        {:else if listError !== ""}
            <p style="font-size: 0.85rem; color: var(--text-muted);">{listError}</p>
        {:else if candidates.length === 0}
            <p style="font-size: 0.85rem; color: var(--text-muted);">No matching materials found.</p>
        {:else}
            {#each candidates as candidate (candidate.id)}
                {@const selected = selectedId === candidate.id}
                <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-material-id={candidate.id}
                    onclick={() => selectCandidate(candidate.id)}
                    style={`display: flex; flex-direction: column; gap: 0.2rem; width: 100%; text-align: left; padding: 0.55rem 0.75rem; cursor: pointer; font-family: var(--font-family); border: 1px solid ${selected ? "var(--accent-blue)" : "var(--border-light)"}; border-radius: var(--radius-sm); background: ${selected ? "rgba(59,130,246,0.12)" : "transparent"};`}
                >
                    <span style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                        <span style="font-size: 0.9rem; font-weight: 600; color: var(--text-primary);">{candidate.name}</span>
                        <span class="chem-pos">{labels[candidate.type] ?? candidate.type}</span>
                    </span>
                    <span style="font-size: 0.75rem; color: var(--text-muted);">
                        {candidate.counts.stocks} stocks · {candidate.counts.batches} batches · {candidate.counts.products} products
                    </span>
                </button>
            {/each}
        {/if}
    </div>

    <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--border-subtle);">
        <button type="button" class="btn-secondary" id="merge-cancel" onclick={() => closeModal()}>Cancel</button>
        <button
            type="button"
            class="btn-primary"
            id="merge-confirm"
            disabled={selectedId === null || submitting}
            onclick={() => void confirmMerge()}
        >Merge into selected</button>
    </div>
{/if}
