import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HomePage from './page';

describe('HomePage', () => {
  it('shows the product name and what it does', () => {
    render(<HomePage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Neuron' })).toBeDefined();
    expect(screen.getByText(/transactional email through one API/i)).toBeDefined();
  });
});
