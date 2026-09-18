import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NotificationsPage from './page';
import { api, type EmailJobList, type EmailTemplatePreview } from '@/lib/api';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      listEmailJobs: vi.fn(),
      listEmailTemplates: vi.fn(),
      sendEmail: vi.fn(),
      sendTemplatedEmail: vi.fn(),
      retryEmail: vi.fn(),
      cancelEmail: vi.fn(),
    },
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

const listEmailJobs = vi.mocked(api.listEmailJobs);
const listEmailTemplates = vi.mocked(api.listEmailTemplates);
const sendEmail = vi.mocked(api.sendEmail);
const sendTemplatedEmail = vi.mocked(api.sendTemplatedEmail);
const retryEmail = vi.mocked(api.retryEmail);
const cancelEmail = vi.mocked(api.cancelEmail);

const welcomeTemplate: EmailTemplatePreview = {
  key: 'welcome',
  subject: 'Welcome to Neuron, Ada!',
  body: '<p>Hi Ada,</p>',
  requiredVariables: ['name', 'productName'],
  urlVariables: [],
};

// Every test renders the Send email form, which always fetches the
// template list — default to one template (the 'welcome' default
// selection) so unrelated tests don't need to know about this.
listEmailTemplates.mockResolvedValue([welcomeTemplate]);

function page(items: EmailJobList['items'], total: number, limit: number): EmailJobList {
  return { items, total, limit, offset: 0 };
}

const baseJob = {
  id: 'job-1',
  status: 'SENT' as const,
  to: ['recipient@example.com'],
  subject: 'Welcome',
  error: null,
  attemptsMade: 0,
  resendId: 'resend-1',
  createdAt: '2026-09-16T00:00:00.000Z',
  updatedAt: '2026-09-16T00:00:00.000Z',
};

