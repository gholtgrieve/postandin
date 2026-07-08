// GroupDO — one Durable Object instance per group, addressed by the caller via
// env.GROUP_DO.idFromName(slug) where slug = groupName.trim().lower() + "|" +
// password.trim().lower(). Cloudflare serializes all calls to a given DO
// instance, so the create/join/leave/rsvp races that used to happen against
// the shared group:<slug> / rsvp:<slug> KV keys can no longer occur — there's
// no window between a read and the following write for another request to
// slip in.
//
// Storage layout (ctx.storage):
//   groupName  string
//   members    [{ id, displayName }, ...]
//   rsvp       { [sessionKey]: [displayName,...] }
//   migrated   bool — set once this instance has pulled in (and deleted) its
//              legacy KV records; see _ensureMigrated below.
//
// Lazy migration: nothing runs a batch job over existing groups. Each group's
// DO instance seeds itself from the legacy group:<slug> / rsvp:<slug> KV keys
// (via the GROUPS binding, pointed at the same namespace the Pages project's
// GROUPS binding uses) the first time any method is called on it, then
// deletes those two keys so the DO is the sole source of truth from then on.
// Groups nobody touches after this deploy simply never migrate.

import { DurableObject } from 'cloudflare:workers';

const STALE_CUTOFF_MS = 24 * 60 * 60 * 1000;

