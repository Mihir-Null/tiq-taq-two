import { defineConfig } from 'vitest/config';

// Unit tests cover the pure logic (quantum engine, rules, bot, room protocol).
// They run in plain Node — no browser or DOM needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // A few tests play whole games with the Monte-Carlo bot. They finish in a few
    // seconds on a laptop, but shared CI runners can be several times slower, so
    // allow far more than vitest's 5 s default before calling a test "hung".
    testTimeout: 60_000,
  },
});
