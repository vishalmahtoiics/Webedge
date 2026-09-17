import { CATCH_ALL, normaliseAddress, parseAddress } from './mail-address';

/**
 * Where an address actually delivers.
 *
 * Aliases may point at other aliases, so resolution is a graph walk, and the
 * graph can contain cycles: `sales -> team -> sales` is two edits made months
 * apart by two people, neither of whom is wrong on their own. Postfix will
 * detect the loop at delivery and bounce, after the message has been accepted —
 * so the mail is lost from the sender's point of view and the failure appears in
 * a log nobody reads. Refusing to create the cycle is the only version a
 * customer ever understands.
 *
 * Resolution is also what answers "who actually gets mail sent here", which is
 * the question support is asked when a customer says mail is going missing.
 */

/** How the domain's addresses are configured, as far as resolution cares. */
export type DomainRouting = {
  /** Local parts with a real mailbox, lowercase. */
  mailboxes: Set<string>;
  /** Alias local part -> destination addresses, lowercase. */
  aliases: Map<string, string[]>;
};

export type Resolution = {
  /** Addresses mail is finally delivered to, deduplicated and sorted. */
  deliverTo: string[];
  /** Addresses outside the domains WebEdge manages. */
  external: string[];
  /** The chain that repeats, if resolution found a cycle. */
  loop: string[] | null;
  /** True when delivery came from the catch-all rather than a named address. */
  viaCatchAll: boolean;
};

/**
 * Postfix stops expanding aliases at a depth of its own; the limit here is
 * lower and exists to bound work rather than to detect loops, which the visited
 * set already does. A chain longer than this is a configuration nobody intends.
 */
const MAX_DEPTH = 20;

export function resolveAddress(
  address: string,
  domains: Map<string, DomainRouting>,
): Resolution {
  const parsed = parseAddress(address);
  if (!parsed) {
    return { deliverTo: [], external: [], loop: null, viaCatchAll: false };
  }

  const deliverTo = new Set<string>();
  const external = new Set<string>();
  const visited = new Set<string>();
  let viaCatchAll = false;
  let loop: string[] | null = null;

  const walk = (current: string, chain: string[]): void => {
    if (loop) return;

    const normalised = normaliseAddress(current);
    if (visited.has(normalised)) {
      // Only a repeat *within the current chain* is a loop. The same address
      // reached twice by different branches is a diamond, which is fine and
      // merely delivers once.
      if (chain.includes(normalised)) {
        loop = [...chain.slice(chain.indexOf(normalised)), normalised];
      }
      return;
    }
    visited.add(normalised);

    if (chain.length >= MAX_DEPTH) {
      loop = [...chain, normalised];
      return;
    }

    const parts = parseAddress(normalised);
    if (!parts) return;

    const routing = domains.get(parts.domain);
    if (!routing) {
      // Not a domain WebEdge hosts, so this is where it leaves us.
      external.add(normalised);
      return;
    }

    if (routing.mailboxes.has(parts.localPart)) {
      deliverTo.add(normalised);
      return;
    }

    const alias = routing.aliases.get(parts.localPart);
    if (alias) {
      for (const destination of alias) walk(destination, [...chain, normalised]);
      return;
    }

    const catchAll = routing.aliases.get(CATCH_ALL);
    if (catchAll) {
      // Only reached because no mailbox and no named alias matched, which is
      // exactly what a catch-all is for.
      viaCatchAll = true;
      for (const destination of catchAll) walk(destination, [...chain, normalised]);
      return;
    }

    // No mailbox, no alias, no catch-all: nothing delivers, and saying so is
    // more useful than silently returning an empty list.
  };

  walk(address, []);

  return {
    deliverTo: [...deliverTo].sort(),
    external: [...external].sort(),
    loop,
    viaCatchAll,
  };
}

/**
 * Whether adding these destinations to an alias would create a cycle.
 *
 * Checked before the write, so the cycle never exists. Checking afterwards would
 * mean a window in which mail loops, and a repair that has to be applied while
 * messages are bouncing.
 */
export function wouldCreateLoop(
  aliasAddress: string,
  destinations: string[],
  domains: Map<string, DomainRouting>,
): string[] | null {
  const parsed = parseAddress(aliasAddress, { forStorage: true });
  if (!parsed) return null;

  const routing = domains.get(parsed.domain);
  if (!routing) return null;

  // Resolve against a copy carrying the proposed change, so the question asked
  // is "what would happen", not "what happens now".
  const proposed = new Map(domains);
  proposed.set(parsed.domain, {
    mailboxes: routing.mailboxes,
    aliases: new Map(routing.aliases).set(parsed.localPart, destinations.map(normaliseAddress)),
  });

  return resolveAddress(aliasAddress, proposed).loop;
}
