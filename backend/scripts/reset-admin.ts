/**
 * Reset the administrator account back to the initial password and force a
 * change at next sign-in. Use this if the admin password is ever lost.
 *
 *   npx tsx scripts/reset-admin.ts               -> resets to SEED_ADMIN_PASSWORD
 *   npx tsx scripts/reset-admin.ts "NewPass@123" -> resets to the password given
 */
import bcrypt from 'bcryptjs';
import { q, closeDb } from '../src/db';
import { config } from '../src/config';

const email = config.seedAdmin.email;
const password = process.argv[2] || config.seedAdmin.password;

const user = q.get<any>('SELECT id, email FROM users WHERE lower(email) = lower(@e)', { e: email });
if (!user) {
  console.error(`No user found with login ID ${email}. Run "npm run seed" first.`);
  process.exit(1);
}

q.run(
  `UPDATE users SET password_hash = @h, must_change_password = 1, failed_attempts = 0,
          locked_until = NULL, is_active = 1, updated_at = datetime('now')
    WHERE id = @id`,
  { h: bcrypt.hashSync(password, 12), id: user.id }
);

console.log(`Password reset for ${user.email}`);
console.log(`  New password : ${password}`);
console.log('  The account must change it at the next sign-in.');

const counts = q.get<any>(
  `SELECT (SELECT COUNT(*) FROM vendors) vendors,
          (SELECT COUNT(*) FROM bookings) bookings,
          (SELECT COUNT(*) FROM invoices) invoices,
          (SELECT COUNT(*) FROM invoice_templates) templates,
          (SELECT COUNT(*) FROM users) users`
);
console.log(`\nDatabase: ${counts.vendors} vendors, ${counts.bookings} bookings, ` +
  `${counts.invoices} invoices, ${counts.templates} templates, ${counts.users} users`);

closeDb();
