// What the fixer may change — the single wording shown in report.json `fixPolicy` (docs/REPORT_FORMAT.md).
// enforced: checked in code; apply.mjs cites these texts when it rejects an edit.
// instructed: only asked of the model; each text is quoted verbatim from prompts/fixer.md (test/fix.test.mjs checks).
export const FIX_POLICY = {
  enforced: [
    { id: 'keep-visible-text', rule: 'An edit may add text but may not remove any visible text or string literal.' },
    { id: 'unique-match', rule: 'The text an edit replaces must occur exactly once in the file.' },
    { id: 'site-copy-only', rule: 'Edits only change files inside the patched copy of the site; the original site is never modified.' },
  ],
  instructed: [
    { id: 'attributes-and-small-js', rule: 'Only add or change attributes (aria-*, role, tabindex, id) or add small JavaScript (focus management, key handlers).' },
    { id: 'no-rewording', rule: 'NEVER delete or reword visible text or error messages. Making the message disappear is not a fix.' },
  ],
};

/** Text of the enforced rule `id` (throws on an unknown id, so a typo can't silently drop the citation). */
export function enforcedRule(id) {
  const r = FIX_POLICY.enforced.find((x) => x.id === id);
  if (!r) throw new Error(`unknown fix rule: ${id}`);
  return r.rule;
}
