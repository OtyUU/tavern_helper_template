# Manifest-Based Asset Scoring for Ren'Py Player

## Goal

Replace filename construction with manifest lookup + scoring. The manifest is stored in a tavern helper variable as JSON, loaded synchronously via `getVariables()`. Scoring replaces `resolveTokens()`, path construction, and the blush fallback chain. No `poseTokens`, `assetExtensions`, `defaultPose`, or `defaultExpression` configuration needed for normal use.

## User Decisions

- **Clean break** — no fallback to path construction. Manifest required.
- **Scoring for both** sprites and backgrounds.
- **Below threshold = no asset** (SmartImage shows nothing).

---

## Phase 1: Types (`types.ts`)

### Add

```ts
type AssetManifest = {
  bg: Array<[filename: string, slug: string, tags: string[]]>;
  sprites: Record<string, Record<string, Record<string, Array<[filename: string, expression: string, modifiers: string[]]>>>>;
};
```

Hierarchy: `sprites[character][outfit][pose]` → array of `[file, expr, mods]`.

### Remove from `CharacterSpriteConfig`

- `poseTokens` field

### Remove from `FrameBuildOptions`

- `assetExtensions`
- `globalPoseTokens`
- `defaultPose`
- `defaultExpression`

### Add to `FrameBuildOptions`

- `manifest: AssetManifest`

### Add to settings schema (later in settings.ts)

- `renpyManifest: string` — raw JSON text stored in variable
- `manifestSourceUrl: string` — optional URL for "fetch and store" button

---

## Phase 2: Settings (`settings.ts`)

### Schema changes

Add to `BaseSettingsSchema`:
```ts
renpyManifest: z.string().default(''),
manifestSourceUrl: z.string().default(''),
```

Remove from `BaseSettingsSchema`:
```ts
assetExtensions
globalPoseTokens
defaultPose
defaultExpression
```

### Remove computed

- `assetExtensions` computed
- `globalPoseTokens` computed

### Remove from `CharacterSpriteConfigEntryFieldSchemas`

- `poseTokens` field

### Add manifest parsing

Same reactive pattern as existing `characterSpriteConfigParsed`:

```ts
const manifestParsed = ref<AssetManifest>({ bg: [], sprites: {} });
const manifestError = ref<string | null>(null);

watch(
  () => settings.value.renpyManifest,
  (raw) => {
    if (!raw?.trim()) {
      manifestParsed.value = { bg: [], sprites: {} };
      manifestError.value = null;
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      // shape validation
      manifestParsed.value = parsed;
      manifestError.value = null;
    } catch (e) {
      manifestParsed.value = { bg: [], sprites: {} };
      manifestError.value = e instanceof Error ? e.message : 'Invalid JSON';
    }
  },
  { immediate: true },
);
```

Expose `manifest`, `manifestError` from the store.

### Remove storeToRefs

Remove `assetExtensions`, `globalPoseTokens` from what's returned and destructured.

---

## Phase 3: Scoring Engine (`parser.ts`)

This is the core change. Replace all path construction with scoring against the manifest.

### Functions to delete

| Function | Lines | Reason |
|---|---|---|
| `buildCandidates()` | 35–39 | No path construction |
| `joinPath()` | 41–53 | Paths come from manifest |
| `trimTrailingSlash()` | 31–33 | Only path construction used it |
| `createBackgroundAsset()` | 333–346 | Replaced by scoring |
| `createSpriteAssetOutfitPose()` | 350–373 | Replaced by scoring |
| `resolveTokens()` | 393–410 | No token classification |
| `getCharacterConfig()` | 377–386 | Only returned poseTokens |
| `buildSpriteAsset()` | 455–463 | Merged into scoring |

### New functions

**`flattenSprites(manifest, character)`** — flatten hierarchical sprite entries into flat array for scoring.

**`scoreSpriteEntry(entry, tokens, requestedModifiers, preferredOutfit, defaultOutfit)`** — score a single sprite entry against a request. Returns number. Key scoring dimensions:
- outfit match: +100 (preferred), +40 (default), -200 (wrong explicit)
- token match: each token checked against `[pose, expression, ...modifiers]` → +50 match, -30 miss
- modifier match: requested modifiers → +25 present, -15 missing; extra asset modifiers → -10 each
- tiebreaker: prefer fewer extra modifiers (-2 per modifier)

**`findBestSprite(manifest, query, rememberedOutfit, defaultOutfit)`** — iterate flat list, score each, return best if score ≥ 0, else undefined.

**`scoreBackgroundEntry(entry, background, segment)`** — score a bg entry. Exact slug match + tags match.

**`findBestBackground(manifest, background, segment)`** — iterate bg array, return best if score ≥ 0.

### Modify `resolveShowState()`

Replace `resolveTokens` + `createSpriteAssetOutfitPose` + `buildSpriteAsset` with:

1. Build `query` from command tokens + modifiers
2. Determine preferred outfit: `command.outfit ?? existing?.outfit ?? rememberedOutfits[id] ?? defaultOutfit`
3. Call `findBestSprite(manifest, query, preferredOutfit, defaultOutfit)`
4. Build `SpriteState` from the best match (outfit/pose/expression/modifiers come from the manifest entry, not from the request)

