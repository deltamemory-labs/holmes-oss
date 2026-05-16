/**
 * Polyfills shimmed in at app boot, before anything else runs.
 *
 * WKWebView (Tauri on macOS + Linux's webkit2gtk) didn't expose
 * `ReadableStream.prototype[Symbol.asyncIterator]` until Safari 17.4.
 * Both the Vercel AI SDK (in its chat transport) and pdf.js iterate
 * over streams with `for await (const chunk of stream)`, which on
 * older WebKits throws
 *
 *     undefined is not a function (near '...value of readableStream...')
 *
 * This file installs the spec-shaped iterator on the prototype if it's
 * missing. Chromium-based WebView2 (Tauri on Windows) already supports
 * it natively, in which case the polyfill is a no-op.
 */

if (
  typeof ReadableStream !== "undefined" &&
  !(Symbol.asyncIterator in ReadableStream.prototype)
) {
  type StreamIterator<T> = AsyncIterator<T, undefined, unknown> & {
    [Symbol.asyncIterator](): StreamIterator<T>;
    return?: (value?: unknown) => Promise<IteratorResult<T, undefined>>;
  };

  function streamValues<T>(
    this: ReadableStream<T>,
    opts?: { preventCancel?: boolean },
  ): StreamIterator<T> {
    const reader = this.getReader();
    const preventCancel = Boolean(opts?.preventCancel);
    let released = false;

    const release = () => {
      if (released) return;
      released = true;
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    };

    return {
      async next() {
        try {
          const { done, value } = await reader.read();
          if (done) {
            release();
            return { done: true, value: undefined };
          }
          return { done: false, value };
        } catch (err) {
          release();
          throw err;
        }
      },
      async return(value?: unknown) {
        if (!preventCancel) {
          try {
            await reader.cancel(value);
          } catch {
            /* ignore */
          }
        }
        release();
        return { done: true, value: undefined };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  // `.values()` is the canonical spec entry point; `[Symbol.asyncIterator]`
  // delegates to it with default options. Expose both so code that calls
  // either shape works.
  Object.defineProperty(ReadableStream.prototype, "values", {
    value: streamValues,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, {
    value: function (this: ReadableStream<unknown>) {
      return streamValues.call(this);
    },
    writable: true,
    configurable: true,
  });
}

export {};
