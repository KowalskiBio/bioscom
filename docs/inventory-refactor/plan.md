# Inventory refactor — current-state mapping and migration plan

Deliverable 1 of `lab_inventory_refactor_agent_brief.md`. Written against the actual
repository (branch `visual`, baseline commit `f771cb8`). All data examples below are
structural, not from production — **no production database is available on this machine**;
production data lives only on the faculty VM.

## 1. System inspection results

### Stack
- **Backend:** Node 24, Fastify 5, `better-sqlite3` (WAL). Bootstrap schema via
  `server/src/db/schema.sql`, applied with `CREATE TABLE IF NOT EXISTS` **on every boot**
  (`db.ts`); there is no versioned migration runner yet.
- **Frontend:** Svelte 5 + Vite, reads the whole inventory document on login, works against
  it entirely in memory, and refreshes on WebSocket broadcasts.
- **Shared:** zod schemas in `shared/` validate both API payloads and the inventory
  document itself, server- and client-side.
- **Tests:** vitest + supertest server unit/API tests (scratch SQLite per run), shared zod
  tests, mock-WS web tests, Playwright E2E incl. visual parity.

### How chemicals are modeled today
The entire lab inventory of one group is **one JSON document**:

```text
group_inventory_docs (group_id PK, tree TEXT, version INTEGER)

tree = {
  rooms[] → containers[] → shelves[] → chemicals[]     ← the live inventory domain
  assetRooms, assets, protocols,                        ← live, used by web views
  instruments, notices, printCatalog, printRequests     ← dead baggage in the doc (web never
                                                          reads them; first-class relational
                                                          feature tables serve those domains)
}
```

Legacy `chemical` row (inline in `shelves[].chemicals[]`):

```text
id, name, cas, formula, quantity, unit, concentration, concUnit,
position, customPosition, _shelfOverride, note  (+ any extra legacy keys; zod is looseObject)
```

**Classification per brief §6.1:** one legacy row conflates four concepts:
substance identity (`name`, `cas`, `formula`) + concentration (`concentration`,
`concUnit` — attribute-ish) + physical stock (`quantity`, `unit`) + placement
(room/container/shelf + textual `position` slots). It is **not** a clean substance record:
the same material in two locations exists as two unrelated rows (no shared identity), and
there are **no manufacturer/catalog/lot/expiry fields anywhere** (verified across schema,
API payload schemas, and forms).

⇒ Migration mapping is therefore **one legacy row → 1 Material + 0 Product + 1 placeholder
Batch + 1 Stock**, with **no automatic merging** (brief invariant; dedupe is a later,
user-driven workflow).

### Write path
All mutations flow through `createMutator` (`server/src/inventory/doc.ts`): load doc →
apply JS mutation → zod-revalidate → full-JSON rewrite with `version+1` → insert flat
history row, **inside one SQLite transaction**; the hub then broadcasts the whole new tree
to the group (and to the mirror group for shared-container writers; mirrored history line).

### Location model
Embedded in the doc: `room → container(cabinet/fridge/freezer/deepfreezer) → shelf`,
plus deep-freezer extras (`rackName`, `boxName`, `parentShelfId`, colored boxes), cabinet
"range shelves" (`isRangeShelf/rangeStart/rangeEnd`), and per-chemical computed text
positions via `getOrCreatePosition` with `customPosition`/`_shelfOverride` escape hatches.

### Quantities & status
`quantity` (REAL-ish number) + `unit` (free text); `adjust-qty` adds a delta, clamps ≥ 0,
rounds to 3 dp. UI colors: `0 → low/red`, `<10 → medium/amber`, else ok. No status enum,
no expiry.

### Tenancy & sharing
- Everything scoped per group; `users.group_id`; `superadmin` bypass.
- **Shared containers:** stored only in the owner's doc with `ownerGroupId` +
  `sharedWithGroupIds`; the shared listing (`/api/groups/:id/shared-containers`)
  **scans every group's doc** and filters; viewer writes mutate the *owner's* doc with
  mirrored history + broadcast to both groups.

