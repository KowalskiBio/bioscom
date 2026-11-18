<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    CATALOG_COLUMN_SCOPES,
    MATERIAL_TYPES,
    catalogColumnKeysForScope,
    defaultCatalogColumnSelections,
    defaultCatalogColumnsForScope,
    type CatalogColumnScope,
    type CatalogColumnSelections,
  } from "@bioscom/shared";
  import {
    catalogColumnIsRequired,
    catalogCoreColumnLabel,
    catalogCoreColumnsForScope,
    catalogDescriptorFieldsForSelection,
  } from "../../lib/catalogColumns";
  import { closeModal } from "../../lib/modal.svelte";
  import { session } from "../../lib/stores/session.svelte";
  import {
    catalogColumnPreferences,
    loadCatalogColumnPreferences,
    saveCatalogColumnPreferences,
  } from "../../lib/stores/catalogColumnPreferences.svelte";

  let { initialScope = "all" }: { initialScope?: CatalogColumnScope } = $props();

  let selectedScope = $state<CatalogColumnScope>(initialScope);
  let draftSelections = $state<CatalogColumnSelections>(defaultCatalogColumnSelections());
  let ready = $state(false);
  let active = true;
  let feedback = $state("");

  const coreColumns = $derived(catalogCoreColumnsForScope(selectedScope));
  const descriptorFields = $derived(
    catalogDescriptorFieldsForSelection(
      selectedScope,
      catalogColumnKeysForScope(selectedScope),
    ),
  );

  onMount(() => {
    void loadDraft();
  });

  onDestroy(() => {
    active = false;
  });

  function scopeLabel(scope: CatalogColumnScope): string {
    if (scope === "all") {
      return "All material types";
    }
    return MATERIAL_TYPES.find((type) => type.key === scope)?.label ?? scope;
  }

  function copyConfirmedSelections(userId: string): void {
    for (const scope of CATALOG_COLUMN_SCOPES) {
      draftSelections[scope] = [...catalogColumnPreferences.columnsForUser(userId, scope)];
    }
  }

  async function loadDraft(force = false): Promise<void> {
    const userId = session.user?.uid ?? null;
    ready = false;
    feedback = "";
    const loaded = await loadCatalogColumnPreferences(userId, force);
    if (!active) {
      return;
    }
    if (loaded && userId !== null) {
      copyConfirmedSelections(userId);
      ready = true;
    }
  }

  function toggleColumn(key: string, checked: boolean): void {
    const current = draftSelections[selectedScope];
    draftSelections[selectedScope] = checked
      ? [...current, key]
      : current.filter((column) => column !== key);
    feedback = "";
  }

  function resetScope(): void {
    draftSelections[selectedScope] = defaultCatalogColumnsForScope(selectedScope);
    feedback = `Defaults selected for ${scopeLabel(selectedScope)}. Save to apply them.`;
  }

  async function save(): Promise<void> {
    const userId = session.user?.uid;
    if (userId === undefined) {
      return;
    }
    const scope = selectedScope;
    const saved = await saveCatalogColumnPreferences(userId, scope, draftSelections[scope]);
    if (!active) {
      return;
    }
    if (saved) {
      draftSelections[scope] = [...catalogColumnPreferences.columnsForUser(userId, scope)];
      feedback = `${scopeLabel(scope)} columns saved to your account.`;
    }
  }
</script>

