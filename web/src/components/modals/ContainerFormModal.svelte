<script lang="ts">
  import { groupList } from "../../lib/stores/groups.svelte";
  import { currentGroup } from "../../lib/stores/currentGroup.svelte";

  let {
    form,
    type,
  }: {
    form: {
      name: string;
      description: string;
      emoji: string;
      system: string;
      countNum: number;
      countAlpha: number;
      customRangeType: string;
      customRanges: Array<{ start: string; end: string }>;
      customExtraNames: string;
      doorCount: number;
      freezerType: string;
      rackCount: number;
      boxCount: number;
      isShared: boolean;
      sharedGroups: Record<string, boolean>;
    };
    type: "cabinet" | "fridge" | "freezer";
  } = $props();

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  function addRange(): void {
    const rows = form.customRanges;
    let start = "A";
    let end = "A";
    if (rows.length > 0) {
      const lastEnd = rows[rows.length - 1]!.end;
      if (form.customRangeType === "alphabetical") {
        const nextCode = lastEnd.charCodeAt(0) + 1;
        if (nextCode <= 90) {
          start = String.fromCharCode(nextCode);
          end = start;
        }
      } else {
        const nextNum = parseInt(lastEnd, 10) + 1;
        if (!Number.isNaN(nextNum)) {
          start = String(nextNum);
          end = String(nextNum + 2);
        }
      }
    }
    rows.push({ start, end });
  }

  const otherGroups = $derived(groupList.items.filter((g) => g.id !== currentGroup.groupId));
</script>

<div class="form-group">
  <label class="form-label">Name *</label>
  <input class="form-input" id="c-name" placeholder="e.g. {type === 'cabinet' ? 'Cabinet' : type === 'fridge' ? 'Fridge' : 'Freezer'} 1" bind:value={form.name}>
</div>
<div class="form-group">
  <label class="form-label">Description</label>
  <input class="form-input" id="c-desc" placeholder="e.g. Acid storage or DNA samples" bind:value={form.description}>
</div>
<div class="form-group">
  <label class="form-label">Emoji Icon (optional)</label>
  <input class="form-input" id="c-emoji" placeholder="e.g. 🧪 or 🥶" bind:value={form.emoji}>
</div>

