import { strict as assert } from "node:assert";

import { base64Encode, basicAuthHeader, authToken } from "../src/utils/auth.ts";
import { test } from "./harness.ts";

export async function authSuite() {
  console.log("\n== auth helpers ==");
  await test("base64Encode matches Buffer reference", () => {
    assert.equal(base64Encode("opencode:testpwd123"), "b3BlbmNvZGU6dGVzdHB3ZDEyMw==");
    assert.equal(base64Encode(""), "");
    assert.equal(base64Encode("a"), "YQ==");
    assert.equal(base64Encode("ab"), "YWI=");
    assert.equal(base64Encode("abc"), "YWJj");
  });
  await test("base64Encode handles UTF-8 multi-byte", () => {
    const expected = Buffer.from("hello world", "utf8").toString("base64");
    assert.equal(base64Encode("hello world"), expected);
    const expected2 = Buffer.from("multibyte", "utf8").toString("base64");
    assert.equal(base64Encode("multibyte"), expected2);
  });
  await test("basicAuthHeader format", () => {
    assert.equal(
      basicAuthHeader({ username: "opencode", password: "secret" }),
      "Basic b3BlbmNvZGU6c2VjcmV0",
    );
  });
  await test("authToken is bare base64", () => {
    assert.equal(authToken({ username: "u", password: "p" }), "dTpw");
  });
}
