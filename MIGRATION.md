# Migrating from 1.x to 3.x

This guide covers upgrading the open-source `instagram-private-api` from the original **1.46.1** line (last release of the 1.x series) through **2.0.0** to the current **3.x** line.

> **Naming note:** the README's "Next Major Version" section describes a *different*, paid 3.x ecosystem (monorepo with Android/Web/Realtime packages). This guide is about the free open-source package's own 2.0.0 → 3.0.0 releases.

## Version overview

| | 1.46.1 | 2.0.0 | 3.0.0 |
|---|---|---|---|
| Node.js | >= 8 | >= 20 | **>= 24.18.0** |
| HTTP stack | `request` / `request-promise` (deprecated) | axios + hpagent | axios + hpagent |
| Promise lib | Bluebird | native | native |
| Cookie jar | tough-cookie 2 via `request`'s jar | tough-cookie 5, owned by `State` | tough-cookie 6 |
| Packaging | `main` only, deep imports possible | `exports` map, root import only | `exports` map, root import only |
| TypeScript | 4.3 | 5.9 | 5.9 |

The public API surface (repositories, feeds, services, method names, option shapes) is **unchanged** across all three versions. Migration is about the runtime, the HTTP layer and a handful of type/behavior details.

## Step 1 — Runtime and install

1. Run Node.js >= 24.18.0 (2.0.0 floor is >= 20; 1.x needed >= 8).
2. `npm install instagram-private-api@^3.0.0`.
3. If you deep-imported internals (`require('instagram-private-api/dist/core/client')`), import from the package root instead — the `exports` map (added in 2.0.0) makes deep imports fail at runtime.

## Step 2 — HTTP layer (`request` → axios, 2.0.0)

### `Request#send` options

`client.request.send()` now takes `IgRequestOptions` (exported from `types`) instead of the `request` library's `Options`. The core option names survived:

```typescript
// unchanged shape
await ig.request.send({ url: '/api/v1/users/<pk>/info/', qs: {}, headers: {} });
```

Options the `request` library supported and this client never used are **gone from the type**: `agentClass`, `agentOptions`, `simple`, `json`, `followRedirect`, `strictSSL`, `timeout`, `jar`, `oauth`, and friends. If you passed any of these, delete them:

- Proxies: use `ig.state.proxyUrl = 'http://user:pass@host:port'` (hpagent CONNECT proxies). The old `socks5-proxy.example.ts` pattern (`agentClass: require('socks5-http-client')`) no longer works; SOCKS is not supported natively — put an HTTP front (e.g. local converter or proxy chain) in front of a SOCKS upstream if you need it.
- TLS verification is disabled inside the client's own agents (as `strictSSL: false` was in 1.x); there is currently no public toggle.
- **There is no request timeout** — a hung connection hangs. If your workflow needs one, wrap calls in your own timeout/`AbortController` at the application level.

### `IgResponse`

