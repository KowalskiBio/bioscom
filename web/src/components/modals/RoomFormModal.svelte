<script lang="ts">
  import HighlightColorSelect from "./HighlightColorSelect.svelte";
  import type { HighlightFormValue } from "../../lib/highlight";

  let {
    form,
    mode,
  }: {
    form: { name: string; description: string; highlightColor: HighlightFormValue };
    mode: "add" | "edit";
  } = $props();
</script>

<div class="form-group"><label class="form-label" for="f-rn">{mode === "add" ? "Room name" : "Name"} *</label><input class="form-input" id="f-rn" placeholder={mode === "add" ? "e.g. A301" : ""} bind:value={form.name}></div>
<div class="form-group"><label class="form-label" for="f-rd">Description</label><input class="form-input" id="f-rd" placeholder={mode === "add" ? "e.g. Organic chemistry" : ""} bind:value={form.description}></div>
<HighlightColorSelect id="r-highlight" bind:value={form.highlightColor} />
