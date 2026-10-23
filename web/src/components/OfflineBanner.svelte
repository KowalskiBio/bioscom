<script lang="ts">
  import { connection } from "../lib/stores/connection.svelte";
</script>

{#if connection.offline}
    <div
        class="toast error"
        style="position: fixed; top: 1.5rem; left: 50%; transform: translateX(-50%); z-index: 2001; display: flex; align-items: center; gap: 0.5rem;"
    ><span class="toast-icon">📡</span><span>Offline – changes are disabled. Reconnecting…</span></div>
{/if}
