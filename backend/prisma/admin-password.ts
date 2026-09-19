/**
 * Sets a new password for a staff account, from a shell on the server.
 *
 *   node --experimental-strip-types prisma/admin-password.ts [email]
 *
 * This exists because the seed prints the generated password exactly once, to
 * the deploy log, and the stored form is an argon2id hash — one-way by design,
 * so nothing in this codebase can read a password back. Miss that line in the
 * log and there was no way into the panel at all. Re-running the seed does not
 * help: it finds the account, says "password unchanged", and prints nothing.
 *
 * A shell on the server is the authentication, exactly as it is for the setup
 * wizard: anyone who can run this already has the machine and the database it
 * points at, so there is nothing further to prove. It is deliberately not an
 * HTTP route — a "reset the administrator" endpoint is a takeover button with
 * a friendly form in front of it.
 *
 * The new password is generated here rather than taken as an argument. An
 * argument is visible in `ps` to every user on the box and is written to the
 * shell history file, which is the same reasoning that keeps mailbox
 * plaintexts out of process boundaries. Generated, printed once, never stored
 * in anything but its hash.
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { ACCOUNT_COST, hashPassword } from '../src/common/password-hashing.ts';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const requested = process.argv[2]?.toLowerCase();
  const staff = await prisma.adminUser.findMany({
    select: { id: true, email: true, fullName: true, status: true },
    orderBy: { createdAt: 'asc' },
  });

  if (staff.length === 0) {
    console.error('\nNo staff accounts exist. Run `npm run seed` to create the first one.\n');
    process.exitCode = 1;
    return;
  }

  // Naming the accounts rather than guessing which one was meant. A script
  // that picks for you is a script that resets the wrong person's password on
  // a panel with more than one administrator.
  if (!requested) {
    console.error('\nUsage: npm run admin:password -- <email>\n\nStaff accounts:');
    for (const account of staff) {
      console.error(`  ${account.email}  (${account.status})`);
    }
    console.error('');
    process.exitCode = 1;
    return;
  }

  const target = staff.find((account) => account.email === requested);
  if (!target) {
    console.error(`\nNo staff account with the address ${requested}.\n\nStaff accounts:`);
    for (const account of staff) {
      console.error(`  ${account.email}  (${account.status})`);
    }
    console.error('');
    process.exitCode = 1;
    return;
  }

  const password = randomBytes(15).toString('base64url');

  await prisma.adminUser.update({
    where: { id: target.id },
    data: {
      passwordHash: await hashPassword(password, ACCOUNT_COST),
      // A locked-out account stays locked out after a password change unless
      // the counter is cleared too, which reads as "the new password is wrong
      // as well" and sends whoever ran this straight back here.
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  console.log(`\n  Password reset for ${target.email}`);
  console.log(`    password: ${password}`);
  console.log(`    Shown once. Store it in a password manager.`);
  if (target.status !== 'ACTIVE') {
    console.log(`\n    Note: this account is ${target.status}, so it still cannot sign in.`);
  }
  console.log('');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