### Chemical-id references (must stay resolvable)
- `id`s are used by: GlobalSearch highlight rows, `computePositions` position map,
  move/adjust/delete API paths, `history.src_id` column (nullable, currently unused),
  exports server-side (`exports.ts`) and print/PDF flows.
- `barcode` fields exist only on **assets**, not chemicals; chemical labels are generated
  in exports from position/name.

### History
Relational flat table `(group_id, timestamp, user_name, action TEXT)`; action strings are
generated per mutation type. Migration must not touch it (readable as-is). New: populate
`src_id` with the affected stock id for new inventory mutations where trivially known.

## 2. Target architecture (adapted to this repo)

Brief §11 decisions, made on repository evidence:

1. **Products:** plain optional child table of materials (no separate normalized
   manufacturer entity; legacy data has no manufacturer values at all).
2. **Custom descriptors:** SQLite JSON via `attributes TEXT` + server-side zod validation
   against a **type registry in `shared/`** (types own their field definitions,
   versioned). JSON indexing (`json_extract`) used only where query patterns justify it
   (CAS lookup); full-text/external search deliberately out of scope.
3. **Locations:** new relational `locations` hierarchy mirrors the doc structure
   (room→container→shelf; container/shelf metadata columns; deep-freezer rack/box fields);
   **no competing model** — the two are kept identical by the sync layer below.
4. **Catalog vs inventory UI:** unified module initially (existing views keep working);
   type-filtered columns and a material catalog view follow in the UI increment.
5. **Provenance:** `batch_inputs` table ships in the schema now (Phase C design), unused
   by UI for now.
6. **API compatibility:** all existing `/api/groups/:id/inventory/**` endpoints keep their
   exact shapes (payloads, history strings, broadcasts); new typed endpoints are additive.

### New tables (additive, alongside everything existing)

```text
schema_migrations(version PK, name, applied_at)             ← new versioned runner
material_types(key PK, label, schema_version, fields JSON)  ← seeded 7 types
materials(id PK, group_id, type_key, name, description, attributes JSON, timestamps, archived_at)
products(id PK, material_id FK, manufacturer_name, supplier_name, catalog_number,
         product_name, variant, attributes JSON, timestamps)
batches(id PK, material_id FK, product_id NULL FK, lot_code, origin_type, received_at,
        prepared_at, prepared_by, expires_at, attributes JSON, timestamps)
locations(id PK, group_id, parent_id NULL FK, kind(room|container|shelf), name,
          description, container_type, emoji, color, rack_name, box_name, parent_shelf_id,
          is_range_shelf, range_start, range_end, owner_group_id, owner_group_name,
          rack_positions JSON, sort_index, timestamps)
container_shares(container_location_id FK, group_id, PK pair)
stocks(id PK = legacy chemical id, group_id, batch_id FK NOT NULL, location_id FK NOT NULL,
       position, custom_position, shelf_override, current_quantity, quantity_unit,
       concentration, concentration_unit, note, status, container_type, timestamps)
batch_inputs(id PK, output_batch_id FK, source_stock_id FK, quantity_used, unit, role)
legacy_chemical_map(group_id, chemical_id, material_id, batch_id, stock_id, migrated_at,
                    PK(group_id, chemical_id))
```

Invariants enforced in code (+ tests): `batch.product_id` may only reference a product of
the same material; a stock always has a batch (and via batch a material); deletion of a
material/batch referenced by a stock is prevented (soft archive for materials).

### IDs
Legacy ids are preserved one-to-one: room/container/shelf map to `locations.id`; chemical
to `stocks.id`. Materials/batches get deterministic derived ids `m-<chemId>`, `b-<chemId>`
→ backfill and sync are naturally idempotent; no map lookup needed for the common case
(map table still records the link explicitly + `migrated_at`).

