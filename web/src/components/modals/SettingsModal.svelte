<script lang="ts">
  import { theme, setDesign, type DesignTheme } from "../../lib/theme.svelte";
  import { NAV_ITEMS, navPrefs } from "../../lib/stores/navPrefs.svelte";
  import { prefs, setRadioMode } from "../../lib/stores/prefs.svelte";
  import { openCatalogColumnSettings } from "../../lib/catalogColumnSettings";

  const OPTIONS: Array<{ value: DesignTheme; name: string; desc: string }> = [
    { value: "original", name: "Original", desc: "The classic BioSCom look" },
    { value: "bauhaus", name: "Bauhaus", desc: "Clean, minimal, professional" },
  ];
</script>

<div class="form-group">
    <span class="form-label">Packages</span>
    <button
        type="button"
        class="btn-secondary catalog-columns-trigger"
        id="btn-settings-catalog-columns"
        aria-label="Choose package table columns"
        onclick={() => openCatalogColumnSettings()}
    >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="1"/><line x1="9" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span>Choose table columns</span>
    </button>
    <p class="form-hint">Select separate columns for All and each material type. Saved to your account for every lab.</p>
</div>

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

<div class="form-group">
    <span class="form-label">Radio</span>
    <label class="nav-toggle" id="radio-toggle-ask">
        <input
            type="radio"
            id="radio-mode-ask"
            name="radio-mode"
            checked={prefs.radioMode === "ask"}
            onchange={() => setRadioMode("ask")}
        >
        <span>Ask when adding chemicals (background music prompt)</span>
    </label>
    <label class="nav-toggle" id="radio-toggle-never">
        <input
            type="radio"
            id="radio-mode-never"
            name="radio-mode"
            checked={prefs.radioMode === "never"}
            onchange={() => setRadioMode("never")}
        >
        <span>Never show the music prompt</span>
    </label>
    <p class="form-hint">Controls the Laboratory Background Radio prompt shown before adding a chemical.</p>
</div>
