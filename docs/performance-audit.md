# Performance Audit

Date: 2026-09-06

## Purpose and scope

This document records a static performance review of the `openmrs-esm-core`
monorepo. The review focused on runtime behavior in shared state management,
React hooks, extension rendering, offline-patient processing, and patient banner
rendering.

The findings below are based on source inspection. They should be confirmed with
unit tests and browser profiling against a representative OpenMRS distribution
and realistic data volumes before and after each change.

## Summary

| Priority | Area | Finding | Likely effect |
| --- | --- | --- | --- |
| High | State subscriptions | A selected value is compared with the previous full store state | Components can update after unrelated store changes |
| Medium | Extension hooks | A deprecated hook compares against an initial, stale ID array | Repeated renders after unrelated extension-store changes |
| Medium | Offline patients | Patient and synchronization records are repeatedly scanned | Processing grows quadratically as offline data grows |
| Low | Patient banner | Patient lists are sorted during rendering and in place | Repeated sorting and mutation of fetched data |

## Finding 1: selected store values are compared incorrectly

**Priority:** High

**Affected code:**

- [`packages/framework/esm-state/src/state.ts`](../packages/framework/esm-state/src/state.ts)
- [`packages/framework/esm-react-utils/src/useStore.ts`](../packages/framework/esm-react-utils/src/useStore.ts)
- [`packages/framework/esm-react-utils/src/useExtensionSlotStore.ts`](../packages/framework/esm-react-utils/src/useExtensionSlotStore.ts)

### Current behavior

The selector form of `subscribeTo` calculates the selected value for the current
state, but compares it with the complete previous store state:

```ts
return store.subscribe((state, previous) => {
  const current = selector(state);

  if (!shallowEqual(previous, current)) {
    handler(current);
  }
});
```

When a selector returns only one portion of the store, `previous` and `current`
usually have different shapes. The equality check therefore fails even when the
selected portion has not changed.

`useStore` uses this subscription function. Extension slots are especially
relevant because `useExtensionSlotStore` selects one slot from the shared
extension store. Updating a different slot can consequently notify and render
the current slot.

There is also subscription churn when callers pass a selector defined during
render. `useStore` includes the selector identity in its effect dependencies, so
a new function causes the subscription to be removed and recreated.

### Recommended change

Compare selected values on both sides:

```ts
return store.subscribe((state, previous) => {
  const current = selector(state);
  const previousSelected = selector(previous);

  if (!shallowEqual(previousSelected, current)) {
    handler(current);
  }
});
```

Where practical, callers should also provide stable selectors. A longer-term
option is to implement the hook with `useSyncExternalStore`, preserving selector
and equality semantics explicitly.

### Verification

Add tests demonstrating that:

1. Changing an unselected property does not notify the subscriber.
2. Changing the selected property notifies it exactly once.
3. Updating one extension slot does not render components subscribed to another
   slot.
4. Mounting and rerendering a consumer does not leak multiple subscriptions.

Use the React Profiler to compare commit counts while repeatedly updating an
unrelated extension slot.

## Finding 2: stale state in `useAssignedExtensionIds`

**Priority:** Medium

**Affected code:**

- [`packages/framework/esm-react-utils/src/useAssignedExtensionIds.ts`](../packages/framework/esm-react-utils/src/useAssignedExtensionIds.ts)

### Current behavior

The subscription callback closes over the initial `ids` value because the effect
has an empty dependency list:

```ts
useEffect(() => {
  return getExtensionStore().subscribe((state) => {
    const newIds = state.slots[slotName]?.assignedExtensions.map((e) => e.id) ?? [];
    if (!isEqual(newIds, ids)) {
      setIds(newIds);
    }
  });
}, []);
```

If the initial value is empty and the slot later contains extensions, subsequent
store updates continue comparing new IDs with that original empty array. This
can install a fresh array and render the consumer even when the IDs did not
change. The hook also keeps using the original `slotName` if the argument changes.

### Recommended change

The API is deprecated, so consumers should migrate to `useAssignedExtensions`.
If it must remain supported, use a functional state update and include
`slotName` in the dependencies:

