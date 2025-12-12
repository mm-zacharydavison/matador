import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/testing.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  target: 'node18',
  treeshake: true,
  // Keep class names for NestJS DI to work properly
  keepNames: true,
  external: [
    '@nestjs/common',
    '@nestjs/core',
    '@nestjs/testing',
    '@zdavison/matador',
    'reflect-metadata',
    'rxjs',
  ],
});