export class GroupDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    // Dedupes concurrent first-touch calls within the same DO instance so two
    // requests that arrive before the 'migrated' flag is persisted don't both
    // read the legacy KV keys and double-apply them.
    this._migratingPromise = null;
  }

  async _ensureMigrated(slug) {
    if (await this.ctx.storage.get('migrated')) return;
    if (!this._migratingPromise) this._migratingPromise = this._migrate(slug);
    await this._migratingPromise;
  }

  async _migrate(slug) {
    // Re-check under the in-memory lock in case another call already finished
    // migrating while we were waiting to acquire it.
    if (await this.ctx.storage.get('migrated')) return;

    const [rawGroup, rawRsvp] = await Promise.all([
      this.env.GROUPS.get(`group:${slug}`),
      this.env.GROUPS.get(`rsvp:${slug}`),
    ]);

    const group = rawGroup ? JSON.parse(rawGroup) : { groupName: '', members: [] };
    const rsvp  = rawRsvp  ? JSON.parse(rawRsvp)  : {};

    await this.ctx.storage.put({
      groupName: group.groupName ?? '',
      members: group.members ?? [],
      rsvp,
      migrated: true,
    });

    await Promise.all([
      this.env.GROUPS.delete(`group:${slug}`),
      this.env.GROUPS.delete(`rsvp:${slug}`),
    ]);
  }

  async create(slug, groupName, displayName) {
    await this._ensureMigrated(slug);

    const members = (await this.ctx.storage.get('members')) ?? [];
    if (members.length > 0) {
      return { created: false, error: 'A group with that name and password already exists.  Choose a new group name.' };
    }

    const memberId = crypto.randomUUID();
    await this.ctx.storage.put({
      groupName,
      members: [{ id: memberId, displayName }],
    });

    return { created: true, memberId, groupName };
  }

  async join(slug, displayName) {
    await this._ensureMigrated(slug);

    const [groupName, members] = await Promise.all([
      this.ctx.storage.get('groupName'),
      this.ctx.storage.get('members'),
    ]);

    if (!(members && members.length) && !groupName) {
      return { joined: false, error: 'Group not found — check the group name and password' };
    }

    const memberId = crypto.randomUUID();
    const newMembers = [...(members ?? []), { id: memberId, displayName }];
    await this.ctx.storage.put('members', newMembers);

    return { joined: true, memberId, groupName };
  }

  async leave(slug, memberId) {
    await this._ensureMigrated(slug);

    const members = (await this.ctx.storage.get('members')) ?? [];
    const leavingMember = members.find(m => m.id === memberId);
    const filtered = members.filter(m => m.id !== memberId);
    await this.ctx.storage.put('members', filtered);

    // Purge this member's display name from all RSVP lists on leave — same
    // removal setRsvp() already does for an ordinary "not going" toggle.
    // KNOWN LIMITATION: if another current member shares this exact display
    // name (no uniqueness is enforced anywhere), this can also remove their
    // RSVP for the same sessions — this mirrors an identical, pre-existing
    // collision risk in setRsvp()'s own going:false branch, not a new one.
    if (leavingMember?.displayName) {
      const rsvp = (await this.ctx.storage.get('rsvp')) ?? {};
      for (const sk of Object.keys(rsvp)) {
        rsvp[sk] = rsvp[sk].filter(n => n !== leavingMember.displayName);
      }
      await this.ctx.storage.put('rsvp', rsvp);
    }

    return { ok: true };
  }

  async upsertMember(slug, memberId, displayName) {
    await this._ensureMigrated(slug);

    const members = (await this.ctx.storage.get('members')) ?? [];
    const existing = members.find(m => m.id === memberId);
    if (existing) {
      if (displayName) existing.displayName = displayName;
    } else {
      members.push({ id: memberId, displayName: displayName || '' });
    }
    await this.ctx.storage.put('members', members);

    return { ok: true };
  }

  async getRsvp(slug) {
    await this._ensureMigrated(slug);
    return (await this.ctx.storage.get('rsvp')) ?? {};
  }

  async setRsvp(slug, sessionKey, memberId, displayName, going) {
    await this._ensureMigrated(slug);

    // memberId used to be accepted but not verified, allowing anyone who knew
    // the group name/password to RSVP under an invented display name that
    // didn't belong to any real member.
    const members = (await this.ctx.storage.get('members')) ?? [];
    if (!members.some(m => m.id === memberId)) {
      return { error: 'Not a member of this group' };
    }

    const rsvp = (await this.ctx.storage.get('rsvp')) ?? {};

    if (!rsvp[sessionKey]) rsvp[sessionKey] = [];
    if (going) {
      if (!rsvp[sessionKey].includes(displayName)) rsvp[sessionKey].push(displayName);
    } else {
      rsvp[sessionKey] = rsvp[sessionKey].filter(n => n !== displayName);
    }

    pruneStale(rsvp);

    await this.ctx.storage.put('rsvp', rsvp);

    return { going: rsvp[sessionKey] ?? [] };
  }

  // Used by the scheduler's backup job (see scheduler/src/backup.js) since
  // migrated groups' data lives only in this DO's storage, not in KV.
  // Read-only: unlike every other method here, this must NOT trigger
  // migration — a backup job should observe state, not mutate it. A group
  // whose legacy KV keys still exist is already captured by the KV backup
  // file, so this falls back to reading group:<slug>/rsvp:<slug> from
  // this.env.GROUPS directly (same parsing shape as _migrate) instead of
  // calling _ensureMigrated().
  async export(slug) {
    if (await this.ctx.storage.get('migrated')) {
      return {
        slug,
        groupName: await this.ctx.storage.get('groupName'),
        members: await this.ctx.storage.get('members'),
        rsvp: await this.ctx.storage.get('rsvp'),
        source: 'do',
      };
    }

    const [rawGroup, rawRsvp] = await Promise.all([
      this.env.GROUPS.get(`group:${slug}`),
      this.env.GROUPS.get(`rsvp:${slug}`),
    ]);

    const group = rawGroup ? JSON.parse(rawGroup) : { groupName: '', members: [] };
    const rsvp  = rawRsvp  ? JSON.parse(rawRsvp)  : {};

    return {
      slug,
      groupName: group.groupName ?? '',
      members: group.members ?? [],
      rsvp,
      source: 'kv',
    };
  }
}

// Entries whose session start is >24h in the past are pruned on every RSVP
// write so the map stays bounded without requiring explicit TTL management.
function pruneStale(map) {
  const cutoff = Date.now() - STALE_CUTOFF_MS;
  for (const sk of Object.keys(map)) {
    const parts = sk.split('|');
    if (parts.length < 3) continue;
    const sessionStart = new Date(`${parts[1]}T${parts[2]}:00`);
    if (!isNaN(sessionStart) && sessionStart.getTime() < cutoff) {
      delete map[sk];
    }
  }
}

// This Worker only exists to host the GroupDO class — it isn't meant to serve
// HTTP directly. The Pages project talks to it exclusively through the
// GROUP_DO Durable Object binding.
export default {
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};