{#if type === "cabinet"}
  <div class="form-group">
    <label class="form-label">Cabinet Shelf Naming System *</label>
    <select class="form-select" id="c-system" style="cursor: pointer;" bind:value={form.system}>
      <option value="numerical">Numerical shelves</option>
      <option value="alphabetical">Alphabetical shelves (A, B, C...)</option>
      <option value="custom">Custom shelves &amp; ranges</option>
    </select>
  </div>
  {#if form.system === "numerical"}
    <div class="form-group">
      <label class="form-label">Number of Shelves *</label>
      <input class="form-input" id="c-count-num" type="number" min="1" max="25" bind:value={form.countNum}>
    </div>
  {:else if form.system === "alphabetical"}
    <div class="form-group">
      <label class="form-label">Number of Shelves (A, B, C...) *</label>
      <input class="form-input" id="c-count-alpha" type="number" min="1" max="25" bind:value={form.countAlpha}>
    </div>
  {:else}
    <div class="form-group">
      <label class="form-label">Custom Shelf Range Type</label>
      <select class="form-select" id="c-custom-prefix" style="cursor: pointer;" bind:value={form.customRangeType}>
        <option value="alphabetical">Letters (A-Z)</option>
        <option value="numerical">Numbers (1-99)</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label" style="font-weight: 600; margin-bottom: 0.25rem;">Define Custom Ranges</label>
      <div id="c-custom-ranges-container" style="display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.5rem; background: rgba(0,0,0,0.15); padding: 0.5rem; border-radius: 6px; border: 1px solid var(--border-subtle); max-height: 200px; overflow-y: auto;">
        {#each form.customRanges as range, i (i)}
          <div class="custom-range-row" style="display: flex; gap: 0.5rem; align-items: center; background: rgba(255,255,255,0.02); padding: 0.4rem; border-radius: 4px; border: 1px solid var(--border-subtle); margin-top: 0.25rem;">
            {#if form.customRangeType === "alphabetical"}
              <select class="form-select range-start" style="width: 75px; cursor: pointer; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: 4px; padding: 0.25rem;" bind:value={range.start}>
                {#each alphabet as letter (letter)}<option value={letter}>{letter}</option>{/each}
              </select>
              <span style="color: var(--text-muted); align-self: center; font-size: 0.85rem;">to</span>
              <select class="form-select range-end" style="width: 75px; cursor: pointer; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: 4px; padding: 0.25rem;" bind:value={range.end}>
                {#each alphabet as letter (letter)}<option value={letter}>{letter}</option>{/each}
              </select>
            {:else}
              <input type="number" class="form-input range-start" min="1" max="999" style="width: 80px; padding: 0.25rem; font-size: 0.85rem;" bind:value={range.start}>
              <span style="color: var(--text-muted); align-self: center; font-size: 0.85rem;">to</span>
              <input type="number" class="form-input range-end" min="1" max="999" style="width: 80px; padding: 0.25rem; font-size: 0.85rem;" bind:value={range.end}>
            {/if}
            <button type="button" class="btn" style="padding: 0.25rem 0.5rem; display: inline-flex; align-items: center; background: rgba(239,68,68,0.15); color: var(--accent-red); border: none; font-size: 0.8rem; margin-left: auto; border-radius: 4px; cursor: pointer;" onclick={() => form.customRanges.splice(i, 1)}>🗑️</button>
          </div>
        {/each}
      </div>
      <button type="button" class="btn btn-secondary" id="btn-add-custom-range" style="padding: 0.3rem 0.6rem; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 0.25rem; border-radius: 4px; cursor: pointer;" onclick={addRange}>➕ Add Range</button>
    </div>
    <div class="form-group" style="margin-top: 0.75rem;">
      <label class="form-label">Extra Custom Shelf Names (One per line)</label>
      <textarea class="form-textarea" id="c-custom-extra-names" placeholder="e.g. Bottom shelf&#10;Special space" style="height: 60px;" bind:value={form.customExtraNames}></textarea>
    </div>
  {/if}
{:else if type === "fridge"}
  <div class="form-group">
    <label class="form-label">Number of Shelves *</label>
    <input class="form-input" id="c-count" type="number" min="1" max="25" bind:value={form.countNum}>
  </div>
  <div class="form-group">
    <label class="form-label">Number of Door Shelves</label>
    <input class="form-input" id="c-door-count" type="number" min="0" max="10" bind:value={form.doorCount}>
  </div>
{:else if type === "freezer"}
  <div class="form-group">
    <label class="form-label">Freezer Type</label>
    <select class="form-select" id="c-freezer-type" style="cursor: pointer;" bind:value={form.freezerType}>
      <option value="standard">Standard Freezer</option>
      <option value="deepfreezer">Deep Freezer (-80°C)</option>
    </select>
  </div>
  {#if form.freezerType === "standard"}
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Number of Shelves *</label>
        <input class="form-input" id="c-count" type="number" min="1" max="25" bind:value={form.countNum}>
      </div>
    </div>
  {:else}
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Number of Racks</label>
        <input class="form-input" id="c-rack-count" type="number" min="1" max="50" bind:value={form.rackCount}>
      </div>
      <div class="form-group">
        <label class="form-label">Boxes per Rack</label>
        <input class="form-input" id="c-box-count" type="number" min="1" max="50" bind:value={form.boxCount}>
      </div>
    </div>
  {/if}
{/if}

<div class="form-group" style="margin-top: 1rem; border-top: 1px solid var(--border-subtle); padding-top: 1rem;">
  <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; user-select: none;">
    <input type="checkbox" id="c-is-shared" style="cursor: pointer; width: 16px; height: 16px;" bind:checked={form.isShared}>
    <span style="font-size: 0.85rem; font-weight: 500; color: var(--text-primary);">Share this container with other laboratories</span>
  </label>
</div>
{#if form.isShared}
  <div class="form-group" id="c-share-wrap" style="margin-top: 0.5rem;">
    <label class="form-label" style="font-weight: 600; margin-bottom: 0.5rem;">Select Laboratories to Share With</label>
    <div id="c-shared-groups-list" style="background: rgba(0, 0, 0, 0.2); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 0.5rem; max-height: 150px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem;">
      {#each otherGroups as group (group.id)}
        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
          <input type="checkbox" name="c-shared-group-item" value={group.id} style="cursor: pointer;" bind:checked={form.sharedGroups[group.id]}>
          <span style="font-size: 0.85rem;">{group.name}</span>
        </label>
      {:else}
        <div style="font-size: 0.8rem; color: var(--text-muted); padding: 0.25rem 0.5rem;">No other groups found</div>
      {/each}
    </div>
  </div>
{/if}