### Attribute mapping for legacy chemicals (type `chemical`)
```text
cas          → attributes.cas_number
formula      → attributes.molecular_formula
concentration+concUnit → kept on stocks (stock-level properties), NOT material attributes
note         → stocks.note
any extra legacy keys on the row (looseObject) → attributes.legacy_fields { ... }
```

## 3. Migration strategy (locked with maintainer)

**Mirror first, flip later** — the JSON doc remains the write/read driver; a transactional
sync keeps relational tables current on every mutation. **Auto backfill on boot** via a new
versioned migration runner (fits existing schema auto-apply deploy style; rollback = doc
untouched, new tables simply ignored).

### Sequence (this increment, Phase A part 1)
1. `shared/`: material-type registry (7 types, field defs incl. validation rules), zod
   attribute validation, entity schemas/types.
2. `server/`: versioned migration runner + migration 0001 (tables above + seeded types).
3. `server/`: backfill/sync module (idempotent, transactional, per-group) + reconcile
   report (doc chemical count vs stocks, rooms/containers/shelves vs locations, per-group
   anomaly lines; corrupt docs skipped, never fatal).
   - migration 0002 runs backfill over all groups at boot, logs the report.
4. `server/`: `createMutator` calls the same sync for the mutated group **inside the same
   transaction** → relational mirror is always consistent with the doc.
5. Tests: backfill round-trip + idempotency + reconcile on fixture trees (rooms, shares,
   deep-freezer boxes, range shelves, weird quantities/unknown units, extra legacy keys);
   mirror-on-write through real API flows (add/edit/adjust/move/delete chemical).
6. Rebuild of the doc → later, reviewed step ("flip"): reads are untouched now.

### Phase A remainder (next increments, not this one)
- Typed read APIs: materials catalog, material detail (products/batches/stocks), mixed
  stock queries by location/type/expiry/search (server-validated attributes).
- Type-aware create/edit UX (Add/Edit item: type picker + dynamic descriptor fields via the
  shared registry; Chemicals table gains type descriptor columns where a type is filtered;
  mixed table stays as is by default).
- Move/depletion/adjust routed to stock semantics in UI copy (APIs unchanged).
- Acceptance-scenario tests 1–14 as integration coverage.
- Rollout runbook + merge workflows for duplicate materials (Phase B).

## 4. Risks & honest limitations

## 5. Status — increment 1 (foundation) DONE

Implemented and verified:

- `shared/src/material.ts`: 7-type registry with field defs, `validateAttributes` (tolerant
  to unknown keys, strict on known ones), entity zod schemas + TS types. Re-exported via
  index/browser entries. Tests: shared 44 pass + 1 skip (18 new registry cases).
- `server/src/db/migrations/` + `db/migrate.ts`: versioned runner hooked into `getDatabase`
  (after legacy bootstrap). Migrations: 0001 tables, 0002 type seeds, 0003 canonical fields
  (matches shared registry exactly). All additive/idempotent.
- `server/src/inventory/sync.ts`: document→relational mirror (`syncGroupInventoryDocument`,
  `syncGroupInventory`) + version-aware `ensureBackfilled` (per-group `inventory_sync_state`;
  corrupt docs re-report every run and never block) + reconcile reports
  (doc vs db counts per level).
- `server/src/inventory/doc.ts` mutator now mirrors every mutation transactionally into the
  relational schema and marks the group synced; mirror failures log loudly but never fail the
  user write (document remains authoritative during mirror-first phase).
- Tests: server 77/77 (62 pre-existing + migrations 4 + backfill/sync 6 + API-mirror 5),
  shared 44+1, web 9/9, builds + typecheck clean on all workspaces.

| Metric | Result |
| --- | --- |
| Legacy tables dropped/modified | none — fully additive |
| Doc write path changes | none beyond mirror hook |
| Existing tests failing | 0 |
| Backfill reruns | idempotent (verified incl. deletion pruning + user-row survives) |
| Boot behavior (prod) | migrations + backfill run once, anomalies logged as JSON line |

