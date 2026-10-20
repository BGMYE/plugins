// Devin's nginx turns away a request body past 10 MiB on the wire (413
// Request Entity Too Large), while its server takes a gzipped Connect frame
// up to 32 MiB inflated: a long turn goes gzipped, a short one as it was.
import { expect, test } from "bun:test"
import { gunzipSync } from "node:zlib"
import { _internal } from "./index.mjs"

const unframe = (b) => ({ flags: b[0], data: b.subarray(5, 5 + new DataView(b.buffer, b.byteOffset).getUint32(1)) })

test("a short message goes as it is", () => {
  const msg = new TextEncoder().encode("hi")
  const { flags, data } = unframe(_internal.frame(msg))
  expect(flags).toBe(0)
  expect([...data]).toEqual([...msg])
})

test("a long message goes gzipped, and inflates to itself", () => {
  const msg = new TextEncoder().encode("x".repeat(12 << 20))
  const out = _internal.frame(msg)
  const { flags, data } = unframe(out)
  expect(flags).toBe(1)
  expect(out.length).toBeLessThan(1 << 20)
  expect(Buffer.from(gunzipSync(data)).equals(Buffer.from(msg))).toBe(true)
})

test("the chat request says its frames may be gzipped", async () => {
  let seen
  const was = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    seen = init
    return new Response("{}", { status: 400 })
  }
  try {
    const chat = { model: "swe-2", messages: [{ role: "user", content: "y".repeat(200 << 10) }] }
    await _internal.complete({ key: "k", server: "https://devin.test", families: [] }, chat)
  } finally {
    globalThis.fetch = was
  }
  expect(seen.headers["Connect-Content-Encoding"]).toBe("gzip")
  expect(unframe(seen.body).flags).toBe(1)
})
