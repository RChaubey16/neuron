import 'dotenv/config';
import { randomBytes, randomUUID, createHash } from 'crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma';

const TEST_USER_EMAIL = 'dev@neuron.local';
const KEY_PREFIX_LENGTH = 8;

/**
 * Hashes a raw API key for storage, matching the scheme `ApiKeyGuard` will
 * use to look up incoming `x-api-key` headers (Phase 3).
 */
function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Seeds a test user and a test API key for local development.
 * Prints the raw key once — it is never stored or logged again after this.
 */
async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const user = await prisma.user.upsert({
      where: { email: TEST_USER_EMAIL },
      update: {},
      create: { id: randomUUID(), email: TEST_USER_EMAIL },
    });

    const rawKey = `sk_test_${randomBytes(24).toString('hex')}`;

    const apiKey = await prisma.apiKey.create({
      data: {
        userId: user.id,
        hashedKey: hashApiKey(rawKey),
        keyPrefix: rawKey.slice(0, KEY_PREFIX_LENGTH),
        name: 'Local dev seed key',
      },
    });

    console.log('Seeded test user:', user.email);
    console.log('Seeded test API key (id):', apiKey.id);
    console.log('Raw API key (copy now, not stored anywhere):', rawKey);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