`IgResponse` is a plain interface now (it no longer extends `request`'s `Response`). Everything code actually consumed is unchanged: `statusCode`, `statusMessage`, `headers`, `body`, `request.method`, `request.uri.path`. If you relied on exotic `request`-specific fields, they are gone.

### Cookie jar

`State` owns a `tough-cookie` `CookieJar` directly (`ig.state.cookieJar`, `serializeCookieJar()` / `deserializeCookieJar()`). The 1.x workarounds — `ig.state._jar`, `request.jar()` interop, `request-promise`'s jar wrapping — are gone. tough-cookie is now major 5/6; if you touched the jar directly, its API changed since v2 (sync methods like `getCookieStringSync`/`setCookieSync` are the ones to use).

### Behavior notes

- Response bodies are parsed with `json-bigint` as before; numbers beyond `Number.MAX_SAFE_INTEGER` arrive as strings.
- All HTTP status codes resolve (the old `simple: false` behavior is preserved — errors are thrown as `IgResponseError`s, not axios rejections).
- Feed retry/backoff and `request.attemptOptions.maxAttempts` semantics are unchanged.

## Step 3 — Bluebird removal (2.0.0)

Bluebird is no longer a dependency. Map old patterns:

| 1.x | 3.x |
|---|---|
| `Bluebird.try(fn).catch(IgCheckpointError, handler)` | `try { ... } catch (e) { if (e instanceof IgCheckpointError) { ... } else throw e; }` |
| `Bluebird.map(items, fn, { concurrency: n })` | `p-map`/your own pool (the library uses an internal `mapWithConcurrency`) |
| `Bluebird.delay(ms)` | `setTimeout` from `timers/promises` |

The checkpoint example pattern is now:

```typescript
try {
  await ig.account.login(user, pass);
} catch (e) {
  if (e instanceof IgCheckpointError) {
    await ig.challenge.auto(true);
    await ig.challenge.sendSecurityCode(code);
  } else throw e;
}
```

## Step 4 — Dependency majors that can touch your code

- **rxjs 6 → 7**: `ig.request.end$` / `error$` Subjects — API compatible for `subscribe`, but check custom operators if you pipe them.
- **image-size 0.7 → 2**: named export — `const { imageSize } = require('image-size')` (was default-export callable).
- **luxon 1 → 3**, **class-transformer 0.3 → 0.5**: only relevant if you consumed those types from the library's responses.
- **TypeScript 4.3 → 5.9** with `esModuleInterop`: default imports of CJS deps now type-check correctly; a handful of latent errors in downstream code may surface when you upgrade TS alongside.

## Step 5 — 2.0.0 → 3.0.0

3.0.0 is a maintenance + configurability release; no public API was removed except the items below.

### Breaking / behavior changes

- **Node >= 24.18.0** required; CI tests Node 24 only.
- Direct-thread video/voice transcode wait default changed **4000 ms → 5000 ms** (unified with all other publish paths). Restore the old value per instance if needed (see below).
- Album and story-video publishes now actually wait `5000 ms` on a `202 Transcode pending` response (previously the option fell through and waited ~0 ms).
- The IGTV `configureToIgtv` retry loop now throws `IgConfigureVideoError` when retries are exhausted (previously it returned `undefined` due to a dead bounds check).
- `PostingIgtvOptions.transcodeDelay` and `maxTranscodeTries` were removed — they documented a `resolveTranscode` implementation that has been commented out for years and never ran.
- `QpRepository.surfacesToQueries` / `surfacesToTriggers` became getters (reads are identical; you can no longer *assign* the field directly — override via `state.constants` instead).

### New: overridable constants (the headline 3.0 feature)

Protocol defaults moved out of consumer code into `src/core/constants.ts` and are exported from the package root. Every value below is overridable per client instance, and overrides survive `state.serialize()`/`deserialize()`:

```typescript
import { Constants, IgApiClient } from 'instagram-private-api';

const ig = new IgApiClient();
ig.state.constants = {
  ...Constants,
  // publishing knobs
  TRANSCODE_DELAY_MS: 5000,            // 202-transcode wait (was hardcoded 5000/4000 in places)
  CONFIGURE_MAX_ATTEMPTS: 6,           // timeline-video/IGTV configure retries
  CONFIGURE_RETRY_BASE_DELAY_MS: 2000, // linear backoff base for those retries
  SEGMENTED_VIDEO_CHUNK_SIZE: 2 ** 24, // IGTV upload chunk (16 MiB)
  UPLOAD_PHOTO_QUALITY: '80',          // JPEG quality in rupload params
  // device fingerprint
  WEB_USER_AGENT_CHROME_VERSION: '70.0.3538.110',
  // rot-prone protocol IDs — swap when Instagram rotates them
  INSIGHTS_DOCUMENT_IDS: { ...Constants.INSIGHTS_DOCUMENT_IDS, account: '<new-id>' },
};
```

Device pools are plain fields now: `ig.state.devices` / `ig.state.builds` replace the fixed `src/samples/*.json` lookups in `generateDevice()`.

Per-call precedence is unchanged: `transcodeDelay` options and `segmentDivider` still override the constants.

### Pre-existing example files

`examples/*.ts` still show the 1.x style (Bluebird conditional catches, `inquirer`, socks5 agents) and are excluded from typechecking; treat `README.md` and `AGENTS.md` snippets as the current patterns.

## Migration checklist

- [ ] Node >= 24.18.0 (or >= 20 if you stop at 2.0.0)
- [ ] Import only from the package root
- [ ] No `request`-library options in `request.send()` calls; proxies via `state.proxyUrl`
- [ ] Bluebird conditional catches → `try/catch` + `instanceof`
- [ ] Direct jar access uses `state.cookieJar` (tough-cookie 6 API)
- [ ] `image-size` import is the named `imageSize`
- [ ] Remove `PostingIgtvOptions.transcodeDelay`/`maxTranscodeTries` usages
- [ ] Any direct writes to `qp.surfacesToQueries`/`surfacesToTriggers` moved to `state.constants` overrides
- [ ] Re-verify session persistence round-trip (`state.serialize()`/`deserialize()`) after upgrading
