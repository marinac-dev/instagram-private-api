import { describe, expect, it } from 'vitest';
import { IgApiClient } from '../src';

describe('IgApiClient', () => {
  it('constructs and wires up its repositories and services', () => {
    const client = new IgApiClient();
    expect(client.account).toBeDefined();
    expect(client.media).toBeDefined();
    expect(client.directThread).toBeDefined();
    expect(client.feed).toBeDefined();
    expect(client.entity).toBeDefined();
    expect(client.publish).toBeDefined();
    expect(client.state).toBeDefined();
    expect(client.request).toBeDefined();
  });

  it('generates a deterministic device from a seed', () => {
    const client = new IgApiClient();
    client.state.generateDevice('smoke-test-seed');
    expect(client.state.deviceString).toMatch(/\w+\/\d+/);
    expect(client.state.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    const second = new IgApiClient();
    second.state.generateDevice('smoke-test-seed');
    expect(second.state.deviceId).toBe(client.state.deviceId);
  });
});
