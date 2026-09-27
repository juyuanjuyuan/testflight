# TODO: team name — task-level accessibility audit

We don't score pages. We check whether a screen-reader or keyboard user can actually **finish checkout**, show exactly where they get stuck, then fix the code and re-run the same task to prove the fix works.

Built at Test Flight, the Glasswing Ventures hackathon, September 26 and 27, 2026.

Team: TODO Name (@github), Name (@github), Name (@github), Name (@github)


## The problem

Web accessibility lawsuits keep growing, and they concentrate on e-commerce transaction flows. US federal website-accessibility suits reached 3,117 in 2025, up 27% (Seyfarth). The complaints describe **tasks that can't be finished**, not code that fails a rule: a blind user can't complete an order, the "added to cart" confirmation is never announced, a card error appears on screen but the screen reader stays silent. In *Gomez v. Trinitas Cellars* the court found no ADA violation for unreadable icons because the plaintiff didn't show how they blocked use of the site. What matters is whether the task is blocked.

Static scanners (axe, Lighthouse) check pages, not tasks. They catch missing alt text but miss dynamic problems — announcements, focus traps, focus loss — which only show up when you actually operate the page. Today that gap is filled by manual audits: slow, expensive, and redone on every release.

Who has it: engineering, QA and legal at mid-size e-commerce and restaurant brands, before every release.


## Who pays

- **Primary:** mid-size e-commerce and restaurant brands. Subscription priced per site and per monitored critical flow (checkout, signup). Budget: QA/engineering, pulled by legal risk.
- **Also:** accessibility audit firms (seats — automates their manual flow testing), public universities and local governments facing the April 2027 WCAG 2.1 AA deadline.
- Pricing sits between rule-engine seats and per-project manual audits.
- Expansion: the same accessibility tree is what AI shopping agents read. "Can a non-visual user finish checkout?" is also "can an agent buy on your site?"

We do not claim compliance certification or legal protection.


## How it works

```
goal ─► planner (LLM, keyboard only) ─► runner (Playwright + CDP, records everything) ─► trace.jsonl
                ▲  sees ONLY what assistive tech conveys                                      │
                └───────────────────────── observation ◄──────────────────────────────────────┘
trace ─► deterministic detectors ─► judge (LLM filters/labels, can't invent) ─► report ─► fixer (LLM) ─► rerun
```

**Perception parity.** After every keypress we record, deterministically, what appeared **on screen** and what **assistive tech could convey** (focus role/name/description from the accessibility tree, live-region text). Visible changes with no programmatic path to the user are reported with step, screenshot, element and WCAG criterion.

**Where the AI does work rules can't:**
1. **Planner** — operates any site toward a goal using only keyboard + screen-reader information. No per-site scripts to maintain. Its outcome doubles as "can a structure-only AI agent complete this purchase?"
2. **Judge** — separates "added to cart" from a rotating promo banner, and grades each issue by *whether it blocks this task*, not by WCAG level. It can only label detector output — every finding traces back to recorded evidence.
3. **Name quality** — "🛒" is a non-empty name (axe passes it); the judge decides it doesn't tell a blind user what the button does.
4. **Fix + verify** — generates a code fix, applies it to a copy of the site, re-runs the same task. A fix counts only if the task now completes.

Architecture details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).


## Results so far

On a small test page with 4 planted barriers (emoji-only button, unannounced "Added to cart", unannounced and unassociated card error, keyboard trap), same key sequence for all tools:

| dataset | tool | planted | detected | false positives |
|---|---|---|---|---|
| testpage (original) | axe-core (WCAG rules) | 4 | 0 | 0 |
| testpage (original) | ours (detectors only, no LLM) | 4 | 4 | 0 |
| testpage (fixed) | ours | 0 | – | 0 |

TODO: replace with the full fake-shop table (`node cli.mjs score …`) and the judge on/off ablation.


## What's real and what's mocked

- **Real:** browser automation on real Chromium, accessibility-tree reads via CDP, all detectors, axe-core comparison, LLM calls (Sciforium: DeepSeek V4.1 Flash for the planner, GLM 5.3 Flash for judge/fixer).
- **Synthetic:** the demo shop (`sites/shop`) and test page are ours, with planted barriers and a hand-fixed reference version. W3C Before-and-After Demonstration is used only to measure false positives.
- **Real-site segment:** detection only — no fixes, stops before checkout, never types payment data; results are shown from a cached run and not committed to this repo.
- **Limits:** a virtual screen reader is not NVDA/JAWS (we say "no programmatic way to be announced"); cross-origin iframes (e.g. Stripe) are invisible to us; focus visibility (D5) compares the focused element's own computed style with an unfocused copy of it, so a focus ring drawn only by a parent's `:focus-within` is reported as missing (left to the judge), and visually hidden inputs whose ring is drawn on a sibling label are not judged; at real scale, noise filtering on busy sites needs more tuning. In real-site mode the tool does not record or send what the user typed or the browser autofilled: field values are kept only for fields the agent typed into itself (never for sensitive ones), and field text is dropped from page text. Local per-step screenshots can still show it; they are never sent to a model or committed.


## Running it

```bash
cp .env.example .env            # put your keys in .env, it never gets committed
npm install
npx playwright install chromium # or set CHROME_BIN to a local Chromium
npm test                        # runs on recorded traces, no browser or keys needed
npm run serve                   # serves sites/ on http://localhost:8080

# deterministic run, no LLM:
node cli.mjs audit --url http://localhost:8080/testpage/original/ --goal "Buy the canvas tote bag" \
  --script eval/keys.testpage.json --no-judge
# add --trace to any audit to debug it step by step (or drop the zip on https://trace.playwright.dev, parsed locally):
npx playwright show-trace runs/<id>/trace.zip
# autonomous run with planner + judge:
node cli.mjs audit --url http://localhost:8080/shop/original/ --goal "Buy a canvas tote bag" --site sites/shop/original
node cli.mjs fix   --run runs/<id>
node cli.mjs rerun --run runs/<id>
```


## Brought in from before the weekend

TODO — if the ~100-line feasibility script was written before Saturday, commit it unchanged as "prior work" first and describe it here. Focus-visibility detection will reuse keyboard-a11y-tester (MIT) — TODO: add the exact link and what we changed. Open-source libraries (Playwright, axe-core) don't need listing.
