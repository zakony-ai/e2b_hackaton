import { execSync } from 'child_process';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🔨 Prebuild: Building server bundle...');

// Build the server from the root directory
const rootDir = join(__dirname, '..', '..');
try {
  execSync('pnpm --filter server build', {
    cwd: rootDir,
    stdio: 'inherit',
  });
} catch {
  console.error('❌ Failed to build server');
  process.exit(1);
}

console.log('📦 Prebuild: Copying server bundle to client...');

// Copy the server bundle to client/server-bundle/
const sourcePath = join(rootDir, 'server', 'dist', 'server.mjs');
const targetDir = join(__dirname, '..', 'server-bundle');
const targetPath = join(targetDir, 'server.mjs');

// Create target directory if it doesn't exist
if (!existsSync(targetDir)) {
  mkdirSync(targetDir, { recursive: true });
}

// Copy the file
try {
  copyFileSync(sourcePath, targetPath);
  console.log('✅ Prebuild: Server bundle copied successfully');
} catch (error) {
  console.error('❌ Failed to copy server bundle:', error.message);
  process.exit(1);
}
