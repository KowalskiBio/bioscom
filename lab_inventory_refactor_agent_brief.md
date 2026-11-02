# Laboratory Inventory Refactor — Implementation Brief for AI Coding Agent

> **Purpose:** Refactor an existing laboratory management application in which **all inventory items are currently represented as `chemical` records** into a **unified, type-aware laboratory inventory system**.
>
> **Audience:** AI coding agent working inside the existing repository.
>
> **Priority:** Preserve existing data and working features. Make incremental, testable changes rather than replacing the application wholesale.

## 0. Your mission

Inspect the existing codebase and implement an architecture that:

1. Represents **chemicals, commercial reagents, antibodies, primers/oligonucleotides, prepared solutions, biological stocks (including glycerol stocks)**, and future item types in one inventory.
2. Displays **type-specific descriptors** on creation/edit/detail forms (e.g., CAS number and molecular weight for chemicals; manufacturer/catalog number for commercial products; target/clone for antibodies; sequence for primers).
3. Allows **mixed inventory views** for physical storage locations (a fridge can hold a chemical, an antibody, and a buffer in the same table).
4. Separates **what a material is** from **commercial product information**, **lot/preparation batch**, and **physical stock/container**.
5. Migrates the current chemical-centric data model **without losing records, references, locations, quantities, metadata, or history**.
6. Preserves existing end-user workflows wherever feasible and introduces a clear path for additional types and fields later.

**Do not simply rename `chemicals` to `items` or add a `type` string while leaving all other concepts conflated.** The model must distinguish a catalog definition from an actual bottle, vial, aliquot, or tube.

**Do not drop or irreversibly modify existing tables/data as the first step.** Begin with inspection and a migration plan, then implement additive migrations and verified backfill.

---

## 1. Before making changes: inspect the actual application

Determine and document:

- Language, backend framework, database engine, ORM/migration mechanism, frontend framework, and test framework.
- Current `chemical` schema, validation, service/API routes, UI forms, tables, import/export processes, and search.
- Whether one current `chemical` row means a **substance definition**, a **supplier product**, a **batch**, a **single physical container**, or some mixture of these.
- All references to chemical IDs (experiments, protocols, orders, usage logs, storage locations, labels, attachments, permissions, audit history, etc.).
- Existing location hierarchy, stock count/quantity handling, units, expiry handling, and barcodes.
- Whether there are multiple labs/tenants and any role-based access control or row-level security.
- Production data size, existing duplicate materials, and any legacy fields whose meaning is ambiguous.

**Required first deliverable in the agent's working notes:** a short *current-state mapping* and *migration plan* identifying existing tables, important foreign keys, migration risks, and which records become materials, products, batches, and stocks. Adapt all examples below to the actual repository; do not assume PostgreSQL or any particular ORM if the app uses something else.

If an existing feature or relationship cannot be safely migrated automatically, preserve it and clearly flag the records requiring review. **Do not silently guess scientific or inventory data.**

---

## 2. The target conceptual model

Model these entities separately:

```text
Material Type / Field Schema
          |
          v
       Material  <-------- reusable definition ("What is it?")
          |
          +------> Product (optional; supplier/manufacturer/catalog identity)
          |              |
          +--------------+
                         v
                 Batch / Lot
         (commercial lot or in-house preparation)
                         |
                         v
                  Physical Stock
           (bottle / tube / vial / aliquot)
                         |
                         v
                      Location
               (room / fridge / shelf / box / slot)
```

The exact schema can differ, but these distinctions must exist.

### 2.1 Material type

Defines **which descriptors are appropriate** and how they are validated/displayed.

Initial types:

| Type key (suggested) | Label | Important descriptive fields |
|---|---|---|
| `chemical` | Chemical / compound | CAS number, molecular formula, molecular weight (g/mol), purity/grade, safety metadata |
| `reagent` | Commercial reagent / kit | Product/formulation descriptors, kit components if applicable; commercial identity belongs to Product |
| `antibody` | Antibody | Antigen/target, host species, clonality, clone ID, conjugate, species reactivity, applications |
| `primer` | Primer / oligonucleotide | Sequence (5′→3′), length, modifications, purification, calculated/recorded Tm |
| `solution` | Prepared solution / buffer | Composition, concentrations, pH, preparation method or recipe reference |
| `biological_stock` | Biological / glycerol stock | Organism, strain, genotype, plasmid, selection marker, preservation method |
| `other` | Other material | Minimal common descriptors plus custom fields |

