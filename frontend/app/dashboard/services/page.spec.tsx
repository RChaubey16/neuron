import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ServicesPage from './page';

describe('ServicesPage', () => {
  it('lists every notifications endpoint, not just the primary one', () => {
    render(<ServicesPage />);

    expect(
      screen.getByText('POST /api/v1/notifications/email'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('GET /api/v1/notifications/email/templates'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'POST /api/v1/notifications/email/templates/:templateKey/send',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('GET /api/v1/notifications/email/:jobId'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('POST /api/v1/notifications/email/:jobId/retry'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('DELETE /api/v1/notifications/email/:jobId'),
    ).toBeInTheDocument();
  });

  it('lists both URL shortener endpoints', () => {
    render(<ServicesPage />);

    expect(
      screen.getByText('POST /api/v1/short-url/shorten'),
    ).toBeInTheDocument();
    expect(screen.getByText('GET /api/v1/short-url')).toBeInTheDocument();
  });
});
