// Basic Auth + directory header for every request: Authorization: Basic ...
// is used for both fetch (client.ts) and SSE (sse.ts). authToken() is kept
// for legacy/test consumers that need the bare base64.

export type Credentials = {
  username: string;
  password: string;
};

// React Native does not ship `btoa` reliably, write a tiny encoder.
const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64Encode(input: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }

  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = bytes[i + 1];
    const b3 = bytes[i + 2];
    out += B64_CHARS[b1 >> 2];
    out += B64_CHARS[((b1 & 3) << 4) | ((b2 ?? 0) >> 4)];
    out += b2 === undefined ? "=" : B64_CHARS[((b2 & 15) << 2) | ((b3 ?? 0) >> 6)];
    out += b3 === undefined ? "=" : B64_CHARS[b3 & 63];
  }
  return out;
}

export function basicAuthHeader(creds: Credentials): string {
  return `Basic ${base64Encode(`${creds.username}:${creds.password}`)}`;
}

export function authToken(creds: Credentials): string {
  return base64Encode(`${creds.username}:${creds.password}`);
}