**Taxonomy caveat:** These types are **forms/templates, not scientifically exclusive classes**. An antibody is also a reagent; a chemical can be commercially purchased; a glycerol stock is a preservation form. Do not encode rules like “only reagents can have a manufacturer.” Manufacturer and catalog number belong to an optional **Product** associated with any appropriate material. Tags and cross-cutting properties (hazards, storage needs, project, owner) can coexist with the primary type.

### 2.2 Material

Reusable identity of the thing, independent of where it is stored.

Examples:

- Tris base (chemical, CAS `77-86-1`, molecular weight `121.14 g/mol`).
- Anti-GAPDH antibody, rabbit polyclonal (antibody).
- Forward primer `GeneX_F` with its nucleotide sequence (primer).
- PBS 1× (solution).
- *E. coli* strain carrying plasmid X (biological_stock).

Suggested fields:

```text
materials
- id
- material_type_id
- name                    // common searchable display name
- description             // optional
- attributes              // validated type-specific attributes
- created_at, updated_at
- created_by / owner / lab_id where applicable
- archived_at             // optional, prefer soft deletion
```

Consider a separate alias/synonym table if the existing application supports names, alternative names, or searchable synonyms. Retain original names and identifiers.

### 2.3 Product (optional)

Commercial identity for a specific catalog offering of a material.

Suggested fields:

```text
products
- id
- material_id
- manufacturer_name (or manufacturer_id if a supplier entity exists)
- supplier_name (optional; may differ from manufacturer)
- catalog_number / reference_code
- product_name (optional)
- formulation_or_variant (optional)
- attributes (optional)
- created_at, updated_at
```

Examples:

- Tris base sold by manufacturer A under catalog code T123.
- The same Tris base sold by manufacturer B under a different catalog code.
- A specific commercial anti-GAPDH antibody product.

Do not put CAS/MW exclusively on Product; these describe chemical identity. Do not put supplier lot numbers on Material; those describe particular batches.

Products are **optional**: in-house-prepared PBS does not need a product or catalog number.

### 2.4 Batch / lot

Connects a material (and optionally a product) to a particular purchased lot or in-house preparation batch.

Suggested fields:

```text
batches
- id
- material_id
- product_id (nullable)
- lot_number / batch_code (nullable, but assign an internal unique identifier)
- origin_type               // e.g. purchased, prepared, derived, unknown
- received_at (optional)
- prepared_at (optional)
- prepared_by (optional)
- expires_at (optional)
- attributes (optional)
- created_at, updated_at
```

Invariants:

- A product, if set, must belong to the same material as the batch.
- A batch may have many physical stocks (e.g., aliquots).
- A home-prepared batch must be allowed without a commercial product.
- If the old model has no batch info, create a traceable placeholder batch instead of inventing a manufacturer lot.

### 2.5 Physical stock / container

Represents what occupies space in a storage location and what can be moved, consumed, aliquoted, depleted, discarded, or labeled.

Suggested fields:

```text
stocks
- id
- batch_id
- location_id (nullable only if the app supports unassigned/in-transit stock)
- internal_code / barcode (unique where applicable)
- container_type (optional)
- initial_quantity (nullable)
- current_quantity (nullable)
- quantity_unit (nullable)
- status                    // available, depleted, discarded, reserved, unknown...
- created_at, updated_at
```

A stock record is **one physical container or individually tracked unit**. Ten tubes of the same batch can be ten stock records. If your app supports bulk counts rather than tracking each tube, preserve that semantics and explicitly document it; avoid silently treating a “count of 10” as one tube.

Keep a clear distinction between **container capacity**, **initial fill**, and **remaining quantity** if these concepts exist. Never infer remaining quantity from nominal package size without evidence.

### 2.6 Location

