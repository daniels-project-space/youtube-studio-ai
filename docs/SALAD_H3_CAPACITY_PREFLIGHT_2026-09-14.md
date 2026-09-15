# Salad H3 capacity preflight — 14 September 2026

This was a read-only provider check. It created, started, stopped, or deleted no
Salad resources and submitted no inference jobs.

## Observed state

- Organization: `bananajoeinc`
- Project: `default`
- Exact class: `RTX 5090 (32 GB)` (`851399fb-7329-4195-a042-d6514b28cf33`)
- H3 resources: 8 CPU, 128 GiB memory, 100 GiB storage
- Shared account occupancy: `0/3` slots
- Organization quota: `0/10` replicas used
- R2 model manifest and all 5 declared files: verified (44,426,778,471 bytes)
- Exact class price: medium `$0.417/hr`; high price is present in the class catalog

Availability returned `0 medium / 0 high` for the H3 resource profile with the
existing `cn` filter and with the read-only comparison queries for all, `us`,
`ca`, `de`, `nl`, and `sg`. The batch must remain held; changing region,
memory, or GPU class would violate the sealed H3 quality contract.

## Fresh recheck

At `2026-09-14T05:05:09Z`, the same vault-backed read-only probe again found
`0 medium / 0 high` H3 slots, with `0/3` occupied slots and `0/10` replicas
used. The exact RTX 5090 class and both prices were still present. This confirms
that the high-priority escape hatch is wired but has no capacity to unlock at
this observation; no paid request was attempted.

At `2026-09-14T07:05:06Z`, a second vault-backed read-only probe observed the
same H3 result (`0 medium / 0 high`, `0/3` occupied, `0/10` replicas). The
3090 comparison lanes had capacity, but the exact H3 5090 lane did not; the
controller therefore remained held and issued no paid request. This is the
expected fail-closed behavior: high is selected only when it actually unlocks
the complete wave, not merely because the medium tier is empty.

At `2026-09-14T07:19:24Z`, the latest vault-backed probe again observed
`0 medium / 0 high` H3 slots, `0/3` occupied, and `0/10` replicas. The exact
RTX 5090 class remained priced at medium `$0.417/hr` and high, but neither
tier could unlock a wave, so the route stayed held and made no paid request.

At `2026-09-14T08:07:15Z`, a fresh vault-backed read-only probe observed the
same exact H3 result: `0 medium / 0 high`, `0/3` occupied, and `0/10` replicas.
The 3090 comparison lanes had supply (`117` medium ERNIE, `20` medium Music3),
but those lanes are not valid substitutes for the sealed H3 5090 runtime. The
controller therefore remained held; no GPU mutation or inference request was
made.

## Runtime behavior

`assertMiniMaxH3SaladCapacity()` checks the exact desktop class, account-wide
three-GPU lease, and the current market snapshot before any paid request. It
selects medium first. If medium cannot admit the whole wave, it may select the
same exact class at high priority only when high pricing and enough high slots
are both present. The selected tier is included in the worker request and must
match the immutable receipt. If neither tier has capacity, the worker is not
called and the batch remains held for a later retry/reconciliation.

This is capacity admission, not a reservation or a guarantee of future Salad
supply. Native H3 output quality, worker-image digest, and durable worker
deduplication remain separate qualification gates.

## Locality fallback — 15 September 2026

The admission check first asks for the configured preferred `cn` market. When
that snapshot cannot admit the complete wave at either eligible tier, it makes
one additional read-only request without `country_codes` and uses the global
snapshot only when it reports more matching medium or high slots. This handles
the provider's documented distinction between currently-online regional nodes
and the wider network without turning a locality miss into an unbounded poll or
silently changing the exact GPU/resource contract. Medium remains the first
choice; high is selected only when the global or preferred snapshot has enough
high-tier slots and a valid exact-class price.

The global read is still an estimate, not a reservation. The durable account
lease is checked before and after the market read, so an overlapping wave keeps
the order held even when the provider snapshot looks healthy.

## Operational follow-up — 15 September 2026

The repository-side `salad-runtime-preflight` was run again after the H3
caller migration. It could not authenticate to the shared vault, so it made no
Salad API request and performed no GPU mutation or inference call. This run is
not evidence of current provider availability and must not overwrite the last
authenticated `0 medium / 0 high` observation above.

The production route therefore remains fail-closed: it uses the durable
organization-wide lease to prevent local check-then-dispatch races, then reads
the exact 5090 class and current tier counts immediately before dispatch. If
medium cannot fit the complete wave, the same exact class may be admitted at
high only when high has a valid price and enough slots; otherwise the order is
held for a later recheck. Salad's availability estimate is not treated as a
provider reservation; a true supply increase still requires Salad capacity
support or a later authenticated availability observation.
