import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],

    /**
     * One file at a time.
     *
     * Several suites here run against one real Postgres database and assert
     * properties of the whole table — that the invoice serial sequence has no
     * gaps, that the audit trail cannot be rewritten. Two such suites running at
     * once see each other's rows, and the failure looks like a defect in the
     * code rather than in the test setup: the invoice suite clears the invoice
     * table to make its audit exact, which deletes rows the isolation suite is
     * mid-way through checking.
     *
     * Running them in sequence costs a few seconds and removes the whole class.
     */
    fileParallelism: false,
  },
});
