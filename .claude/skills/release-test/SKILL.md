---
name: release-test
description: Set up a temp git repo with conventional commits and run a simulated release flow for testing
disable-model-invocation: true
---

# Release Test

Create a temporary git repository and simulate a release flow to verify release-smith behavior.

## Steps

1. Create a temp directory and initialize a git repo:

```bash
TMPDIR=$(mktemp -d)
cd "$TMPDIR"
git init
git config user.email "test@test.com"
git config user.name "Test"
```

2. Set up a minimal package.json:

```bash
echo '{"name":"test-pkg","version":"0.0.0"}' > package.json
git add . && git commit -m "chore: init"
git tag test-pkg@0.0.0
```

3. Add conventional commits for testing:

```bash
echo "module.exports = {}" > index.js
git add . && git commit -m "feat: add initial module"
echo "// fix" >> index.js
git add . && git commit -m "fix: resolve edge case"
```

4. Run release-smith in dry-run mode from the project root:

```bash
cd /Users/zhangzhichao/zzcwoshizz/release-smith
bun run dev status -- --cwd="$TMPDIR"
```

5. Inspect the output and verify version bumps, changelog, and tag format are correct.

6. Clean up:

```bash
rm -rf "$TMPDIR"
```

## Notes

- Adjust commit types (feat/fix/breaking) to test different bump scenarios
- Add `BREAKING CHANGE:` footer to test major bumps
- Use `--dry-run` flag when available to avoid writing files
