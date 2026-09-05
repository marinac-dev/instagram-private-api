import { firstValueFrom, toArray } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { IgApiClient } from '../src';
import { AccountFollowersFeedResponse } from '../src/responses';

function page(users: { pk: string; username: string }[], nextMaxId?: string): { body: any } {
  return {
    body: {
      users,
      next_max_id: nextMaxId,
      more_available: typeof nextMaxId === 'string',
      status: 'ok',
    } as AccountFollowersFeedResponse,
  };
}

describe('Feed pagination', () => {
  it('observable() emits every page and threads next_max_id', async () => {
    const client = new IgApiClient();
    client.state.generateDevice('feed-spec');
    const send = vi
      .fn<(options: any) => Promise<any>>()
      .mockResolvedValueOnce(page([{ pk: '1', username: 'one' }], '2'))
      .mockResolvedValueOnce(
        page(
          [
            { pk: '2', username: 'two' },
            { pk: '3', username: 'three' },
          ],
          undefined,
        ),
      );
    vi.spyOn(client.request, 'send').mockImplementation(send);

    const feed = client.feed.accountFollowers(1234);
    const emissions = await firstValueFrom(feed.observable().pipe(toArray()));

    expect(emissions).toHaveLength(2);
    expect(emissions.flat()).toHaveLength(3);
    expect(emissions[0][0].username).toBe('one');
    expect(feed.isMoreAvailable()).toBe(false);

    expect(send).toHaveBeenCalledTimes(2);
    const secondCall = send.mock.calls[1][0] as { qs?: { max_id?: string } };
    expect(secondCall.qs?.max_id).toBe('2');
  });

  it('observable() surfaces request errors', async () => {
    const client = new IgApiClient();
    client.state.generateDevice('feed-spec');
    vi.spyOn(client.request, 'send').mockRejectedValue(new Error('network down'));

    const feed = client.feed.accountFollowers(1234);
    // the feed retry policy waits 60s between attempts - bypass it for the test
    feed.attemptOptions = { maxAttempts: 1 };
    await expect(firstValueFrom(feed.observable().pipe(toArray()))).rejects.toThrow('network down');
  });
});
