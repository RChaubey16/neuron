import { BadRequestException } from '@nestjs/common';
import { renderTemplate } from './render-template';
import type { EmailTemplateDefinition } from './templates';

describe('renderTemplate', () => {
  const definition: EmailTemplateDefinition = {
    subject: 'Welcome, {{name}}!',
    body: '<p>Hi {{name}}, enjoy {{productName}}.</p>',
    requiredVariables: ['name', 'productName'],
  };

  it('substitutes every placeholder with the given variable values', () => {
    const result = renderTemplate(definition, {
      name: 'Ada',
      productName: 'Neuron',
    });

    expect(result).toEqual({
      subject: 'Welcome, Ada!',
      body: '<p>Hi Ada, enjoy Neuron.</p>',
    });
  });

  it('HTML-escapes substituted values in the body so they cannot break the markup or inject a tag', () => {
    const result = renderTemplate(definition, {
      name: '<script>alert(1)</script>',
      productName: 'A & B "quoted"',
    });

    expect(result.body).toBe(
      '<p>Hi &lt;script&gt;alert(1)&lt;/script&gt;, enjoy A &amp; B &quot;quoted&quot;.</p>',
    );
  });

  it('does not HTML-escape the subject, since it is sent as a plain mail header, not HTML', () => {
    const result = renderTemplate(definition, {
      name: 'A & B "quoted"',
      productName: 'Neuron',
    });

    expect(result.subject).toBe('Welcome, A & B "quoted"!');
  });

  it('throws BadRequestException when a required variable is missing', () => {
    expect(() => renderTemplate(definition, { name: 'Ada' })).toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException when an unexpected variable is provided', () => {
    expect(() =>
      renderTemplate(definition, {
        name: 'Ada',
        productName: 'Neuron',
        extra: 'nope',
      }),
    ).toThrow(BadRequestException);
  });

  it('throws BadRequestException when a variable value is not a string', () => {
    expect(() =>
      renderTemplate(definition, {
        name: 'Ada',
        productName: 42 as unknown as string,
      }),
    ).toThrow(BadRequestException);
  });

  describe('urlVariables', () => {
    const urlDefinition: EmailTemplateDefinition = {
      subject: 'Reset your password',
      body: '<p><a href="{{resetUrl}}">Reset password</a></p>',
      requiredVariables: ['resetUrl'],
      urlVariables: ['resetUrl'],
    };

    it('accepts a valid http(s) URL', () => {
      const result = renderTemplate(urlDefinition, {
        resetUrl: 'https://neuron.ruturaj.xyz/reset?token=abc',
      });

      expect(result.body).toBe(
        '<p><a href="https://neuron.ruturaj.xyz/reset?token=abc">Reset password</a></p>',
      );
    });

    it('throws BadRequestException for a non-http(s) URL scheme (e.g. javascript:)', () => {
      expect(() =>
        renderTemplate(urlDefinition, {
          resetUrl: 'javascript:alert(1)',
        }),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException for a value that is not a URL at all', () => {
      expect(() =>
        renderTemplate(urlDefinition, {
          resetUrl: 'not a url',
        }),
      ).toThrow(BadRequestException);
    });
  });
});
