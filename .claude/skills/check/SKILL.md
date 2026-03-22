---
name: check
description: Run full CI gate (typecheck + lint + test) and auto-fix lint issues if any
disable-model-invocation: true
---

# Check

Run the full CI quality gate and handle failures.

## Steps

1. Run lint with auto-fix first (so type-check and tests see clean code):

```bash
bun run lint:fix
```

2. Run typecheck:

```bash
bun run typecheck
```

If typecheck fails, read the error output and fix the type errors before continuing.

3. Run all tests:

```bash
bun run test
```

If tests fail, investigate and fix the failing tests.

4. Once all three pass, confirm readiness:

```
All checks passed. Ready to commit.
```

## Notes

- This mirrors the CI gate: `bun run check` runs typecheck, lint, and test sequentially
- Always fix lint issues automatically; only report typecheck and test failures for manual review
- If a single package is failing, you can isolate with `bun test packages/<name>/`
