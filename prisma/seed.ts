import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

// Bootstraps the first super_admin. There is no app route that can mint an
// elevated role (register always lands on the ["user"] schema default), so the
// initial privileged account must come from outside the request path — here.
// Idempotent: re-running upserts the same row by email, never a duplicate.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const email = process.env.SEED_SUPER_ADMIN_EMAIL?.toLowerCase();
const password = process.env.SEED_SUPER_ADMIN_PASSWORD;
const displayName = process.env.SEED_SUPER_ADMIN_NAME ?? 'Super Admin';

// Fail loudly rather than bake a default credential into the repo — a known
// seeded password is a privilege-escalation backdoor in every deployment.
if (!email || !password) {
  throw new Error('Set SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD to seed the super admin');
}

const pool = new Pool({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const hashedPassword = await bcrypt.hash(password!, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { roles: ['super_admin'] },
    create: {
      email: email!,
      displayName,
      password: hashedPassword,
      roles: ['super_admin'],
      isEmailVerified: true,
    },
  });
  console.log(`Seeded super_admin: ${user.email} (${user.id})`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
