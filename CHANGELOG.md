# Changelog

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
