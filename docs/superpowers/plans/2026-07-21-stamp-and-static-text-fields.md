# Stamp Placement & Static Text Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Legal place a pre-set company stamp and static text onto contracts — sized, mirrored across all pages, and burned into the PDF before it reaches Zoho.

**Architecture:** `STAMP` and `TEXT` stop being Zoho fields and become static content flattened into the PDF with `pdf-lib` on the way to Zoho. The stamp image lives in a private Supabase Storage bucket, seeded by a script. The existing signature all-pages mirroring is generalized to cover stamps.

**Tech Stack:** Next.js, TypeScript, Supabase (Postgres + Storage), pdf-lib, Zoho Sign API, Jest, react-pdf.

**Spec:** `docs/superpowers/specs/2026-07-21-stamp-and-static-text-fields-design.md`

---

## Conventions

- Tests are colocated: `foo.ts` → `foo.test.ts`.
- Run a single test file: `npx jest <path> --verbose`
- Run one test by name: `npx jest <path> -t "<test name>" --verbose`
- Type-check: `npm run type-check`
- **Do not run `git commit`.** Commit steps below state what to stage; the user commits manually.
- **Do not apply migrations.** Write the file; the user applies it.

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/core/domain/contracts/static-field-layout.ts` | Pure geometry + text wrapping. Coordinate flip, wrap/measure, overflow verdict. No I/O. | Create |
| `src/core/domain/contracts/static-field-layout.test.ts` | Tests for the above | Create |
| `src/core/domain/contracts/pdf-static-field-renderer.ts` | Burns stamps and text into PDF bytes using pdf-lib | Create |
| `src/core/domain/contracts/pdf-static-field-renderer.test.ts` | Tests for the above | Create |
| `src/core/infra/repositories/supabase-org-asset-repository.ts` | Fetches stamp bytes / signed URL from `org-assets` | Create |
| `src/core/constants/contracts.ts` | Add `orgAssetStorage` constants, `staticFieldTypes` | Modify |
| `src/core/domain/contracts/schemas.ts` | Add `text_value` to field schemas | Modify |
| `src/core/domain/contracts/contract-signatory-service.ts` | Partition fields, call renderer, guard non-PDF | Modify |
| `src/core/infra/integrations/zoho-sign/zoho-sign-client.ts` | Reject static field types defensively | Modify |
| `src/modules/contracts/ui/PrepareForSigningModal.tsx` | Palette gating, all-pages generalization, handles, text input | Modify |
| `src/modules/contracts/ui/prepare-for-signing-modal.module.css` | Handle styles | Modify |
| `src/app/api/contracts/org-assets/stamp/route.ts` | Signed URL for editor preview | Create |
| `supabase/migrations/<ts>_create_org_assets_bucket.sql` | Bucket + RLS | Create |
| `supabase/assets/company-stamp.png` | Stamp source of truth | Add (user supplies) |
| `scripts/seed-company-stamp.ts` | Uploads stamp to Supabase | Create |

**Ordering rationale:** Tasks 1–2 build pure logic with no dependencies. Tasks 3–5 add storage. Tasks 6–8 wire the send path. Tasks 9–12 do UI. The send path works end-to-end after Task 8; UI is additive after that.

---

## Task 1: Coordinate flip and geometry

The editor stores `y` measured downward from the page top. pdf-lib's origin is bottom-left. This is the highest-risk logic in the feature and gets isolated into a pure function.

**Files:**
- Create: `src/core/domain/contracts/static-field-layout.ts`
- Test: `src/core/domain/contracts/static-field-layout.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/core/domain/contracts/static-field-layout.test.ts
import { toPdfRect } from './static-field-layout'

