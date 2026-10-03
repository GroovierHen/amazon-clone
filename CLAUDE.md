# Amazon clone

Read SPEC.md before any work. It is the source of truth. Section 10 of SPEC.md overrides everything else.

## Commands

Use Bun. Do not use npm or npx. Keep these script names when you set up the project.

- `bun run dev` starts the app
- `bun run build` builds for production
- `bun run typecheck` runs `tsc --noEmit`
- `bun run lint`
- `bun test` runs unit and integration tests
- `bun run test:e2e` runs Playwright
- `bun run db:migrate` applies migrations
- `bun run db:seed` loads seed data
- `vercel env pull` refreshes `.env.local`
- `vercel deploy` makes a preview deploy

The database connection variables are in `.env.local`. Tests need a real Postgres database, not a mock. They run in the `test` schema.

## Rules

- IMPORTANT: never use OFFSET. Every list query uses keyset pagination as described in SPEC.md 6.1.
- Stock changes only inside the place-order transaction in SPEC.md 6.4, with rows locked in ascending product id order.
- Store money as integer cents. Format it only in the UI.
- Never cache the cart, cart count, checkout or orders in the shared cache.
- Check the Next.js docs for the installed version before writing caching code.
- No payment code. No login code. See SPEC.md section 2.
- Do not download Amazon's logo files, product photos or product text.
- Free plans only on Vercel and the Marketplace. Never add a paid resource. Stop and ask.
- Never print or commit secrets. `.env.local` stays out of git.
- Never delete a Vercel project, a database or environment variables without asking me first.

## Workflow

- Build the slices in SPEC.md section 8 in order.
- A slice is done when typecheck, lint, build and tests pass. Show the command output.
- Tick the slice in SPEC.md section 8, then commit with a message that names the slice. Include `.agent-logs/` in every commit.
- IMPORTANT: never add `.agent-logs/` to `.gitignore`. The assessment requires it in the public repository.
- For UI work, screenshot the page at 1440px and 390px and run the UX check in SPEC.md section 7.
- This is not a pixel copy of Amazon. Follow the product decisions in SPEC.md 10.4.
- Deploy to production at the end of slice 2 and after every later slice.
- If a requirement is unclear or missing from SPEC.md, stop and ask. Do not guess.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `GroovierHen/stockroom`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
