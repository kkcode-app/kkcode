// Draft store 单元测试：getDraft / setDraftText / setDraftImages / clearDraft

import { strict as assert } from "node:assert";

import { useDraftStore } from "../src/store/draft.ts";
import type { ImageAttachment } from "../src/utils/image-attach.ts";
import { test } from "./harness.ts";

function resetStore() {
  useDraftStore.setState({ drafts: {} });
}

function makeImage(id: string): ImageAttachment {
  return {
    id,
    mime: "image/png",
    filename: `${id}.png`,
    dataUrl: `data:image/png;base64,${id}`,
    previewUri: `file:///tmp/${id}.png`,
  };
}

export async function draftSuite() {
  console.log("\n== draft store ==");

  await test("getDraft: returns empty data for unknown session", () => {
    resetStore();
    const d = useDraftStore.getState().getDraft("unknown");
    assert.equal(d.text, "");
    assert.deepEqual(d.images, []);
  });

  await test("setDraftText: stores text for a session", () => {
    resetStore();
    useDraftStore.getState().setDraftText("S1", "hello world");
    assert.equal(useDraftStore.getState().getDraft("S1").text, "hello world");
    assert.deepEqual(useDraftStore.getState().getDraft("S1").images, []);
  });

  await test("setDraftText: multiple sessions are isolated", () => {
    resetStore();
    useDraftStore.getState().setDraftText("S1", "draft1");
    useDraftStore.getState().setDraftText("S2", "draft2");
    assert.equal(useDraftStore.getState().getDraft("S1").text, "draft1");
    assert.equal(useDraftStore.getState().getDraft("S2").text, "draft2");
  });

  await test("setDraftText: overwriting updates the stored text", () => {
    resetStore();
    useDraftStore.getState().setDraftText("S1", "v1");
    useDraftStore.getState().setDraftText("S1", "v2");
    assert.equal(useDraftStore.getState().getDraft("S1").text, "v2");
  });

  await test("setDraftText: empty string removes the draft entry (no images)", () => {
    resetStore();
    useDraftStore.getState().setDraftText("S1", "something");
    useDraftStore.getState().setDraftText("S1", "");
    assert.equal(useDraftStore.getState().getDraft("S1").text, "");
    assert.equal(useDraftStore.getState().drafts["S1"], undefined);
  });

  await test("setDraftImages: stores images for a session", () => {
    resetStore();
    const imgs = [makeImage("i1"), makeImage("i2")];
    useDraftStore.getState().setDraftImages("S1", imgs);
    assert.equal(useDraftStore.getState().getDraft("S1").images.length, 2);
    assert.equal(useDraftStore.getState().getDraft("S1").images[0].id, "i1");
    assert.equal(useDraftStore.getState().getDraft("S1").text, "");
  });

  await test("setDraftImages: empty array removes the draft entry (no text)", () => {
    resetStore();
    useDraftStore.getState().setDraftImages("S1", [makeImage("i1")]);
    useDraftStore.getState().setDraftImages("S1", []);
    assert.deepEqual(useDraftStore.getState().getDraft("S1").images, []);
    assert.equal(useDraftStore.getState().drafts["S1"], undefined);
  });

  await test("setDraftText + setDraftImages: text and images coexist", () => {
    resetStore();
    useDraftStore.getState().setDraftText("S1", "look at this");
    useDraftStore.getState().setDraftImages("S1", [makeImage("i1")]);
    const d = useDraftStore.getState().getDraft("S1");
    assert.equal(d.text, "look at this");
    assert.equal(d.images.length, 1);
  });

  await test("setDraftText: empty with images kept does not delete entry", () => {
    resetStore();
    useDraftStore.getState().setDraftImages("S1", [makeImage("i1")]);
    useDraftStore.getState().setDraftText("S1", "");
    assert.equal(useDraftStore.getState().getDraft("S1").images.length, 1);
    assert.ok(useDraftStore.getState().drafts["S1"] !== undefined);
  });

  await test("clearDraft: removes the draft for a session", () => {
    resetStore();
    useDraftStore.getState().setDraftText("S1", "hello");
    useDraftStore.getState().clearDraft("S1");
    assert.equal(useDraftStore.getState().getDraft("S1").text, "");
    assert.equal(useDraftStore.getState().drafts["S1"], undefined);
  });

  await test("clearDraft: also clears images", () => {
    resetStore();
    useDraftStore.getState().setDraftImages("S1", [makeImage("i1"), makeImage("i2")]);
    useDraftStore.getState().setDraftText("S1", "text");
    useDraftStore.getState().clearDraft("S1");
    assert.deepEqual(useDraftStore.getState().getDraft("S1").images, []);
    assert.equal(useDraftStore.getState().getDraft("S1").text, "");
    assert.equal(useDraftStore.getState().drafts["S1"], undefined);
  });

  await test("clearDraft: no-op for non-existent session", () => {
    resetStore();
    useDraftStore.getState().setDraftText("S1", "keep");
    useDraftStore.getState().clearDraft("S2"); // S2 never set
    assert.equal(useDraftStore.getState().getDraft("S1").text, "keep");
  });

  await test("clearDraft: does not affect other sessions", () => {
    resetStore();
    useDraftStore.getState().setDraftText("S1", "a");
    useDraftStore.getState().setDraftImages("S2", [makeImage("i1")]);
    useDraftStore.getState().clearDraft("S1");
    assert.equal(useDraftStore.getState().getDraft("S1").text, "");
    assert.equal(useDraftStore.getState().getDraft("S2").images.length, 1);
  });
}
