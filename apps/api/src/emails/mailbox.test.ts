import { describe, expect, it } from 'vitest';
import { parseMailbox } from './mailbox.js';

describe('parseMailbox', () => {
  it.each([
    ['noreply@example.com', { name: null, address: 'noreply@example.com' }],
    ['  noreply@example.com  ', { name: null, address: 'noreply@example.com' }],
    ['Neuron <noreply@example.com>', { name: 'Neuron', address: 'noreply@example.com' }],
    ['Neuron App<noreply@example.com>', { name: 'Neuron App', address: 'noreply@example.com' }],
    ['  Acme Inc.  <hi@mail.acme.io> ', { name: 'Acme Inc.', address: 'hi@mail.acme.io' }],
  ])('parses %j', (value, expected) => {
    expect(parseMailbox(value)).toEqual(expected);
  });

  it.each([
    ['empty', ''],
    ['not an email', 'neuron'],
    ['bad address in brackets', 'Neuron <not-an-email>'],
    ['brackets without a name', '<noreply@example.com>'],
    ['quotes in the name', '"Neuron" <noreply@example.com>'],
    ['a line break in the name', 'Neuron\r\nBcc: x@y.com <noreply@example.com>'],
    ['two addresses', 'Neuron <a@example.com> <b@example.com>'],
    ['unclosed bracket', 'Neuron <noreply@example.com'],
  ])('rejects %s', (_label, value) => {
    expect(parseMailbox(value)).toBeNull();
  });
});
