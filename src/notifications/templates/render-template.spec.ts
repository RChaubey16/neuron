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

  it('HTML-escapes substituted values so they cannot break the markup or inject a tag', () => {
    const result = renderTemplate(definition, {
      name: '<script>alert(1)</script>',
      productName: 'A & B "quoted"',
    });

    expect(result.subject).toBe(
      'Welcome, &lt;script&gt;alert(1)&lt;/script&gt;!',
    );
    expect(result.body).toBe(
      '<p>Hi &lt;script&gt;alert(1)&lt;/script&gt;, enjoy A &amp; B &quot;quoted&quot;.</p>',
    );
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
});