Use an extensible parent-child hierarchy:

```text
locations
- id
- parent_id (nullable)
- name
- location_type    // building, room, fridge, freezer, shelf, box, position...
- created_at, updated_at
```

Example:

```text
Building A
  -> Room 204
     -> Fridge 2
        -> Shelf B
           -> Bottle of Tris (stock)
           -> Anti-GAPDH vial (stock)
           -> PBS bottle (stock)
```

Location queries should return **all stock types**, not only chemicals. If the app already has a functional location model, adapt/reuse it rather than create competing models. Preserve box/slot location if present.

---

## 3. Flexible, validated descriptors

Use a **relational core** for entity identity and relationships, plus a **schema-driven flexible field system** for material-type-specific descriptors. PostgreSQL `JSONB` is reasonable if already using PostgreSQL. For other databases, choose the native equivalent or a typed custom-field table as appropriate.

Suggested type configuration:

```json
{
  "key": "chemical",
  "label": "Chemical / compound",
  "schemaVersion": 1,
  "fields": [
    {
      "key": "cas_number",
      "label": "CAS number",
      "dataType": "string",
      "required": false,
      "searchable": true
    },
    {
      "key": "molecular_weight",
      "label": "Molecular weight",
      "dataType": "number",
      "unit": "g/mol",
      "required": false
    },
    {
      "key": "molecular_formula",
      "label": "Molecular formula",
      "dataType": "string",
      "required": false
    }
  ]
}
```

Material example:

```json
{
  "name": "Tris base",
  "type": "chemical",
  "attributes": {
    "cas_number": "77-86-1",
    "molecular_weight": 121.14,
    "molecular_formula": "C4H11NO3"
  }
}
```

### Descriptor requirements

- Support types: string, long text, number, boolean, date, enum/multiselect, and (when appropriate) sequence or structured composition.
- Distinguish *missing*, *not applicable*, and *unknown* when required by existing semantics.
- Validate both frontend **and backend** against the active type schema.
- Use canonical field keys and schema versions. Changes to field definitions must not reinterpret historical values silently.
- Use controlled vocabularies where appropriate (e.g., species, units, storage status), not free text for everything.
- Normalize or explicitly store units; avoid hard-coded unit conversions that are not scientifically valid (e.g., mass to volume without density/concentration).
- Keep important relationships outside arbitrary JSON: locations, products, batches, source stocks, permissions, attachments, stock movements.
- Allow custom user/lab-specific fields later without requiring a new database column for every field.
- Index commonly queried descriptors (e.g., CAS number, antibody target, primer name) as justified by actual query patterns.

Initial design can ship with **predefined schemas only**, provided the underlying approach can later support custom fields without redesign.

---

## 4. User experience requirements

### 4.1 Separate catalog and physical inventory

Provide two related conceptual views (they need not be separate top-level navigation items):

1. **Materials/catalog:** “What materials are known to this lab?” One record per reusable material definition; show type-specific information.
2. **Stock/inventory:** “What physical items do we have, and where?” One row per tracked stock/container, with location, quantity, lot/expiry, and status.

A material detail page should list its related products, batches, and physical stocks. A physical-stock detail page should identify its material and batch, and allow permitted actions (move, adjust quantity, dispose, etc.).

### 4.2 A mixed location table

When opening a fridge/shelf, show **all physical stocks** in that location, optionally including descendants depending on the view.

Default shared columns:

| Name | Type | Quantity | Location | Lot / batch | Expires | Status |
|---|---|---|---|---|---|---|
| Tris base | Chemical | 250 g | Fridge 2 / B | LOT-01 | 2028-04 | Available |
| Anti-GAPDH | Antibody | 80 µL | Fridge 2 / B | LOT-02 | 2027-01 | Available |
| PBS 1× | Solution | 500 mL | Fridge 2 / B | PREP-014 | 2026-12 | Available |

*The rows above are illustrative, not real application data.*

Do **not** force CAS, molecular weight, primer sequence, or antibody clone into the default mixed view. They are type-specific descriptors, accessible from item details or configurable table columns.

### 4.3 Type-specific forms

When the user creates a material:

