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
