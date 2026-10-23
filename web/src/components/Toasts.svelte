<script lang="ts">
  import { toastList } from "../lib/stores/toast.svelte";

  const icons: Record<string, string> = { success: "✅", error: "❌", info: "ℹ️" };
</script>

<div id="toast-container" class="toast-container">
    {#each toastList.items as toast (toast.id)}
        <div
            class={`toast ${toast.type}`}
            style={toast.leaving ? "animation: toastOut 0.3s ease forwards;" : ""}
        ><span class="toast-icon">{icons[toast.type]}</span><span>{toast.message}</span></div>
    {/each}
</div>
