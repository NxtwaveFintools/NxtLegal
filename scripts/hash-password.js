/**
 * Password Hashing Utility
 *
 * Use this script to generate password hashes for creating employees in Supabase.
 *
 * Usage:
 * 1. Run: node scripts/hash-password.js
 * 2. Or modify and run directly in Node.js
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const bcrypt = require('bcryptjs')

async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10)
  const hash = await bcrypt.hash(password, salt)
  return hash
}

// Example: Hash the password "password"
hashPassword('password').then((hash) => {
  console.log('Password: password')
  console.log('Hash:', hash)
  console.log('\nUse this hash when creating employees in Supabase Dashboard')
})

// To hash a custom password, call:
// hashPassword('your-password-here').then(console.log);
