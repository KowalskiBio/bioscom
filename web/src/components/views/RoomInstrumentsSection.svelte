<script lang="ts">
  import { fetchInstruments, instrumentList } from "../../lib/stores/instruments.svelte";
  import { openBookingModal } from "../../lib/forms";
  import { stripEmoji } from "../../lib/inventoryUtils";
  import { navigateTo } from "../../lib/router.svelte";
  import { theme } from "../../lib/theme.svelte";

  let {
    roomId,
    roomGroupId,
  }: {
    roomId: string;
    roomGroupId: string;
  } = $props();

  const design = $derived(theme.design);
  const instruments = $derived(
    instrumentList.items.filter(
      (instrument) => instrument.roomGroupId === roomGroupId && instrument.roomId === roomId,
    ),
  );

  function retry(): void {
    void fetchInstruments();
  }

  function bookInstrument(instrumentId: string, instrumentName: string): void {
    navigateTo("instruments");
    openBookingModal(instrumentId, instrumentName);
  }

  function onInstrumentKeydown(event: KeyboardEvent, instrumentId: string, instrumentName: string): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    bookInstrument(instrumentId, instrumentName);
  }
</script>

<section id="room-instruments-section" class="room-equipment-section" aria-labelledby="room-instruments-title" data-room-id={roomId}>
  <div class="room-equipment-heading">
    <div>
      <h2 id="room-instruments-title">Instruments &amp; machines</h2>
      <p class="room-equipment-subtitle">Instruments explicitly assigned to this room.</p>
    </div>
    <div class="room-equipment-actions">
      {#if instrumentList.loaded}<span class="room-equipment-count">{instruments.length} {instruments.length === 1 ? "instrument" : "instruments"}</span>{/if}
    </div>
  </div>

  {#if instrumentList.loadError !== ""}
    <div class="room-equipment-message warning" role="alert">
      <span>
        {instrumentList.loadError}
        {instrumentList.loaded ? "Showing the last confirmed results." : "This room’s instrument assignments are not confirmed yet."}
      </span>
      <button type="button" class="btn-inline" id="room-instruments-retry" onclick={retry}>Try again</button>
    </div>
  {:else if !instrumentList.loaded && instrumentList.loading}
    <p class="room-equipment-message" id="room-instruments-loading" role="status">Loading this room’s instruments…</p>
  {:else if !instrumentList.loaded}
    <div class="room-equipment-message" role="status">
      <span>Instrument assignments have not been loaded yet.</span>
      <button type="button" class="btn-inline" id="room-instruments-load" onclick={retry}>Load instruments</button>
    </div>
  {/if}

  {#if instrumentList.loaded && instruments.length === 0}
    <p class="room-equipment-empty" id="room-instruments-empty">No instruments are assigned to this room.</p>
  {:else if instrumentList.loaded && instruments.length > 0}
    <div class="room-instrument-grid" id="room-instrument-grid">
      {#each instruments as instrument (instrument.id)}
        {@const displayName = design === "bauhaus" ? stripEmoji(instrument.name) : instrument.name}
        <div
          class="room-instrument-card"
          data-instrument-id={instrument.id}
          role="button"
          tabindex="0"
          aria-label={`Book ${displayName}`}
          onclick={() => bookInstrument(instrument.id, instrument.name)}
          onkeydown={(event) => onInstrumentKeydown(event, instrument.id, instrument.name)}
        >
          <h3>{displayName}</h3>
          {#if instrument.location}<p class="room-instrument-location">{design === "bauhaus" ? stripEmoji(instrument.location) : instrument.location}</p>{/if}
          {#if instrument.description}<p class="room-instrument-description">{design === "bauhaus" ? stripEmoji(instrument.description) : instrument.description}</p>{/if}
        </div>
      {/each}
    </div>
  {/if}
</section>
