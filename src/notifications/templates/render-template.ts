import { BadRequestException } from '@nestjs/common';
import type { EmailTemplateDefinition } from './templates';

const PLACEHOLDER_PATTERN = /\{\{\s*(\w+)\s*\}\}/g;

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/**
 * Fills a template's `{{variable}}` placeholders with the given values.
 * Throws a BadRequestException if `variables` doesn't contain exactly the
 * template's `requiredVariables` (missing or unexpected keys) or if any
 * value isn't a string — rejected up front rather than silently sending a
 * broken or partially-rendered email.
 * Every substituted value is HTML-escaped since the rendered body is sent
 * as HTML — this stops a variable's value from breaking the surrounding
 * markup or injecting a tag/script into the outgoing email.
 *
 * @param definition - The template to render
 * @param variables - Caller-supplied values, keyed by variable name
 * @returns The rendered subject and body
 */
export function renderTemplate(
  definition: EmailTemplateDefinition,
  variables: Record<string, string>,
): { subject: string; body: string } {
  const provided = Object.keys(variables);
  const missing = definition.requiredVariables.filter(
    (key) => !provided.includes(key),
  );
  const unexpected = provided.filter(
    (key) => !definition.requiredVariables.includes(key),
  );
  const nonString = provided.filter(
    (key) => typeof variables[key] !== 'string',
  );

  if (missing.length > 0 || unexpected.length > 0 || nonString.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(`missing: ${missing.join(', ')}`);
    }
    if (unexpected.length > 0) {
      parts.push(`unexpected: ${unexpected.join(', ')}`);
    }
    if (nonString.length > 0) {
      parts.push(`not a string: ${nonString.join(', ')}`);
    }
    throw new BadRequestException(
      `Invalid template variables (${parts.join('; ')})`,
    );
  }

  const substitute = (input: string): string =>
    input.replace(PLACEHOLDER_PATTERN, (_match, key: string) =>
      escapeHtml(variables[key]),
    );

  return {
    subject: substitute(definition.subject),
    body: substitute(definition.body),
  };
}