## 6. Next increments (target order)

Status — increment 2 (typed read APIs) DONE:

- `server/src/inventory/catalog.ts` registered in `app.ts`:
  - `GET /api/groups/:id/material-types` — DB-seeded registry (canonical 0003 fields).
  - `GET /api/groups/:id/materials` — catalog list with products/batches/stocks/locations
    counts, `type` + `q` filters, pagination; archived excluded by default.
  - `GET /api/groups/:id/materials/:materialId` — material + products + batches (product
    joined) + stocks with location path (`Room / Container / Shelf`).
  - `GET /api/groups/:id/stocks` — mixed read model with shared columns
    (name/type/quantity/location/batch incl. lot & expiry/product if any), recursive
    location subtree filter, type/status/`expiresBefore` filters, attribute-aware search
    (name, cas_number/target/sequence via `json_extract`, catalog, lot, position),
    pagination. Same auth conventions (members + superadmin; readers allowed on GET).
- Tests: server 90/90 (+13 catalog cases incl. mixed-fridge, subtree, filters, search
  set, pagination, group isolation, reader access, 404s).
- Caught during review: positional-parameter binding matters when a `WITH RECURSIVE` CTE
  prefix precedes WHERE placeholders (fixed by explicit cte/where param order).

Status — increment 3 (type-aware create/edit) DONE:

- Shared: `ChemicalSchema` doc row extended (`type`, `attributes`, `product`, `batchInfo`);
  Add/Edit chemical body schemas accept the same; `product: null` on edit detaches.
- Server: mirror maps rows into typed materials (validated attributes; legacy extras under
  `legacy_fields`), single deterministic product per stock (`p-<chemId>`, orphan-pruned when
  detached), batch lot/origin/dates/expiry; create/edit endpoints validate attributes
  server-side against the registry, incl. unknown type keys (400 with field errors).
- Web: type picker + dynamic descriptor fields per registry (string/text/number/boolean/
  date/enum/sequence), CAS/formula stay chemical-only, optional Commercial product and
  Batch/lot sections, UTC-safe date handling, type chips in the chemical tables.
- Tests: server 96/96 (+6 typed-ops incl. 400s, detach semantics, merged edit validation,
  FK-order caught the product-before-material sync bug), web 9/9, typecheck 0 errors and
  a11y warnings held at the 113 baseline (new fields fully label-associated).

Status — increment 4 (flip-read parity tooling) DONE:

- `server/src/inventory/assemble.ts` rebuilds the exact legacy inventory slice from
  relational data (locations + shares + chemicals with attributes re-expanded, product
  and batchInfo reattached); `checkParity(groupId)` canonical-compares for
  missing/different/ghost rows; boot logs parity mismatches as one JSON line (any
  non-zero output = alarm); probe endpoint `GET /api/groups/:id/inventory/parity`.
- Only the inventory slice (rooms→containers→shelves→chemicals) participates —
  assets/protocols stay doc-only by design for now.
- Tests: server 100/100 (+4 parity).

Status — Phase B 2 (duplicate-material merge) DONE:

- Authority shift in sync: `legacy_chemical_map` is now the chemical→material authority
  (INSERT OR IGNORE; deterministic `m-<chemId>` derivation only for unmapped rows), so
  user-performed merges survive every resync; merged materials (>1 chemicals linked) are
  never overwritten by the mirror; prune deletes a source chemical's batch/stock but
  spares a merged target material (guarded by remaining map references); type mismatch,
  same-id, archived and foreign rows are rejected.
- POST /api/groups/:id/materials/merge: atomic transaction moving products (+ batches,
  whose stocks ride along), re-linking the map, archiving the source material, logging a
  history entry; returns moved counts. Reader/role enforcement identical to other writes.
- UI: "Merge into…" action on the material detail (hidden for readers) → merge modal with
  debounced same-type candidate search, counts per candidate, confirm flow, error recovery;
  on success the catalog refreshes (merge modal replaces detail modal — single openModal
  state).