describe('toPdfRect', () => {
  it('flips a top-left origin rect to bottom-left origin', () => {
    // Field 10pt from the top of an 800pt page, 36pt tall.
    // Its bottom edge sits at 800 - 10 - 36 = 754 from the bottom.
    const result = toPdfRect({ x: 20, y: 10, width: 96, height: 36, pageHeight: 800 })

    expect(result).toEqual({ x: 20, y: 754, width: 96, height: 36 })
  })

  it('places a field at the bottom of the page at y=0', () => {
    const result = toPdfRect({ x: 0, y: 764, width: 96, height: 36, pageHeight: 800 })

    expect(result.y).toBe(0)
  })

  it('is not symmetric for off-centre fields', () => {
    // Guards against a flip bug that happens to look correct when centred.
    const top = toPdfRect({ x: 0, y: 50, width: 100, height: 20, pageHeight: 800 })
    const bottom = toPdfRect({ x: 0, y: 730, width: 100, height: 20, pageHeight: 800 })

    expect(top.y).toBe(730)
    expect(bottom.y).toBe(50)
    expect(top.y).not.toBe(bottom.y)
  })

  it('clamps a field extending past the bottom edge to y=0', () => {
    const result = toPdfRect({ x: 0, y: 790, width: 96, height: 36, pageHeight: 800 })

    expect(result.y).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/core/domain/contracts/static-field-layout.test.ts --verbose`
Expected: FAIL — `Cannot find module './static-field-layout'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/core/domain/contracts/static-field-layout.ts

export type PdfRect = {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Converts an editor rect (y measured downward from the page top) into a
 * pdf-lib rect (y measured upward from the page bottom).
 *
 * The editor derives y from a click offset inside the rendered page
 * (PrepareForSigningModal.tsx:621), so y grows downward. pdf-lib's origin is
 * bottom-left. Getting this wrong produces output that looks correct for a
 * vertically centred element and is visibly wrong everywhere else.
 */
export function toPdfRect(params: {
  x: number
  y: number
  width: number
  height: number
  pageHeight: number
}): PdfRect {
  const bottomUpY = params.pageHeight - params.y - params.height

  return {
    x: params.x,
    y: Math.max(0, bottomUpY),
    width: params.width,
    height: params.height,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/core/domain/contracts/static-field-layout.test.ts --verbose`
Expected: PASS — 4 tests

- [ ] **Step 5: Stage for commit**

```bash
git add src/core/domain/contracts/static-field-layout.ts src/core/domain/contracts/static-field-layout.test.ts
```

Suggested message: `feat: add coordinate flip for static PDF field placement`

---

## Task 2: Text wrapping and overflow verdict

Shared by the editor's overflow indicator and the send-time renderer. Both must agree or the editor will pass text that overflows in the PDF.

**Files:**
- Modify: `src/core/domain/contracts/static-field-layout.ts`
- Test: `src/core/domain/contracts/static-field-layout.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `static-field-layout.test.ts`:

```typescript
import { layoutStaticText, STATIC_TEXT_FONT_SIZE, STATIC_TEXT_LINE_HEIGHT } from './static-field-layout'

// Stand-in for pdf-lib's PDFFont.widthOfTextAtSize. Each character is `size`
// points wide, keeping the arithmetic obvious in assertions.
const fakeMeasure = (text: string, size: number) => text.length * size

describe('static text metrics', () => {
  it('uses a fixed font size independent of field height', () => {
    // Font size must not scale with height: line height scales with font size,
    // so a height-derived size makes exactly one line fit at EVERY height, and
    // any wrap would always overflow. Fixed size means height sets line capacity.
    const short = layoutStaticText({ text: 'abc', width: 100, height: 20, measure: fakeMeasure })
    const tall = layoutStaticText({ text: 'abc', width: 100, height: 200, measure: fakeMeasure })

    expect(short.fontSize).toBe(STATIC_TEXT_FONT_SIZE)
    expect(tall.fontSize).toBe(STATIC_TEXT_FONT_SIZE)
  })

  it('fits more lines in a taller box', () => {
    // The remedy for overflow is resizing the box, so this must hold.
    const text = 'aaaa bbbb cccc'
    const short = layoutStaticText({ text, width: 50, height: 20, measure: fakeMeasure })
    const tall = layoutStaticText({ text, width: 50, height: 80, measure: fakeMeasure })

    expect(short.overflows).toBe(true)
    expect(tall.overflows).toBe(false)
  })
})

describe('layoutStaticText', () => {
  it('keeps short text on one line and reports no overflow', () => {
    // 'abc' at size 11 measures 33pt, well inside 100pt.
    const result = layoutStaticText({ text: 'abc', width: 100, height: 24, measure: fakeMeasure })

    expect(result.lines).toEqual(['abc'])
    expect(result.overflows).toBe(false)
  })

  it('wraps at word boundaries when text exceeds field width', () => {
    // Each word is 4 chars = 44pt at size 11; two words with a space is 99pt,
    // which exceeds a 50pt box, so each word lands on its own line.
    // 3 lines x 13.2pt line height = 39.6pt, inside an 80pt box.
    const result = layoutStaticText({ text: 'aaaa bbbb cccc', width: 50, height: 80, measure: fakeMeasure })

    expect(result.lines).toEqual(['aaaa', 'bbbb', 'cccc'])
    expect(result.overflows).toBe(false)
  })

  it('packs multiple words onto one line when they fit', () => {
    // 'aaaa bbbb' is 99pt, inside a 120pt box.
    const result = layoutStaticText({ text: 'aaaa bbbb cccc', width: 120, height: 80, measure: fakeMeasure })

    expect(result.lines).toEqual(['aaaa bbbb', 'cccc'])
    expect(result.overflows).toBe(false)
  })

  it('reports overflow when wrapped lines exceed field height', () => {
    // 3 lines x 13.2pt = 39.6pt, which does not fit a 24pt box.
    const result = layoutStaticText({ text: 'aaaa bbbb cccc', width: 50, height: 24, measure: fakeMeasure })

    expect(result.overflows).toBe(true)
  })

  it('treats an unbreakable word wider than the field as overflow', () => {
    const result = layoutStaticText({
      text: 'aaaaaaaaaaaaaaaaaaaa',
      width: 50,
      height: 200,
      measure: fakeMeasure,
    })

    expect(result.overflows).toBe(true)
    // The word is kept whole rather than split mid-word.
    expect(result.lines).toEqual(['aaaaaaaaaaaaaaaaaaaa'])
  })

  it('reports no overflow for empty text', () => {
    const result = layoutStaticText({ text: '', width: 100, height: 24, measure: fakeMeasure })

    expect(result.lines).toEqual([])
    expect(result.overflows).toBe(false)
  })

  it('exposes a line height consistent with the fixed font size', () => {
    const result = layoutStaticText({ text: 'abc', width: 100, height: 24, measure: fakeMeasure })

    expect(result.lineHeight).toBeCloseTo(STATIC_TEXT_FONT_SIZE * STATIC_TEXT_LINE_HEIGHT)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/core/domain/contracts/static-field-layout.test.ts --verbose`
Expected: FAIL — `layoutStaticText is not a function`

- [ ] **Step 3: Write the implementation**

Append to `static-field-layout.ts`:

```typescript
/**
 * Fixed point size for all burned-in static text.
 *
 * Deliberately NOT derived from field height. Line height scales with font
 * size, so a height-derived size makes exactly one line fit at every height —
 * a taller box would enlarge the text rather than admit a second line, and any
 * wrap would always overflow. Holding size fixed means height determines line
 * capacity, which is what makes "resize the box" a real remedy for overflow.
 */
export const STATIC_TEXT_FONT_SIZE = 11
export const STATIC_TEXT_LINE_HEIGHT = 1.2

export type StaticTextLayout = {
  lines: string[]
  fontSize: number
  lineHeight: number
  overflows: boolean
}

/** Measures rendered width of `text` at `size`. Matches pdf-lib's PDFFont.widthOfTextAtSize. */
export type MeasureText = (text: string, size: number) => number

/**
 * Word-wraps text to the field width and reports whether the result fits the
 * field height.
 *
 * Used by BOTH the editor's overflow indicator and the send-time renderer.
 * They must not diverge: an editor that disagrees with the renderer will pass
 * text that overflows in the final PDF with no warning shown.
 */
export function layoutStaticText(params: {
  text: string
  width: number
  height: number
  measure: MeasureText
}): StaticTextLayout {
  const fontSize = STATIC_TEXT_FONT_SIZE
  const lineHeight = fontSize * STATIC_TEXT_LINE_HEIGHT
  const words = params.text.trim().split(/\s+/).filter((word) => word.length > 0)

  if (words.length === 0) {
    return { lines: [], fontSize, lineHeight, overflows: false }
  }

  const lines: string[] = []
  let currentLine = ''
  let hasUnbreakableWord = false

  for (const word of words) {
    if (params.measure(word, fontSize) > params.width) {
      // A single word wider than the field cannot be wrapped. Keep it whole
      // and flag overflow rather than breaking mid-word.
      hasUnbreakableWord = true
    }

    const candidate = currentLine.length > 0 ? `${currentLine} ${word}` : word

    if (currentLine.length > 0 && params.measure(candidate, fontSize) > params.width) {
      lines.push(currentLine)
      currentLine = word
      continue
    }

    currentLine = candidate
  }

  if (currentLine.length > 0) {
    lines.push(currentLine)
  }

  const overflows = hasUnbreakableWord || lines.length * lineHeight > params.height

  return { lines, fontSize, lineHeight, overflows }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/core/domain/contracts/static-field-layout.test.ts --verbose`
Expected: PASS — 13 tests total (4 from Task 1, 9 added here)

- [ ] **Step 5: Stage for commit**

```bash
git add src/core/domain/contracts/static-field-layout.ts src/core/domain/contracts/static-field-layout.test.ts
```

Suggested message: `feat: add shared text wrap and overflow calculation for static fields`

---

## Task 3: Constants for static field types and org assets

**Files:**
- Modify: `src/core/constants/contracts.ts`

- [ ] **Step 1: Add the constants**

Add after the `contractStorage` block (currently `:104-107`):

```typescript
export const orgAssetStorage = {
  privateBucketName: 'org-assets',
  signedUrlExpirySeconds: 60 * 10,
  stampPathForTenant: (tenantId: string) => `stamps/${tenantId}.png`,
} as const
```

Add after the `contractSignatoryFieldTypes` block (currently `:210-220`):

```typescript
/**
 * Field types burned into the PDF before it reaches Zoho, rather than sent as
 * Zoho fields. Zoho never learns about these — it receives an already-stamped
 * document.
 */
export const staticContractFieldTypes = ['STAMP', 'TEXT'] as const

export const isStaticContractFieldType = (fieldType: string): boolean =>
  (staticContractFieldTypes as readonly string[]).includes(fieldType)
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: no errors

- [ ] **Step 3: Stage for commit**

```bash
git add src/core/constants/contracts.ts
```

Suggested message: `feat: add org asset storage and static field type constants`

---

## Task 4: `org-assets` bucket migration

**Files:**
- Create: `supabase/migrations/20260721100000_create_org_assets_bucket.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Private bucket for organisation-level assets (company stamp, etc).
-- Separate from contracts-private: contracts are per-tenant confidential
-- documents; org assets are read by every staff member's signing editor.
insert into storage.buckets (id, name, public)
values ('org-assets', 'org-assets', false)
on conflict (id) do nothing;

-- Reads go through the service role (send-time flattening) or a signed URL
-- minted by our API (editor preview), so no public read policy is granted.
-- Writes are service-role only, performed by scripts/seed-company-stamp.ts.
create policy "org_assets_service_role_all"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'org-assets')
  with check (bucket_id = 'org-assets');
```

- [ ] **Step 2: Verify the file exists and is well-formed**

Run: `cat supabase/migrations/20260721100000_create_org_assets_bucket.sql`
Expected: the SQL above

**Do not apply this migration.** Hand it to the user to apply.

- [ ] **Step 3: Stage for commit**

```bash
git add supabase/migrations/20260721100000_create_org_assets_bucket.sql
```

Suggested message: `feat: add migration creating private org-assets bucket`

---

## Task 5: Stamp seed script

**Files:**
- Create: `scripts/seed-company-stamp.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the script**

```typescript
// scripts/seed-company-stamp.ts
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { readFile } from 'fs/promises'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = 'org-assets'
const SOURCE_PATH = resolve(process.cwd(), 'supabase/assets/company-stamp.png')

async function main(): Promise<void> {
  const tenantId = process.argv.find((arg) => arg.startsWith('--tenant='))?.split('=')[1]
  const confirmed = process.argv.includes('--yes')

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local')
  }

  if (!tenantId) {
    throw new Error('Pass --tenant=<uuid> to choose which tenant this stamp belongs to')
  }

  const targetPath = `stamps/${tenantId}.png`

  // The failure mode that matters is running this against the wrong project,
  // so the target is always printed and never uploaded without --yes.
  console.log(`Supabase project : ${SUPABASE_URL}`)
  console.log(`Bucket / path    : ${BUCKET}/${targetPath}`)
  console.log(`Source file      : ${SOURCE_PATH}`)

  if (!confirmed) {
    console.log('\nDry run. Re-run with --yes to upload.')
    return
  }

  const stampBytes = await readFile(SOURCE_PATH)
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // upsert:true so re-running replaces. "Update the stamp" is the same
  // command as "install the stamp".
  const { error } = await supabase.storage.from(BUCKET).upload(targetPath, stampBytes, {
    contentType: 'image/png',
    upsert: true,
  })

  if (error) {
    throw new Error(`Upload failed: ${error.message}`)
  }

  console.log(`\nUploaded ${stampBytes.byteLength} bytes to ${BUCKET}/${targetPath}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add after the `"seed:test-employee"` line:

```json
    "seed:company-stamp": "tsx scripts/seed-company-stamp.ts",
```

- [ ] **Step 3: Verify the dry run guard works**

Run: `npx tsx scripts/seed-company-stamp.ts --tenant=00000000-0000-0000-0000-000000000000`
Expected: prints project URL, bucket path, source path, then `Dry run. Re-run with --yes to upload.` and exits 0 without uploading.

- [ ] **Step 4: Verify the missing-tenant guard works**

Run: `npx tsx scripts/seed-company-stamp.ts`
Expected: exits 1 with `Pass --tenant=<uuid> to choose which tenant this stamp belongs to`

- [ ] **Step 5: Stage for commit**

```bash
git add scripts/seed-company-stamp.ts package.json
```

Suggested message: `feat: add company stamp seed script`

---

## Task 6: Org asset repository

**Files:**
- Create: `src/core/infra/repositories/supabase-org-asset-repository.ts`

Read `src/core/infra/repositories/supabase-contract-storage-repository.ts` first and follow its client-construction pattern.

- [ ] **Step 1: Write the implementation**

```typescript
// src/core/infra/repositories/supabase-org-asset-repository.ts
import { createServiceSupabase } from '@/core/infra/supabase/service-client'
import { orgAssetStorage } from '@/core/constants/contracts'

class SupabaseOrgAssetRepository {
  /**
   * Returns the tenant's stamp image bytes, or undefined when no stamp is
   * configured. Callers must treat undefined as a hard stop when stamp fields
   * are present — never as "send without the stamp".
   */
  async findStampBytes(tenantId: string): Promise<Uint8Array | undefined> {
    const supabase = createServiceSupabase()
    const { data, error } = await supabase.storage
      .from(orgAssetStorage.privateBucketName)
      .download(orgAssetStorage.stampPathForTenant(tenantId))

    if (error || !data) {
      return undefined
    }

    return new Uint8Array(await data.arrayBuffer())
  }

  /** Signed URL for the editor preview, or undefined when no stamp is configured. */
  async findStampSignedUrl(tenantId: string): Promise<string | undefined> {
    const supabase = createServiceSupabase()
    const { data, error } = await supabase.storage
      .from(orgAssetStorage.privateBucketName)
      .createSignedUrl(orgAssetStorage.stampPathForTenant(tenantId), orgAssetStorage.signedUrlExpirySeconds)

    if (error || !data?.signedUrl) {
      return undefined
    }

    return data.signedUrl
  }
}
```

- [ ] **Step 2: Verify the import path for `createServiceSupabase`**

Run: `npx jest --listTests 2>/dev/null | head -1; grep -rn "createServiceSupabase" src/core/infra/repositories/supabase-contract-storage-repository.ts`
Expected: shows the exact import path used by the existing repository. If it differs from `@/core/infra/supabase/service-client`, correct the import above to match.

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: no errors

- [ ] **Step 4: Stage for commit**

```bash
git add src/core/infra/repositories/supabase-org-asset-repository.ts
```

Suggested message: `feat: add org asset repository for company stamp`

---

## Task 7: PDF static field renderer

**Files:**
- Create: `src/core/domain/contracts/pdf-static-field-renderer.ts`
- Test: `src/core/domain/contracts/pdf-static-field-renderer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/core/domain/contracts/pdf-static-field-renderer.test.ts
import { PDFDocument } from 'pdf-lib'
import { flattenStaticFields, StaticFieldRenderError } from './pdf-static-field-renderer'

async function makePdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let index = 0; index < pageCount; index += 1) {
    doc.addPage([600, 800])
  }
  return doc.save()
}

async function makePng(): Promise<Uint8Array> {
  // 1x1 transparent PNG.
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

describe('flattenStaticFields', () => {
  it('returns the original bytes unchanged when there are no static fields', async () => {
    const pdf = await makePdf(1)

    const result = await flattenStaticFields({ pdfBytes: pdf, fields: [], stampBytes: undefined })

    expect(result).toBe(pdf)
  })

  it('produces a valid loadable PDF after drawing a stamp', async () => {
    const pdf = await makePdf(1)

    const result = await flattenStaticFields({
      pdfBytes: pdf,
      fields: [{ fieldType: 'STAMP', pageNumber: 1, x: 20, y: 10, width: 96, height: 36, textValue: undefined }],
      stampBytes: await makePng(),
    })

    const reloaded = await PDFDocument.load(result)
    expect(reloaded.getPageCount()).toBe(1)
    expect(result).not.toBe(pdf)
  })

  it('draws stamps on every page they are placed on', async () => {
    const pdf = await makePdf(3)

    const result = await flattenStaticFields({
      pdfBytes: pdf,
      fields: [1, 2, 3].map((pageNumber) => ({
        fieldType: 'STAMP' as const,
        pageNumber,
        x: 20,
        y: 10,
        width: 96,
        height: 36,
        textValue: undefined,
      })),
      stampBytes: await makePng(),
    })

    const reloaded = await PDFDocument.load(result)
    expect(reloaded.getPageCount()).toBe(3)
  })

  it('throws when a stamp field is present but no stamp image was supplied', async () => {
    const pdf = await makePdf(1)

    await expect(
      flattenStaticFields({
        pdfBytes: pdf,
        fields: [{ fieldType: 'STAMP', pageNumber: 1, x: 0, y: 0, width: 96, height: 36, textValue: undefined }],
        stampBytes: undefined,
      })
    ).rejects.toThrow(StaticFieldRenderError)
  })

  it('throws when static text overflows its box', async () => {
    const pdf = await makePdf(1)

    await expect(
      flattenStaticFields({
        pdfBytes: pdf,
        fields: [
          {
            fieldType: 'TEXT',
            pageNumber: 1,
            x: 0,
            y: 0,
            width: 40,
            height: 20,
            textValue: 'this is a great deal more text than can possibly fit inside forty points',
          },
        ],
        stampBytes: undefined,
      })
    ).rejects.toThrow(/overflow/i)
  })

  it('draws text that fits without throwing', async () => {
    const pdf = await makePdf(1)

    const result = await flattenStaticFields({
      pdfBytes: pdf,
      fields: [{ fieldType: 'TEXT', pageNumber: 1, x: 10, y: 10, width: 400, height: 24, textValue: 'Hello' }],
      stampBytes: undefined,
    })

    const reloaded = await PDFDocument.load(result)
    expect(reloaded.getPageCount()).toBe(1)
  })

  it('ignores fields whose page number is out of range', async () => {
    const pdf = await makePdf(1)

    const result = await flattenStaticFields({
      pdfBytes: pdf,
      fields: [{ fieldType: 'STAMP', pageNumber: 9, x: 0, y: 0, width: 96, height: 36, textValue: undefined }],
      stampBytes: await makePng(),
    })

    const reloaded = await PDFDocument.load(result)
    expect(reloaded.getPageCount()).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/core/domain/contracts/pdf-static-field-renderer.test.ts --verbose`
Expected: FAIL — `Cannot find module './pdf-static-field-renderer'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/core/domain/contracts/pdf-static-field-renderer.ts
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { layoutStaticText, toPdfRect } from './static-field-layout'

export class StaticFieldRenderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StaticFieldRenderError'
  }
}

export type StaticField = {
  fieldType: 'STAMP' | 'TEXT'
  pageNumber: number
  x: number
  y: number
  width: number
  height: number
  textValue: string | undefined
}

/**
 * Burns stamp images and static text into a copy of the PDF.
 *
 * The caller's bytes are never mutated: flattening happens on the way to Zoho
 * so the stored source document stays clean and a recalled envelope can be
 * re-sent without double-stamping.
 */
export async function flattenStaticFields(params: {
  pdfBytes: Uint8Array
  fields: StaticField[]
  stampBytes: Uint8Array | undefined
}): Promise<Uint8Array> {
  if (params.fields.length === 0) {
    return params.pdfBytes
  }

  const stampFields = params.fields.filter((field) => field.fieldType === 'STAMP')

  if (stampFields.length > 0 && !params.stampBytes) {
    throw new StaticFieldRenderError(
      'A stamp field is placed on this contract but no company stamp is configured for this organisation.'
    )
  }

  const pdfDoc = await PDFDocument.load(params.pdfBytes)
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const pages = pdfDoc.getPages()
  const stampImage = params.stampBytes ? await pdfDoc.embedPng(params.stampBytes) : undefined

  for (const field of params.fields) {
    const page = pages[field.pageNumber - 1]
    if (!page) {
      continue
    }

    const pageHeight = page.getHeight()
    const rect = toPdfRect({
      x: field.x,
      y: field.y,
      width: field.width,
      height: field.height,
      pageHeight,
    })

    if (field.fieldType === 'STAMP' && stampImage) {
      page.drawImage(stampImage, { x: rect.x, y: rect.y, width: rect.width, height: rect.height })
      continue
    }

    if (field.fieldType === 'TEXT') {
      const text = field.textValue?.trim() ?? ''
      if (text.length === 0) {
        continue
      }

      const layout = layoutStaticText({
        text,
        width: field.width,
        height: field.height,
        measure: (value, size) => font.widthOfTextAtSize(value, size),
      })

      if (layout.overflows) {
        throw new StaticFieldRenderError(
          `Static text on page ${field.pageNumber} overflows its box. Widen the box or shorten the text.`
        )
      }

      layout.lines.forEach((line, index) => {
        // Text is drawn from the top of the box downward. pdf-lib positions
        // text by its baseline, so the first line sits one line-height below
        // the box top edge.
        const baselineY = rect.y + rect.height - layout.lineHeight * (index + 1)
        page.drawText(line, {
          x: rect.x,
          y: baselineY,
          size: layout.fontSize,
          font,
          color: rgb(0, 0, 0),
        })
      })
    }
  }

  return pdfDoc.save()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/core/domain/contracts/pdf-static-field-renderer.test.ts --verbose`
Expected: PASS — 7 tests

- [ ] **Step 5: Stage for commit**

```bash
git add src/core/domain/contracts/pdf-static-field-renderer.ts src/core/domain/contracts/pdf-static-field-renderer.test.ts
```

Suggested message: `feat: add pdf static field renderer for stamps and text`

---

## Task 8: Wire flattening into the send path

**Files:**
- Modify: `src/core/domain/contracts/schemas.ts:276-285` and `:325-335`
- Modify: `src/core/domain/contracts/contract-signatory-service.ts:271-296`
- Modify: `src/core/infra/integrations/zoho-sign/zoho-sign-client.ts:401-435`
- Test: `src/core/domain/contracts/contract-signatory-service.test.ts`

- [ ] **Step 1: Add `text_value` to both field schemas**

In `src/core/domain/contracts/schemas.ts`, add this line to **both** `contractSignatoryFieldSchema` and `contractSigningPreparationFieldSchema`, immediately after their `anchor_string` lines:

```typescript
    text_value: z.string().trim().max(2000).optional(),
```

`fields` is a JSONB column, so no migration is required.

- [ ] **Step 2: Write the failing test for static field partitioning**

Add to `src/core/domain/contracts/contract-signatory-service.test.ts`. Follow the existing mock/setup style in that file — reuse whatever harness the neighbouring `sendSigningPreparationDraft` or `assignSignatory` tests already build rather than inventing a new one.

```typescript
describe('static field handling', () => {
  it('excludes STAMP and TEXT from the fields sent to Zoho', async () => {
    // Arrange a draft with one SIGNATURE, one STAMP and one TEXT field for a
    // single recipient, using the existing test harness in this file.
    // Act: send the draft.
    // Assert: the fields passed to signatureProvider.createSigningEnvelope
    // contain only the SIGNATURE field.
    const sentFields = createSigningEnvelopeMock.mock.calls[0][0].recipients[0].fields
    expect(sentFields.map((field: { field_type: string }) => field.field_type)).toEqual(['SIGNATURE'])
  })

  it('rejects a recipient whose only fields are STAMP and TEXT', async () => {
    // assertSignatureFieldPerRecipient already enforces this. Pinning it here
    // because the flattening design now depends on the invariant: without it,
    // filtering static fields out could leave Zoho with an empty field array.
    await expect(sendDraftWithOnlyStaticFields()).rejects.toThrow('SIGNATURE field is required')
  })

  it('throws when the document is not a PDF and static fields are present', async () => {
    // pdf-lib cannot flatten DOCX. Sending it with stamps silently dropped
    // would put an unsealed contract in front of a counterparty.
    await expect(sendDraftWithDocxAndStamp()).rejects.toThrow(/PDF/i)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest src/core/domain/contracts/contract-signatory-service.test.ts -t "static field handling" --verbose`
Expected: FAIL — static fields are still present in the Zoho payload

- [ ] **Step 4: Filter static fields out of the Zoho payload**

> **CORRECTED DURING EXECUTION.** As originally written, Steps 4 and 5 were mutually exclusive and would have silently dropped every stamp. Step 4 filtered `STAMP`/`TEXT` out of `recipientFields` — but that array *is* what gets passed into `assignSignatory` as `params.recipients`, which Step 5 then reads to decide what to flatten. It would always have been empty: no Zoho field, no burned image, no error.
>
> **The exclusion belongs at the Zoho boundary, after flattening** — inside `assignSignatory`, on the `createSigningEnvelope` payload:
>
> ```typescript
> fields: recipient.fields.filter((field) => !isStaticContractFieldType(field.fieldType)),
> ```
>
> This is also the only location that covers the direct `POST /api/contracts/[contractId]/signatories` route, which passes recipients straight through and would have bypassed a filter in `sendSigningPreparationDraft` entirely. It additionally leaves static fields in the persisted `fieldConfig`, preserving the audit record of what was placed.
>
> The block below is retained for context. Do not apply it as written.

In `contract-signatory-service.ts`, in `sendSigningPreparationDraft` where `recipientFields` is built (currently `:514-527`), add a filter before `.map`:

```typescript
        const recipientFields = draft.fields
          .filter((field) => field.assignedSignerEmail.trim().toLowerCase() === recipientEmail)
          // STAMP and TEXT are burned into the PDF (see pdf-static-field-renderer),
          // so Zoho must never receive them as fields — it would draw its own
          // upload box on top of the flattened content.
          .filter((field) => !isStaticContractFieldType(field.fieldType))
          .map((field) => ({
```

Add the import at the top of the file:

```typescript
import { isStaticContractFieldType } from '@/core/constants/contracts'
```

- [ ] **Step 5: Flatten the PDF before envelope creation**

In `assignSignatory`, insert between the document fetch `catch` block (ends `:271`) and the `let envelope:` declaration (`:273`):

```typescript
    const staticFields = params.recipients
      .flatMap((recipient) => recipient.fields)
      .filter((field) => isStaticContractFieldType(field.field_type))
      .map((field) => ({
        fieldType: field.field_type as 'STAMP' | 'TEXT',
        pageNumber: field.page_number ?? 1,
        x: field.x_position ?? 0,
        y: field.y_position ?? 0,
        width: field.width ?? 0,
        height: field.height ?? 0,
        textValue: field.text_value,
      }))

    if (staticFields.length > 0) {
      // pdf-lib cannot flatten DOCX/DOC. Sending one with the stamps silently
      // dropped would put an unsealed contract in front of a counterparty.
      const isPdf = documentMimeType.includes('pdf') || download.fileName.toLowerCase().endsWith('.pdf')
      if (!isPdf) {
        throw new BusinessRuleError(
          'CONTRACT_STATIC_FIELDS_REQUIRE_PDF',
          'Stamp and text fields can only be applied to PDF documents. Convert this contract to PDF and try again.'
        )
      }

      const stampBytes = staticFields.some((field) => field.fieldType === 'STAMP')
        ? await this.orgAssetRepository.findStampBytes(params.tenantId)
        : undefined

      documentBytes = await flattenStaticFields({ pdfBytes: documentBytes, fields: staticFields, stampBytes })
    }
```

Add the imports:

```typescript
import { flattenStaticFields } from './pdf-static-field-renderer'
```

Inject `orgAssetRepository` through the service constructor following the pattern used for the other repositories already injected there.

- [ ] **Step 6: Reject static field types in the Zoho client defensively**

In `zoho-sign-client.ts`, at the top of `mapFieldToZohoField` (`:401`):

```typescript
    if (field.fieldType === 'STAMP' || field.fieldType === 'TEXT') {
      // These are flattened into the PDF upstream and must never reach Zoho.
      // Reaching here means the filter in sendSigningPreparationDraft was bypassed.
      throw new Error(`Static field type ${field.fieldType} must be flattened, not sent to Zoho`)
    }
```

Remove the now-unreachable `STAMP` and `TEXT` cases from `resolveZohoFieldType` (`:509-516` and `:541-548`).

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx jest src/core/domain/contracts/ --verbose`
Expected: PASS, including all pre-existing tests in the directory

- [ ] **Step 8: Type-check**

Run: `npm run type-check`
Expected: no errors

- [ ] **Step 9: Stage for commit**

```bash
git add src/core/domain/contracts/ src/core/infra/integrations/zoho-sign/zoho-sign-client.ts
```

Suggested message: `feat: flatten stamp and text fields into pdf before sending to zoho`

---

## Task 9: Stamp preview API route

**Files:**
- Create: `src/app/api/contracts/org-assets/stamp/route.ts`

Read a neighbouring route under `src/app/api/contracts/` first and copy its auth wrapper and tenant-resolution pattern exactly.

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/contracts/org-assets/stamp/route.ts
import { supabaseOrgAssetRepository } from '@/core/infra/repositories/supabase-org-asset-repository'

// Wrap with the same withAuth helper used by neighbouring contract routes
// (src/core/http/with-auth.ts) and resolve tenantId from the session the same
// way they do.
export const GET = withAuth(async ({ tenantId }) => {
  const signedUrl = await supabaseOrgAssetRepository.findStampSignedUrl(tenantId)

  // 200 with configured:false rather than 404: "no stamp configured" is a
  // normal state the editor renders a disabled palette for, not an error.
  return Response.json({ configured: Boolean(signedUrl), signedUrl: signedUrl ?? null })
})
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: no errors

- [ ] **Step 3: Stage for commit**

```bash
git add src/app/api/contracts/org-assets/stamp/route.ts
```

Suggested message: `feat: add stamp preview endpoint`

---

## Task 10: Generalize all-pages mirroring to stamps

**Files:**
- Modify: `src/modules/contracts/ui/PrepareForSigningModal.tsx`

Five hardcoded `SIGNATURE` checks become one predicate.

- [ ] **Step 1: Add the predicate**

After `isImageFieldType` (`:124`):

```typescript
const allPagesFieldTypes: FieldType[] = ['SIGNATURE', 'STAMP']
const supportsAllPages = (fieldType: FieldType) => allPagesFieldTypes.includes(fieldType)
```

- [ ] **Step 2: Rename the state**

`:186` — rename `applySignatureToAllPages` → `applyToAllPages` and `setApplySignatureToAllPages` → `setApplyToAllPages`. Update every reference.

- [ ] **Step 3: Generalize `removeFieldWithCurrentScope`**

Replace the body at `:485-494`:

```typescript
  const removeFieldWithCurrentScope = (current: DraftField[], field: DraftField, scope: 'page' | 'group') => {
    // Scope keys off mirrorGroupId, not the live toolbar toggle: a field
    // mirrored at placement time must still delete as a group after the
    // toggle is switched off.
    if (scope === 'group' && field.mirrorGroupId) {
      return current.filter((item) => item.mirrorGroupId !== field.mirrorGroupId)
    }

    return current.filter((item) => item.id !== field.id)
  }
```

Update the existing call at `:1208` to pass `'page'`.

- [ ] **Step 4: Generalize the placement logic**

At `:628-638`, replace the three `selectedFieldType === 'SIGNATURE' && applySignatureToAllPages` conditions with `supportsAllPages(selectedFieldType) && applyToAllPages`, and the hit-test's `field.fieldType !== 'SIGNATURE'` with `field.fieldType !== selectedFieldType`.

Update the `removeFieldWithCurrentScope` call at `:657` to pass `'group'`.

- [ ] **Step 5: Show the toggle for stamps too**

At `:1103`, replace `selectedFieldType === 'SIGNATURE' ?` with `supportsAllPages(selectedFieldType) ?` and change the label text to `Add on all pages`.

- [ ] **Step 6: Verify in the browser**

Run: `npm run dev`

Open a contract, click **Prepare for Signing**, select **STAMP**, tick **Add on all pages**, click on the page. Confirm:
- A stamp chip appears on the current page.
- Navigating with Next shows a chip in the same relative position on every page.
- Unticking the toggle, then clicking one stamp's delete-all handle, still removes every copy.

- [ ] **Step 7: Run existing modal tests**

Run: `npx jest src/modules/contracts/ui/PrepareForSigningModal.test.tsx --verbose`
Expected: PASS — no regressions

- [ ] **Step 8: Stage for commit**

```bash
git add src/modules/contracts/ui/PrepareForSigningModal.tsx
```

Suggested message: `feat: support apply-to-all-pages for stamp fields`

---

## Task 11: Chip handles — delete, delete-all, reset

**Files:**
- Modify: `src/modules/contracts/ui/PrepareForSigningModal.tsx:1194-1224`
- Modify: `src/modules/contracts/ui/prepare-for-signing-modal.module.css`

The chip is a `<button>`, so nested `<button>` elements are invalid HTML. Follow the existing resize-handle idiom (`:1216-1223`): a `<span role="presentation">` whose `onClick` calls `stopPropagation()` and `preventDefault()`.

- [ ] **Step 1: Add the reset handler**

Near `removeFieldWithCurrentScope`:

```typescript
  const resetFieldSize = (field: DraftField) => {
    const defaults = defaultFieldSizeByType[field.fieldType]

    setFields((current) =>
      current.map((item) => {
        // Reset is always group-wide, deliberately unlike delete: mismatched
        // sizes across pages is the problem it exists to solve.
        const isInScope = field.mirrorGroupId ? item.mirrorGroupId === field.mirrorGroupId : item.id === field.id

        return isInScope ? { ...item, width: defaults.width, height: defaults.height } : item
      })
    )
  }
```

- [ ] **Step 2: Add the handles to the chip**

Inside the chip `<button>`, after the existing resize handle span:

```tsx
                      <span
                        className={styles.chipHandle}
                        role="presentation"
                        title="Remove from this page"
                        onClick={(event) => {
                          event.stopPropagation()
                          event.preventDefault()
                          setFields((current) => removeFieldWithCurrentScope(current, field, 'page'))
                        }}
                      >
                        ×
                      </span>
                      {field.mirrorGroupId ? (
                        <span
                          className={styles.chipHandle}
                          role="presentation"
                          title="Remove from all pages"
                          onClick={(event) => {
                            event.stopPropagation()
                            event.preventDefault()
                            setFields((current) => removeFieldWithCurrentScope(current, field, 'group'))
                          }}
                        >
                          ⨯⨯
                        </span>
                      ) : null}
                      <span
                        className={styles.chipHandle}
                        role="presentation"
                        title="Reset to default size"
                        onClick={(event) => {
                          event.stopPropagation()
                          event.preventDefault()
                          resetFieldSize(field)
                        }}
                      >
                        ↺
                      </span>
```

- [ ] **Step 3: Add the CSS**

In `prepare-for-signing-modal.module.css`, matching the existing `.resizeHandle` conventions:

```css
.chipHandle {
  position: absolute;
  top: -8px;
  width: 16px;
  height: 16px;
  line-height: 16px;
  text-align: center;
  font-size: 10px;
  border-radius: 50%;
  background: #1f2937;
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease;
}

/* Handles stay hidden until hover so the idle chip is not crowded.
   Stamps default to 96x36pt and already carry label text and a resize handle. */
.fieldChip:hover .chipHandle,
.fieldChip:focus-within .chipHandle {
  opacity: 1;
}

.chipHandle:nth-of-type(1) { right: 22px; }
.chipHandle:nth-of-type(2) { right: 40px; }
.chipHandle:nth-of-type(3) { right: 58px; }
```

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev`

Place a stamp with **Add on all pages** on. Hover a chip and confirm:
- Three handles appear (×, ⨯⨯, ↺).
- `×` removes only the current page's stamp; other pages keep theirs.
- `⨯⨯` removes every copy.
- Resize a stamp, then `↺` restores default size on every page.
- Clicking a handle never also deletes the chip via the parent button.
- On a non-mirrored field, the `⨯⨯` handle does not render.

**If the handles are too small to hit reliably at normal zoom, stop and report it** rather than shrinking hit targets further. The spec flags this as the point to reconsider in favour of modifier keys.

- [ ] **Step 5: Stage for commit**

```bash
git add src/modules/contracts/ui/PrepareForSigningModal.tsx src/modules/contracts/ui/prepare-for-signing-modal.module.css
```

Suggested message: `feat: add delete-page, delete-all and reset-size handles to field chips`

---

## Task 12: Text input, overflow indicator, stamp preview and palette gating

**Files:**
- Modify: `src/modules/contracts/ui/PrepareForSigningModal.tsx`
- Modify: `src/modules/contracts/ui/prepare-for-signing-modal.module.css`

- [ ] **Step 1: Add `textValue` to the draft field type**

At `:29` and `:43`, add to both field type declarations:

```typescript
  textValue?: string
```

Include `text_value: field.textValue` in the save payloads at `:886` and `:940`, and read it back when loading a draft.

⚠️ **Three places must all carry `textValue`, or static text renders blank with no error.** Task 8 established the flattening path but could not complete this wiring, because the property did not exist on the type yet:

1. `getSigningPreparationDraft`'s return type in `src/core/infra/repositories/supabase-contract-query-repository.ts` — add `textValue` to the field shape it returns.
2. The `recipientFields` map inside `sendSigningPreparationDraft` (`contract-signatory-service.ts`, ~`:514-527`) — add `text_value: field.textValue`.
3. This modal's save/load payloads.

Miss any one and `flattenStaticFields` receives `textValue: undefined`, hits its empty-text early return, and skips the field silently. Stamps are unaffected — they carry no per-field value — so this fails for text only. Verify by placing a TEXT field, sending, and confirming the text appears in the resulting PDF.

- [ ] **Step 2: Load the stamp asset state**

Add state and a fetch on modal open:

```typescript
  const [stampSignedUrl, setStampSignedUrl] = useState<string | null>(null)
  const [isStampConfigured, setIsStampConfigured] = useState(true)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    void (async () => {
      const response = await fetch('/api/contracts/org-assets/stamp')
      if (!response.ok) {
        setIsStampConfigured(false)
        return
      }

      // okResponse wraps the payload one level under `data` — this is the
      // house convention for every route in the codebase.
      const payload = (await response.json()) as {
        ok: boolean
        data: { configured: boolean; signedUrl: string | null }
      }
      setIsStampConfigured(payload.data.configured)
      setStampSignedUrl(payload.data.signedUrl)
    })()
  }, [isOpen])
```

- [ ] **Step 3: Gate the STAMP palette item**

In the palette map (`:1078-1089`), disable STAMP when unconfigured:

```tsx
                  disabled={!canEdit || (fieldType === 'STAMP' && !isStampConfigured)}
                  title={
                    fieldType === 'STAMP' && !isStampConfigured
                      ? 'No company stamp configured for this organisation'
                      : undefined
                  }
```

- [ ] **Step 4: Render the stamp image inside stamp chips**

In the chip body, when `field.fieldType === 'STAMP' && stampSignedUrl`, render the image so users can size it accurately:

```tsx
                      {field.fieldType === 'STAMP' && stampSignedUrl ? (
                        <img src={stampSignedUrl} alt="Company stamp" className={styles.stampPreview} />
                      ) : null}
```

With CSS:

```css
.stampPreview {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}
```

- [ ] **Step 5: Add the text input and overflow indicator**

For `TEXT` chips, render an input bound to `textValue`, and flag overflow using the **same** `layoutStaticText` used by the renderer:

```tsx
                      {field.fieldType === 'TEXT' ? (
                        <input
                          className={styles.chipTextInput}
                          value={field.textValue ?? ''}
                          placeholder="Static text"
                          disabled={!canEdit}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => {
                            const nextValue = event.target.value
                            setFields((current) =>
                              current.map((item) => (item.id === field.id ? { ...item, textValue: nextValue } : item))
                            )
                          }}
                        />
                      ) : null}
```

Import `layoutStaticText` from `@/core/domain/contracts/static-field-layout` and apply an overflow class to the chip when it reports overflow. Measure with an approximation of Helvetica metrics — the renderer uses `font.widthOfTextAtSize`, which is unavailable in the browser without loading the font.

**This is the one place the editor and renderer can legitimately diverge.** Approximate measurement may disagree at the margins. That is acceptable only because the renderer throws on overflow at send time, so a disagreement produces a blocked send with a clear message rather than a silently overflowing PDF. Do not remove the renderer-side check on the grounds that the editor already warns.

- [ ] **Step 6: Verify in the browser**

Run: `npm run dev`

- Select TEXT, place a field, type into it. Text persists across a page navigation and a modal reopen.
- Type well past the box width — the chip shows the overflow state.
- Select STAMP with a configured stamp — the real image renders in the chip and scales with resize.
- Temporarily rename the stamp object in Supabase Storage and reopen — the STAMP palette item is disabled with the tooltip.

- [ ] **Step 7: Run the modal tests**

Run: `npx jest src/modules/contracts/ui/PrepareForSigningModal.test.tsx --verbose`
Expected: PASS

- [ ] **Step 8: Full check**

Run: `npm run type-check && npx jest --verbose`
Expected: type-check clean, full suite passing

- [ ] **Step 9: Stage for commit**

```bash
git add src/modules/contracts/ui/
```

Suggested message: `feat: add static text input, stamp preview and palette gating`

---

## Manual verification before merge

The unit tests cover geometry and partitioning, but the coordinate flip can only be confirmed against a real rendered document.

- [ ] Place a stamp in the **top-left corner** of page 1, send to Zoho, open the resulting document. The stamp must appear top-left — not bottom-left.
- [ ] Place a stamp in the **bottom-right corner**, repeat. A flip bug that survives centred testing shows up here.
- [ ] Place a stamp with **all pages** on a document with pages of **differing sizes** (e.g. A4 followed by Letter). The stamp must sit in the same relative position on each.
- [ ] Confirm the document stored in `contracts-private` is **unstamped** after sending — flattening must not have mutated the source.
- [ ] Recall the envelope and re-send. The stamp must appear **once**, not twice.
