import { describe, expect, it } from 'vitest';
import { resolveAddress, wouldCreateLoop, type DomainRouting } from './mail-routing';

/**
 * Alias resolution.
 *
 * The case that matters is the cycle. `sales -> team -> sales` is two sensible
 * edits made months apart by two different people. Postfix detects it at
 * delivery and bounces, which means the message was already accepted: the sender
 * believes it was sent, the recipient never sees it, and the evidence is in a
 * log nobody reads. Refusing to create the cycle is the only version a customer
 * ever understands.
 */
const routing = (
  mailboxes: string[],
  aliases: Record<string, string[]> = {},
): DomainRouting => ({
  mailboxes: new Set(mailboxes),
  aliases: new Map(Object.entries(aliases)),
});

const domains = (entries: Record<string, DomainRouting>) => new Map(Object.entries(entries));

describe('resolving an address', () => {
  const map = domains({
    'northwind.test': routing(['asha', 'vikram'], {
      sales: ['asha@northwind.test', 'vikram@northwind.test'],
      info: ['sales@northwind.test'],
      offsite: ['someone@elsewhere.test'],
      mixed: ['asha@northwind.test', 'someone@elsewhere.test'],
    }),
  });

  it('delivers a mailbox to itself', () => {
    expect(resolveAddress('asha@northwind.test', map).deliverTo).toEqual(['asha@northwind.test']);
  });

  it('expands an alias to its destinations', () => {
    expect(resolveAddress('sales@northwind.test', map).deliverTo).toEqual([
      'asha@northwind.test',
      'vikram@northwind.test',
    ]);
  });

  it('follows an alias that points at another alias', () => {
    expect(resolveAddress('info@northwind.test', map).deliverTo).toEqual([
      'asha@northwind.test',
      'vikram@northwind.test',
    ]);
  });

  /** Where mail leaves WebEdge is worth reporting separately from where it lands. */
  it('separates external destinations from local ones', () => {
    const result = resolveAddress('mixed@northwind.test', map);
    expect(result.deliverTo).toEqual(['asha@northwind.test']);
    expect(result.external).toEqual(['someone@elsewhere.test']);
  });

  it('reports an address that delivers nowhere as delivering nowhere', () => {
    const result = resolveAddress('nobody@northwind.test', map);
    expect(result.deliverTo).toEqual([]);
    expect(result.external).toEqual([]);
    expect(result.loop).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(resolveAddress('SALES@Northwind.Test', map).deliverTo).toEqual([
      'asha@northwind.test',
      'vikram@northwind.test',
    ]);
  });

  it('returns nothing for a malformed address rather than throwing', () => {
    expect(resolveAddress('not an address', map).deliverTo).toEqual([]);
    expect(resolveAddress('@northwind.test', map).deliverTo).toEqual([]);
  });

  it('treats an unhosted domain as external', () => {
    expect(resolveAddress('someone@elsewhere.test', map).external).toEqual([
      'someone@elsewhere.test',
    ]);
  });
});

describe('catch-all', () => {
  const map = domains({
    'northwind.test': routing(['asha'], {
      '*': ['asha@northwind.test'],
      sales: ['asha@northwind.test'],
    }),
  });

  it('is used only when nothing else matches', () => {
    const named = resolveAddress('asha@northwind.test', map);
    expect(named.viaCatchAll).toBe(false);

    const alias = resolveAddress('sales@northwind.test', map);
    expect(alias.viaCatchAll).toBe(false);

    const unknown = resolveAddress('anything-at-all@northwind.test', map);
    expect(unknown.viaCatchAll).toBe(true);
    expect(unknown.deliverTo).toEqual(['asha@northwind.test']);
  });
});

describe('loops', () => {
  it('finds a two-step cycle', () => {
    const map = domains({
      'northwind.test': routing([], {
        sales: ['team@northwind.test'],
        team: ['sales@northwind.test'],
      }),
    });

    const result = resolveAddress('sales@northwind.test', map);
    expect(result.loop).toEqual([
      'sales@northwind.test',
      'team@northwind.test',
      'sales@northwind.test',
    ]);
    expect(result.deliverTo).toEqual([]);
  });

  it('finds an alias that points at itself', () => {
    const map = domains({
      'northwind.test': routing([], { sales: ['sales@northwind.test'] }),
    });
    expect(resolveAddress('sales@northwind.test', map).loop).not.toBeNull();
  });

  it('finds a cycle that runs through a third domain', () => {
    const map = domains({
      'a.test': routing([], { hub: ['spoke@b.test'] }),
      'b.test': routing([], { spoke: ['hub@a.test'] }),
    });
    expect(resolveAddress('hub@a.test', map).loop).not.toBeNull();
  });

  /**
   * Two branches reaching the same mailbox is a diamond, not a loop: mail is
   * delivered once and nothing recurses. Treating it as a loop would refuse a
   * perfectly ordinary configuration.
   */
  it('does not mistake a diamond for a loop', () => {
    const map = domains({
      'northwind.test': routing(['asha'], {
        all: ['left@northwind.test', 'right@northwind.test'],
        left: ['asha@northwind.test'],
        right: ['asha@northwind.test'],
      }),
    });

    const result = resolveAddress('all@northwind.test', map);
    expect(result.loop).toBeNull();
    expect(result.deliverTo).toEqual(['asha@northwind.test']);
  });

  it('stops on a chain too long to be intended', () => {
    const aliases: Record<string, string[]> = {};
    for (let i = 0; i < 40; i += 1) {
      aliases[`step${i}`] = [`step${i + 1}@northwind.test`];
    }
    const map = domains({ 'northwind.test': routing([], aliases) });

    expect(resolveAddress('step0@northwind.test', map).loop).not.toBeNull();
  });
});

describe('refusing a loop before it exists', () => {
  const map = domains({
    'northwind.test': routing(['asha'], {
      team: ['sales@northwind.test'],
    }),
  });

  /**
   * Checked before the write. Checking afterwards leaves a window in which mail
   * loops, and a repair that has to be made while messages are bouncing.
   */
  it('rejects a destination that closes a cycle', () => {
    expect(wouldCreateLoop('sales@northwind.test', ['team@northwind.test'], map)).not.toBeNull();
  });

  it('rejects an alias pointing at itself', () => {
    expect(wouldCreateLoop('sales@northwind.test', ['sales@northwind.test'], map)).not.toBeNull();
  });

  it('allows a destination that does not', () => {
    expect(wouldCreateLoop('sales@northwind.test', ['asha@northwind.test'], map)).toBeNull();
    expect(wouldCreateLoop('sales@northwind.test', ['someone@elsewhere.test'], map)).toBeNull();
  });

  it('asks about the proposed state, not the current one', () => {
    // `sales` does not exist yet, so resolving it today finds nothing at all.
    expect(resolveAddress('sales@northwind.test', map).loop).toBeNull();
    // But adding it with this destination would close the cycle through `team`.
    expect(wouldCreateLoop('sales@northwind.test', ['team@northwind.test'], map)).not.toBeNull();
  });
});
