# Stamp Placement & Static Text Fields — Design

**Date:** 2026-07-21
**Status:** Approved for planning

## Problem

Three related gaps in the Prepare-for-Signing editor:

1. **Stamp placement.** A company stamp must be placeable on the document and sized like a signature. Today `STAMP` exists as a field type but maps to a Zoho `Stamp` field, which prompts the *signer* to upload an image at signing time. We want a single pre-set company stamp applied automatically, with no signer involvement.
2. **Apply to all pages.** Placing a stamp page-by-page is tedious. Signature fields already support mirroring across all pages; stamps do not.
3. **Textbox does nothing.** The `TEXT` field places a positioned box, but nothing can be typed into it. Legal expects to type static text that becomes part of the document.
4. **No recovery from a bad resize.** Once a stamp is dragged to a wrong size there is no way back to the default other than deleting and re-placing it.

## Key insight

Items 1 and 3 are the same feature. Both `STAMP` and `TEXT` are **static content burned into the PDF before it reaches Zoho** — neither is a Zoho field. One flattening step handles both.

```
Draft fields
   ├─ STAMP ──┐
   ├─ TEXT  ──┴─→ flatten into PDF (pdf-lib) ──→ send flattened PDF to Zoho
   └─ SIGNATURE, INITIAL, NAME, DATE, TIME ──→ Zoho field payload (unchanged)
```

## Current state

Relevant existing code, verified:

| Concern | Location | State |
|---|---|---|
| Field palette, placement, resize | `src/modules/contracts/ui/PrepareForSigningModal.tsx` | `STAMP` already in palette (`:97`), sized (`:117`), and in `imageFieldTypes` (`:123`) so resize already works |
| All-pages mirroring | Same file, `:628-684` | Works, but hardcoded to `SIGNATURE` in five places |
| Zoho field mapping | `src/core/infra/integrations/zoho-sign/zoho-sign-client.ts:401-550` | `STAMP` → `field_type_name: 'Stamp'`, `field_category: 'image'` |
| Envelope send | `src/core/domain/contracts/contract-signatory-service.ts:421` | Where flattening will hook in |
| PDF manipulation | `pdf-lib` ^1.17.1 | Already a dependency, used for merging at `:1943` |
| Draft persistence | `contract_signing_preparation_drafts.fields` | **JSONB** — field shape changes need no migration |

## Design

### 1. Stamp image storage

```
supabase/assets/company-stamp.png          source of truth, checked into repo
scripts/seed-company-stamp.ts              uploader
   ↓
Supabase Storage: org-assets/stamps/{tenantId}.png    private bucket
```

**New private bucket `org-assets`**, not `contracts-private`. Different access rules: contracts are per-tenant confidential; the stamp is an org asset every staff member's editor must preview.

**Not `public/`** — a company stamp on a public URL is a forgery risk.

The path is keyed by `tenantId` because the schema is multi-tenant throughout. One file is seeded now; the path needs no rework later.

### 2. Promotion to production

Two halves, two paths:

| Piece | Reaches prod via |
|---|---|
| `org-assets` bucket + RLS policies | SQL migration (written here, applied manually by the user) |
| The stamp PNG (binary) | `npm run seed:company-stamp` against prod env vars |

The script follows existing `scripts/seed-*.ts` conventions (dotenv from `.env.local`, run via `tsx`). Requirements:

- **Idempotent** — `upsert: true`, so re-running replaces. "Update the stamp" is the same command as "install the stamp".
- **Confirms its target** — prints the Supabase host and requires `--yes` before uploading. The failure mode that matters is running against the wrong project.
- **Env-driven** — reads `SUPABASE_URL` / service-role key from env, so prod is a credential swap, not a code change.

Deferred: an admin upload screen so Legal can swap the stamp without developer involvement. Not now — the stamp changes rarely and the script is a fraction of the work.

### 3. Flattening pipeline

