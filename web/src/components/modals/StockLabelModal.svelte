<script lang="ts">
  import JsBarcode from "jsbarcode";
  import { materialTypeLabels } from "@bioscom/shared";

  let {
    name,
    barcode,
    type,
    locationText,
    position,
    lotCode,
    expiresAt,
  }: {
    name: string;
    barcode: string;
    type?: string;
    locationText?: string;
    position?: string | null;
    lotCode?: string | null;
    expiresAt?: number | null;
  } = $props();

  const labels = materialTypeLabels();

  let cardEl = $state<HTMLDivElement | null>(null);
  let barcodeEl = $state<SVGSVGElement | null>(null);

  const typeLabel = $derived(type !== undefined && type !== "" ? (labels[type] ?? type) : "");
  const metaOne = $derived([typeLabel, locationText?.trim() ?? ""].filter((part) => part !== "").join(" · "));
  const metaTwo = $derived(
    [
      position?.trim() ?? "",
      lotCode?.trim() ?? "",
      expiresAt !== undefined && expiresAt !== null && Number.isFinite(expiresAt)
        ? new Date(expiresAt).toISOString().slice(0, 10)
        : "",
    ]
      .filter((part) => part !== "")
      .join(" · "),
  );

  $effect(() => {
    const el = barcodeEl;
    const value = barcode.trim();
    if (el === null || value === "") {
      return;
    }
    try {
      JsBarcode(el, value, {
        format: "CODE128",
        width: 2,
        height: 60,
        displayValue: true,
        fontSize: 16,
        margin: 10,
      });
      const bbox = el.getBBox();
      if (bbox.width > 0 && bbox.height > 0) {
        el.setAttribute("viewBox", `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`);
        el.setAttribute("width", "100%");
        el.setAttribute("height", "100%");
      }
    } catch {
      console.error("Barcode generation failed for", value);
    }
  });

  function printLabel(): void {
    const card = cardEl;
    if (card === null) {
      return;
    }
    // The app shell (and therefore this modal) lives inside #app, which is hidden
    // for print. Clone the label outside #app so only the label reaches the printer.
    const printRoot = document.createElement("div");
    printRoot.className = "stock-label-print";
    printRoot.appendChild(card.cloneNode(true));
    document.body.appendChild(printRoot);
    document.body.classList.add("printing-label");
    window.print();
    setTimeout(() => {
      document.body.classList.remove("printing-label");
      printRoot.remove();
    }, 300);
  }
</script>

<div class="stock-label-card" bind:this={cardEl}>
  <div class="stock-label-name">{name}</div>
  <div class="stock-label-barcode-text">{barcode}</div>
  <svg class="stock-label-barcode" bind:this={barcodeEl}></svg>
  {#if metaOne !== ""}
    <div class="stock-label-meta">{metaOne}</div>
  {/if}
  {#if metaTwo !== ""}
    <div class="stock-label-meta">{metaTwo}</div>
  {/if}
  <div class="stock-label-actions">
    <button class="btn-primary" id="btn-print-label" onclick={printLabel}>Print label</button>
  </div>
</div>
