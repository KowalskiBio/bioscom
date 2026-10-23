<script lang="ts">
  let {
    form,
    mode,
  }: {
    form: { name: string; description: string };
    mode: "add" | "edit";
  } = $props();
</script>

<div class="form-group"><label class="form-label">{mode === "add" ? "Room name" : "Name"} *</label><input class="form-input" id="f-rn" placeholder={mode === "add" ? "e.g. A301" : ""} bind:value={form.name}></div>
<div class="form-group"><label class="form-label">Description</label><input class="form-input" id="f-rd" placeholder={mode === "add" ? "e.g. Organic chemistry" : ""} bind:value={form.description}></div>