1. Choose type (chemical, reagent, antibody, primer, solution, biological stock, other).
2. Search for an existing material to avoid duplication; otherwise create the material using type-specific fields.
3. Optionally associate an existing/new commercial product.
4. Record batch/lot information.
5. Create one or more physical stock containers and assign location(s).
6. Save; show the item in location inventory and material detail views.

Avoid requiring all steps for a material that is only being added to the catalog. A new stock should reuse existing material/product definitions where possible.

### 4.4 Tables, filtering, and columns

Support at least:

- Mixed **All inventory** view with common columns.
- Type-filtered **Chemicals**, **Antibodies**, **Primers**, etc.
- Location-filtered views, including fridge/freezer/shelf and nested descendants if appropriate.
- Search by name, alias, stock/barcode, catalog number, and relevant type-specific identifiers.
- Display type-specific descriptor columns in filtered views (e.g., CAS/MW for chemicals; target/clone for antibodies).
- In a mixed view with a custom type-specific column, show **blank/—** for non-applicable records, not a misleading value.

Saved user/team views and column customization are desirable **after the core migration**; implement them if already supported or reasonably within scope, but they should not block safe data migration.

### 4.5 Existing workflows must continue

Review and adapt (where present):

- Find/create/edit chemical; receive stock; transfer storage location.
- Inventory adjustment, depletion, disposal, aliquoting.
- Supplier catalog references and purchasing.
- Barcode/QR scans and labels.
- CSV import/export.
- Attachments, safety sheets, protocols, experiments, and links referring to old chemical records.
- Permissions, audit trails, and historical logs.

Use the app's existing visual design and interaction patterns; avoid unnecessary UI rewrites.

---

## 5. Traceability for prepared solutions and biological stocks

Design a relationship for deriving one batch/stock from other physical stocks. This may be implemented in a later UI phase, but the model should not preclude it.

Example:

```text
NaCl bottle (stock #031) -------+
KCl bottle (stock #084) --------+
Phosphate stock (stock #085) ---+--> PBS 1× preparation batch #014
Water source (optional) -------+          |
                                           +--> PBS 500 mL bottle (stock #201)
```

Suggested structure:

```text
batch_inputs / preparation_inputs
- id
- output_batch_id
- source_stock_id
- quantity_used (nullable)
- unit (nullable)
- role (nullable)
```

Optional additions when supported by the existing domain:

- Recipes and recipe versions.
- Preparation notes and protocol reference.
- Preparer, date, pH, final volume, measurements.
- Aliquot/derived-from relationship between physical stocks.
- Stock usage events and audit history.

**Important:** Source links are provenance, not a reason to mutate existing stock quantities automatically without a deliberate, validated consumption operation. If consumption is implemented, it must be transactional and auditable.

---

## 6. The critical part: migrate current chemical records safely

Treat the current database as the source of truth. Do **not** presume that old “chemical” rows are pure chemical definitions.

### 6.1 Classify existing records before mapping

Identify whether each legacy row represents:

- A **material definition** with no physical stock.
- A **commercial product** or catalog item.
- A **physical container** with amount/location.
- A **lot** with multiple units.
- A mixture of the above.

An old record can sometimes map to **one material + one optional product + one batch + one stock**. Multiple legacy rows may refer to the same material, but **do not automatically merge them based only on name or CAS**, since differences in formulation, hydrate/salt form, grade, stereochemistry, concentration, supplier, or other details can be meaningful.

### 6.2 Suggested additive migration sequence

