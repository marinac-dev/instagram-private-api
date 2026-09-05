import { defaultsDeep, inRange, random } from 'lodash';
import { createHmac } from 'crypto';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { Subject } from 'rxjs';
import { AttemptOptions, retry } from '@lifeomic/attempt';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { HttpProxyAgent, HttpsProxyAgent } from 'hpagent';
import { IgApiClient } from './client';
import {
  IgActionSpamError,
  IgCheckpointError,
  IgClientError,
  IgInactiveUserError,
  IgLoginRequiredError,
  IgNetworkError,
  IgNotFoundError,
  IgPrivateUserError,
  IgResponseError,
  IgSentryBlockError,
  IgUserHasLoggedOutError,
} from '../errors';
import { IgRequestOptions } from '../types/request.types';
import { IgResponse } from '../types/common.types';
import JSONbigInt = require('json-bigint');

const JSONbigString = JSONbigInt({ storeAsString: true });

import debug from 'debug';

type Payload = { [key: string]: any } | string;

interface SignedPost {
  signed_body: string;
  ig_sig_key_version: string;
}

const DEFAULT_BASE_URL = 'https://i.instagram.com/';

export class Request {
  private static requestDebug = debug('ig:request');
  end$ = new Subject<void>();
  error$ = new Subject<IgClientError>();
  attemptOptions: Partial<AttemptOptions<any>> = {
    maxAttempts: 1,
  };
  defaults: Partial<IgRequestOptions> = {};

  constructor(private client: IgApiClient) {}

  public async send<T = any>(userOptions: IgRequestOptions, onlyCheckHttpStatus?: boolean): Promise<IgResponse<T>> {
    // call-provided options win over `this.defaults` (the precedence of the former
    // `defaultsDeep(userOptions, {…}, this.defaults)` call)
    const options = defaultsDeep({}, this.defaults, userOptions) as IgRequestOptions;
    const method = (options.method || 'GET').toUpperCase();
    const fullUrl = this.buildUrl(options.url, options.qs);
    const headers = defaultsDeep({}, options.headers, this.getDefaultHeaders());
    let data: string | Buffer | undefined;
    if (typeof options.form !== 'undefined') {
      data = Request.toUrlEncoded(options.form);
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (typeof options.body !== 'undefined') {
      data = options.body;
    }
    const jarCookies = this.client.state.cookieJar.getCookieStringSync(fullUrl);
    if (jarCookies) {
      headers.Cookie = headers.Cookie ? `${headers.Cookie}; ${jarCookies}` : jarCookies;
    }
    Request.requestDebug(`Requesting ${method} ${fullUrl}`);
    const config: AxiosRequestConfig = {
      url: fullUrl,
      method,
      headers,
      data,
      // parity with the former `simple: false`: never reject on HTTP status codes
      validateStatus: () => true,
      // parse manually so numbers beyond Number.MAX_SAFE_INTEGER stay strings
      transformResponse: [(body: unknown) => body],
      proxy: false,
    };
    if (this.client.state.proxyUrl) {
      config.httpAgent = new HttpProxyAgent({
        proxy: this.client.state.proxyUrl,
      });
      config.httpsAgent = new HttpsProxyAgent({
        proxy: this.client.state.proxyUrl,
        rejectUnauthorized: false,
      });
    } else {
      config.httpAgent = new HttpAgent();
      config.httpsAgent = new HttpsAgent({ rejectUnauthorized: false });
    }
    const response = await this.faultTolerantRequest(config);
    this.storeCookies(response, fullUrl);
    this.updateState(response);
    process.nextTick(() => this.end$.next());
    const igResponse: IgResponse<T> = {
      statusCode: response.status,
      statusMessage: response.statusText || '',
      headers: response.headers,
      body: this.parseBody(response),
      request: {
        method,
        uri: { path: Request.uriPath(fullUrl) },
      },
    };
    if ((igResponse.body as any).status === 'ok' || (onlyCheckHttpStatus && igResponse.statusCode === 200)) {
      return igResponse;
    }
    const error = this.handleResponseError(igResponse);
    process.nextTick(() => this.error$.next(error));
    throw error;
  }

  private buildUrl(url: string, qs?: IgRequestOptions['qs']): string {
    const absolute = url.startsWith('http') ? url : `${DEFAULT_BASE_URL}${url}`;
    if (!qs) {
      return absolute;
    }
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(qs)) {
      if (typeof value !== 'undefined' && value !== null) {
        params.append(key, String(value));
      }
    }
    const serialized = params.toString();
    if (!serialized) {
      return absolute;
    }
    return `${absolute}${absolute.includes('?') ? '&' : '?'}${serialized}`;
  }