```ts
useEffect(() => {
  return getExtensionStore().subscribe((state) => {
    const newIds = state.slots[slotName]?.assignedExtensions.map((e) => e.id) ?? [];
    setIds((currentIds) => (isEqual(currentIds, newIds) ? currentIds : newIds));
  });
}, [slotName]);
```

### Verification

Count component renders while updating an unrelated slot. Once the selected
slot is stable, its consumer should not render again.

## Finding 3: quadratic offline-patient processing

**Priority:** Medium

**Affected code:**

- [`packages/apps/esm-offline-tools-app/src/hooks/offline-patient-data-hooks.ts`](../packages/apps/esm-offline-tools-app/src/hooks/offline-patient-data-hooks.ts)

### Current behavior

For every offline patient, the hook searches the fetched patient array with
`find()` and scans the synchronization-item array with `filter()`. The registered
patient calculation similarly calls `find()` for each synchronization item.

This produces approximately `O(P * S)` work, where `P` is the patient count and
`S` is the synchronization-item count. The effect becomes visible as both
collections grow.

The `useMergedSwr` helper does not provide effective memoization because callers
pass a new merge callback and a new response array on each render. Its expensive
merge work can therefore run again on ordinary renders. The use of Lodash
`merge()` may also mutate the cached patient object supplied as its first
argument.

### Recommended change

- Index patients by patient ID using a `Map`.
- Group synchronization items by patient ID in a second `Map`.
- Derive both maps with `useMemo` from the underlying `data` references.
- Merge into a new object rather than the cached SWR object.
- Replace `useMergedSwr` dependencies with stable data and status fields, or
  memoize the merge callback and response collection.

This changes the lookup portion from quadratic to approximately linear time.

### Verification

Benchmark at minimum with 10, 100, 1,000, and 5,000 offline patient and sync
records. Capture calculation time and React commit duration. Also verify that
the original SWR patient objects are unchanged after merging.

## Finding 4: in-place sorting during patient-banner rendering

**Priority:** Low

**Affected code:**

- [`packages/framework/esm-styleguide/src/patient-banner/contact-details/patient-banner-contact-details.component.tsx`](../packages/framework/esm-styleguide/src/patient-banner/contact-details/patient-banner-contact-details.component.tsx)

### Current behavior

`PatientLists` calls `cohorts.sort()` inside render. `Array.prototype.sort()`
mutates the fetched array, and the sort is repeated each time the component
renders.

### Recommended change

Copy and memoize the sorted collection:

```ts
const sortedLists = useMemo(
  () => [...cohorts].sort((a, b) => parseDate(a?.startDate).getTime() - parseDate(b?.startDate).getTime()),
  [cohorts],
);
```

The component can then render `sortedLists.slice(0, 3)`.

### Verification

Add a test asserting that rendering does not alter the order of the supplied
cohort array. A profiler comparison should show that sorting occurs only when
the cohort data changes.

## Recommended implementation order

1. Correct `subscribeTo` and add selector-isolation regression tests.
2. Stabilize extension-store selection and verify extension-slot render counts.
3. Replace repeated offline-patient scans with indexed lookups.
4. Repair or remove the deprecated extension-ID subscription hook.
5. Memoize patient-list sorting.
6. Run unit tests, TypeScript checks, and a browser profiling scenario.

## Suggested commands

Once dependencies and Yarn are available:

```sh
yarn turbo run test --filter="@openmrs/esm-state"
yarn turbo run test --filter="@openmrs/esm-react-utils"
yarn turbo run test --filter="@openmrs/esm-offline-tools-app"
yarn turbo run test --filter="@openmrs/esm-styleguide"
yarn turbo run typescript
```

## Review limitations

The review was static and did not include production bundle analysis, browser
traces, backend response timing, network throttling, or measurements from a live
OpenMRS environment. Targeted tests could not be run in the review environment
because Yarn was unavailable and Corepack could not initialize its cache there.
The high-priority selector comparison is directly evident from the code, while
the user-visible magnitude of every finding depends on distribution size, store
update frequency, device capability, and data volume.
