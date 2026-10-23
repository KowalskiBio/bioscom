import type { Container, InventoryTree, Room } from "@bioscom/shared";
import { computePositions, countAllChems, countChems, renderFormulaHtml, escapeHtml, sortChems, normalizeFormula } from "./inventoryUtils";
import { showToast } from "./stores/toast.svelte";

const BASE_CSS = `*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10pt;color:#111;padding:20px}
h1{font-size:18pt;margin-bottom:4px}h2{font-size:13pt;margin:18px 0 4px;padding:6px 10px;background:#1a2035;color:#fff;border-radius:4px}
h3{font-size:11pt;margin:12px 0 4px;padding:4px 8px;background:#e8ecf4;border-left:4px solid #3b82f6;color:#1a2035}
h3.fridge{border-left-color:#06b6d4}
h4{font-size:10pt;margin:8px 0 3px;color:#444;font-weight:600}
table{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:9pt;table-layout:fixed}
th{background:#f1f5f9;text-align:left;padding:4px 6px;border:1px solid #cbd5e1;font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}
td{padding:4px 6px;border:1px solid #cbd5e1;vertical-align:middle;word-break:break-word}
th:nth-child(1){width:6%}th:nth-child(2){width:26%}th:nth-child(3){width:14%}th:nth-child(4){width:7%}th:nth-child(5){width:7%}th:nth-child(6){width:12%}th:nth-child(7){width:12%}th:nth-child(8){width:16%}
tr:nth-child(even){background:#f8fafc}
.pos{font-weight:700;color:#2563eb;font-size:8.5pt}
.pos.fridge{color:#0891b2}.pos.freezer{color:#4f46e5}
.qty-low{color:#dc2626;font-weight:700}.qty-med{color:#d97706;font-weight:700}.qty-ok{color:#16a34a}
.meta{font-size:9pt;color:#64748b;margin-bottom:16px}
.badge{display:inline-block;font-size:8pt;padding:1px 6px;border-radius:10px;margin-left:6px;vertical-align:middle}
.badge.cabinet{background:#ede9fe;color:#7c3aed}.badge.fridge{background:#cffafe;color:#0e7490}.badge.freezer{background:#e0e7ff;color:#4f46e5}
.shelf-empty{color:#94a3b8;font-style:italic;font-size:9pt;padding:4px 0}
@media print{body{padding:10px}h2{break-before:page}h2:first-of-type{break-before:avoid}}`;

function containerMeta(cont: Container): { badgeCls: string; badgeLabel: string; icon: string; isFridge: boolean; isFreezer: boolean; isCooling: boolean } {
  const isFridge = cont.type === "fridge";
  const isFreezer = cont.type === "freezer" || cont.type === "deepfreezer";
  return {
    isFridge,
    isFreezer,
    isCooling: isFridge || isFreezer,
    badgeCls: isFridge ? "fridge" : isFreezer ? "freezer" : "cabinet",
    badgeLabel: isFridge ? "Fridge" : cont.type === "deepfreezer" ? "Deep Freezer" : isFreezer ? "Freezer" : "Cabinet",
    icon: isFridge ? "❄️" : isFreezer ? "🧊" : "🗄️",
  };
}

function shelfRows(cont: Container, heading: string): string {
  const posMap = computePositions(cont);
  let html = "";
  for (const sh of cont.shelves ?? []) {
    const chems = sortChems(sh.chemicals ?? [], posMap);
    const meta = containerMeta(cont);
    const shelfIcon = meta.isCooling ? (sh.name.startsWith("Door") ? "🚪" : meta.isFreezer ? "🧊" : "❄️") : "📁";
    html += `<h4>${shelfIcon} ${escapeHtml(sh.name)} (${chems.length})</h4>`;
    if (chems.length === 0) {
      html += `<div class="shelf-empty">Empty</div>`;
      continue;
    }
    html += `<table><thead><tr><th>Pos.</th><th>Name</th><th>Formula</th><th>Qty</th><th>Unit</th><th>Conc.</th><th>CAS</th><th>Note</th></tr></thead><tbody>`;
    for (const ch of chems) {
      const qty = parseFloat(String(ch.quantity ?? 0)) || 0;
      const qc = qty <= 0 ? "qty-low" : qty < 10 ? "qty-med" : "qty-ok";
      const pos = posMap[ch.id] ?? "—";
      const conc = ch.concentration !== null && ch.concentration !== undefined ? escapeHtml(`${ch.concentration} ${ch.concUnit ?? ""}`) : "—";
      html += `<tr><td><span class="pos ${meta.badgeCls}">${escapeHtml(pos)}</span></td><td>${escapeHtml(ch.name ?? "")}</td><td><em>${renderFormulaHtml(ch.formula)}</em></td><td class="${qc}">${escapeHtml(String(ch.quantity ?? 0))}</td><td>${escapeHtml(ch.unit ?? "pcs")}</td><td style="white-space:nowrap">${conc}</td><td>${escapeHtml(ch.cas ?? "—")}</td><td>${escapeHtml(ch.note ?? "—")}</td></tr>`;
    }
    html += `</tbody></table>`;
  }
  return html + (heading ? "" : "");
}

function printHtml(title: string, bodyHtml: string): void {
  const w = window.open("", "_blank");
  if (w === null) {
    showToast("Popup blocked – allow popups to export PDF", "error");
    return;
  }
  w.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title><style>${BASE_CSS}</style></head><body>${bodyHtml}</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 600);
  showToast("PDF ready – use browser Print dialog", "info");
}

export function exportPDF(tree: InventoryTree): void {
  const rooms = tree.rooms ?? [];
  let html = `<h1>BioSCom – Chemical Inventory</h1><div class="meta">Generated: ${new Date().toLocaleString()} &nbsp;|&nbsp; ${rooms.length} room(s)</div>`;
  for (const room of rooms) {
    const total = countAllChems(room);
    html += `<h2>${escapeHtml(room.name)}${room.description ? ` <span style="font-weight:400;font-size:11pt">${escapeHtml(room.description ?? "")}</span>` : ""}  <span style="font-size:10pt;font-weight:400;float:right">${total} chemical(s)</span></h2>`;
    for (const cont of room.containers ?? []) {
      const meta = containerMeta(cont);
      html += `<h3 class="${meta.badgeCls}">  ${meta.icon} ${escapeHtml(cont.name)}<span class="badge ${meta.badgeCls}">${meta.badgeLabel}</span>${cont.description ? ` – ${escapeHtml(cont.description ?? "")}` : ""}</h3>`;
      html += shelfRows(cont, "");
    }
  }
  printHtml("BioSCom – Chemical Inventory", html);
}

export function exportContainerPDF(room: Room, cont: Container): void {
  const meta = containerMeta(cont);
  const posMap = computePositions(cont);
  const total = countChems(cont);
  let html = `<h1>${meta.icon} ${escapeHtml(cont.name)}</h1><div class="meta">${escapeHtml(room.name)} | ${meta.badgeLabel} | ${total} chemical(s) | Generated: ${new Date().toLocaleString()}</div>`;
  html += `<h3 class="${meta.badgeCls}">${meta.icon} ${escapeHtml(cont.name)}<span class="badge ${meta.badgeCls}">${meta.badgeLabel}</span>${cont.description ? ` – ${escapeHtml(cont.description ?? "")}` : ""}</h3>`;
  html += shelfRows(cont, "");
  printHtml(`BioSCom – ${cont.name} PDF`, html);
}

export function normalizeFormulaForExport(formula: string | null | undefined): string {
  return normalizeFormula(formula ?? "");
}