  private static toUrlEncoded(form: IgRequestOptions['form']): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(form)) {
      if (typeof value !== 'undefined' && value !== null) {
        params.append(key, String(value));
      }
    }
    return params.toString();
  }

  private static uriPath(fullUrl: string): string {
    const { pathname, search } = new URL(fullUrl);
    return `${pathname}${search}`;
  }

  private parseBody(response: AxiosResponse): any {
    const body = response.data;
    if (typeof body !== 'string') {
      return body;
    }
    try {
      // Sometimes we have numbers greater than Number.MAX_SAFE_INTEGER in json response
      // To handle it we just wrap numbers with length > 15 it double quotes to get strings instead
      return JSONbigString.parse(body);
    } catch (e) {
      if (inRange(response.status, 200, 299)) {
        throw e;
      }
      return body;
    }
  }

  private storeCookies(response: AxiosResponse, fullUrl: string) {
    const setCookies = response.headers['set-cookie'];
    if (Array.isArray(setCookies)) {
      for (const cookie of setCookies) {
        this.client.state.cookieJar.setCookieSync(cookie, fullUrl);
      }
    }
  }

  private updateState(response: AxiosResponse) {
    const {
      'x-ig-set-www-claim': wwwClaim,
      'ig-set-authorization': auth,
      'ig-set-password-encryption-key-id': pwKeyId,
      'ig-set-password-encryption-pub-key': pwPubKey,
    } = response.headers;
    if (typeof wwwClaim === 'string') {
      this.client.state.igWWWClaim = wwwClaim;
    }
    if (typeof auth === 'string' && !auth.endsWith(':')) {
      this.client.state.authorization = auth;
    }
    if (typeof pwKeyId === 'string') {
      this.client.state.passwordEncryptionKeyId = pwKeyId;
    }
    if (typeof pwPubKey === 'string') {
      this.client.state.passwordEncryptionPubKey = pwPubKey;
    }
  }

  public signature(data: string) {
    return createHmac('sha256', this.client.state.signatureKey).update(data).digest('hex');
  }

  public sign(payload: Payload): SignedPost {
    const json = typeof payload === 'object' ? JSON.stringify(payload) : payload;
    const signature = this.signature(json);
    return {
      ig_sig_key_version: this.client.state.signatureVersion,
      signed_body: `${signature}.${json}`,
    };
  }

  public userBreadcrumb(size: number) {
    const term = random(2, 3) * 1000 + size + random(15, 20) * 1000;
    const textChangeEventCount = Math.round(size / random(2, 3)) || 1;
    const data = `${size} ${term} ${textChangeEventCount} ${Date.now()}`;
    const signature = Buffer.from(
      createHmac('sha256', this.client.state.userBreadcrumbKey).update(data).digest('hex'),
    ).toString('base64');
    const body = Buffer.from(data).toString('base64');
    return `${signature}\n${body}\n`;
  }

  private handleResponseError(response: IgResponse<any>): IgClientError {
    Request.requestDebug(
      `Request ${response.request.method} ${response.request.uri.path} failed: ${
        typeof response.body === 'object' ? JSON.stringify(response.body) : response.body
      }`,
    );

    const json = response.body;
    if (json.spam) {
      return new IgActionSpamError(response);
    }
    if (response.statusCode === 404) {
      return new IgNotFoundError(response);
    }
    if (typeof json.message === 'string') {
      if (json.message === 'challenge_required') {
        this.client.state.checkpoint = json;
        return new IgCheckpointError(response);
      }
      if (json.message === 'user_has_logged_out') {
        return new IgUserHasLoggedOutError(response);
      }
      if (json.message === 'login_required') {
        return new IgLoginRequiredError(response);
      }
      if (json.message.toLowerCase() === 'not authorized to view user') {
        return new IgPrivateUserError(response);
      }
    }
    if (json.error_type === 'sentry_block') {
      return new IgSentryBlockError(response);
    }
    if (json.error_type === 'inactive user') {
      return new IgInactiveUserError(response);
    }
    return new IgResponseError(response);
  }

  protected async faultTolerantRequest(config: AxiosRequestConfig): Promise<AxiosResponse> {
    try {
      return await retry<AxiosResponse>(async () => axios.request(config), this.attemptOptions);
    } catch (err) {
      throw new IgNetworkError(err);
    }
  }

  public getDefaultHeaders() {
    return {
      'User-Agent': this.client.state.appUserAgent,
      'X-Ads-Opt-Out': this.client.state.adsOptOut ? '1' : '0',
      'X-CM-Bandwidth-KBPS': '-1.000',
      'X-CM-Latency': '-1.000',
      'X-IG-App-Locale': this.client.state.language,
      'X-IG-Device-Locale': this.client.state.language,
      'X-Pigeon-Session-Id': this.client.state.pigeonSessionId,
      'X-Pigeon-Rawclienttime': (Date.now() / 1000).toFixed(3),
      'X-IG-Connection-Speed': `${random(1000, 3700)}kbps`,
      'X-IG-Bandwidth-Speed-KBPS': '-1.000',
      'X-IG-Bandwidth-TotalBytes-B': '0',
      'X-IG-Bandwidth-TotalTime-MS': '0',
      'X-IG-EU-DC-ENABLED':
        typeof this.client.state.euDCEnabled === 'undefined' ? void 0 : this.client.state.euDCEnabled.toString(),
      'X-IG-Extended-CDN-Thumbnail-Cache-Busting-Value': this.client.state.thumbnailCacheBustingValue.toString(),
      'X-Bloks-Version-Id': this.client.state.bloksVersionId,
      'X-MID': this.client.state.extractCookie('mid')?.value,
      'X-IG-WWW-Claim': this.client.state.igWWWClaim || '0',
      'X-Bloks-Is-Layout-RTL': this.client.state.isLayoutRTL.toString(),
      'X-IG-Connection-Type': this.client.state.connectionTypeHeader,
      'X-IG-Capabilities': this.client.state.capabilitiesHeader,
      'X-IG-App-ID': this.client.state.fbAnalyticsApplicationId,
      'X-IG-Device-ID': this.client.state.uuid,
      'X-IG-Android-ID': this.client.state.deviceId,
      'Accept-Language': this.client.state.language.replace('_', '-'),
      'X-FB-HTTP-Engine': 'Liger',
      Authorization: this.client.state.authorization,
      'Accept-Encoding': 'gzip',
      Connection: 'close',
    };
  }
}
