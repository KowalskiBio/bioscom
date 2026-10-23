<script lang="ts">
  import { closeModal } from "../lib/modal.svelte";

  let {
    imageUrl,
    options,
    onPick,
  }: {
    imageUrl: string;
    options: string[];
    onPick: (selected: string) => void;
  } = $props();
</script>

<div style="text-align: center;">
    <p style="margin-bottom: 1rem; color: var(--text-secondary);">Please identify this dendrobatid frog to confirm deletion:</p>
    <img src={imageUrl} alt="Frog" style="max-width: 100%; max-height: 250px; border-radius: 8px; margin-bottom: 1.5rem; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
    <div style="display: flex; flex-direction: column; gap: 0.5rem; align-items: center;">
        {#each options as opt (opt)}
            <button class="btn-primary" style="margin: 0.25rem; width: 100%; padding: 0.75rem;" onclick={() => onPick(opt)}>{opt}</button>
        {/each}
    </div>
    <button class="btn-secondary" style="margin-top: 1rem; width: 100%;" onclick={() => closeModal()}>Cancel</button>
</div>
