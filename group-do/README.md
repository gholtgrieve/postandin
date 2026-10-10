# Group Durable Object Worker

This independently deployed Worker hosts the `GroupDO` class used by Ice Time
Groups for membership and RSVPs. It is not part of the Cloudflare Pages
deployment.

## Boundaries

- One Durable Object instance represents one group.
- Pages Functions reach it through the `GROUP_DO` Durable Object binding.
- Client-supplied member IDs must be checked against stored membership before a
  write.
- Legacy KV group and RSVP records migrate lazily when a group is used.

The scheduler's Durable Object export is best-effort because Cloudflare does not
provide enumeration of all instances, and the repository has no complete import
path. See [Ice Time and Groups operations](../docs/operations/ice-time-and-groups.md).

## Deployment

Changes require an explicitly authorized `wrangler deploy` from this directory.
A push to `main` deploys Pages but does not deploy this Worker.

Verify current bindings and migration configuration in `wrangler.toml` before a
deployment. Never place production secrets or private identifiers in this file
or other tracked documentation.
