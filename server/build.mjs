import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Bundle the server into a single .mjs file
await esbuild.build({
  entryPoints: [join(__dirname, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: join(__dirname, 'dist/server.mjs'),
  external: ['dotenv'], // Only exclude dotenv - it's for local dev only
  minify: true,
  sourcemap: false,
  logLevel: 'info',
  banner: {
    js: '// Bundled server for E2B sandbox deployment\n',
  },
});

console.log('✅ Server bundled successfully to dist/server.mjs');
