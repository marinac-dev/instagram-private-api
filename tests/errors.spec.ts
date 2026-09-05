import { describe, expect, it } from 'vitest';
import { IgResponse, IgResponseError } from '../src';

function fakeResponse(body: any, statusCode = 400): IgResponse {
  return {
    statusCode,
    statusMessage: 'Bad Request',
    headers: {},
    body,
    request: { method: 'POST', uri: { path: '/api/v1/example/' } },
  };
}

describe('IgResponseError', () => {
  it('carries the method, path, status and message', () => {
    const error = new IgResponseError(fakeResponse({ message: 'oops' }));
    expect(error.message).toContain('POST /api/v1/example/');
    expect(error.message).toContain('400');
    expect(error.message).toContain('oops');
    expect(error.text).toBe('oops');
    expect(error.response.statusCode).toBe(400);
  });

  it('omits text when the body has no message', () => {
    const error = new IgResponseError(fakeResponse({ status: 'fail' }));
    expect(error.text).toBeUndefined();
    expect(error.message).not.toContain('undefined');
  });
});