In `sendSigningPreparationDraft`, before the PDF is uploaded to Zoho:

1. Partition draft fields: `STAMP` and `TEXT` → flatten list; all others → Zoho payload.
2. `PDFDocument.load(pdf)`; `embedPng(stampBytes)` once, reused across all stamp fields.
3. Per stamp field: `page.drawImage()` at the stored position and size.
4. Per text field: `page.drawText()` with `StandardFonts.Helvetica`, size derived from field height.
5. Send the flattened bytes to Zoho.

**The stored source document is never modified.** Flattening happens on an in-memory copy on the way to Zoho. The original PDF in `contracts-private` stays clean, so re-sending a recalled envelope does not double-stamp the document.

**Non-PDF sources are rejected when static fields are present.** `detectSupportedFileFormat` (`zoho-sign-client.ts:577`) accepts `docx` and `doc` as well as `pdf`, and pdf-lib cannot flatten those. If a draft contains `STAMP` or `TEXT` fields and the source document is not a PDF, the send throws with a clear error naming the reason. Silently sending a DOCX with the stamps dropped is the §7 failure mode. Drafts with no static fields continue to accept DOCX exactly as today.

Insertion point: `assignSignatory`, between the source document fetch (`contract-signatory-service.ts:236-271`) and `createSigningEnvelope` (`:285`).

**`STAMP` and `TEXT` must be excluded from `mapFieldToZohoField`.** Otherwise Zoho draws its own upload box or textfield on top of the burned-in content.

#### Coordinate flip — primary risk

The editor stores `y` measured **downward from the top** (`PrepareForSigningModal.tsx:621`). pdf-lib's origin is **bottom-left**. Every flattened element needs:

```
pdfY = pageHeight - y - height
```

Getting this wrong produces output that looks correct for a vertically centered element and is visibly wrong everywhere else. This must be covered by a test asserting placement in a page corner, not the centre.

### 4. Apply to all pages

Generalize the existing mechanism rather than adding a parallel one:

- Rename `applySignatureToAllPages` → `applyToAllPages`.
- Replace the five hardcoded `selectedFieldType === 'SIGNATURE'` checks with a predicate covering `SIGNATURE` and `STAMP`.
- The mirroring logic at `:663-676` already re-projects x/y against each page's own dimensions — no change needed.

**Easy to miss:** the in-place hit test at `:636-654` also hardcodes `field.fieldType !== 'SIGNATURE'`, and must be generalized alongside the placement logic.

### 4a. Delete scope for mirrored stamps

Click-to-delete **already works for stamps** — the chip's `onClick` calls `removeFieldWithCurrentScope` for every field type (`:1194-1208`). The gap is scope.

`removeFieldWithCurrentScope` (`:485-493`) only removes a whole mirror group when the field is a `SIGNATURE` *and* the all-pages toggle is on:

```js
if (selectedFieldType === 'SIGNATURE' && field.fieldType === 'SIGNATURE' && applySignatureToAllPages && field.mirrorGroupId)
```

Both scopes must stay reachable: removing one page's stamp and removing the whole mirror group are both legitimate intents.

**Two explicit handles, no hidden modifiers:**

| Affordance | Scope | Rendered when |
|---|---|---|
| Chip body click | This page's copy | Always (unchanged from today) |
| Delete handle `×` | This page's copy | On hover / active field |
| Delete-all handle | Entire mirror group | Only when `field.mirrorGroupId` is set |
| Reset handle `↺` | Entire mirror group (§4b) | On hover / active field |
| Resize handle | This page's copy | Existing behavior |

**Scope decisions key off `field.mirrorGroupId`, not the live toolbar state.** The current signature code checks `applySignatureToAllPages` — the toggle's *present* value — so placing mirrored fields, then unticking the toggle, then deleting removes one copy and strands the rest. Keying off whether the field was mirrored at placement time avoids this.

