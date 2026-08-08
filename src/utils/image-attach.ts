// 图片附件工具 —— 把 expo-image-picker 的结果封装成服务端能直接消费的
// FilePartInput。opencode 服务端不区分"图片 part"，图片就是 mime 以
// `image/` 开头的 FilePart，url 为 `data:image/...;base64,...` 内联数据 URL。
// 服务端 image.normalize() 会自动把超大图缩到 2000x2000 / 5MB 以内，所以
// 客户端不必自己预压缩，只让 picker 用 quality 0.8 先压一道 jpeg 即可。
//
// 设计要点:
//  1. ImageAttachment 同时保留 previewUri(本地 file://) 和 dataUrl(base64)。
//     输入栏缩略图用 previewUri，避免反复解码 base64；发送时才用 dataUrl。
//  2. base64 可能很大(单张几 MB)，所以 ImageAttachment 只活在内存 + 草稿
//     store 里，不持久化到 AsyncStorage(与文字草稿现状一致)。
//  3. expo-image-picker 的 base64 字段文档说是"JPEG data"，但 mimeType 字段
//     会给出实际类型；两者都拿不到时兜底 image/jpeg。dataUrl 的 mime 必须跟
//     实际字节一致，否则服务端 photon 解码会失败。
//  4. id 用 crypto.randomUUID() 不稳(老 iOS Safari 才有问题，RN 没事)，
//     但为了零依赖用计数器 + 时间戳，足够做 UI key 和草稿引用。

import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import type { FilePartInput } from "@opencode-ai/sdk/v2";

export type ImageAttachment = {
  /** 本地生成，用于 UI key 和草稿引用 */
  id: string;
  /** "image/jpeg" / "image/png" / ...，与 dataUrl 字节一致 */
  mime: string;
  /** "photo.jpg" 之类，发给服务端做 filename */
  filename: string;
  /** "data:image/jpeg;base64,..." 完整数据 URL，发送时用 */
  dataUrl: string;
  /** 本地 file:// uri，输入栏缩略图预览用（比 dataUrl 轻） */
  previewUri: string;
};

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `img-${Date.now()}-${idCounter}`;
}

/** 从 asset 推断 mime：优先 mimeType 字段，其次按 uri 扩展名，兜底 jpeg */
function inferMime(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.mimeType && asset.mimeType.startsWith("image/")) {
    return asset.mimeType;
  }
  const ext = asset.uri.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}

function inferFilename(asset: ImagePicker.ImagePickerAsset, mime: string): string {
  if (asset.fileName) return asset.fileName;
  const ext = mime.split("/")[1] ?? "jpg";
  return `image-${asset.assetId ?? Date.now()}.${ext}`;
}

/**
 * 把 ArrayBuffer 转成 base64 字符串。RN 环境没有原生 btoa，用手动分块编码
 * 避免 String.fromCharCode 栈溢出（大图可能几 MB）。
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * 从 picker asset 构造 ImageAttachment。base64 为空时（launchCameraAsync
 * 在部分 Android 设备上已知不返回 base64）用 expo-file-system 从 uri 读取
 * 文件再手动编码，避免静默丢图。
 */
async function assetToAttachment(
  asset: ImagePicker.ImagePickerAsset,
): Promise<ImageAttachment | null> {
  const mime = inferMime(asset);
  let base64 = asset.base64;
  if (!base64) {
    try {
      const file = new File(asset.uri);
      const buf = await file.arrayBuffer();
      base64 = arrayBufferToBase64(buf);
    } catch {
      console.warn("[image-attach] failed to read file for base64 fallback", asset.uri);
      return null;
    }
  }
  return {
    id: nextId(),
    mime,
    filename: inferFilename(asset, mime),
    dataUrl: `data:${mime};base64,${base64}`,
    previewUri: asset.uri,
  };
}

/**
 * 调起相册选图（暂仅单选）。返回选中的附件数组；用户取消返回 null。
 * 抛出 Error 表示权限被拒或选图失败，调用方负责 Toast/Alert。
 *
 * 用 launchImageLibraryAsync（promise 式），selectionLimit:1 限制单选，
 * base64: true 让 picker 一并返回 base64。quality 0.8 让 picker 先压一道 jpeg，
 * 避免超大原图撑爆 JSON body。
 */
export async function pickImages(): Promise<ImageAttachment[] | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: false,
    quality: 0.8,
    base64: true,
    allowsEditing: false,
  });

  if (result.canceled) return null;

  const out: ImageAttachment[] = [];
  for (const asset of result.assets) {
    const att = await assetToAttachment(asset);
    if (att) out.push(att);
  }
  return out.length > 0 ? out : null;
}

/**
 * 调起系统相机拍照。返回单张附件数组；用户取消返回 null。
 * 抛出 Error 表示权限被拒或拍照失败，调用方负责 Toast/Alert。
 *
 * 用 launchCameraAsync（promise 式），base64: true 让 picker 返回 base64。
 * quality 0.8 与相册选图一致，避免超大原图撑爆 JSON body。
 */
export async function takePhoto(): Promise<ImageAttachment[] | null> {
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    quality: 0.8,
    base64: true,
    allowsEditing: false,
  });

  if (result.canceled) return null;

  const out: ImageAttachment[] = [];
  for (const asset of result.assets) {
    const att = await assetToAttachment(asset);
    if (att) out.push(att);
  }
  return out.length > 0 ? out : null;
}

/** 把单个附件转成服务端 parts 数组里的 FilePartInput */
export function toFilePartInput(att: ImageAttachment): FilePartInput {
  return {
    type: "file",
    mime: att.mime,
    filename: att.filename,
    url: att.dataUrl,
  };
}
