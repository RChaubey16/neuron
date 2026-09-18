import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EmailTemplatesPage from './page';
import { api, type EmailTemplatePreview } from '@/lib/api';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { ...actual.api, listEmailTemplates: vi.fn() },
  };
});

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

const listEmailTemplates = vi.mocked(api.listEmailTemplates);

const welcomeTemplate: EmailTemplatePreview = {
  key: 'welcome',
  subject: 'Welcome to Neuron, Ada!',
  body: '<div style="background-color:#f3f4f6;padding:32px 16px;"><table><tr><td><span>Neuron</span></td></tr><tr><td><p>Hi Ada,</p><p>Thanks for signing up for Neuron. We\'re glad to have you.</p></td></tr></table></div>',
  requiredVariables: ['name', 'productName'],
  urlVariables: [],
};

describe('EmailTemplatesPage', () => {
  it('renders each template with its rendered subject/body and required variables', async () => {
    listEmailTemplates.mockResolvedValue([welcomeTemplate]);

    renderWithQueryClient(<EmailTemplatesPage />);

    expect(await screen.findByText('welcome')).toBeInTheDocument();
    expect(screen.getByText('Welcome to Neuron, Ada!')).toBeInTheDocument();
    expect(screen.getByText('name')).toBeInTheDocument();
    expect(screen.getByText('productName')).toBeInTheDocument();

    // The body is rendered inside a sandboxed iframe (isolated from the
    // dashboard's own CSS) via srcDoc — jsdom doesn't actually navigate an
    // iframe's srcDoc into a live contentDocument, so this asserts on the
    // srcDoc markup itself rather than a rendered DOM.
    const iframe = screen.getByTitle('Email preview') as HTMLIFrameElement;
    expect(iframe.srcdoc).toContain('Hi Ada,');
  });

  it('shows an empty state when no templates are registered', async () => {
    listEmailTemplates.mockResolvedValue([]);

    renderWithQueryClient(<EmailTemplatesPage />);

    expect(
      await screen.findByText('No templates available'),
    ).toBeInTheDocument();
  });

  it('shows an error state and retries on demand', async () => {
    listEmailTemplates.mockRejectedValueOnce(new Error('network error'));
    listEmailTemplates.mockResolvedValueOnce([welcomeTemplate]);

    const user = userEvent.setup();
    renderWithQueryClient(<EmailTemplatesPage />);

    expect(
      await screen.findByText("Couldn't load email templates"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('welcome')).toBeInTheDocument();
  });
});
