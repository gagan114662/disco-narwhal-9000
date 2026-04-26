# kairos-sf web

Marketing + product surface for KAIROS-SF. Lives next to `src 2/` but is independent — it does not import from the daemon yet.

## Run

```bash
cd web
bun install        # or npm/pnpm
bun dev            # → http://localhost:3000
```

## Stack

- Next.js 15 (App Router) + React 19
- Tailwind v3 + CSS-variable theme tokens (light/dark)
- next/font: Source Serif 4 (display), Inter (body), JetBrains Mono (code)
- No client JS yet — all sections are server-rendered

## Layout

```
app/
  layout.tsx               root shell (nav + footer)
  page.tsx                 landing — composes sections in order
  globals.css              theme tokens, base, utilities
  (marketing)/
    product/page.tsx       six product surfaces
    security/page.tsx      posture grid + on-prem + procurement pack
    pricing/page.tsx       four tiers + FAQ
  start/page.tsx           three install paths
  signin/page.tsx          local vs cloud-pro access
  contact/page.tsx         four contact desks
  docs/page.tsx            docs roadmap (full site lands with M3)
  status/page.tsx          public status board
  changelog/page.tsx
  about/, careers/, press/, blog/, community/, research/  (lean stubs)
  security/advisories/page.tsx
  legal/
    terms, privacy, dpa, sub-processors, telemetry

components/
  nav.tsx, footer.tsx, page-shell.tsx
  sections/
    hero.tsx               single tagline + 2 CTAs + demo console
    demo-console.tsx       static "build console" preview
    problem.tsx            "production-ready is asserted, not proven"
    proofs.tsx             five proofs with SLOs (no internal C-codes)
    how-it-works.tsx       Spec → Build → Verify
    industries.tsx         Healthcare / Finance / Public / Mid-market
    security-band.tsx      compliance-as-artifacts
    pricing-teaser.tsx     four-tier preview
    cta.tsx                final call to action

lib/cn.ts                  clsx + tailwind-merge
```

## Theme

CSS variables in `app/globals.css`. Light by default. Add `class="dark"` on `<html>` to flip — no theme toggle wired yet.

```
--bg / --fg / --muted / --subtle / --border
--surface          panels & nested cards
--accent / --accent-fg
```

Palette is calm off-white + near-black + one muted sage accent. Easy to swap by editing the HSL triples.

## Next pass

- `/app/specs`, `/app/builds/[id]`, `/app/audit/[id]`, `/app/quality` — mocked product UI
- Real motion on the demo console (animated typing + audit-chain reveal)
- Theme toggle in the nav
- Wire `lib/api.ts` to the daemon at `src 2/daemon/dashboard/server.ts`
