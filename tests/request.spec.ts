import { createHmac } from 'crypto';
import http from 'http';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IgApiClient } from '../src';
import { IgCheckpointError, IgLoginRequiredError, IgNotFoundError } from '../src/errors';

describe('Request', () => {
  let client: IgApiClient;
  let server: http.Server;
  let baseUrl: string;
  /** requests received by the test server, for assertions */
  const received: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer }> = [];

  beforeAll(async () => {
    client = new IgApiClient();
    client.state.generateDevice('request-spec');
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        received.push({
          method: req.method || 'GET',
          url: req.url || '/',
          headers: req.headers,
          body: Buffer.concat(chunks),
        });
        const url = new URL(req.url || '/', 'http://localhost');
        if (url.pathname === '/ok') {
          res.setHeader('content-type', 'application/json');
          res.end('{"status":"ok","hello":"world"}');
        } else if (url.pathname === '/set-cookie') {
          res.setHeader('set-cookie', 'csrftoken=abc123; Path=/');
          res.setHeader('content-type', 'application/json');
          res.end('{"status":"ok"}');
        } else if (url.pathname === '/echo-cookie') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ status: 'ok', cookie: req.headers.cookie || '' }));
        } else if (url.pathname === '/not-found') {
          res.statusCode = 404;
          res.setHeader('content-type', 'application/json');
          res.end('{"status":"fail"}');
        } else if (url.pathname === '/challenge') {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.end('{"message":"challenge_required","challenge":{"api_path":"/challenge/123/"}}');
        } else if (url.pathname === '/login-required') {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.end('{"message":"login_required"}');
        } else if (url.pathname === '/big-int') {
          res.setHeader('content-type', 'application/json');
          res.end('{"status":"ok","big":12345678901234567890}');
        } else if (url.pathname === '/binary') {
          res.setHeader('content-type', 'application/json');
          res.end('{"status":"ok"}');
        } else {
          res.statusCode = 500;
          res.end('unknown test path');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('sign() produces an HMAC-SHA256 signed body with the signature key version', () => {
    const payload = { username: 'alice', _csrftoken: 'token' };
    const signed = client.request.sign(payload);
    const expected = createHmac('sha256', client.state.signatureKey).update(JSON.stringify(payload)).digest('hex');
    expect(signed.signed_body).toBe(`${expected}.${JSON.stringify(payload)}`);
    expect(signed.ig_sig_key_version).toBe(client.state.signatureVersion);
  });

  it('userBreadcrumb() returns two base64-encoded parts', () => {
    const breadcrumb = client.request.userBreadcrumb(42);
    const parts = breadcrumb.trim().split('\n');
    expect(parts).toHaveLength(2);
    // the first part is the hex HMAC (base64-encoded), the second the payload
    expect(Buffer.from(parts[1], 'base64').toString()).toMatch(/^42 \d+ \d+ \d+$/);
  });

  it('sends query parameters', async () => {
    const { body } = await client.request.send({ url: `${baseUrl}/ok`, qs: { max_id: '2', flag: true } });
    expect(body.hello).toBe('world');
    const last = received[received.length - 1];
    expect(last.url).toContain('max_id=2');
    expect(last.url).toContain('flag=true');
  });

  it('sends urlencoded form bodies', async () => {
    await client.request.send({
      url: `${baseUrl}/ok`,
      method: 'POST',
      form: { signed_body: 'abc', greeting: 'hello world' },
    });
    const last = received[received.length - 1];
    expect(last.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(last.body.toString()).toBe('signed_body=abc&greeting=hello+world');
  });

  it('sends raw Buffer bodies byte-for-byte', async () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 255]);
    await client.request.send({ url: `${baseUrl}/binary`, method: 'POST', body: bytes });
    const last = received[received.length - 1];
    expect(last.body.equals(bytes)).toBe(true);
  });

  it('stores response cookies in the jar and sends them back', async () => {
    await client.request.send({ url: `${baseUrl}/set-cookie` });
    // extractCookie only looks at instagram's host, so query the jar directly
    expect(client.state.cookieJar.getCookieStringSync(`${baseUrl}/`)).toContain('csrftoken=abc123');
    const { body } = await client.request.send({ url: `${baseUrl}/echo-cookie` });
    expect(body.cookie).toContain('csrftoken=abc123');
  });

  it('keeps integers beyond Number.MAX_SAFE_INTEGER as strings', async () => {
    const { body } = await client.request.send({ url: `${baseUrl}/big-int` });
    expect(body.big).toBe('12345678901234567890');
    expect(typeof body.big).toBe('string');
  });

  it('maps 404 responses to IgNotFoundError', async () => {
    await expect(client.request.send({ url: `${baseUrl}/not-found` })).rejects.toBeInstanceOf(IgNotFoundError);
  });

  it('maps challenge_required to IgCheckpointError and records the checkpoint', async () => {
    await expect(client.request.send({ url: `${baseUrl}/challenge` })).rejects.toBeInstanceOf(IgCheckpointError);
    expect(client.state.checkpoint).toMatchObject({ message: 'challenge_required' });
  });

  it('maps login_required to IgLoginRequiredError', async () => {
    await expect(client.request.send({ url: `${baseUrl}/login-required` })).rejects.toBeInstanceOf(
      IgLoginRequiredError,
    );
  });

  it('exposes method and path on the response for error reporting', async () => {
    const response = await client.request.send({ url: `${baseUrl}/ok`, qs: { a: 'b' } });
    expect(response.request.method).toBe('GET');
    expect(response.request.uri.path).toBe('/ok?a=b');
    expect(response.statusCode).toBe(200);
  });
});
