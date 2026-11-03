# Council readiness review — BioSCom `visual` branch → VM rollout (2026-11-03)

Synthesis input: multi-model council (councillor-alpha, councillor-beta, councillor-gamma) reviewing the
entire branch statically, then `council` synthesizing consensus. Council verdict: **NO-GO as-is; GO after
six small, individually-tested patches plus a pre-deploy verification pass.** The green gate at review
time (server 123/123, web 9/9, shared 44+1) is insensitive to every top finding — the suites never test
foreign-group authz, post-merge parity, or boot-time idempotency. Convergence note: all Tier-1 items
were found independently by two seats with line-level agreement.

## Tier 1 — release blockers (fix each as its own commit)

| # | Finding | Location | Status |
|---|---|---|---|
| 1 | `POST /deepfreezers/:id/racks`, `/boxes` never call `guard(user, groupId)` nor `checkSharedContainerAccess` → any writer of any lab mutates every freezer in any lab | `server/src/inventory/routes.ts:106–186` | FIXED (guard via `checkSharedContainerAccess` + cross-lab denial test in `deepfreezer-racks.test.ts`) |
| 2 | every material merge permanently trips parity/parity says `ok:false` after merge | `server/src/inventory/assemble.ts`, `material-merge.test.ts` | FIXED (merge-aware parity via legacy map, `parentId` in chemical canonical entry, post-merge parity test proves no poison + true drift still fails) |
| 3 | boot-only reconcile/parity/hoist once; mirror failure swallowed without savepoint; stale `DEPLOY.md` rollback story; corrupt docs skipped | migrate/doc/Deploy paths noted | FIXED (unconditional `ensureBackfilled`+`ensureParityChecked` every boot, mirror savepoint contract inside `createMutator`, rewritten `DEPLOY.md` rollback section + regression test in `migrations.test.ts`) |
| 4 | shared-containers listing scans only `rooms` — hoisted shared deepFreezers vanished for receiving lab | `server/src/inventory/shared.ts` | FIXED (root-deepFreezers scan + sharing test in `deepfreezer-racks.test.ts`) |
| 5 | pseudo-room facade silently swallows roomId-to-freezer writes on placement flows | `server/src/inventory/doc.ts` + room/container endpoints | FIXED (pseudo marker + `isPseudoRoom` guard; rooms PUT/DELETE and containers POST throw 404; `resolveStockTarget` enforces pseudo only when `containerId === freezer.id`; negative tests in `deepfreezer-racks.test.ts`) |
| 6 | barcode uniqueness scans only rooms→containers→shelves; missing room-direct/container-direct/deepFreezers/boxes | routes + bulk scanners | FIXED (single `findBarcodeOwner` walker in `doc.ts` covering all levels/tiers for create/edit/bulk; deepfreeze-root surface proven in `barcode.test.ts`) |

## Tier 2 — pre-deploy verifications on a production copy

1. Full dry-run of hoist + backfill + parity on a copy of prod: require zero `corrupt (json|zod)` anomaly lines and reconcile every `[inventory-backfill] relocated …` line.
2. Confirm on `main` whether the legacy zod chain tolerates the root `deepFreezers` key on OLD-build writes (rollback direction: unconfirmed).
3. Census production `rackPositions` values: any slot index ≥ 32 renders invisible in the fixed 32-slot grid.
4. Census: does any group currently share a deep freezer in production?
5. Snapshot restore drill: restore the pre-refactor backup to prove the rollback path stays snapshot-only.
6. Product sign-off: unlike other mutations, `adjust-qty` bypasses the reader check when `mirrorGroupId` is set on shared containers — verify this asymmetry is intentional.
7. Document the stale-bundle window (cached old SPA + hosted doc = 404s on freezer navigation until hard refresh).

## Tier 3 — post-rollout backlog

- Consolidate all traversal walkers (barcode scan, chemical-stack resolution, canonical builders, shared-containers scan, bulk scanner, counter functions) into one iterator over rooms + deepFreezers × levels.
- `catalog.ts:71–73` four-level path labeling.
- Schema hardening: composite keys for upsert collisions, `PRAGMA foreign_keys` activation, unique barcode index once coverage is consolidated.
- Non-atomic PUT-then-POST edit in flattened form (`ops.ts:252–292`) — failed move leaves edited fields in the old location.
- Per-user theme/nav prefs from localStorage to server profile (expect "my settings reset" tickets).

## Notes on council weighting

- Seven severity ratings rank-promoted by the council: shared-freezer listing, pseudo-room guard, and barcode coverage were inside beta's "below the line" list and gamma's top-3 — council promoted them by double-discovery + silent-data-loss/regression semantics + trivial fix cost.
- Single-source finding #1 (the freezer mutation authz hole) is the cleanest precisely-stated defect with the cheapest verification: the negative test is the adjudication.
- Both seats were static-only; nothing was executed; no production data was inspected.
