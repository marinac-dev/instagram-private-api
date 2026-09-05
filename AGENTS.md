# AGENTS.md — Integrating this library safely (for AI coding agents)

This file is written for AI agents (coding assistants, workflow builders, autonomous integrators) that use `instagram-private-api` in code they generate. Read it before writing integration code.

## What this library is

An **unofficial** wrapper around Instagram's private Android API. It drives an emulated Android device fingerprint against endpoints the official app uses. There is no public contract with Instagram: endpoints, GraphQL document IDs and heuristics change without notice, and automation likely violates Instagram's Terms of Service.

Consequences you must design around:

- **Accounts get banned.** New accounts, datacenter IPs and aggressive pacing are flagged fastest. Never point this at an account the user cannot afford to lose; recommend a dedicated test account.
- **Breakage is expected.** When requests suddenly fail with `IgResponseError` or empty bodies, suspect a server-side change (e.g. rotated `documentId`s), not a bug in generated code. Section [Configuration](#configuration) shows how to hot-fix protocol IDs.
- **You are fingerprinted.** Device identity, session cookies and IP must stay consistent per account. Instability here is what triggers checkpoints and bans.

## Non-negotiable security rules

1. **Credentials from the environment only.** Read `IG_USERNAME`/`IG_PASSWORD`/`IG_PROXY` from `process.env` (see `.env.example`). Never hard-code them, never write them into generated code, logs, or test fixtures.
2. **Serialized state is a credential.** `ig.state.serialize()` contains live session cookies (`sessionid`, `ds_user_id`). Treat its output like a password: store in a secret manager or a file with restrictive permissions (0600), never commit it, never log it, never send it to third-party services.
3. **One client instance per account.** Sharing one `IgApiClient` across accounts corrupts the fingerprint. One account ↔ one device seed ↔ one persisted state ↔ ideally one stable proxy.
4. **Rate limit by default.** Add human-ish delays between actions, back off on `429`/`IgActionSpamError`/`IgRequestsLimitError`, and cap concurrency (e.g. ≤ 1–2 write actions per second, far less for follows/likes/DMs). Do not build retry loops that hammer on 429 — that converts a soft block into a ban.
5. **Proxies:** HTTP/HTTPS proxies are supported via `ig.state.proxyUrl` (hpagent). SOCKS proxies are **not** supported natively. Keep the proxy fixed per account; do not rotate IPs between requests of one session.

## Runtime requirements

- Node.js **>= 24.18.0**, CommonJS (`require`) — the package ships CJS only.
- Install: `npm install instagram-private-api`
- Import from the package root only — the `exports` map blocks deep imports like `dist/core/client`.

```typescript
import { IgApiClient, IgCheckpointError } from 'instagram-private-api';
```

## Canonical session lifecycle

Login is the riskiest operation (it is where checkpoints happen). Log in rarely: persist state after login and restore it on every subsequent run. Only re-login when the restored session is rejected (`IgLoginRequiredError` / `IgUserHasLoggedOutError`).

```typescript
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { IgApiClient, IgLoginRequiredError, IgUserHasLoggedOutError } from 'instagram-private-api';

const STATE_PATH = './state.json'; // protect this file — it contains session cookies

async function getClient(username: string, password: string): Promise<IgApiClient> {
  const ig = new IgApiClient();
  ig.state.generateDevice(username); // deterministic fingerprint from the username seed
  ig.state.proxyUrl = process.env.IG_PROXY; // optional, but keep it stable per account

  if (existsSync(STATE_PATH)) {
    await ig.state.deserialize(readFileSync(STATE_PATH, 'utf8'));
    // Do NOT call generateDevice() again here — it would replace the device
    // identity the session was issued for.
    try {
      void ig.state.cookieUserId; // probe: throws if the session is dead
      return ig;
    } catch {
      // fall through to a fresh login
    }
  }

  await ig.account.login(username, password);
  const serialized = await ig.state.serialize();
  delete serialized.constants; // always ship library defaults, see MIGRATION.md
  writeFileSync(STATE_PATH, JSON.stringify(serialized), { mode: 0o600 });
  return ig;
}
```

Optionally subscribe to `ig.request.end$` to persist state after **every** request (that's what `examples/session.example.ts` does) — session cookies are refreshed by responses, and saving them keeps the session alive.

### Checkpoints and 2FA (interactive by design)

`IgCheckpointError` and `IgLoginTwoFactorRequiredError` require a human (code from SMS/email, "it was me" click, TOTP). **Never try to bypass or brute-force these.** Surface them to the user and pause the workflow:

```typescript
import { IgCheckpointError } from 'instagram-private-api';

try {
  await ig.account.login(username, password);
} catch (e) {
  if (e instanceof IgCheckpointError) {
    await ig.challenge.auto(true); // trigger SMS / "it was me"
    const code = await askHumanFor('Enter the code Instagram sent you');
    await ig.challenge.sendSecurityCode(code);
  } else {
    throw e;
  }
}
```

See `examples/checkpoint.example.ts` and `examples/2fa-sms-login.example.ts`. In headless workflows, stop and notify a human instead.

## Error taxonomy and how to react

All errors extend `IgClientError`. Catch the specific class; do not blanket-retry.

| Error | Meaning | Reaction |
|---|---|---|
| `IgLoginBadPasswordError`, `IgLoginInvalidUserError` | Bad credentials | Fatal — alert the user, do not retry |
| `IgLoginTwoFactorRequiredError` / `IgCheckpointError` | Human verification needed | Pause workflow, hand to human |
| `IgLoginRequiredError`, `IgUserHasLoggedOutError` | Session dead | Re-login (once), then re-persist state |
| `IgActionSpamError`, `IgRequestsLimitError`, `IgSentryBlockError` | Rate limited / blocked | Stop the action class, back off for hours, slow the workflow; repeated hits → ban |
| `IgResponseError` (generic, incl. 5xx) | Server rejected/errored | Retry a few times with exponential backoff + jitter |
| `IgNetworkError` | Transport failure / DNS / timeout | Retry with exponential backoff |
| `IgNotFoundError`, `IgPrivateUserError`, `IgInactiveUserError`, `IgExactUserNotFoundError` | Target state | Fatal for that item — skip, don't retry |
| `IgCookieNotFoundError`, `IgUserIdNotFoundError`, `IgNoCheckpointError`, `IgParseError` | Library/state misuse | Usually a bug in the calling code |

`IgResponseError` exposes `.response.statusCode` and `.response.body` — log both when reporting failures.

## Automation patterns

**Feeds** are async-iterable; they also expose `feed.items$` (observable). The library's built-in feed retry/backoff (`feed.attemptOptions`) waits out 400/429/500/502 — leave its defaults unless you have a reason.

```typescript
for await (const batch of ig.feed.accountFollowers(userId).items()) {
  for (const user of batch) {
    await sleep(jitter(3000, 8000)); // human-ish pacing between actions
    // ... process user
  }
}
```

**Publishing** (photo/video/story) is write-heavy and closely monitored. One publish per workflow step; the video path polls the transcode and configure phases internally (tunables in [Configuration](#configuration)).

**Shutdown:** call `ig.destroy()` when a long-running process exits to complete the client's internal streams.

**Debugging:** run with `DEBUG=ig:*` to get request/state/publish logs. Include this output (redacted) when asking for help.

## Configuration

There are no constructor options. Configure by setting fields after construction:

```typescript
const ig = new IgApiClient();
ig.state.generateDevice(username); // device fingerprint (seeded, deterministic)
ig.state.language = 'en_US';       // locale used in headers and payloads
ig.state.proxyUrl = process.env.IG_PROXY;
```

Protocol-level defaults live in the `Constants` module (exported from the package root) and are overridable per instance through `state.constants`. Override **wholesale** (spread), not field-by-field on the live object:

```typescript
import { Constants, IgApiClient } from 'instagram-private-api';

const ig = new IgApiClient();
// e.g. Instagram rotated the insights GraphQL document IDs; update without waiting for a release:
ig.state.constants = {
  ...Constants,
  INSIGHTS_DOCUMENT_IDS: { ...Constants.INSIGHTS_DOCUMENT_IDS, account: '<new-document-id>' },
};
```

Commonly tuned knobs:

- Fingerprint: `state.devices` / `state.builds` (pools `generateDevice` picks from), `state.timezoneOffset`, `state.capabilitiesHeader`.
- Publishing: `TRANSCODE_DELAY_MS`, `CONFIGURE_MAX_ATTEMPTS`, `CONFIGURE_RETRY_BASE_DELAY_MS`, `SEGMENTED_VIDEO_CHUNK_SIZE`, `UPLOAD_PHOTO_QUALITY`.
- Per-call overrides still win: `transcodeDelay` option on publish calls, `segmentDivider` on IGTV uploads.

Note: if you overrode `state.constants` and then persist state **without** `delete serialized.constants`, the override is restored on deserialize (that's intended). If you *do* delete `constants` (the default recipe), re-apply overrides after restoring.

## Mistakes to avoid (seen in real integrations)

- Calling `generateDevice()` **after** restoring state — replaces the device identity tied to the session; checkpoints follow.
- Logging in on every run instead of restoring persisted state — maximizes checkpoint risk.
- Persisting state with secrets to a world-readable file, or pasting serialized state into prompts/logs.
- Creating a new client per request — the fingerprint must persist across calls.
- Retrying in a tight loop on `IgActionSpamError`/429 — escalate to a human instead.
- Hard-coding insights `documentId`s or QP surfaces in generated code — read them from `Constants` and override via `state.constants`.
- Deep imports (`instagram-private-api/dist/...`) — blocked by the `exports` map; import from the root.
- Assuming SOCKS proxy support — only HTTP/HTTPS (`state.proxyUrl`).

## Verifying generated code

- The repo ships an offline test suite (`npm test`, Vitest, no network). If you modify the library itself, run `npm test && npm run typecheck && npm run build`.
- Generated integration code should be smoke-tested against the real API with a **test account** and conservative pacing before being trusted.
- Library docs: `README.md` (concepts, configuration), `MIGRATION.md` (upgrading from 1.x), `docs/` (typedoc output), `examples/` (working recipes — note some still show the pre-2.0 Bluebird style; the patterns in this file are current).
