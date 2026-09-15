import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardNav } from './dashboard-nav';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

describe('DashboardNav', () => {
  // The desktop nav (`hidden md:flex`) is always mounted — jsdom doesn't
  // apply the Tailwind stylesheet that hides it below the `md` breakpoint —
  // so a link/button rendered in both desktop and mobile markup appears
  // twice once the mobile panel opens. Assert on the count, not presence.

  it('opens the mobile menu on toggle and closes it after picking a link', async () => {
    const user = userEvent.setup();
    render(<DashboardNav userEmail="dev@neuron.local" onSignOut={vi.fn()} />);

    expect(screen.getAllByRole('link', { name: /usage/i })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Open menu' }));

    const usageLinks = screen.getAllByRole('link', { name: /usage/i });
    expect(usageLinks).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: 'Close menu' }),
    ).toBeInTheDocument();

    // The second instance is the mobile one, which closes the panel on click.
    await user.click(usageLinks[1]);
    expect(screen.getAllByRole('link', { name: /usage/i })).toHaveLength(1);
  });

  it('calls onSignOut from the mobile menu', async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    render(<DashboardNav userEmail="dev@neuron.local" onSignOut={onSignOut} />);

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const signOutButtons = screen.getAllByRole('button', { name: /sign out/i });
    expect(signOutButtons).toHaveLength(2);

    await user.click(signOutButtons[1]);
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
