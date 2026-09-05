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

  it('builds the web user agent from the configured chrome version', () => {
    const client = new IgApiClient();
    client.state.generateDevice('seed-a');
    client.state.constants = { ...client.state.constants, WEB_USER_AGENT_CHROME_VERSION: '120.0.0.1' };
    expect(client.state.webUserAgent).toContain('Chrome/120.0.0.1');
  });

  it('generateDevice picks from overridden device and build pools', () => {
    const client = new IgApiClient();
    const deviceString = '25/7.1.1; 440dpi; 1080x1920; Xiaomi; Mi Note 3; jason; qcom';
    client.state.devices = [deviceString];
    client.state.builds = ['TQ3A.1'];
    client.state.generateDevice('any-seed');
    expect(client.state.deviceString).toBe(deviceString);
    expect(client.state.build).toBe('TQ3A.1');
  });

  it('round-trips overridden constants through serialize/deserialize', async () => {
    const client = new IgApiClient();
    client.state.generateDevice('persist-me');
    client.state.constants = {
      ...client.state.constants,
      INSIGHTS_DOCUMENT_IDS: { ...client.state.constants.INSIGHTS_DOCUMENT_IDS, account: '1234567890' },
      TRANSCODE_DELAY_MS: 9000,
    };
    const serialized = JSON.stringify(await client.state.serialize());

    const restored = new IgApiClient();
    await restored.state.deserialize(serialized);
    expect(restored.state.constants.INSIGHTS_DOCUMENT_IDS.account).toBe('1234567890');
    expect(restored.state.constants.TRANSCODE_DELAY_MS).toBe(9000);
  });

  it('qp repository reads surfaces from the overridden constants', () => {
    const client = new IgApiClient();
    const original = client.qp.surfacesToTriggers;
    client.state.constants = { ...client.state.constants, QP_SURFACES_TO_TRIGGERS: '{"overridden":true}' };
    expect(client.qp.surfacesToTriggers).toBe('{"overridden":true}');
    expect(client.qp.surfacesToTriggers).not.toBe(original);
  });
});
