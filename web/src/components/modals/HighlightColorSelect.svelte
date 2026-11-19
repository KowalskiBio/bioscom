<script lang="ts">
  import { HIGHLIGHT_COLOR_OPTIONS, type HighlightFormValue } from "../../lib/highlight";

  let {
    id,
    value = $bindable("default"),
  }: {
    id: string;
    value?: HighlightFormValue;
  } = $props();
</script>

<div class="form-group highlight-select-group">
  <label class="form-label" for={id}>Highlight stripe</label>
  <select class="form-select" {id} bind:value aria-describedby={`${id}-hint`}>
    <option value="default">Default</option>
    {#each HIGHLIGHT_COLOR_OPTIONS as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
  <p class="form-hint" id={`${id}-hint`}>Default keeps current card styling. Choose No highlight to remove the stripe.</p>
</div>
