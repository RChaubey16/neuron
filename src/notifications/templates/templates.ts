/** A predefined email template. Templates are code-defined, not user-created — see notifications.service.ts's `sendTemplatedEmail`. */
export interface EmailTemplateDefinition {
  subject: string;
  body: string;
  /** Exactly these keys must be present in the variables object at send time — no more, no fewer. */
  requiredVariables: string[];
  /** Keys (a subset of requiredVariables) substituted into an href/src attribute — must be a valid http(s) URL, not just HTML-safe, to block javascript: and other unsafe schemes. */
  urlVariables?: string[];
  /** Example values for every requiredVariable, used only to render a dashboard preview (notifications.service.ts's `previewTemplates`) — never sent in a real email. */
  sampleVariables: Record<string, string>;
}

const BRAND_COLOR = '#4f46e5';

/**
 * Wraps a template's inner content in a simple branded card layout (header
 * bar, white body, muted footer) shared by every template, so each
 * definition below only needs to write its own message. Styles are all
 * inline, not a <style> block, since many email clients strip <style> tags
 * or a class-based stylesheet entirely.
 */
function layout(innerHtml: string): string {
  return (
    '<div style="background-color:#f3f4f6;padding:32px 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background-color:#ffffff;border-radius:8px;overflow:hidden;">' +
    `<tr><td style="background-color:${BRAND_COLOR};padding:20px 24px;">` +
    '<span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.01em;">Neuron</span>' +
    '</td></tr>' +
    '<tr><td style="padding:32px 24px;color:#1f2937;font-size:14px;line-height:1.6;">' +
    innerHtml +
    '</td></tr>' +
    '<tr><td style="padding:16px 24px;background-color:#f9fafb;color:#9ca3af;font-size:12px;">' +
    "You're receiving this email because you have an account with Neuron." +
    '</td></tr>' +
    '</table>' +
    '</div>'
  );
}

export const EMAIL_TEMPLATES: Record<string, EmailTemplateDefinition> = {
  welcome: {
    subject: 'Welcome to {{productName}}, {{name}}!',
    body: layout(
      '<p style="margin:0 0 12px;">Hi {{name}},</p>' +
        '<p style="margin:0;">Thanks for signing up for {{productName}}. ' +
        "We're glad to have you.</p>",
    ),
    requiredVariables: ['name', 'productName'],
    sampleVariables: { name: 'Ada', productName: 'Neuron' },
  },
  'password-reset': {
    subject: 'Reset your password',
    body: layout(
      '<p style="margin:0 0 16px;">Hi {{name}},</p>' +
        '<p style="margin:0 0 24px;">Click the button below to reset your ' +
        'password. This link expires in {{expiryMinutes}} minutes.</p>' +
        '<p style="margin:0;"><a href="{{resetUrl}}" ' +
        `style="display:inline-block;background-color:${BRAND_COLOR};` +
        'color:#ffffff;text-decoration:none;padding:10px 22px;' +
        'border-radius:6px;font-weight:600;font-size:14px;">Reset ' +
        'password</a></p>',
    ),
    requiredVariables: ['name', 'resetUrl', 'expiryMinutes'],
    urlVariables: ['resetUrl'],
    sampleVariables: {
      name: 'Ada',
      resetUrl: 'https://example.com/reset/abc123',
      expiryMinutes: '30',
    },
  },
};
