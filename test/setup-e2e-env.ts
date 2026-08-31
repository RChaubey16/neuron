/**
 * E2E test environment setup — sets required env vars to placeholder values.
 * Tests never hit a real database, Supabase project, or Google OAuth
 * (all services are mocked in test configs), so these only need to be
 * present and well-formed so ConfigModule's startup validation doesn't reject them.
 */

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/neuron_test';
process.env.GOOGLE_CLIENT_ID ||= 'test-placeholder-client-id';
process.env.GOOGLE_CLIENT_SECRET ||= 'test-placeholder-client-secret';
process.env.GOOGLE_CALLBACK_URL ||= 'http://localhost:3000/auth/google/callback';
process.env.JWT_SECRET ||= 'test-placeholder-jwt-secret';
process.env.FRONTEND_URL ||= 'http://localhost:3001';
// SUPABASE_URL is not validated by env.validation.ts but is still used by AuthService
process.env.SUPABASE_URL ||= 'https://test-placeholder.supabase.co';