<div class="catalog-column-settings" aria-busy={catalogColumnPreferences.saving}>
    <p class="catalog-column-intro" id="catalog-columns-intro">
        Choose the columns used for each Packages view. These preferences are saved to your account and apply in every lab.
    </p>

    {#if catalogColumnPreferences.loading && !ready}
        <div class="catalog-column-loading" role="status">Loading your saved columns…</div>
    {:else if catalogColumnPreferences.loadError !== "" && !ready}
        <div class="catalog-column-message error" role="alert">
            <p>{catalogColumnPreferences.loadError}</p>
            <p>Saving is disabled until your saved settings can be loaded.</p>
        </div>
        <button type="button" class="btn-secondary" onclick={() => void loadDraft(true)}>Try again</button>
    {:else}
        {#if catalogColumnPreferences.loadError !== ""}
            <div class="catalog-column-message error" role="alert">
                <p>{catalogColumnPreferences.loadError}</p>
                <p>Your last loaded selections are shown. Saving is disabled until loading succeeds.</p>
            </div>
            <button type="button" class="btn-secondary" onclick={() => void loadDraft(true)}>Try again</button>
        {/if}

        <div class="catalog-column-scope">
            <label class="form-label" for="catalog-column-scope">Packages view</label>
            <select
                class="form-select"
                id="catalog-column-scope"
                bind:value={selectedScope}
                disabled={catalogColumnPreferences.saving}
                onchange={() => feedback = ""}
            >
                {#each CATALOG_COLUMN_SCOPES as scope (scope)}
                    <option value={scope}>{scopeLabel(scope)}</option>
                {/each}
            </select>
        </div>

        <fieldset class="catalog-column-group" disabled={catalogColumnPreferences.saving || catalogColumnPreferences.loadError !== ""}>
            <legend>Core fields</legend>
            <div class="catalog-column-options">
                {#each coreColumns as key (key)}
                    {@const required = catalogColumnIsRequired(key)}
                    <label class="catalog-column-option" class:required for={`catalog-column-${key}`}>
                        <input
                            id={`catalog-column-${key}`}
                            type="checkbox"
                            checked={required || draftSelections[selectedScope].includes(key)}
                            disabled={required}
                            onchange={(event) => toggleColumn(key, event.currentTarget.checked)}
                        >
                        <span class="catalog-column-copy">
                            <span class="catalog-column-label">{catalogCoreColumnLabel(key)}</span>
                            {#if key === "name"}
                                <span class="catalog-column-note">Always shown</span>
                            {:else if key === "actions"}
                                <span class="catalog-column-note">Included automatically; visible only to users who can edit</span>
                            {/if}
                        </span>
                    </label>
                {/each}
            </div>
        </fieldset>

        {#if descriptorFields.length > 0}
            <fieldset class="catalog-column-group" disabled={catalogColumnPreferences.saving || catalogColumnPreferences.loadError !== ""}>
                <legend>Type details</legend>
                {#if selectedScope === "all"}
                    <p class="form-hint catalog-column-group-hint">Fields from every material type. Cells show — where a field does not apply.</p>
                {/if}
                <div class="catalog-column-options">
                    {#each descriptorFields as field (field.key)}
                        <label class="catalog-column-option" for={`catalog-column-${field.key}`}>
                            <input
                                id={`catalog-column-${field.key}`}
                                type="checkbox"
                                checked={draftSelections[selectedScope].includes(field.key)}
                                onchange={(event) => toggleColumn(field.key, event.currentTarget.checked)}
                            >
                            <span class="catalog-column-copy">
                                <span class="catalog-column-label">{field.label}</span>
                                {#if field.unit !== undefined}<span class="catalog-column-note">{field.unit}</span>{/if}
                            </span>
                        </label>
                    {/each}
                </div>
            </fieldset>
        {/if}

        {#if catalogColumnPreferences.saveError !== ""}
            <div class="catalog-column-message error" role="alert">{catalogColumnPreferences.saveError}</div>
        {/if}
        {#if feedback !== ""}
            <div class="catalog-column-message success" role="status">{feedback}</div>
        {/if}

        <div class="catalog-column-actions">
            <button
                type="button"
                class="btn-secondary catalog-column-reset"
                disabled={catalogColumnPreferences.saving || catalogColumnPreferences.loadError !== ""}
                onclick={resetScope}
            >Reset this view</button>
            <div class="catalog-column-save-actions">
                <button type="button" class="btn-secondary" onclick={() => closeModal()}>Cancel</button>
                <button
                    type="button"
                    class="btn-primary"
                    id="catalog-columns-save"
                    disabled={!catalogColumnPreferences.canSave}
                    onclick={() => void save()}
                >{catalogColumnPreferences.saving ? "Saving…" : "Save columns"}</button>
            </div>
        </div>
    {/if}
</div>
