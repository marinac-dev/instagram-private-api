# Changelog

## 3.0.0

Maintenance release: Node floor raised, the dependency set brought current, and
hard-coded values made overridable.

### Breaking changes

- **Node.js >= 24.18.0 is required** (was >= 20). CI now tests Node 24 only.
- Removed the dead `PostingIgtvOptions.transcodeDelay` / `maxTranscodeTries`
  knobs (they documented a `resolveTranscode` implementation that has been
  commented out for years).
- `QpRepository.surfacesToQueries` / `surfacesToTriggers` are getters over
  `state.constants` now; assign overrides through `state.constants` instead of
  writing the fields.

### Behavior fixes

- Direct-thread video/voice transcode wait unified to the shared
  5000 ms default (was 4000 ms); restore per-instance via
  `state.constants.TRANSCODE_DELAY_MS`.
- Album and story-video publishes now actually wait on a `202 Transcode
  pending` response (previously the missing fallback waited ~0 ms).
- The IGTV `configureToIgtv` retry loop now throws `IgConfigureVideoError` when
  retries are exhausted (previously the dead `i >= 6` bounds check made it
  return `undefined`).

### Configuration

- `Constants` module is exported from the package root; every new constant is
  overridable per instance via `ig.state.constants` (survives
  `serialize()`/`deserialize()`): `TRANSCODE_DELAY_MS`,
  `CONFIGURE_MAX_ATTEMPTS`, `CONFIGURE_RETRY_BASE_DELAY_MS`,
  `SEGMENTED_VIDEO_CHUNK_SIZE`, `UPLOAD_PHOTO_QUALITY`,
  `WEB_USER_AGENT_CHROME_VERSION`, `INSIGHTS_DOCUMENT_IDS` (six GraphQL
  document IDs moved out of insights service/feeds), `QP_SURFACES_TO_QUERIES`
  / `QP_SURFACES_TO_TRIGGERS`, `LAUNCHER_PRELOGIN_CONFIGS`
  / `LAUNCHER_POSTLOGIN_CONFIGS`.
- `state.devices` / `state.builds` are public per-instance pools used by
  `generateDevice()` (previously the fixed `src/samples/*.json` lookups).
- New docs: `AGENTS.md` (integration guide for AI agents) and `MIGRATION.md`
  (1.46.1 → 2.0.0 → 3.0.0); README gained a Configuration section.

### Dependencies

- snakecase-keys 3 → 4 (last CommonJS major; 5+ is pure ESM and breaks the
  CommonJS build), tough-cookie 5 → 6, url-regex-safe 3 → 4,
  ts-custom-error 2 → 3
- `@types/node` tracks Node 24
- Dev tooling: ESLint 9 → 10, Vitest 3 → 5, dotenv 6 → 17, inquirer 1 → 14,
  lint-staged 16 → 17; in-range refreshes for axios, lodash, chance,
  @lifeomic/attempt and others
- `typescript` stays on 5.9 (typedoc 0.28 does not support newer majors)

## 2.0.0

Breaking modernization release. Thanks to the botched HTTP stack of 2020 being
finally retired, the library now builds on maintained dependencies end to end.

### Breaking changes

- **Node.js >= 20 is required** (was >= 8).
- `Request#send()` accepts `IgRequestOptions` (exported from `types`) instead of
  the `request` library's `Options`. The option names (`url`, `method`, `form`,
  `qs`, `body`, `headers`) are unchanged, so most call sites compile as-is.
- `IgResponse` is now a plain exported interface instead of deriving from
  `request`'s `Response` type. The consumed fields (`statusCode`,
  `statusMessage`, `headers`, `body`, `request.method`, `request.uri.path`)
  are unchanged.
- `request`, `request-promise`, `bluebird` and `utility-types` are no longer
  dependencies; `axios` and `hpagent` are.

### HTTP layer

- Rewrote `src/core/request.ts` on **axios**; the deprecated
  `request`/`request-promise` stack is gone. Cookies (tough-cookie jar),
  gzip, `strictSSL: false` and retry behavior are preserved; proxies now use
  hpagent agents; `json-bigint` body parsing is unchanged.
- `State` now owns a `tough-cookie` `CookieJar` directly, removing the
  request-specific `jar()` wrapper and internal `_jar` field access.
- Bluebird removed: `Bluebird.try(...).catch(IgResponseError, h)` became the
  exported `withIgResponseErrorHandler` helper; `Bluebird.map` became
  `mapWithConcurrency`; delays use `timers/promises`.

### Dependencies

- TypeScript 4.3 → 5.9, `esModuleInterop` enabled (fixes five latent type errors)
- tough-cookie 2 → 5, rxjs 6 → 7, luxon 1 → 3, class-transformer 0.3 → 0.5,
  image-size 0.7 → 2, reflect-metadata 0.2

### Tooling & tests

- tslint → ESLint 9 (flat config) with typescript-eslint; Prettier 3;
  husky 9 + lint-staged pre-commit
- The test script pointed at a `tests/` directory that did not exist; the
  suite now runs on **Vitest** with 24 offline tests covering signing, the
  request layer (local http server), state (de)serialization, feed
  pagination and error mapping
- GitHub Actions CI (Node 20/22/24) runs lint, typecheck, build and tests