describe('NotificationsPage', () => {
  it('renders each email row once data loads', async () => {
    listEmailJobs.mockResolvedValue(page([baseJob], 1, 20));

    renderWithQueryClient(<NotificationsPage />);

    expect(await screen.findByText('recipient@example.com')).toBeInTheDocument();
    expect(screen.getByText('Welcome')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
  });

  it('shows an empty state when no emails exist yet', async () => {
    listEmailJobs.mockResolvedValue(page([], 0, 20));

    renderWithQueryClient(<NotificationsPage />);

    expect(await screen.findByText('No emails sent yet')).toBeInTheDocument();
  });

  it('shows an error state and retries on demand', async () => {
    listEmailJobs.mockRejectedValueOnce(new Error('network error'));
    listEmailJobs.mockResolvedValueOnce(page([], 0, 20));

    const user = userEvent.setup();
    renderWithQueryClient(<NotificationsPage />);

    expect(
      await screen.findByText("Couldn't load your notifications"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('No emails sent yet')).toBeInTheDocument();
  });

  it('sends a templated email using the default template, and refreshes the list on success', async () => {
    listEmailJobs.mockResolvedValueOnce(page([], 0, 20));
    sendTemplatedEmail.mockResolvedValue({ ...baseJob, status: 'QUEUED' });
    listEmailJobs.mockResolvedValue(page([{ ...baseJob, status: 'QUEUED' }], 1, 20));

    const user = userEvent.setup();
    renderWithQueryClient(<NotificationsPage />);

    const toInput = await screen.findByPlaceholderText(
      'recipient@example.com, another@example.com',
    );
    // Wait for the template list to load (and the 'welcome' <option> to
    // exist) before asserting the default selection — a controlled
    // <select>'s displayed value falls back to whatever option is
    // available until the real one renders.
    const nameInput = await screen.findByLabelText('name');
    expect(screen.getByLabelText('Template')).toHaveValue('welcome');

    await user.type(toInput, 'recipient@example.com');
    await user.type(nameInput, 'Ada');
    await user.type(screen.getByLabelText('productName'), 'Neuron');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(sendTemplatedEmail).toHaveBeenCalledWith('welcome', {
        to: ['recipient@example.com'],
        variables: { name: 'Ada', productName: 'Neuron' },
      }),
    );
    await waitFor(() => expect(toInput).toHaveValue(''));
    // Proves the list query was invalidated by the mutation, not just that
    // the mutation itself succeeded.
    expect(await screen.findByText('Welcome')).toBeInTheDocument();
  });

  it('sends a custom email, clears the form, and refreshes the list on success', async () => {
    listEmailJobs.mockResolvedValueOnce(page([], 0, 20));
    sendEmail.mockResolvedValue({ ...baseJob, status: 'QUEUED' });
    listEmailJobs.mockResolvedValue(page([{ ...baseJob, status: 'QUEUED' }], 1, 20));

    const user = userEvent.setup();
    renderWithQueryClient(<NotificationsPage />);

    const toInput = await screen.findByPlaceholderText(
      'recipient@example.com, another@example.com',
    );
    await user.selectOptions(screen.getByLabelText('Template'), 'Custom');
    const subjectInput = screen.getByPlaceholderText('Subject');
    const bodyInput = screen.getByPlaceholderText('Message body');

    await user.type(toInput, 'recipient@example.com');
    await user.type(subjectInput, 'Welcome');
    await user.type(bodyInput, 'Hello there');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(sendEmail).toHaveBeenCalledWith({
        to: ['recipient@example.com'],
        subject: 'Welcome',
        body: 'Hello there',
      }),
    );
    await waitFor(() => expect(toInput).toHaveValue(''));
    // Proves the list query was invalidated by the mutation, not just that
    // the mutation itself succeeded.
    expect(await screen.findByText('Welcome')).toBeInTheDocument();
  });

  it('shows an inline error and keeps the form filled when sending fails', async () => {
    listEmailJobs.mockResolvedValue(page([], 0, 20));
    sendEmail.mockRejectedValue(new Error('bad request'));

    const user = userEvent.setup();
    renderWithQueryClient(<NotificationsPage />);

    const toInput = await screen.findByPlaceholderText(
      'recipient@example.com, another@example.com',
    );
    await user.selectOptions(screen.getByLabelText('Template'), 'Custom');
    await user.type(toInput, 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Failed to send email.')).toBeInTheDocument();
    expect(toInput).toHaveValue('not-an-email');
  });

  it('retries a FAILED job and refreshes the list on success', async () => {
    const failedJob = { ...baseJob, status: 'FAILED' as const, error: 'boom' };
    listEmailJobs.mockResolvedValueOnce(page([failedJob], 1, 20));
    retryEmail.mockResolvedValue({ ...failedJob, status: 'QUEUED', error: null });
    listEmailJobs.mockResolvedValue(
      page([{ ...failedJob, status: 'QUEUED', error: null }], 1, 20),
    );

    const user = userEvent.setup();
    renderWithQueryClient(<NotificationsPage />);

    await user.click(await screen.findByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(retryEmail).toHaveBeenCalledWith('job-1'));
    // Proves the list query was invalidated by the mutation, not just that
    // the mutation itself succeeded.
    expect(await screen.findByText('Queued')).toBeInTheDocument();
  });

  it('shows an inline error when retrying fails', async () => {
    const failedJob = { ...baseJob, status: 'FAILED' as const, error: 'boom' };
    listEmailJobs.mockResolvedValue(page([failedJob], 1, 20));
    retryEmail.mockRejectedValue(new Error('conflict'));

    const user = userEvent.setup();
    renderWithQueryClient(<NotificationsPage />);

    await user.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Failed to retry email.')).toBeInTheDocument();
  });

  it('cancels a QUEUED job after confirming, and refreshes the list on success', async () => {
    const queuedJob = { ...baseJob, status: 'QUEUED' as const };
    listEmailJobs.mockResolvedValueOnce(page([queuedJob], 1, 20));
    cancelEmail.mockResolvedValue(undefined);
    listEmailJobs.mockResolvedValue(
      page([{ ...queuedJob, status: 'CANCELLED' }], 1, 20),
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const user = userEvent.setup();
    renderWithQueryClient(<NotificationsPage />);

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(cancelEmail).toHaveBeenCalledWith('job-1'));
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
  });

  it('does not cancel a job when the confirm dialog is dismissed', async () => {
    // Cleared since the previous test's successful cancel call would
    // otherwise still be recorded on this shared mock.
    cancelEmail.mockClear();
    const queuedJob = { ...baseJob, status: 'QUEUED' as const };
    listEmailJobs.mockResolvedValue(page([queuedJob], 1, 20));
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    const user = userEvent.setup();
    renderWithQueryClient(<NotificationsPage />);

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(cancelEmail).not.toHaveBeenCalled();
  });
});
