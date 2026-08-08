// image-attach — toFilePartInput pure function + pickImages via mock.
//
// Mock for expo-image-picker is pre-loaded via test/register-mocks.ts.
// Control the mock via globalThis.__PICKER_MOCK.

import { strict as assert } from "node:assert";

import { toFilePartInput, pickImages, type ImageAttachment } from "../src/utils/image-attach";
import { test } from "./harness.ts";

const pickerMock = (globalThis as any).__PICKER_MOCK;

function makeAttachment(overrides?: Partial<ImageAttachment>): ImageAttachment {
  return {
    id: "img-1",
    mime: "image/jpeg",
    filename: "photo.jpg",
    dataUrl: "data:image/jpeg;base64,/9j/4AAQ",
    previewUri: "file:///tmp/photo.jpg",
    ...overrides,
  };
}

export async function imageAttachSuite() {
  console.log("\n== image-attach ==");

  // ── toFilePartInput ──
  await test("toFilePartInput: produces correct FilePartInput shape", () => {
    const att = makeAttachment();
    const result = toFilePartInput(att);

    assert.equal(result.type, "file");
    assert.equal(result.mime, "image/jpeg");
    assert.equal(result.filename, "photo.jpg");
    assert.equal(result.url, "data:image/jpeg;base64,/9j/4AAQ");
  });

  await test("toFilePartInput: preserves png mime", () => {
    const att = makeAttachment({
      mime: "image/png",
      filename: "img.png",
      dataUrl: "data:image/png;base64,iVBOR",
    });
    const result = toFilePartInput(att);

    assert.equal(result.mime, "image/png");
    assert.equal(result.filename, "img.png");
  });

  await test("toFilePartInput: preserves webp mime", () => {
    const att = makeAttachment({
      mime: "image/webp",
      filename: "img.webp",
      dataUrl: "data:image/webp;base64,UklGR",
    });
    const result = toFilePartInput(att);

    assert.equal(result.mime, "image/webp");
  });

  // ── pickImages: canceled ──
  await test("pickImages: user cancels → returns null", async () => {
    pickerMock.reset();
    const result = await pickImages();
    assert.equal(result, null);
  });

  // ── pickImages: single image with mimeType ──
  await test("pickImages: single JPEG with mimeType", async () => {
    pickerMock.setResult({
      canceled: false,
      assets: [
        {
          uri: "file:///tmp/photo1.jpg",
          base64: "/9j/4AAQ",
          mimeType: "image/jpeg",
          fileName: "photo1.jpg",
          assetId: "asset-1",
        },
      ],
    });
    const result = await pickImages();
    assert.ok(result);
    assert.equal(result!.length, 1);
    assert.equal(result![0].mime, "image/jpeg");
    assert.equal(result![0].filename, "photo1.jpg");
    assert.equal(result![0].dataUrl, "data:image/jpeg;base64,/9j/4AAQ");
    assert.equal(result![0].previewUri, "file:///tmp/photo1.jpg");
  });

  // ── pickImages: infers mime from extension when mimeType missing ──
  await test("pickImages: infers png from .png extension", async () => {
    pickerMock.setResult({
      canceled: false,
      assets: [
        { uri: "file:///tmp/img.png", base64: "iVBOR", mimeType: undefined, fileName: "img.png" },
      ],
    });
    const result = await pickImages();
    assert.ok(result);
    assert.equal(result![0].mime, "image/png");
  });

  await test("pickImages: infers gif from .gif extension", async () => {
    pickerMock.setResult({
      canceled: false,
      assets: [
        { uri: "file:///tmp/anim.gif", base64: "R0lGOD", mimeType: null, fileName: "anim.gif" },
      ],
    });
    const result = await pickImages();
    assert.ok(result);
    assert.equal(result![0].mime, "image/gif");
  });

  await test("pickImages: infers webp from .webp extension", async () => {
    pickerMock.setResult({
      canceled: false,
      assets: [{ uri: "file:///tmp/x.webp", base64: "UklGR", fileName: "x.webp" }],
    });
    const result = await pickImages();
    assert.ok(result);
    assert.equal(result![0].mime, "image/webp");
  });

  await test("pickImages: defaults to jpeg when no mime and no known extension", async () => {
    pickerMock.setResult({
      canceled: false,
      assets: [{ uri: "file:///tmp/image", base64: "abc", fileName: null }],
    });
    const result = await pickImages();
    assert.ok(result);
    assert.equal(result![0].mime, "image/jpeg");
  });

  // ── pickImages: filename inference ──
  await test("pickImages: generates filename when fileName missing", async () => {
    pickerMock.setResult({
      canceled: false,
      assets: [
        { uri: "file:///tmp/img.png", base64: "iVBOR", mimeType: "image/png", assetId: "42" },
      ],
    });
    const result = await pickImages();
    assert.ok(result);
    assert.match(result![0].filename, /^image-.+\.png$/);
  });

  // ── pickImages: multiple images ──
  await test("pickImages: returns multiple attachments", async () => {
    pickerMock.setResult({
      canceled: false,
      assets: [
        { uri: "file:///a.jpg", base64: "AAA", mimeType: "image/jpeg", fileName: "a.jpg" },
        { uri: "file:///b.png", base64: "BBB", mimeType: "image/png", fileName: "b.png" },
        { uri: "file:///c.webp", base64: "CCC", mimeType: "image/webp", fileName: "c.webp" },
      ],
    });
    const result = await pickImages();
    assert.ok(result);
    assert.equal(result!.length, 3);
    assert.equal(result![0].filename, "a.jpg");
    assert.equal(result![1].filename, "b.png");
    assert.equal(result![2].filename, "c.webp");
  });

  // ── pickImages: skips assets without base64 ──
  await test("pickImages: skips assets missing base64", async () => {
    pickerMock.setResult({
      canceled: false,
      assets: [
        { uri: "file:///no-base64.jpg", base64: null, mimeType: "image/jpeg", fileName: "x.jpg" },
        { uri: "file:///has-base64.jpg", base64: "abc", mimeType: "image/jpeg", fileName: "y.jpg" },
      ],
    });
    const result = await pickImages();
    assert.ok(result);
    assert.equal(result!.length, 1);
    assert.equal(result![0].filename, "y.jpg");
  });

  await test("pickImages: all assets missing base64 → returns null", async () => {
    pickerMock.setResult({
      canceled: false,
      assets: [{ uri: "file:///x.jpg", base64: undefined }],
    });
    const result = await pickImages();
    assert.equal(result, null);
  });
}
