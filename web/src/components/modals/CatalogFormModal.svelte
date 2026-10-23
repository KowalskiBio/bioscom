<script lang="ts">
  let {
    form,
  }: {
    form: { name: string; description: string; category: string; material: string; estimatedTime: string };
  } = $props();

  const categories = ["Racks & Holders", "Adapters & Clamps", "Fluidics & Tubing", "Enclosures & Boxes", "Safety Gears", "Others"];
</script>

<div class="form-group"><label class="form-label">Name *</label><input class="form-input" id="pc-name" placeholder="e.g. Tube Rack 24" bind:value={form.name}></div>
<div class="form-group">
    <label class="form-label">Category</label>
    <select class="form-select" id="pc-category" bind:value={form.category}>
        {#each categories as cat (cat)}<option value={cat}>{cat}</option>{/each}
    </select>
</div>
<div class="form-group"><label class="form-label">Material</label><input class="form-input" id="pc-material" placeholder="e.g. PLA, PETG" bind:value={form.material}></div>
<div class="form-group"><label class="form-label">Estimated Print Time</label><input class="form-input" id="pc-time" placeholder="e.g. 2h 30m" bind:value={form.estimatedTime}></div>
<div class="form-group"><label class="form-label">Description</label><textarea class="form-textarea" id="pc-desc" rows="3" placeholder="What is it for?" bind:value={form.description}></textarea></div>
