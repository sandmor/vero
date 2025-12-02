// Password utilities previously used bcrypt hashing. Since Clerk manages
// authentication & password storage externally, we persist only a constant
// marker to satisfy the local schema (optional field) without introducing
// unused crypto dependencies.

export function generateHashedPassword(_password: string) {
  return 'clerk-managed'; // marker value
}

export function generateDummyPassword() {
  return 'clerk-managed';
}
