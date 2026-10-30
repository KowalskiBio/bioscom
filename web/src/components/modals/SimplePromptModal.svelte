<script lang="ts">
  import { theme } from "../../lib/theme.svelte";

  let {
    form,
    kind,
  }: {
    form: { name: string; description?: string; emoji?: string; color?: string };
    kind: "container" | "shelf" | "box" | "color";
  } = $props();

  const design = $derived(theme.design);
</script>

{#if kind === "container"}
  <div class="form-group"><label class="form-label">Name *</label><input class="form-input" id="c-name" bind:value={form.name}></div>
  <div class="form-group"><label class="form-label">Description</label><input class="form-input" id="c-desc" bind:value={form.description}></div>
  <div class="form-group"><label class="form-label">Emoji Icon (optional)</label><input class="form-input" id="c-emoji" placeholder={design === "bauhaus" ? "optional icon" : "e.g. 🧪 or 🥶"} bind:value={form.emoji}></div>
{:else if kind === "color"}
  <div class="form-group"><label class="form-label">Box Color *</label><input type="color" class="form-input" id="f-color" style="height: 2.5rem; cursor: pointer; padding: 0.2rem;" bind:value={form.color}></div>
{:else}
  <div class="form-group"><label class="form-label">{kind === "shelf" ? "Shelf name" : "Box name"} *</label><input class="form-input" id="f-sn" bind:value={form.name}></div>
{/if}
