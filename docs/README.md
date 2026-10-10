# Post & In documentation

This directory contains the current product, platform, and operational
documentation for Post & In.

Post & In has three core products: **Ice Time**, **Coach Profiles**, and
**Gear Exchange**. Seattle Junior Mets 16U AA pages and the Felix Holtgrieve
profile share the repository and hosting for convenience, but they are not core
products. Their documentation lives under [`asides/`](asides/README.md).

## Documentation map

### Core products

- [Ice Time](core/ice-time.md)
- [Coach Profiles](core/coaches.md)
- [Gear Exchange](core/gear-exchange/README.md)

### Shared platform

- [Architecture](platform/architecture.md)
- [Deployment topology](platform/deployment.md)
- [Routing and search visibility](platform/routing-and-search.md)
- [Design system](platform/design-system.md)
- [Editorial voice](platform/editorial-voice.md)
- [Development and testing](platform/development-and-testing.md)
- [Documentation policy](platform/documentation-policy.md)

### Operations

- [Ice Time and Groups operations](operations/ice-time-and-groups.md)
- [Gear deployment and rollback](operations/gear-exchange/gear-launch-runbook.md)
- [Gear backup and recovery](operations/gear-exchange/gear-lean-backup.md)
- [Gear scheduled maintenance](operations/gear-exchange/gear-production-maintenance.md)

### Hosted asides

- [Hosted asides policy](asides/README.md)
- [Seattle Junior Mets 16U AA](asides/seattle-junior-mets/README.md)
- [Felix Holtgrieve profile](asides/felix-profile/README.md)

### Historical material

The [`archive/`](archive/README.md) directory contains superseded implementation
plans and development-increment records. It can explain why a
decision was made, but it is not current operating guidance.

## Sources of truth

| Subject | Canonical source |
|---|---|
| Implementation and review rules | Root `AGENTS.md` and `CLAUDE.md` |
| Current code behavior | Code and checked-in configuration |
| Product behavior and boundaries | `docs/core/` |
| Shared architecture and conventions | `docs/platform/` |
| Operational procedures | `docs/operations/` and component README files |
| Past decisions and release evidence | `docs/archive/` and Git history |
| Product priorities | Owner direction; do not infer them from archived plans |

When documentation conflicts with code, verify the implementation and correct
the owning current document. Do not update several copies of the same fact.
