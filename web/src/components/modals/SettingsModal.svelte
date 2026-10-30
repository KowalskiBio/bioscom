<script lang="ts">
  import { theme, setDesign, type DesignTheme } from "../../lib/theme.svelte";
  import { NAV_ITEMS, navPrefs } from "../../lib/stores/navPrefs.svelte";

  const OPTIONS: Array<{ value: DesignTheme; name: string; desc: string }> = [
    { value: "original", name: "Original", desc: "The classic BioSCom look" },
    { value: "bauhaus", name: "Bauhaus", desc: "Clean, minimal, professional" },
  ];
</script>

<div class="form-group">
    <span class="form-label">Theme</span>
    <div class="theme-picker" id="theme-picker">
        {#each OPTIONS as opt (opt.value)}
            <button
                type="button"
                class="theme-option"
                class:selected={theme.design === opt.value}
                id={`theme-option-${opt.value}`}
                onclick={() => setDesign(opt.value)}
            >
                <span class="theme-option-name">{opt.name}</span>
                <span class="theme-option-desc">{opt.desc}</span>
            </button>
        {/each}
    </div>
    <p class="form-hint">Applies instantly and is remembered on this device.</p>
    <p class="form-hint" style={`display: ${theme.design === "bauhaus" ? "block" : "none"};`}>Dark mode is not available for the Bauhaus theme yet.</p>
</div>

<div class="form-group">
    <span class="form-label">Navigation menu</span>
    {#each NAV_ITEMS as item (item.view)}
        <label class="nav-toggle" id={`nav-toggle-${item.view}`}>
            <input
                type="checkbox"
                checked={navPrefs.visible(item.view)}
                onchange={(e) => navPrefs.setVisible(item.view, e.currentTarget.checked)}
            >
            <span>{theme.design === "bauhaus" ? item.labelBauhaus : item.label}</span>
        </label>
    {/each}
    <p class="form-hint">Dashboard and Chemicals are always shown. These options take effect in the Bauhaus theme; Original always shows everything.</p>
</div>