Non-mirrored fields have no group, so the delete-all handle never renders for them and their behavior is unchanged.

**Chip crowding is a real risk.** Stamps default to 96×36pt, and the chip already carries label text and a resize handle. Mitigations: render the delete/reset/delete-all handles only on hover or when the field is active, keeping the idle chip clean; and never render the delete-all handle on non-mirrored fields. If handles still prove unhittable at small sizes during implementation, that is a signal to revisit this in favor of modifier keys — flag it rather than shrinking the hit targets below usable size.

### 4b. Reset size

Restores a stamp to `defaultFieldSizeByType` after a bad resize.

**Trigger: a small reset handle on each chip**, beside the existing resize handle. A single click on the chip already deletes the field, so double-click-to-reset is impossible — the chip is gone before the second click lands. Reset needs its own affordance.

The chip is a `<button>`, so a nested `<button>` is invalid HTML. Follow the established idiom already used for the resize handle (`:1216-1223`): a `<span role="presentation">` whose `onClick` calls `stopPropagation()` and `preventDefault()` so it does not trigger the chip's delete. The same applies to every handle added in §4a.

**Scope: always the whole mirror group**, deliberately unlike delete. Reset is non-destructive, so the safe default is the broad one — mismatched stamp sizes across pages is the problem being solved, and per-page reset would reintroduce it. Reuse the `mirrorGroupId` matching from §4a rather than writing a second traversal. For non-mirrored fields this collapses to resetting the single field.

Applies to any resizable field type, not just stamps — the mechanism is type-agnostic and `SIGNATURE`/`INITIAL` get it for free.

### 5. Textbox

- Add `textValue?: string` to the draft field shape (JSONB — no migration).
- Render an `<input>` inside `TEXT` field chips, bound to that value.
- Persist through the existing draft save path; extend the Zod schemas in `src/core/domain/contracts/schemas.ts` (both `contractSignatoryFieldSchema` and `contractSigningPreparationFieldSchema`).
- At send time the value is drawn into the PDF (§3) and the field is dropped from the Zoho payload.

#### Text overflow

`pdf-lib`'s `drawText` neither wraps nor clips — text keeps drawing past the box, over other content and potentially off the page edge. Overflow behavior must therefore be explicit.

**Word-wrap at fixed font size; block when the wrapped block is too tall.**

1. Font size is a **fixed constant** (11pt), independent of field height, and is never adjusted to make text fit.

   Font size must *not* be derived from field height. Line height scales with font size, so a height-derived size makes exactly one line fit at every height — making the box taller would enlarge the text rather than admit a second line, and any wrap would always overflow. Holding size fixed means height determines line capacity, which is what makes "resize the box" a real remedy for overflow.

2. Wrap at word boundaries to the field width, measured with `font.widthOfTextAtSize()` using the same `StandardFonts.Helvetica` used for drawing.
3. A single word longer than the field width (a long URL, an unbroken reference number) cannot be wrapped. Treat as overflow rather than breaking mid-word.
4. If total wrapped height exceeds field height, the field is in overflow: the editor flags the chip visually and a `PreflightCheck` blocks the send.

**Text is never truncated, and font size is never silently reduced.** Dropping the tail of a typed clause is the same class of failure as sending an unstamped contract (§7) — the sender is not told. Blocking is recoverable: the user resizes the box, which they can already do, or shortens the text.

**Editor and PDF must agree on what fits.** The editor renders an HTML `<input>`; a browser's default font has different metrics from Helvetica, so a naive preview will disagree with the burned-in output at the margins. The overflow calculation must be shared — one wrap/measure function, used by both the editor's overflow indicator and the send-time renderer — rather than reimplemented per side. Divergence here produces the worst outcome available: an editor showing no warning for text that overflows in the final PDF.

### 6. Editor preview

The editor must render the real stamp image so users can size it accurately. A new API route returns a signed URL for `org-assets/stamps/{tenantId}.png`, following the existing `signedUrlExpirySeconds` pattern (`contracts.ts:106`).

