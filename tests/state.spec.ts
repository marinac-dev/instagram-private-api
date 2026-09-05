import { describe, expect, it } from 'vitest';
import { IgApiClient } from '../src';
import { IgCookieNotFoundError, IgNoCheckpointError } from '../src/errors';

describe('State', () => {
  it('generates identical devices for identical seeds', () => {
    const a = new IgApiClient();
    const b = new IgApiClient();
    a.state.generateDevice('seed-a');
    b.state.generateDevice('seed-a');
    expect(a.state.deviceString).toBe(b.state.deviceString);
    expect(a.state.deviceId).toBe(b.state.deviceId);
    expect(a.state.uuid).toBe(b.state.uuid);
    expect(a.state.build).toBe(b.state.build);
  });

  it('generates different devices for different seeds', () => {
    const a = new IgApiClient();
    const b = new IgApiClient();
    a.state.generateDevice('seed-a');
    b.state.generateDevice('seed-b');
    expect(a.state.uuid).not.toBe(b.state.uuid);
  });

  it('builds the app user agent from the device', () => {
    const client = new IgApiClient();
    client.state.generateDevice('seed-a');
    expect(client.state.appUserAgent).toBe(
      `Instagram ${client.state.appVersion} Android (${client.state.deviceString}; ${client.state.language}; ${client.state.appVersionCode})`,
    );
  });

  it('round-trips through serialize/deserialize', async () => {
    const client = new IgApiClient();
    client.state.generateDevice('persist-me');
    client.state.language = 'de_DE';
    client.state.cookieJar.setCookieSync('ds_user_id=4242; Path=/', 'https://i.instagram.com/');
    const serialized = JSON.stringify(await client.state.serialize());

    const restored = new IgApiClient();
    await restored.state.deserialize(serialized);
    expect(restored.state.deviceString).toBe(client.state.deviceString);
    expect(restored.state.uuid).toBe(client.state.uuid);
    expect(restored.state.language).toBe('de_DE');
    expect(restored.state.extractCookieValue('ds_user_id')).toBe('4242');
  });

  it('extractCookieValue throws for missing cookies', () => {
    const client = new IgApiClient();
    expect(() => client.state.extractCookieValue('ds_user_id')).toThrow(IgCookieNotFoundError);
  });

  it('falls back to "missing" for the csrf token when no cookie exists', () => {
    const client = new IgApiClient();
    expect(client.state.cookieCsrfToken).toBe('missing');
  });

  it('challengeUrl throws when no checkpoint is set', () => {
    const client = new IgApiClient();
    expect(() => client.state.challengeUrl).toThrow(IgNoCheckpointError);
  });
});
