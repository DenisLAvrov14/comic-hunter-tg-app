import { defineConfig, loadEnv } from 'vite';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    environment: 'node',
    // Подхватываем TEST_DATABASE_URL и прочее из .env (без префикса VITE_).
    env: loadEnv('test', process.cwd(), ''),
    // Интеграционные тесты делят одну БД — гоняем файлы последовательно.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['packages/domain/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
      // SPEC §12, этап 3: покрытие packages/domain ≥ 90%.
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
