<script lang="ts">
  import { toastList } from "../lib/stores/toast.svelte";
  import { theme } from "../lib/theme.svelte";

  const design = $derived(theme.design);
  const icons: Record<string, string> = { success: "✅", error: "❌", info: "ℹ️" };
</script>

<div id="toast-container" class="toast-container">
    {#each toastList.items as toast (toast.id)}
        <div
            class={`toast ${toast.type}`}
            style={toast.leaving ? "animation: toastOut 0.3s ease forwards;" : ""}
        >{#if design !== "bauhaus"}<span class="toast-icon">{icons[toast.type]}</span>{/if}<span>{toast.message}</span></div>
    {/each}
</div>
