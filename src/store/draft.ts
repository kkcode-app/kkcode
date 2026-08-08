/**
 * [INPUT]: 依赖 zustand 的 create
 * [OUTPUT]: 对外提供 useDraftStore hook，含 getDraft / setDraftText / setDraftImages / clearDraft
 * [POS]: store/ 的草稿持久化层，按 sessionID 隔离，被 app/chat/[id].tsx 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * 草稿同时存文字和图片附件。两者都只活在内存（不持久化到 AsyncStorage）：
 * 文字草稿本来就没持久化；图片 base64 太大不适合持久化，杀进程丢失可接受。
 * 切会话再回来（同一次 app 生命周期内）文字和图片都还在。
 */
import { create } from "zustand";

import type { ImageAttachment } from "../utils/image-attach";

type DraftData = {
  /** 草稿文字 */
  text: string;
  /** 草稿图片附件，发送时作为 FilePartInput 一起发 */
  images: ImageAttachment[];
};

const EMPTY: DraftData = { text: "", images: [] };

type DraftState = {
  /** sessionID -> 草稿（文字 + 图片） */
  drafts: Record<string, DraftData>;

  /** 读取某个 session 的草稿，不存在返回空对象（含空文字和空图片数组） */
  getDraft: (sessionID: string) => DraftData;

  /** 保存草稿文字；内容为空时清掉该 session 的文字 */
  setDraftText: (sessionID: string, text: string) => void;

  /** 保存草稿图片；数组为空时清掉该 session 的图片 */
  setDraftImages: (sessionID: string, images: ImageAttachment[]) => void;

  /** 提交发送时清除整个草稿（文字 + 图片）；请求失败由调用方恢复提交快照 */
  clearDraft: (sessionID: string) => void;
};

export const useDraftStore = create<DraftState>((set, get) => ({
  drafts: {},

  getDraft: (sessionID) => get().drafts[sessionID] ?? EMPTY,

  setDraftText: (sessionID, text) =>
    set((state) => {
      const prev = state.drafts[sessionID] ?? EMPTY;
      // 文字和图片都空了就整体删掉，避免 drafts 里攒一堆空对象
      if (!text && prev.images.length === 0) {
        if (!state.drafts[sessionID]) return state;
        const next = { ...state.drafts };
        delete next[sessionID];
        return { drafts: next };
      }
      return { drafts: { ...state.drafts, [sessionID]: { ...prev, text } } };
    }),

  setDraftImages: (sessionID, images) =>
    set((state) => {
      const prev = state.drafts[sessionID] ?? EMPTY;
      if (images.length === 0 && !prev.text) {
        if (!state.drafts[sessionID]) return state;
        const next = { ...state.drafts };
        delete next[sessionID];
        return { drafts: next };
      }
      return { drafts: { ...state.drafts, [sessionID]: { ...prev, images } } };
    }),

  clearDraft: (sessionID) =>
    set((state) => {
      if (!state.drafts[sessionID]) return state;
      const next = { ...state.drafts };
      delete next[sessionID];
      return { drafts: next };
    }),
}));
