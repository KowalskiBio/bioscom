<script lang="ts">
  let { form, instrumentId }: { form: { date: string; startTime: string; endTime: string; note: string }; instrumentId: string } = $props();

  const today = new Date().toISOString().slice(0, 10);
</script>

<div class="form-group">
    <label class="form-label">Date *</label>
    <input type="date" class="form-input" id="b-date" min={today} bind:value={form.date}>
</div>
<div class="form-row">
    <div class="form-group">
        <label class="form-label">Start Time *</label>
        <input type="time" class="form-input" id="b-start" bind:value={form.startTime}>
    </div>
    <div class="form-group">
        <label class="form-label">End Time *</label>
        <input type="time" class="form-input" id="b-end" bind:value={form.endTime}>
    </div>
</div>
<div class="form-group">
    <label class="form-label">Note</label>
    <input class="form-input" id="b-note" placeholder="Optional note" bind:value={form.note}>
</div>
