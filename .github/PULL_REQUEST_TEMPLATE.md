<!-- Thanks for contributing! Please read CONTRIBUTING.md first. -->

## Summary

<!-- What does this change do, and why? -->

## Related issue

<!-- e.g. Closes #123. Omit if none. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation only
- [ ] Refactor / internal
- [ ] Eval cases (new set; frozen cases untouched)

## Checklist

- [ ] `npm test` passes locally (Node >= 20).
- [ ] No runtime or dev dependency was added (`package.json` and lockfile unchanged in that respect).
- [ ] Docs updated to match any behaviour or format change.
- [ ] `check` still never falls back to `GO`; anything uncertain stays `UNKNOWN`.
- [ ] Frozen `eval/bakery-42` cases are unchanged (new eval cases live in a new directory).

## Notes for reviewers

<!-- Anything worth calling out: trade-offs, follow-ups, areas to scrutinise. -->