1. **Baseline and backup:** Record row counts, important foreign-key relationships, representative legacy examples, and (if permitted) take a tested database backup/snapshot before risky operations.
2. **Introduce target tables:** Add material types, materials, products, batches, stocks, and necessary relationships alongside existing structures; reuse compatible tables that already exist.
3. **Seed initial types:** Chemical, reagent, antibody, primer, solution, biological_stock, other.
4. **Write an idempotent backfill:** Map legacy records into the new structure. Transfer known chemical descriptors to Material; manufacturer/catalog data to Product; supplier lot/expiry to Batch; quantity/container/location to Stock. Keep unrecognized legacy attributes in a documented `legacy_attributes`/equivalent or explicit extension data; do not discard them.
5. **Keep stable references:** Prefer retaining public identifiers where practical; otherwise maintain a `legacy_chemical_id -> target entity ID(s)` mapping table and update every dependent reference deliberately.
6. **Handle missing data honestly:** Do not invent lot numbers, quantities, expiry dates, units, locations, or manufacturers. Create internal batch IDs where needed; represent missing values as unknown/null with correct validation exceptions.
7. **Reconcile:** Compare record counts, field values, linked files, locations, quantities, and references pre/post migration. Make migrations rerunnable in dev/staging without duplicating data.
8. **Move application reads/writes:** Switch services/APIs and frontend workflows to the new model in a controlled order. If both old and new representations coexist temporarily, define the single source of truth or deliberate compatibility strategy to prevent divergence.
9. **Validate real workflows:** Run data and integration tests including legacy chemical search/editing, new non-chemical creation, location browsing, and stock movements.
10. **Retire legacy structures only in a later, explicitly reviewed migration:** Do not drop old data/tables until the new paths are verified, backups are available, and dependent code has been migrated.

### 6.3 Strong migration invariants

- Every legacy record remains accessible after migration, directly or via an unambiguous mapping.
- Every legacy stock quantity/unit/location/lot/expiry is preserved (including unknown states).
- All existing references remain resolvable; no silent broken links.
- No unwanted merging, splitting, or duplicate backfill on rerun.
- Tenant/lab ownership and permissions are preserved; cross-tenant references remain impossible.
- Audit records, historical attachments, inventory adjustments, and old IDs are retained or mapped.
- No deletion or destructive constraint changes until data quality checks pass.
- The app must not create a stock without a valid batch and material chain.

**If a legacy feature does not fit neatly into the proposed structure, favor a compatibility layer and an explicit migration note over data loss.**

---

## 7. Backend and data integrity

Implementation requirements:

- APIs/services support CRUD for Material, Product, Batch, Stock, and Location (respecting existing authorization conventions).
- Provide reliable queries for mixed inventory by location, type, owner/lab, expiry, product, and searchable identifiers.
- Validate type-specific `attributes` server-side; avoid accepting arbitrary, unvalidated JSON from clients.
- Enforce referential integrity: Stock -> Batch -> Material; Batch -> Product only when Product belongs to same Material.
- Use safe delete semantics: prevent deletion of materials/batches referenced by stock, or soft-delete/archive them.
- Keep stock mutations atomic where appropriate; avoid negative quantities unless deliberately supported, and protect against concurrent lost updates.
- Maintain an audit/event trail of moves, adjustments, aliquoting, and disposal if the app currently tracks them. Consider implementing one if operational traceability is a core requirement.
- Use consistent units and conversion rules; record quantity as numeric/decimal plus unit (not floating-point if exact decimal quantities matter).
- Index relevant foreign keys, names/identifiers, location ancestry queries, status, expiry, and high-traffic attribute searches.
- Respect organization/lab scoping and existing row-level permissions everywhere, including new lookup/search endpoints.

**Avoid** an enormous `inventory_items` table containing every field for every type as nullable columns. **Also avoid** isolated physical inventory tables per material type, since they make mixed-fridge views, stock tracking, and permissions unnecessarily complicated.

---

## 8. Concrete acceptance scenarios

Use actual fixtures or seed test data; do not rely only on screenshots.

