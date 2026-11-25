import { isEmail } from 'class-validator';

export interface Mailbox {
  name: string | null;
  address: string;
}

const NAME_AND_ADDRESS = /^([^<>"\r\n]+?)\s*<([^<>\s]+)>$/;

/**
 * Parses a sender like `Neuron <noreply@example.com>` or `noreply@example.com`.
 * Returns null for anything else, including names with quotes, angle brackets
 * or line breaks, which could be used to inject email headers.
 */
export function parseMailbox(value: string): Mailbox | null {
  const trimmed = value.trim();

  const named = NAME_AND_ADDRESS.exec(trimmed);
  if (named) {
    const [, name, address] = named;
    return name && address && isEmail(address) ? { name: name.trim(), address } : null;
  }

  return isEmail(trimmed) ? { name: null, address: trimmed } : null;
}
