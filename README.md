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

**Perception parity.** After every keypress we record, deterministically, what appeared **on screen** and what **assistive tech conveyed**: the words an open-source virtual screen reader ([Guidepup](https://github.com/guidepup/virtual-screen-reader), MIT) running in the page actually said, e.g. `button, Pay` or `assertive: Card number is invalid`, plus focus role/name/description from the accessibility tree. Visible changes with no programmatic path to the user are reported with step, screenshot, element and WCAG criterion. Our own rules make the same call independently; the report's `stats.spokenAgreement` shows where the two agree (on the test page they agree everywhere except the step where the payment dialog opens: see Limits).

**Where the AI does work rules can't:**
1. **Planner** — operates any site toward a goal using only keyboard + screen-reader information. No per-site scripts to maintain. Its outcome doubles as "can a structure-only AI agent complete this purchase?"
2. **Judge** — separates "added to cart" from a rotating promo banner, and grades each issue by *whether it blocks this task*, not by WCAG level. It can only label detector output — every finding traces back to recorded evidence.
3. **Name quality** — "🛒" is a non-empty name (axe passes it); the judge decides it doesn't tell a blind user what the button does.
4. **Fix + verify** — generates a code fix, applies it to a copy of the site, re-runs the same task. A fix counts only if the task now completes.

Architecture details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).


## Results so far

Fake shop (3 task flows), the small test page, and the W3C Before-and-After Demonstration "after" page; each flow in its
original (planted barriers) and hand-fixed version. One recorded key script per flow, so every tool sees the same page states.
Barriers were planted by a teammate who had read the detector code (see `sites/shop/README.md`), so some overfitting is possible.

**Detection: planted barriers vs tools**

| dataset | variant | tool | planted | detected | missed | false positives |
|---|---|---|---|---|---|---|
| shop-main | original | ours (judge off) | 8 | 7 | B3† | 0 |
| shop-main | original | ours (judge on) | 8 | 7 | B3† | 0 |
| shop-main | original | axe (WCAG rules) | 8 | 0 | B1 B2 B3† B4 B5 B6 B7 B8 | 0 |
| shop-main | fixed | ours (judge off) | 0 | 0 | – | 0 |
| shop-main | fixed | ours (judge on) | 0 | 0 | – | 0 |
| shop-main | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| shop-second | original | ours (judge off) | 4 | 4 | – | 0 |
| shop-second | original | ours (judge on) | 4 | 4 | – | 0 |
| shop-second | original | axe (WCAG rules) | 4 | 0 | B5 B8 B9 B10 | 0 |
| shop-second | fixed | ours (judge off) | 0 | 0 | – | 0 |
| shop-second | fixed | ours (judge on) | 0 | 0 | – | 0 |
| shop-second | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| shop-popup | original | ours (judge off) | 1 | 1 | – | 0 |
| shop-popup | original | ours (judge on) | 1 | 1 | – | 0 |
| shop-popup | original | axe (WCAG rules) | 1 | 0 | B11 | 0 |
| shop-popup | fixed | ours (judge off) | 0 | 0 | – | 0 |
| shop-popup | fixed | ours (judge on) | 0 | 0 | – | 0 |
| shop-popup | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| testpage | original | ours (judge off) | 6 | 6 | – | 0 |
| testpage | original | ours (judge on) | 6 | 5 | T5 | 0 |
| testpage | original | axe (WCAG rules) | 6 | 0 | T1 T2 T3 T4 T5 T6 | 0 |
| testpage | fixed | ours (judge off) | 0 | 0 | – | 0 |
| testpage | fixed | ours (judge on) | 0 | 0 | – | 0 |
| testpage | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| w3c-bad | fixed | ours (judge off) | 0 | 0 | – | 3 |
| w3c-bad | fixed | ours (judge on) | 0 | 0 | – | 3 |
| w3c-bad | fixed | axe (WCAG rules) | 0 | 0 | – | 0 |
| **total** | | ours (judge off) | 19 | 18 | 1 | 3 |
| **total** | | ours (judge on) | 19 | 17 | 2 | 3 |
| **total** | | axe (WCAG rules) | 19 | 0 | 19 | 0 |

† vision-only barrier (B3): text printed on an image; no keyboard/screen-reader rule can see it, so it is counted as a miss for us too.
Same trace for every tool (recorded key scripts `eval/keys.*.json`). axe counts only WCAG-tagged rules, per affected element; findings are matched to barriers by `data-barrier` id, unmatched = false positive.
axe best-practice rule nodes, not counted above: shop-main/original 1, shop-main/fixed 1, shop-second/original 1, shop-second/fixed 1, shop-popup/original 1, shop-popup/fixed 1, testpage/original 7, testpage/fixed 5, w3c-bad/fixed 28.
w3c-bad = W3C Before-and-After Demonstration, "after" (accessible) version: nothing planted, so it only measures false positives.
keyboard-a11y-tester: not included in this comparison.

**Ablation: same trace, judge off vs on**

| dataset | variant | candidates | FP judge off | FP judge on | detected off → on | dropped by judge | judge errors |
|---|---|---|---|---|---|---|---|
| shop-main | original | 9 | 0 | 0 | 7/8 → 7/8 | 0 | 0 |
| shop-main | fixed | 0 | 0 | 0 | 0/0 → 0/0 | 0 | 0 |
| shop-second | original | 6 | 0 | 0 | 4/4 → 4/4 | 1 | 0 |
| shop-second | fixed | 0 | 0 | 0 | 0/0 → 0/0 | 0 | 0 |
| shop-popup | original | 2 | 0 | 0 | 1/1 → 1/1 | 0 | 0 |
| shop-popup | fixed | 0 | 0 | 0 | 0/0 → 0/0 | 0 | 0 |
| testpage | original | 7 | 0 | 0 | 6/6 → 5/6 | 1 | 0 |
| testpage | fixed | 0 | 0 | 0 | 0/0 → 0/0 | 0 | 0 |
| w3c-bad | fixed | 3 | 3 | 3 | 0/0 → 0/0 | 0 | 0 |
| **total** | | 27 | 3 | 3 | 18 → 17 | 2 | 0 |

Judge-on numbers depend on the model (`MODEL_JUDGE`); verdicts are cached in `.cache/llm`, so replaying the same recording on this machine gives the same numbers; another machine or model may differ slightly. A fresh recording can also differ: the demo pages' rotating banner lands in different steps, so the judge sees a slightly different prompt.

Reproduce: `node eval/run.mjs --replay eval/traces` (no browser; the judge column needs `.env`).
`node eval/run.mjs` (no flag) records every flow afresh in Chromium: the judge-off and axe rows come out the same; the judge-on rows can differ (see above).


## What's real and what's mocked

- **Real:** browser automation on real Chromium, accessibility-tree reads via CDP, all detectors, axe-core comparison, LLM calls (Sciforium: DeepSeek V4.1 Flash for the planner, GLM 5.3 Flash for judge/fixer).
- **Synthetic:** the demo shop (`sites/shop`) and test page are ours, with planted barriers and a hand-fixed reference version. W3C Before-and-After Demonstration is used only to measure false positives.
- **Real-site segment:** detection only — no fixes, stops before checkout, never types payment data; results are shown from a cached run and not committed to this repo.
- **Limits:** a virtual screen reader is not NVDA/JAWS (we say "no programmatic way to be announced"); when focus moves onto a dialog it says the dialog's name only, where NVDA/JAWS usually also read the dialog's text, so the planner may hear less there than a real user would (our rules count that text as heard; `stats.spokenAgreement` lists each such step); cross-origin iframes (e.g. Stripe) are invisible to us; focus visibility (D5) compares the focused element's own computed style with an unfocused copy of it, so a focus ring drawn only by a parent's `:focus-within` is reported as missing (left to the judge), and visually hidden inputs whose ring is drawn on a sibling label are not judged; at real scale, noise filtering on busy sites needs more tuning. In real-site mode the tool does not record or send what the user typed or the browser autofilled: field values are kept only for fields the agent typed into itself (never for sensitive ones), and field text is dropped from page text. Local per-step screenshots can still show it; they are never sent to a model or committed.


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

**Third-party component:** the virtual screen reader is [`@guidepup/virtual-screen-reader`](https://github.com/guidepup/virtual-screen-reader) (Guidepup, MIT), used unchanged to simulate what a screen reader announces. What we built on top: the per-step comparison of what appeared on screen with what the screen reader conveyed, the planner that only ever hears that output (information barrier), and the fix-and-verify loop.

TODO — if the ~100-line feasibility script was written before Saturday, commit it unchanged as "prior work" first and describe it here. Focus-visibility detection will reuse keyboard-a11y-tester (MIT) — TODO: add the exact link and what we changed. Open-source libraries (Playwright, axe-core) don't need listing.