1. **Legacy chemical:** An existing Tris record remains searchable, keeps its CAS/MW and manufacturer/catalog information where present, and preserves all physical stock/location information.
2. **Multiple products:** One Tris material can reference two commercial products from different manufacturers/catalog codes, with separate batches and bottles.
3. **Mixed fridge:** A location query returns a Tris bottle, an anti-GAPDH vial, and prepared PBS in the same table; all rows share the standard inventory columns.
4. **Antibody descriptors:** An antibody can store target, host, clonality/clone and can appear in the inventory without requiring CAS or molecular weight.
5. **Primer descriptors:** A primer can store sequence and modifications without requiring chemical-only fields; sequence validation is applied if configured.
6. **Homemade solution:** A PBS material has a preparation batch and physical bottle with no mandatory manufacturer or catalog number.
7. **Glycerol stock:** A biological stock can record strain/genotype/plasmid and physical freezer location.
8. **Aliquots:** Multiple physical tubes can reference one batch without duplicating its shared identity; each has its own barcode, quantity, and location.
9. **Multiple locations:** Stocks of one material are distributed across two storage locations; a material catalog view shows the material once, while inventory shows all stocks.
10. **Safe migration:** Every old chemical record and its references remain accessible; repeat backfill creates no duplicates.
11. **Permissions:** Users cannot see or edit materials/stocks belonging to labs/tenants they are unauthorized to access.
12. **Stock movement:** Moving a tube updates its location correctly without changing material identity, product, or batch.
13. **Not-applicable fields:** The mixed table does not require CAS/MW for an antibody and renders missing type-specific columns appropriately.
14. **Audit/history:** Existing history remains readable and new inventory actions follow existing audit conventions.

---

## 9. Recommended implementation order

### Phase A — Foundation (must implement)

- Inspect repository, document current-state mapping and migration plan.
- Implement target model and initial type schemas.
- Add safe and rerunnable legacy-data migration/backfill.
- Update backend read/write paths with compatibility handling.
- Implement material catalog and unified stock/inventory queries.
- Adapt create/edit/detail and location pages to show mixed stock and type-specific fields.
- Preserve and test all existing chemical workflows.

### Phase B — Usability (implement after foundation is stable)

- Customizable table columns and saved views.
- More advanced filters and indexing for typed fields.
- Bulk imports and multi-aliquot creation.
- Barcode/QR label improvements.
- Type-schema administration and custom fields (with versioning/validation).

### Phase C — Scientific provenance (design for now, implement when appropriate)

- Recipes and recipe versions for prepared solutions.
- Preparation input/source lineage and controlled stock consumption.
- Derived stocks and aliquot lineage.
- Inventory alerts, reorder thresholds, advanced audit/reporting.

If scope is limited, **finish Phase A fully rather than doing superficial pieces of all phases**.

---

## 10. What I expect you to deliver

When finished, provide:

1. A summary of the **actual schema and architecture implemented**, with a short explanation of any deviation from this specification.
2. The database migrations and idempotent backfill scripts.
3. A legacy-to-new-field/entity **mapping document** and reconciliation results (record counts, exceptions, unresolved data).
4. Updated models, services/APIs, validations, views/forms, search, and location inventory queries.
5. Tests covering the acceptance scenarios and the actual test commands/results.
6. A list of existing workflows verified and any remaining compatibility limitations.
7. Rollout instructions (backup, migrate, validate, switch application, monitor) and a realistic rollback strategy. Explicitly state when rollback of *new writes* would require special handling or data conversion; do not claim a reversible migration if it is not.
8. Documentation describing how to add another material type and its descriptor schema without modifying the core stock model.

## 11. Decisions to make using repository evidence

The following are intentionally **not** dictated by this brief. Decide after inspecting the app, record the decision, and keep compatibility:

- Whether product/manufacturer is a separate normalized entity or a straightforward optional table.
- Whether custom descriptors use JSONB, typed EAV/custom-field values, or another database-native representation.
- Whether existing stock/location/audit tables should be reused or incrementally adjusted.
- Whether the initial UI uses separate catalog/inventory navigation or a unified module with tabs.
- Whether batch provenance is implemented immediately or added after the safe schema migration.
- How the public API retains compatibility with old `/chemicals` endpoints, if they exist.

## 12. Non-negotiable guiding principle

> **A material answers “What is this?”, a product answers “Which commercial offering?”, a batch answers “Which lot or preparation?”, and a stock answers “Which actual bottle/tube is here?”**
>
> Each physical stock belongs to the same unified inventory, regardless of whether it contains a chemical, reagent, antibody, primer, prepared solution, or biological stock. Descriptors depend on type; the inventory and location system does not.

**Start by inspecting and mapping the current application. Then implement the safest practical migration, run tests, and report exactly what changed and what remains.**