- Tests: server 104/104 (+4 merge: validation, relocation + resync-no-resurrect,
  cross-type/archived rejects, permissions). typecheck 0 errors, a11y 113 baseline,
  builds pass, web 9/9.
- Gotcha worth remembering locally: server consumes shared's built `dist/` — rebuild
  `shared` after editing `shared/src` BEFORE running server tests (the stale-dist 500s
  confound otherwise).

Status — Phase B 3 (mixed stocks table) DONE:

- Catalog view tabs Materials | Stocks: the Stocks tab shows every physical stock across
  locations in one table (Name/Type/Quantity/Location path+position chip/Lot/Expires with
  60-day aging colors/Status), from GET /stocks with shared type pills + independent
  search / status / expiry-window filters and 25-page pagination; row click opens the
  material detail. Type-dependent descriptor columns (registry-driven) appear only when
  a type filter is active (chemical: CAS+MW; others: first two descriptor fields), so the
  mixed view never shows misleading values for non-applicable rows.
- Store: dedicated stocks slice with stale-request guards; cleared with catalog.
- Gates: typecheck 0 errors / 113 baseline, builds pass, web tests 9/9.

Status — Phase B 1 (Materials catalog UI) DONE:

- New top-level Catalog view: type filter pills (All + 7 registry types), debounced name
  search, paginated card list (25/page) with type chips, descriptor summaries and
  stock/location/product counts; xwide material-detail modal (attributes, products,
  batches with lot/origin/expiry + ≤60-day expiry hint, stocks with location paths and
  status chips). Consumes the Phase A read APIs unchanged. Group-scoped lazy loading +
  clear-on-logout. Default-visible nav toggle "Catalog" (bauhaus nav: after Inventory in
  Assets with blue edge; original nav appended alongside).
- Gates: typecheck 0 errors, a11y warnings at 113 baseline, builds pass, web tests 9/9;
  live DOM verification of nav placement + route activation.

Status — Phase B 2 (duplicate-material merge) DONE:

Status — Phase B 4 (bulk CSV import) DONE:

- POST /api/groups/:id/inventory/bulk-import: single doc mutation (one bump + one
  broadcast) creating up to 500 items into a chosen shelf; every row passes type-registry
  validation first, invalid rows reported per-index and skipped without side effects;
  fully-invalid payloads are a no-op. Full type/product/batchInfo support.
- UI: "Import CSV" in the container detail header (writer-only) → xwide modal: paste →
  quote-aware parse (BOM/CR, duplicate-header first-wins, attribute mapping,
  client-side registry validation, 500-row cap) → valid/skipped preview → confirm →
  created/skipped report; realtime broadcast refreshes the view automatically.
- Tests: server 107/107 (+3 import flow), web 9/9, typecheck 0 errors / 113 baseline,
  builds pass.

Remaining in target order:

1. Rollout runbook update in `deploy/` (backup → boot migrations → log reconcile →
   monitor) once Phase A soaks in production for 1–2 weeks; then schedule the flip-read
   (assemble-to-doc becomes the read driver) in a reviewed migration.

- **Local-only data:** no production reconciliation is possible here; correctness is argued
  by fixture tests + reconcile report, which also runs on boot in production and logs
  anomalies loudly for operator review.
- **1:1:1:1 mapping** preserves everything but duplicates materials that are logically the
  same substance — deliberate (brief §6.1); merging is Phase B user workflow, not a
  backfill guess.
- **Deep-freezer positions** (`rackPositions` map, range-shelf auto placement) stay as
  location metadata + textual positions; slot-level location records are a later refinement
 – legacy textual positions are never lost.
- **Rollback:** safe because additive and mirror-first — the doc and its history are never
  rewritten by the migration; new writes flow through the same transaction as the old doc,
  so rollback only means ignoring the new tables. No data-conversion rollback needed yet
  (nothing is written *only* into the new structure).
