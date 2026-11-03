import Database from "better-sqlite3";

const DB_PATH = process.env.DB_PATH ?? "bioscom.db";
const GROUP_ID = process.env.GROUP_ID ?? "PKwJMGE33ZSg";
const FORCE = process.argv.includes("--force");
const DAY = 86_400_000;

type Origin = "purchased" | "prepared" | "derived" | "unknown";

interface Item {
  name: string;
  type?: string;
  attributes?: Record<string, unknown>;
  cas?: string;
  formula?: string;
  quantity?: number;
  unit?: string;
  concentration?: number;
  concUnit?: string;
  position?: string;
  note?: string;
  product?: { manufacturer?: string; catalogNumber?: string };
  batchInfo?: { lotCode?: string; originType?: Origin; expiresAt?: number; preparedBy?: string };
}

interface ShelfSpec {
  id: string;
  name: string;
  items?: Item[];
  rackName?: string;
  boxName?: string;
  color?: string;
}

interface ContainerSpec {
  id: string;
  name: string;
  type: string;
  description?: string;
  emoji?: string;
  shelves: ShelfSpec[];
}

interface RoomSpec {
  id: string;
  name: string;
  description?: string;
  containers: ContainerSpec[];
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const exp = (days: number): number => Date.now() + days * DAY;

const rooms: RoomSpec[] = [
  {
    id: "demo-room-main",
    name: "C05/209 — Synthetic wing",
    description: "Main bench space",
    containers: [
      {
        id: "demo-cabinet-acid",
        name: "Acid Cabinet",
        type: "cabinet",
        description: "Concentrated acids and bases",
        emoji: "🧪",
        shelves: [
          {
            id: "demo-sh-acid",
            name: "A",
            items: [
              { name: "Hydrochloric acid 37 %", cas: "7647-01-0", formula: "HCl", quantity: 4, unit: "L", concentration: 37, concUnit: "%", position: "A1", attributes: { molecular_weight: 36.46, safety_notes: "corrosive" }, product: { manufacturer: "Sigma-Aldrich", catalogNumber: "H1758" }, batchInfo: { lotCode: "K23-118", originType: "purchased", expiresAt: exp(900) } },
              { name: "Sulfuric acid 96 %", cas: "7664-93-9", formula: "H2SO4", quantity: 2, unit: "L", concentration: 96, concUnit: "%", position: "A2", attributes: { molecular_weight: 98.08, safety_notes: "burns" }, batchInfo: { lotCode: "S-209", originType: "purchased" } },
              { name: "Nitric acid 65 %", cas: "7697-37-2", formula: "HNO3", quantity: 1, unit: "L", concentration: 65, concUnit: "%", position: "A3", attributes: { molecular_weight: 63.01, safety_notes: "oxidizer corrosive" } },
              { name: "Ammonia 25 %", cas: "1336-21-6", formula: "NH3", quantity: 1, unit: "L", concentration: 25, concUnit: "%", position: "A4", attributes: { molecular_weight: 17.03, safety_notes: "vapor corrosive" } },
            ],
          },
          {
            id: "demo-sh-common",
            name: "B",
            items: [
              { name: "Sodium chloride", cas: "7647-14-5", formula: "NaCl", quantity: 5, unit: "kg", position: "B1", attributes: { molecular_weight: 58.44 } },
              { name: "Tris base", cas: "77-86-1", formula: "C4H11NO3", quantity: 1, unit: "kg", position: "B2", attributes: { molecular_weight: 121.14, safety_notes: "" }, product: { manufacturer: "Merck", catalogNumber: "T1503" }, batchInfo: { lotCode: "T-9023", originType: "purchased", expiresAt: exp(1800) } },
              { name: "Glycine", cas: "56-40-6", formula: "C2H5NO2", quantity: 500, unit: "g", position: "B3", attributes: { molecular_weight: 75.07 } },
              { name: "EDTA disodium" , cas: "60-00-4", formula: "C10H14N2Na2O8", quantity: 250, unit: "g", position: "B4", attributes: { molecular_weight: 336.2, safety_notes: "dust" } },
              { name: "SDS (sodium dodecyl sulfate)", cas: "151-21-3", formula: "C12H25NaO4S", quantity: 250, unit: "g", position: "B5", attributes: { molecular_weight: 288.38, safety_notes: "irritant dust" } },
              { name: "Ammonium sulfate", cas: "7783-20-2", formula: "(NH4)2SO4", quantity: 1, unit: "kg", position: "B6", attributes: { molecular_weight: 132.14 } },
            ],
          },
          {
            id: "demo-sh-organic",
            name: "C",
            items: [
              { name: "Ethanol absolute", cas: "64-17-5", formula: "C2H5OH", quantity: 5, unit: "L", position: "C1", attributes: { molecular_weight: 46.07, safety_notes: "flammable" }, batchInfo: { lotCode: "E-331", originType: "purchased" } },
              { name: "Methanol HPLC grade", cas: "67-56-1", formula: "CH3OH", quantity: 4, unit: "L", position: "C2", attributes: { molecular_weight: 32.04, safety_notes: "flammable toxic" } },
              { name: "Acetone", cas: "67-64-1", formula: "C3H6O", quantity: 2, unit: "L", position: "C3", attributes: { molecular_weight: 58.08, safety_notes: "flammable" } },
              { name: "Isopropanol", cas: "67-63-0", formula: "C3H7OH", quantity: 5, unit: "L", position: "C4", attributes: { molecular_weight: 60.1, safety_notes: "flammable" } },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "demo-room-cold",
    name: "C05/112 — Cold storage",
    description: "-20 and -80",
    containers: [
      {
        id: "demo-fridge-std",
        name: "Lab fridge +4",
        type: "fridge",
        description: "Stock fridges for kits and prepared buffers",
        emoji: "🥶",
        shelves: [
          {
            id: "demo-sh-fridge-solutions",
            name: "Top shelf",
            items: [
              { name: "PBS 1×", type: "solution", quantity: 2, unit: "L", attributes: { composition: "137 mM NaCl, 10 mM phosphate", ph: 7.4, recipe_reference: "P-033" }, batchInfo: { lotCode: "PREP-014", originType: "prepared", preparedBy: "admin" } },
              { name: "TBS 10×", type: "solution", quantity: 1, unit: "L", attributes: { composition: "200 mM Tris, 1.5 M NaCl", ph: 7.6 }, batchInfo: { lotCode: "PREP-019", originType: "prepared", expiresAt: exp(180) } },
              { name: "LB medium, autoclaved", type: "solution", quantity: 10, unit: "L", attributes: { composition: "tryptone 10 g/L, yeast 5 g/L, NaCl 10 g/L", ph: 7.0 }, batchInfo: { lotCode: "PREP-021", originType: "prepared", preparedBy: "admin", expiresAt: exp(120) } },
              { name: "DTT stock 1 M", type: "solution", quantity: 5, unit: "mL", attributes: { composition: "dithiothreitol in water" }, batchInfo: { lotCode: "PREP-007", originType: "prepared", expiresAt: exp(365) } },
            ],
          },
          {
            id: "demo-sh-fridge-reagents",
            name: "Middle shelf",
            items: [
              { name: "Anti-GAPDH rabbit polyclonal", type: "antibody", quantity: 100, unit: "μL", attributes: { target: "GAPDH", host_species: "Rabbit", clonality: "Polyclonal", applications: "WB 1:5000" }, product: { manufacturer: "Sigma-Aldrich", catalogNumber: "G9545" }, batchInfo: { lotCode: "AB-77", originType: "purchased", expiresAt: exp(545) } },
              { name: "Anti-GFP mouse monoclonal", type: "antibody", quantity: 50, unit: "μL", attributes: { target: "GFP", host_species: "Mouse", clonality: "Monoclonal", clone_id: "9F9" }, product: { manufacturer: "Roche", catalogNumber: "11814460001" }, batchInfo: { lotCode: "K-880", originType: "purchased", expiresAt: exp(365) } },
              { name: "Secondary anti-rabbit HRP", type: "antibody", quantity: 200, unit: "μL", attributes: { target: "rabbit IgG", host_species: "Goat", clonality: "Polyclonal", conjugate: "HRP" }, batchInfo: { lotCode: "G-4581", originType: "purchased" } },
              { name: "Streptavidin-HRP", type: "reagent", quantity: 1, unit: "mg", attributes: { formulation: "peroxidase conjugate" }, batchInfo: { lotCode: "SA-11", originType: "purchased" } },
            ],
          },
          {
            id: "demo-sh-fridge-primers",
            name: "Door pocket",
            items: [
              { name: "T7 promoter primer", type: "primer", quantity: 20, unit: "nmol", attributes: { sequence: "TAATACGACTCACTATAGGG", purification: "Desalted", tm_celsius: 53.2 }, batchInfo: { lotCode: "SYN-0091", originType: "purchased" } },
              { name: "M13 reverse primer", type: "primer", quantity: 20, unit: "nmol", attributes: { sequence: "CAGGAAACAGCTATGAC", purification: "Desalted", tm_celsius: 50.8 } },
              { name: "GAPDH forward primer", type: "primer", quantity: 10, unit: "nmol", attributes: { sequence: "GAAGGTGAAGGTCGGAGTC", purification: "HPLC", tm_celsius: 60.8 } },
              { name: "GAPDH reverse primer", type: "primer", quantity: 10, unit: "nmol", attributes: { sequence: "GAAGATGGTGATGGGATTTC", purification: "HPLC", tm_celsius: 60.5 } },
            ],
          },
        ],
      },
      {
        id: "demo-deepfreezer",
        name: "Deep freezer −80",
        type: "deepfreezer",
        description: "Long-term stocks",
        shelves: [
          {
            id: "demo-sh-df-a1",
            name: "Rack A / Box 1",
            rackName: "A",
            boxName: "1",
            color: "#38bdf8",
            items: [
              { name: "E. coli DH5α glycerol stock", type: "biological_stock", quantity: 8, unit: "tubes", attributes: { organism: "E. coli", strain: "DH5α", plasmid: "none", preservation_method: "Glycerol -80°C" }, note: "Competent cells" },
              { name: "E. coli BL21(DE3) stock", type: "biological_stock", quantity: 5, unit: "tubes", attributes: { organism: "E. coli", strain: "BL21(DE3)", preservation_method: "Glycerol -80°C" } },
            ],
          },
          {
            id: "demo-sh-df-b1",
            name: "Rack B / Box 1",
            rackName: "B",
            boxName: "1",
            color: "#f59e0b",
            items: [
              { name: "S. cerevisiae BY4741 stock", type: "biological_stock", quantity: 2, unit: "tubes", attributes: { organism: "Saccharomyces cerevisiae", strain: "BY4741", genotype: "MATa his3Δ1 leu2Δ0 met15Δ0 ura3Δ0", preservation_method: "Glycerol -80°C" } },
              { name: "pUC19 plasmid stock", type: "biological_stock", quantity: 1, unit: "tube", attributes: { organism: "E. coli", plasmid: "pUC19", selection_marker: "Ampicillin", preservation_method: "Glycerol -80°C" } },
              { name: "pET-28a-GFP plasmid stock", type: "biological_stock", quantity: 2, unit: "tubes", attributes: { organism: "E. coli", plasmid: "pET-28a-GFP", selection_marker: "Kanamycin", preservation_method: "Glycerol -80°C" } },
            ],
          },
        ],
      },
    ],
  },
];

function toDocChem(item: Item): Record<string, unknown> {
  const out: Record<string, unknown> = { id: genId(), name: item.name };
  const maybe = (key: string, value: unknown) => {
    if (value !== undefined && value !== null) out[key] = value;
  };
  maybe("cas", item.cas);
  maybe("formula", item.formula);
  maybe("quantity", item.quantity);
  maybe("unit", item.unit);
  maybe("concentration", item.concentration);
  maybe("concUnit", item.concUnit);
  maybe("position", item.position);
  maybe("note", item.note);
  maybe("type", item.type);
  maybe("attributes", item.attributes);
  maybe("product", item.product);
  maybe("batchInfo", item.batchInfo);
  return out;
}

function buildDoc(existing: Record<string, unknown> | null): { tree: Record<string, unknown>; totalItems: number } {
  const tree =
    existing !== null
      ? (JSON.parse(JSON.stringify(existing)) as { rooms: Array<Record<string, unknown>>; assetRooms?: unknown[]; assets?: unknown[]; protocols?: unknown[] } & Record<string, unknown>)
      : ({ rooms: [], assetRooms: [], assets: [], protocols: [] } as Record<string, unknown> & { rooms: Array<Record<string, unknown>>; assetRooms?: unknown[]; assets?: unknown[]; protocols?: unknown[] });

  tree.rooms = ((tree.rooms as Array<Record<string, unknown>>) ?? []).filter((r) => !(r as { id?: string }).id?.startsWith("demo-"));
  for (const r of rooms) {
    const containers = r.containers.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description ?? "",
      emoji: c.emoji,
      type: c.type,
      sharedWithGroupIds: [],
      shelves: c.shelves.map((s) => ({
        id: s.id,
        name: s.name,
        rackName: s.rackName,
        boxName: s.boxName,
        color: s.color,
        chemicals: (s.items ?? []).map(toDocChem),
      })),
    }));
    tree.rooms.push({ id: r.id, name: r.name, description: r.description ?? "", containers });
  }
  let total = 0;
  for (const room of tree.rooms) {
    for (const cont of (room.containers as Array<{ shelves?: Array<{ chemicals?: unknown[] }> }>) ?? []) {
      for (const sh of cont.shelves ?? []) {
        total += (sh.chemicals ?? []).length;
      }
    }
  }
  return { tree: tree as Record<string, unknown>, totalItems: total };
}

function seed(): void {
  const db = new Database(DB_PATH);
  const row = db
    .prepare("SELECT tree, version FROM group_inventory_docs WHERE group_id = ?")
    .get(GROUP_ID) as { tree: string; version: number } | undefined;

  const already = ((): boolean => {
    if (row === undefined) return false;
    const parsed = JSON.parse(row.tree) as { rooms?: Array<{ id: string }> };
    return (parsed.rooms ?? []).some((r) => r.id.startsWith("demo-"));
  })();
  if (already && !FORCE) {
    console.log(`demo rooms already present in group ${GROUP_ID} — rerun with --force to replace`);
    process.exit(0);
  }

  const run = db.transaction(() => {
    const existing = row === undefined ? null : (JSON.parse(row.tree) as Record<string, unknown>);
    const { tree, totalItems } = buildDoc(existing);
    if (row === undefined) {
      db.prepare("INSERT INTO group_inventory_docs (group_id, tree, version) VALUES (?, ?, ?)").run(GROUP_ID, JSON.stringify(tree), 1);
    } else {
      db.prepare("UPDATE group_inventory_docs SET tree = ?, version = ? WHERE group_id = ?").run(
        JSON.stringify(tree),
        row.version + 1,
        GROUP_ID,
      );
    }
    db.prepare(
      "INSERT INTO history (group_id, timestamp, user_name, action) VALUES (?, ?, ?, ?)",
    ).run(GROUP_ID, Date.now(), "demo-seed", `Seeded demo inventory (${totalItems} stocked items across ${rooms.length} rooms)`);
    return totalItems;
  });

  const total = run();
  const finalVersion = (db.prepare("SELECT version FROM group_inventory_docs WHERE group_id = ?").get(GROUP_ID) as { version: number }).version;
  console.log(`✔ demo seed applied: ${total} stocked items written, doc version now ${finalVersion}`);
  db.close();
}

seed();