### 7. Missing stamp asset

`org-assets/stamps/{tenantId}.png` can be absent: a tenant onboarded without the seed script being run, an object deleted, or a tenant whose stamp was never configured. Three layers, defence in depth:

**Palette — prevent.** If no stamp asset resolves for the tenant, the `STAMP` palette item renders disabled with an explanatory tooltip ("No company stamp configured for this organisation"). Users cannot place a field that could never render.

**Preflight — catch.** A `PreflightCheck` (`PrepareForSigningModal.tsx:90`) fails when the draft contains `STAMP` fields but no stamp asset resolves. This surfaces in the editor's Execution Readiness panel, before anyone attempts to send. This check is what catches the dangerous ordering: stamps placed while the asset existed, asset deleted afterwards.

**Send — hard fail.** `sendSigningPreparationDraft` throws if a `STAMP` field is present and the asset cannot be fetched. The envelope is not created.

**Sending an unstamped contract must never be a silent outcome.** Degrading to "send without the stamp" would put an unsealed contract in front of a counterparty with nothing surfaced to the sender — the worst failure mode available here. A blocked send is recoverable; an unsealed executed contract is not.

A missing asset blocks the send **only when the draft actually contains `STAMP` fields.** Contracts that use no stamps are unaffected, so an unconfigured tenant is not prevented from sending ordinary documents.

The editor preview (§6) degrades to the disabled-palette state rather than a broken image.

## Consequences

**Recipient assignment becomes meaningless for `STAMP`/`TEXT`.** Static content is not assigned to anyone. `assigned_signer_email` stays populated and is ignored at send time. The alternative — loosening the Zod rule that requires an assignee — would weaken validation that protects every other field type.

**A document with only stamps and text cannot occur — already guarded.** The concern was that filtering `STAMP`/`TEXT` out of the Zoho payload could leave a recipient with an empty field array, which Zoho rejects. `assertSignatureFieldPerRecipient` (`contract-signatory-service.ts:1720-1747`) already throws unless every non-`VIEWER` recipient has at least one `SIGNATURE` field, and signatures always reach Zoho. No new guard is needed. A regression test should pin this, since the invariant is now load-bearing for the flattening design rather than incidental.

## Testing

- **Coordinate mapping** — flattened elements land correctly for corner positions on pages of differing dimensions. Highest-value test in this change.
- **Partitioning** — `STAMP`/`TEXT` are absent from the Zoho payload; other types are unaffected.
- **All-pages mirroring** — stamps mirror to every page, each re-projected against that page's own dimensions.
- **Delete scope** — the delete handle removes only the clicked page's copy; the delete-all handle removes the whole group. Both still work after the all-pages toggle has been switched off, since scope keys off `mirrorGroupId`.
- **Reset size** — restores default dimensions across a whole mirror group; neither the reset nor delete-all handle triggers the chip's own delete.
- **Signature invariant** — a recipient whose only fields are `STAMP`/`TEXT` is still rejected by `assertSignatureFieldPerRecipient`. Pins the invariant the flattening design now depends on.
- **Text overflow** — wrapped text within bounds renders on multiple lines; text exceeding box height blocks the send; an unbreakable word wider than the box is treated as overflow, not broken mid-word. Editor and renderer agree on the same overflow verdict for identical input.
- **Missing stamp asset** — palette disabled when unconfigured; preflight fails for stamps placed before the asset was removed; send throws rather than producing an unstamped PDF; a draft with no stamp fields sends normally.
- **Script idempotency** — a second run replaces rather than errors.

## Out of scope

- Admin upload screen for the stamp (deferred, see §2).
- Per-signer or multiple stamp images — one stamp per tenant.
- Changing how `SIGNATURE`, `INITIAL`, `NAME`, `DATE`, `TIME` reach Zoho.
