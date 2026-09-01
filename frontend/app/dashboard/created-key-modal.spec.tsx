import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreatedKeyModal } from './created-key-modal';
import type { CreatedApiKey } from '@/lib/api';

const apiKey: CreatedApiKey = {
  id: 'key-1',
  keyPrefix: 'nrn_abcd',
  name: 'test key',
  createdAt: new Date().toISOString(),
  lastUsedAt: null,
  revokedAt: null,
  key: 'nrn_abcdefghijklmnopqrstuvwxyz0123456789',
};

describe('CreatedKeyModal', () => {
  it('renders the raw key exactly once', () => {
    render(<CreatedKeyModal apiKey={apiKey} onClose={vi.fn()} />);
    expect(screen.getByText(apiKey.key)).toBeInTheDocument();
  });

  it('copies the raw key to the clipboard and confirms it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<CreatedKeyModal apiKey={apiKey} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(writeText).toHaveBeenCalledWith(apiKey.key);
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
  });

  it('calls onClose when Done is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<CreatedKeyModal apiKey={apiKey} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
