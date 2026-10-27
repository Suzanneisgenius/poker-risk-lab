# Preflop Design QA

> **Superseded (2026-10-27).** The app now uses the case study's light theme,
> with a dark variant that follows the system setting. The glass panels, glows and
> the amber selection ring described below are gone. Strategy fills are now
> Raise `#2b6cb0`, Call `#9e6c10`, Jam `#a8366e` and Fold `#6b717b`, the same in
> both themes, so white cell labels stay readable. Raise, call and jam pass the
> colour-vision checks. The selected cell is outlined in the text colour. The
> record below describes the earlier dark design.

## Target and implementation

- Reference visual: `/Users/suzanne/.codex/generated_images/019f7d7d-d551-7810-9d06-503d83372bf0/exec-6e38e50a-107a-4eeb-ab0c-bc31d14ecd1f.png` (`1486 × 1058`)
- Desktop implementation capture: `preflop-implementation-desktop-wide.png` (`1166 × 1097`)
- Mobile implementation capture: `preflop-implementation-mobile.png` (`281 × 1932`)
- Side-by-side comparison: `preflop-design-comparison.png` (`2400 × 960`)
- Route and state: `/#preflop`, Library mode, `BTN open 2.5bb · 6-max Cash · 100bb`, `A5s` selected

The desktop browser override was `2200 × 1600`, producing a CSS viewport of
`1606 × 1168`. The mobile override was `540 × 1160`, producing a CSS viewport
of `394 × 846`. The screenshot surface applies its own device-pixel scaling;
the CSS viewport values above are the dimensions used for layout decisions.

## Visual comparison

- Preserved the target's dark navy glass workspace, cyan strategy matrix,
  proportional mixed cells, amber selection ring, action legend, range summary,
  and two-card selected-hand treatment.
- Adapted the target into the existing Poker Analytics Suite header, navigation,
  type scale, glass tokens, and responsive shell instead of creating a separate
  visual system.
- Strategy colors match the approved palette: Fold `#4B5563`, Call `#22C55E`,
  Raise `#38BDF8`, Jam `#EC4899` with `#DB2777` emphasis, Mixed `#F59E0B`.
- Jam is deliberately the most visually prominent action when present. The
  40bb SB response range contains 13 Jam cells; the strongest example is
  announced as `AA: Jam 100 percent` and receives the magenta glow treatment.
- Copy consistently identifies the data as a demonstration dataset and does
  not claim solver verification or Nash-optimal output.

## Responsive and interaction checks

- Desktop: all three Library columns fit without document-level horizontal
  overflow at the wide breakpoint.
- Tablet (`839px` CSS width): Library, Compare, and Trainer collapse to one
  column.
- Mobile (`394px` CSS width): document width equals viewport width. The
  `169-hand` matrix remains intentionally horizontally scrollable inside its
  own container (`335px` client width / `523px` scroll width).
- Library: scenario loading, selected-hand cards, exact action mix, summary,
  and hand selection work.
- Compare: A/B range loading, Swap, matrix selection, and per-action percentage
  point deltas work. `A5s` correctly reports Raise `+25 pp` between the tested
  100bb and 40bb BTN ranges.
- Trainer: action selection, mixed-strategy feedback, progress statistics,
  Next hand, and View full range work.
- Accessibility: semantic tabs, labelled selects, grid cells with full
  frequency labels, live status regions, visible focus behavior, and minimum
  touch-target sizing are present.
- Browser console: no errors during Library, Compare, Trainer, desktop, tablet,
  or mobile checks.

## Validation history

1. Initial implementation matched the selected visual direction but used a
   symbol-only Swap control.
2. Replaced the symbol with a labelled `Swap` button and updated global product
   copy to include Preflop.
3. Added explicit About/README limitations so illustrative frequencies cannot
   be mistaken for solver output.
4. Added API tests that require all action frequencies to total 100 and verify
   a Jam-enabled range.
5. Rebuilt all generated HTML copies and reran engine, API, security,
   rate-limit, and public-bundle checks.

## Final result

passed