**Blush persistence**: Before scoring, compute effective modifiers:
- explicit `blush` → include `"blush"`
- no explicit `blush`, command has tokens → don't include (expression likely changing)
- no explicit `blush`, no tokens → carry forward from `existing?.blush`

### Modify `StageState.apply()` — scene command

Replace `createBackgroundAsset()` call with `findBestBackground()`.

### Modify `buildFrames()` / `getInitialState()`

Pass `manifest` from `FrameBuildOptions` through to scoring functions. No other changes needed.

### Helper: `getDefaultOutfit()`

```ts
function getDefaultOutfit(character: string, options: FrameBuildOptions): string {
  return options.characterSpriteConfig[character]?.defaultOutfit ?? 'default';
}
```

Replaces `getCharacterConfig()`.

---

## Phase 4: App.vue Wiring

### Remove store refs

Remove destructured refs for:
- `assetExtensions`
- `globalPoseTokens`

### Add manifest ref

```ts
const { manifest, manifestError } = storeToRefs(settingsStore);
```

### Update `buildOptions`

```ts
const buildOptions = {
  assetRoot: settings.value.assetRoot,
  manifest: manifest.value,
  characterSpriteConfig: characterSpriteConfig.value,
};
```

Remove: `assetExtensions`, `defaultPose`, `defaultExpression`, `globalPoseTokens`.

### Update diagnostics panel

- Show manifest error if present
- Show matched asset path from manifest instead of constructed candidates
- Remove `assetExtensions` display

---

## Phase 5: SettingsPanel.vue

### Assets section

Replace "Asset extensions" field with:

1. **Manifest textarea** — `v-model="settings.renpyManifest"`, tall textarea (~8 rows)
   - Small help text explaining format
   - Show `manifestError` in red if JSON parse fails
2. **Manifest source URL** — `v-model="settings.manifestSourceUrl"`
3. **"Load from URL" button** — fetches from `manifestSourceUrl`, stores result in `settings.renpyManifest`
   - Loading state, error handling
   - Validates JSON before storing

Remove:
- "Asset extensions" input

Update path examples to reflect manifest-based resolution.

### Character layouts section

Remove:
- "Default pose token" input
- "Default expression token" input
- "Global pose tokens" input

Keep:
- "Sprite reference height"
- "Character sprite config JSON" (but update help text — remove `poseTokens` mention)

Update placeholder:
```json
{
  "_note": "Settings for VN Player",
  "chinami": {
    "defaultOutfit": "pajamas",
    "referenceHeight": 2000
  }
}
```

---

## Phase 6: Build Tool (Optional)

A Node.js script that scans an asset directory and generates the manifest JSON.

Location: `scripts/generate-manifest.mjs` (or similar)

Logic:
1. Scan `<assetDir>/bg/` for files matching `<id>_<slug>[+<tag>...].<ext>`
2. Scan `<assetDir>/<character>/<outfit>/<pose>/` for sprite files
3. Parse each filename: `split("_", 1)` → `[id, rest]`, `rest.replace(ext, "").split("+")` → `[slug, ...mods]`
4. Build `AssetManifest` structure
5. Write JSON to stdout or file

Not required for the player to work — users can write manifests manually or use their own tools. Included as a convenience.

---

## Phase 7: Context Updates

### `src/renpy-player/context.md`

Update:
- "Asset Resolution" section: describe manifest + scoring, remove path construction docs
- "Settings That Matter": remove deleted settings, add `renpyManifest`, `manifestSourceUrl`
- "Script Grammar" semantics: note that tokens are matched by scoring, not by classification
- "State And Frames": update `FrameBuildOptions` description
- "Sharp Edges": note that manifest is required, empty manifest = no assets

---

## File Change Summary

| File | Action |
|---|---|
| `types.ts` | Modify: add `AssetManifest`, remove deprecated fields |
| `settings.ts` | Modify: add manifest schema + parsing, remove deprecated settings |
| `parser.ts` | Major rewrite: delete ~96 lines of path construction, add ~80 lines of scoring |
| `App.vue` | Modify: rewire store refs, update buildOptions, update diagnostics |
| `SettingsPanel.vue` | Modify: add manifest textarea + URL + button, remove deprecated fields |
| `context.md` | Update documentation |
| `scripts/generate-manifest.mjs` | New file (optional) |

## Execution Order

1. `types.ts` — add `AssetManifest`, update `FrameBuildOptions`, remove deprecated fields
2. `settings.ts` — add manifest schema + parsing, remove deprecated settings/computeds
3. `parser.ts` — scoring engine + delete path construction
4. `App.vue` — rewire store → buildOptions
5. `SettingsPanel.vue` — UI changes
6. `context.md` — documentation
7. Build tool (optional, can be deferred)

Phases 1–2 can be done together. Phase 3 is the largest change. Phases 4–5 are wiring. Phase 6 is isolated.
