import { BadRequestException } from '@nestjs/common';
import { isURL } from 'class-validator';
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
 * template's `requiredVariables` (missing or unexpected keys), if any value
 * isn't a string, or if a value mapped to the template's `urlVariables`
 * isn't a valid http(s) URL — all rejected up front rather than silently
 * sending a broken, partially-rendered, or unsafe-link email.
 * Every value substituted into the body is HTML-escaped since the body is
 * sent as HTML — this stops a variable's value from breaking the
 * surrounding markup or injecting a tag/script into the outgoing email.
 * The subject is substituted unescaped: it's sent as a plain mail header,
 * not HTML, so escaping it would show literal "&amp;"-style entities to
 * the recipient instead of protecting against anything.
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
  const invalidUrl = (definition.urlVariables ?? []).filter(
    (key) =>
      typeof variables[key] === 'string' &&
      !isURL(variables[key], {
        protocols: ['http', 'https'],
        require_protocol: true,
      }),
  );

  if (
    missing.length > 0 ||
    unexpected.length > 0 ||
    nonString.length > 0 ||
    invalidUrl.length > 0
  ) {
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
    if (invalidUrl.length > 0) {
      parts.push(`not a valid http(s) URL: ${invalidUrl.join(', ')}`);
    }
    throw new BadRequestException(
      `Invalid template variables (${parts.join('; ')})`,
    );
  }

  return {
    subject: definition.subject.replace(
      PLACEHOLDER_PATTERN,
      (_match, key: string) => variables[key],
    ),
    body: definition.body.replace(PLACEHOLDER_PATTERN, (_match, key: string) =>
      escapeHtml(variables[key]),
    ),
  };
}
