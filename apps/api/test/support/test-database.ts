/**
 * Connection string of the disposable test Postgres started with
 * docker-compose.test.yml. Never point this at a Supabase project.
 * The credentials are throwaway values for a local, tmpfs-backed container.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://neuron:neuron@postgres-test:5432/neuron_test';

export function assertNotSupabase(url: string): void {
  if (/supabase\.(co|com)/i.test(url)) {
    throw new Error('Refusing to run tests against a Supabase database.');
  }
}
