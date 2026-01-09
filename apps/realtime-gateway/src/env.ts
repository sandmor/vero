import path from 'node:path';
import { config } from 'dotenv';

// Load env from both app-local and repo root locations so imports that
// read env (like @virid/db) see variables before Nest bootstraps.
const cwd = process.cwd();
const envFiles = [path.join(cwd, '.env')];

for (const file of envFiles) {
  config({ path: file, override: false });
}
