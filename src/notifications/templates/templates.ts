/** A predefined email template. Templates are code-defined, not user-created — see notifications.service.ts's `sendTemplatedEmail`. */
export interface EmailTemplateDefinition {
  subject: string;
  body: string;
  /** Exactly these keys must be present in the variables object at send time — no more, no fewer. */
  requiredVariables: string[];
}

export const EMAIL_TEMPLATES: Record<string, EmailTemplateDefinition> = {
  welcome: {
    subject: 'Welcome to {{productName}}, {{name}}!',
    body: "<p>Hi {{name}},</p><p>Thanks for signing up for {{productName}}. We're glad to have you.</p>",
    requiredVariables: ['name', 'productName'],
  },
  'password-reset': {
    subject: 'Reset your password',
    body: '<p>Hi {{name}},</p><p>Click the link below to reset your password. This link expires in {{expiryMinutes}} minutes.</p><p><a href="{{resetUrl}}">Reset password</a></p>',
    requiredVariables: ['name', 'resetUrl', 'expiryMinutes'],
  },
};
