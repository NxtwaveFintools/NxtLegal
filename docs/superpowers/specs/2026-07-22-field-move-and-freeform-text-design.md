# Field Repositioning & Free-Form Static Text — Design

**Date:** 2026-07-22
**Status:** Approved for planning
**Refines:** `2026-07-21-stamp-and-static-text-fields-design.md`

## Problem

The stamp/text feature shipped and works, but Legal cannot use it comfortably:

1. **Placed fields cannot be moved.** Once a SIGNATURE, STAMP or TEXT chip is
   placed, the only corrections available are resize and delete-and-replace.
   Landing a stamp on a signature line becomes trial and error.
2. **Typing a space destroys the field.** Reported from the browser: typing a
   space after a word makes the field disappear.
3. **Text is not free-form.** Newlines are discarded, runs of whitespace are
   collapsed to one, and text that outgrows its box blocks the send outright.

## Diagnosis

### 2 — the space bug

The chip is a `<button>` (`PrepareForSigningModal.tsx:1286`) with the text
`<input>` nested inside it (`:1314`). Interactive content inside `<button>` is
invalid HTML. The chip's `onClick` is
`removeFieldWithCurrentScope(current, field, 'page')` (`:1301`) — so anything
that resolves as a button activation deletes the field.

**This is a hypothesis, not a proven mechanism.** The jsdom test at
`PrepareForSigningModal.test.tsx:1009` types `'Witnessed by Legal'` — spaces
included — and passes, so the fault does not reproduce outside a real browser.
What is certain is that the markup is invalid and that a delete handler shares
an element with a text field. Both are fixed here; if a browser-specific
mechanism survives that, it needs re-diagnosis against the real browser rather
than another round of inference.

### 3 — the text restrictions

`layoutStaticText` (`static-field-layout.ts:72`) does
`text.trim().split(/\s+/)`, which discards newlines and collapses whitespace.
`.trim()` is applied again in four further places, so removing it from one has
no effect:

| Location | Effect |
|---|---|
| `schemas.ts:285` — `z.string().trim().max(2000)` | strips at the API boundary |
| `PrepareForSigningModal.tsx:966` — save payload | strips on draft save |
| `PrepareForSigningModal.tsx:1021` — send payload | strips on send |
| `pdf-static-field-renderer.ts:140` | strips before drawing |

Overflow additionally throws at `pdf-static-field-renderer.ts:154`.

### Not a defect

An earlier reading of this file claimed the chip handle CSS was broken by a
malformed comment opener at `prepare-for-signing-modal.module.css:334`. It is
not — the file is correct and the handles work. Recorded here so the claim is
not rediscovered and acted on.

## Design

### 1. Drag to move

A `DragSession` ref parallel to the existing `ResizeSession` (`:43-54`).
Mousedown on the chip body captures the origin and the field's pdf-space
position; mousemove converts the client delta through the existing
`metrics.width / renderBox.widthPx` scale and clamps to page bounds.

**A 3px movement threshold separates click from drag.** Below it the gesture
resolves as a click; above it as a drag. Without a threshold the two gestures
are indistinguishable, because no real click has zero movement.

**Arrow keys nudge a selected field** — 1pt per press, 10pt with Shift. Drag
resolution is limited by page zoom; this is what allows a stamp to land exactly
on a ruled line.

### 2. Mirror groups and Alt

Plain drag re-projects the new position onto every page in the mirror group by
ratio, reusing the per-page projection already used at placement (`:738-749`)
so pages of differing dimensions stay correct.

**Alt+drag moves only the copy under the cursor and keeps its `mirrorGroupId`.**
Membership is retained deliberately: dropping it would silently detach that copy
from the ⨯⨯ delete-all and ↺ reset handles, so a nudge would quietly change what
two other controls do. A later plain drag re-syncs the whole group, making the
nudge recoverable.

**The modifier must be discoverable.** A hidden modifier the team is never told
about is equivalent to no feature. While a mirrored field is being dragged, a
badge reads `Moving all N pages — hold Alt for this page only`.

### 3. The chip stops being a `<button>`

`<button>` → `<div role="button" tabIndex={0}>`, which legalises the nested text
control. Click-to-delete moves off the body; click now selects.

Selection gets its own state and a persistent outline, and **a selected chip
shows its handles without hover.** Deletion stays available through the existing
× / ⨯⨯ handles, and `Delete`/`Backspace` removes the selected field.

Keyboard access is preserved: `Enter` on a focused chip selects it. Because a
`div` has no native activation behaviour, no keystroke inside the textarea can
reach a delete handler — which is the structural fix for §2 regardless of the
precise browser mechanism.

### 4. Free-form text

`layoutStaticText` changes:

- **Split on `\n` first**, wrapping each paragraph independently, so Enter works
  and blank lines survive.
- **Stop collapsing internal whitespace**, so indentation and double spaces reach
  the PDF.
- **Break over-long words at character level** rather than reporting overflow, so
  a long URL or reference number wraps instead of blocking the send.
- **Return `requiredHeight`** so the editor can auto-grow the box.

`.trim()` is removed from all four locations in the table above. Emptiness is
still tested with `.trim()`, but the *stored* value keeps its whitespace. The
character cap rises 2000 → 10000.

The editor's measurement upgrades from the `0.5em`-per-character approximation
(`PrepareForSigningModal.tsx:146-147`) to canvas `measureText` at
`11px Helvetica, Arial`, so editor preview and burned output stop disagreeing by
roughly a character per line.

### 5. Auto-grow, and the one remaining block

Box height is recomputed from `requiredHeight` on each keystroke and grown
downward, clamped to the page bottom edge.

The renderer becomes authoritative: it recomputes layout and draws every line,
since the box has no visible border in the output. **It throws in exactly one
case — text that cannot fit between the box top and the page bottom even at full
height.** That request is impossible to satisfy, and the alternative is drawing
past the page edge where the text is silently lost. Everything short of a full
page of prose in a single box now sends without complaint.

This preserves the §7 principle of the original spec — silent loss of content is
never an acceptable outcome — while removing the restriction that made ordinary
text unusable.

## Testing

- **Drag geometry** — a field dragged to a page corner lands there; positions
  clamp at page bounds rather than escaping the page.
- **Click vs drag** — movement under 3px selects and does not move; movement over
  3px moves and does not select-then-delete.
- **Mirror drag** — plain drag moves every group member, each re-projected against
  its own page dimensions; Alt+drag moves one and leaves `mirrorGroupId` intact.
- **Whitespace fidelity** — newlines, double spaces and leading indentation
  survive layout, both save payloads, the schema, and the renderer.
- **Character-level breaking** — a word wider than the box wraps rather than
  reporting overflow.
- **Auto-grow** — required height rises with added lines; a box clamped at the
  page bottom that still cannot fit reports overflow.
- **No nested interactive content** — the chip is not a `<button>`, pinning the
  structural fix for §2 against regression.

## Out of scope

- Multi-select and group drag of unrelated fields.
- Snap-to-grid or alignment guides.
- Rich text (bold, size, colour) — the burned text stays Helvetica 11pt black.
- Re-diagnosing §2 in a real browser, if the structural fix proves insufficient.
