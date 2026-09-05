/**
 * The options accepted by {@link Request.send} — the subset of the former
 * `request` library's options that this client actually uses.
 */
export interface IgRequestOptions {
  /** Absolute URL or a path relative to `https://i.instagram.com/` */
  url: string;
  method?: string;
  headers?: { [name: string]: string | number | undefined };
  /** urlencoded form body */
  form?: { [key: string]: any };
  /** query string parameters; `undefined`/`null` values are skipped */
  qs?: { [key: string]: any };
  /** raw request body */
  body?: string | Buffer;
}
