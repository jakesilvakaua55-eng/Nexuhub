import path from 'path';
import { cp, mkdir, readdir } from 'node:fs/promises';
import { defineConfig } from 'vite';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

const publicRoot = path.resolve(import.meta.dirname, '..', '..', 'nexhub', 'public');
const copyOriginalPublicAssets = () => ({
  name: 'copy-original-nexhub-public-assets',
  apply: 'build' as const,
  async closeBundle() {
    const outDir = path.resolve(import.meta.dirname, 'dist/public');
    const copyEntries = async (directory: string, relative = '') => {
      await mkdir(path.join(outDir, relative), { recursive: true });
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const entryRelative = path.join(relative, entry.name);
        const source = path.join(directory, entry.name);
        const destination = path.join(outDir, entryRelative);

        // Vite has already emitted the processed original HTML entry.
        if (entryRelative === 'index.html') continue;
        if (entry.isDirectory()) {
          await copyEntries(source, entryRelative);
        } else {
          await cp(source, destination);
        }
      }
    };
    await copyEntries(publicRoot);
  },
});

export default defineConfig({
  base: basePath,
  plugins: [copyOriginalPublicAssets()],
  root: publicRoot,
  publicDir: false,
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
