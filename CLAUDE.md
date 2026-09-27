# numenumd — project rules for AI agents

## Commands

- Test: `npm test` / Lint: `npm run lint` / Types: `npm run typecheck` / Build: `npm run build`

## Principles

- **Never lose the user's Markdown.** Anything that can't be converted round-trips
  verbatim as a raw block. See `docs/architecture.md#markdown-round-trip`.
- **No persistent state except the remembered save target.** The edited content
  lives only in the `.md` file and in the tab's memory. The single exception numenumd
  itself reads and writes is the record of _which file was saved where_
  (`FileSystemFileHandle` + the file's mtime after the last save) in IndexedDB. It exists so that a reload
  doesn't force the user to pick the save location again. Do not add a second
  exception. The browser also keeps state numenumd can't read (the save picker's
  last directory via `showSaveFilePicker({ id })`, and File System Access
  permissions), so "no persistent state at all" would be inaccurate.
  See `docs/architecture.md#saving-and-the-remembered-save-target`.
- **No network access.**
- Never push directly to `main`.
- Commit messages in English, with a conventional prefix.

## Merge gate (maintainer)

Before merging a PR, the maintainer's agent must have it reviewed by a **fresh
subagent that does not share the session's context**. Ask the subagent to:

1. Check out the PR branch and run
   `npm test && npm run lint && npm run typecheck && npm run build`.
2. Check consistency with the design notes in `docs/superpowers/specs/` and
   `docs/superpowers/plans/` **when they exist locally** (they are gitignored and
   only on the maintainer's machine; the subagent reads them from the main checkout,
   because worktrees don't contain ignored files).
3. Review whether the tests are real (the assertions actually verify the spec) and
   the quality of the diff.

Merge only when **CI is green and the independent review approves**, then run
`gh pr merge`.
