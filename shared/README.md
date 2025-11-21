# Shared Types Package

This workspace contains **only TypeScript types** that are shared between `client` and `server`.

## Important Notes

- **No build step required** - This package is imported directly as TypeScript source files
- **No runtime code** - Only type definitions, interfaces, and type utilities
- **No build artifacts** - The `dist/` folder should never exist

## Configuration

### package.json
```json
{
  "types": "./src/index.ts",  // Points directly to source
  "scripts": {}                // No build script
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "noEmit": true,            // Never emit .js files
    "declaration": false        // Never emit .d.ts files
  }
}
```

## Usage in Other Workspaces

### In client or server tsconfig.json:
```json
{
  "compilerOptions": {
    "paths": {
      "@shared/*": ["../shared/src/*"]
    }
  }
}
```

### In code:
```typescript
import type { Message } from '@shared';
```

## Why No Build Step?

1. **Simpler** - No build artifacts to manage
2. **Faster** - No compilation time for types-only package
3. **Cleaner** - No `.js`, `.d.ts`, or `.js.map` files to ignore
4. **Direct** - TypeScript compiler resolves types at compile time

When you run `pnpm build` from root, this workspace is automatically skipped because it has no `build` script.
