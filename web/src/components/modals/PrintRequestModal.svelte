<script lang="ts">
  let { form }: { form: { note: string; quantity: number } } = $props();
</script>

<div class="form-group"><label class="form-label">Quantity</label><input class="form-input" id="pr-qty" type="number" min="1" max="1000" bind:value={form.quantity}></div>
<div class="form-group"><label class="form-label">Note</label><textarea class="form-textarea" id="pr-note" rows="4" placeholder="Colors, size, special instructions..." bind:value={form.note}></textarea></div>
