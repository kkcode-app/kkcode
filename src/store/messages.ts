/**
 * [INPUT]: 依赖 @opencode-ai/sdk/v2 的 Message/Part 类型，依赖 zustand 的 create
 * [OUTPUT]: 对外提供 useMessagesStore，含 bySession 规范化存储、parent-child 因果顺序修复、setMessages/mergeMessages/prependMessages/upsertMessage（可原子合并 pending delta）/upsertPart/appendDelta/appendDeltas（帧内批量）等
 * [POS]: src/store 的消息存储与顺序一致性核心，被 dispatch.ts（SSE 派发）与 ChatScreen/MessageBubble（渲染消费）依赖
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// Messages store: per-session messages keyed by sessionID, with parts upsert.
// messages stream as part updates, so we keep parts in a Map keyed by partID
// for O(1) upsert.

import { create } from "zustand";

import type { Message, Part } from "@opencode-ai/sdk/v2";

export type MessageWithParts = {
  message: Message;
  // Ordered list of part IDs for stable rendering. Parts themselves live in
  // partsById; reordering happens only when a brand-new part arrives.
  partOrder: string[];
  partsById: Record<string, Part>;
};

export type MessageDelta = {
  sessionID: string;
  messageID: string;
  partID: string;
  delta: string;
};

type MessagesState = {
  bySession: Record<string, MessageWithParts[]>;
  loading: Record<string, boolean>;

  setMessages: (
    sessionID: string,
    messages: Message[],
    partsByMessage: Record<string, Part[]>,
  ) => void;
  /**
   * Reconcile a latest-page snapshot into the existing timeline.
   *
   * Unlike setMessages this never discards history outside the fetched page,
   * and it refuses to shorten streamed text or regress terminal states when a
   * slightly stale REST response races with SSE.
   */
  mergeMessages: (
    sessionID: string,
    messages: Message[],
    partsByMessage: Record<string, Part[]>,
  ) => void;
  // Insert older messages at the head of the timeline. Skips IDs already
  // present so a paginated history fetch never duplicates rows that SSE has
  // already streamed in. Maintains chronological order: caller passes the
  // older page in the order they want it prepended (oldest first).
  prependMessages: (
    sessionID: string,
    messages: Message[],
    partsByMessage: Record<string, Part[]>,
  ) => void;
  upsertMessage: (sessionID: string, message: Message, deltas?: MessageDelta[]) => void;
  upsertPart: (sessionID: string, part: Part) => void;
  removePart: (sessionID: string, partID: string) => void;
  removeMessage: (sessionID: string, messageID: string) => void;
  appendDelta: (sessionID: string, messageID: string, partID: string, delta: string) => void;
  /** Apply all deltas received in one animation frame with a single store update. */
  appendDeltas: (deltas: MessageDelta[]) => void;
  setLoading: (sessionID: string, loading: boolean) => void;
  reset: () => void;
};

function getOrCreateMessage(
  list: MessageWithParts[],
  message: Message,
): { list: MessageWithParts[]; entry: MessageWithParts; isNew: boolean } {
  const idx = list.findIndex((m) => m.message.id === message.id);
  if (idx === -1) {
    const entry: MessageWithParts = {
      message,
      partOrder: [],
      partsById: {},
    };
    return { list: ensureParentBeforeAssistant([...list, entry]), entry, isNew: true };
  }
  const existing = list[idx];
  const entry: MessageWithParts = { ...existing, message };
  const next = list.slice();
  next[idx] = entry;
  return { list: ensureParentBeforeAssistant(next), entry, isNew: false };
}

/**
 * SSE may deliver an assistant message (or its part stub) before the user
 * message referenced by parentID. Repair only that explicit causal violation;
 * never sort the full timeline, which would destabilize virtualized-list anchoring.
 */
function ensureParentBeforeAssistant(list: MessageWithParts[]): MessageWithParts[] {
  let next = list;

  for (let assistantIndex = 0; assistantIndex < next.length; assistantIndex += 1) {
    const message = next[assistantIndex].message;
    if (message.role !== "assistant" || !message.parentID) continue;

    const parentIndex = next.findIndex(
      (entry) => entry.message.role === "user" && entry.message.id === message.parentID,
    );
    if (parentIndex === -1 || parentIndex < assistantIndex) continue;

    if (next === list) next = list.slice();
    const [parent] = next.splice(parentIndex, 1);
    next.splice(assistantIndex, 0, parent);
  }

  return next;
}

function mergeLiveText(current: string, incoming: string): string {
  if (!current) return incoming;
  if (!incoming) return current;
  if (incoming.startsWith(current)) return incoming;
  if (current.startsWith(incoming)) return current;
  return current.length >= incoming.length ? current : incoming;
}

function mergePartUpdate(current: Part | undefined, incoming: Part): Part {
  if (!current) return incoming;
  if (current.type === "text" && (incoming.type === "text" || incoming.type === "reasoning")) {
    return {
      ...incoming,
      text: mergeLiveText(current.text, incoming.text),
    } as Part;
  }
  if (current.type === "reasoning" && incoming.type === "reasoning") {
    return {
      ...incoming,
      text: mergeLiveText(current.text, incoming.text),
    };
  }
  return incoming;
}

function applyPart(entry: MessageWithParts, part: Part): MessageWithParts {
  const exists = entry.partsById[part.id] !== undefined;
  const nextPart = mergePartUpdate(entry.partsById[part.id], part);
  return {
    message: entry.message,
    partOrder: exists ? entry.partOrder : [...entry.partOrder, part.id],
    partsById: { ...entry.partsById, [part.id]: nextPart },
  };
}

function toEntry(message: Message, parts: Part[]): MessageWithParts {
  const partsById: Record<string, Part> = {};
  const partOrder: string[] = [];
  for (const part of parts) {
    if (partsById[part.id] === undefined) partOrder.push(part.id);
    partsById[part.id] = part;
  }
  return { message, partOrder, partsById };
}

function isMessageCompleted(message: Message): boolean {
  const time = (message as Message & { time?: { completed?: number | null } }).time;
  return typeof time?.completed === "number";
}

function partStatus(part: Part): string | undefined {
  const state = (part as Part & { state?: string | { status?: string } }).state;
  return typeof state === "string" ? state : state?.status;
}

function statusRank(status: string | undefined): number {
  if (status === "completed" || status === "error") return 3;
  if (status === "running") return 2;
  if (status === "pending") return 1;
  return 0;
}

/**
 * A latest-page fetch may finish after one or more SSE deltas. Prefer the
 * semantically newer value instead of blindly replacing the live part.
 */
function mergePartSnapshot(
  current: Part,
  incoming: Part,
  currentMessageCompleted: boolean,
  incomingMessageCompleted: boolean,
): Part {
  // A completed REST snapshot is the authoritative final form, including
  // deliberate text rewrites and tool metadata.
  if (incomingMessageCompleted) return incoming;

  if ((current.type === "text" || current.type === "reasoning") && current.type === incoming.type) {
    const currentText = current.text ?? "";
    const incomingText = incoming.text ?? "";
    if (incomingText.startsWith(currentText)) return incoming;
    if (currentText.startsWith(incomingText)) {
      return { ...incoming, text: currentText } as Part;
    }
  }

  const currentRank = statusRank(partStatus(current));
  const incomingRank = statusRank(partStatus(incoming));
  if (currentRank > incomingRank) return current;

  if (currentMessageCompleted && !incomingMessageCompleted) return current;
  return incoming;
}

function mergeEntrySnapshot(
  current: MessageWithParts,
  incoming: MessageWithParts,
): MessageWithParts {
  const currentCompleted = isMessageCompleted(current.message);
  const incomingCompleted = isMessageCompleted(incoming.message);
  const message = currentCompleted && !incomingCompleted ? current.message : incoming.message;
  // Completion makes the fetched part list authoritative. This also recovers
  // part.removed events missed during a disconnect.
  const partOrder = incomingCompleted ? incoming.partOrder.slice() : current.partOrder.slice();
  const partsById = incomingCompleted ? {} : { ...current.partsById };

  for (const partID of incoming.partOrder) {
    const incomingPart = incoming.partsById[partID];
    const currentPart = current.partsById[partID];
    if (!currentPart) {
      if (!incomingCompleted) partOrder.push(partID);
      partsById[partID] = incomingPart;
      continue;
    }
    partsById[partID] = mergePartSnapshot(
      currentPart,
      incomingPart,
      currentCompleted,
      incomingCompleted,
    );
  }

  return { message, partOrder, partsById };
}

function messageCreatedAt(entry: MessageWithParts): number {
  const created = (entry.message as Message & { time?: { created?: number } }).time?.created;
  return typeof created === "number" ? created : 0;
}

function mergeLatestPage(
  current: MessageWithParts[],
  incoming: MessageWithParts[],
): MessageWithParts[] {
  if (current.length === 0) return ensureParentBeforeAssistant(incoming);
  if (incoming.length === 0) return ensureParentBeforeAssistant(current);

  const result = current.slice();
  const incomingIDs = new Set(incoming.map((entry) => entry.message.id));
  const hasOverlap = result.some((entry) => incomingIDs.has(entry.message.id));
  const prependDisjointPage =
    !hasOverlap && messageCreatedAt(incoming[incoming.length - 1]) < messageCreatedAt(result[0]);

  for (let incomingIndex = 0; incomingIndex < incoming.length; incomingIndex += 1) {
    const entry = incoming[incomingIndex];
    const existingIndex = result.findIndex(
      (candidate) => candidate.message.id === entry.message.id,
    );
    if (existingIndex !== -1) {
      result[existingIndex] = mergeEntrySnapshot(result[existingIndex], entry);
      continue;
    }

    if (prependDisjointPage) {
      const previousIncomingID = incoming[incomingIndex - 1]?.message.id;
      const previousIndex = previousIncomingID
        ? result.findIndex((candidate) => candidate.message.id === previousIncomingID)
        : -1;
      result.splice(previousIndex + 1, 0, entry);
      continue;
    }

    const nextKnown = incoming
      .slice(incomingIndex + 1)
      .map((candidate) =>
        result.findIndex((existing) => existing.message.id === candidate.message.id),
      )
      .find((index) => index !== -1);
    if (nextKnown !== undefined) {
      result.splice(nextKnown, 0, entry);
      continue;
    }

    const previousIncomingID = incoming[incomingIndex - 1]?.message.id;
    const previousIndex = previousIncomingID
      ? result.findIndex((candidate) => candidate.message.id === previousIncomingID)
      : -1;
    if (previousIndex !== -1) result.splice(previousIndex + 1, 0, entry);
    else result.push(entry);
  }

  return ensureParentBeforeAssistant(result);
}

/**
 * Returns the original list when the delta cannot affect it. Keeping unchanged
 * session arrays referentially stable is essential: ChatScreen subscribes to
 * one session slice, so streaming in another session must not re-render it.
 */
function appendDeltaToList(
  current: MessageWithParts[],
  sessionID: string,
  messageID: string,
  partID: string,
  delta: string,
): MessageWithParts[] {
  // 流式中的 assistant 几乎总是会话末项。先走 O(1) 尾部命中，只有乱序
  // 事件或后台消息才回退线性查找，避免长会话每个 delta 都扫描全部历史。
  const tailIndex = current.length - 1;
  const idx =
    current[tailIndex]?.message.id === messageID
      ? tailIndex
      : current.findIndex((m) => m.message.id === messageID);
  if (idx === -1) return current;

  const entry = current[idx];
  const part = entry.partsById[partID];
  if (!part) {
    const stubPart = {
      id: partID,
      messageID,
      sessionID,
      type: "text",
      text: delta,
    } as unknown as Part;
    const next = current.slice();
    next[idx] = applyPart(entry, stubPart);
    return next;
  }

  // text 与 reasoning 两种 part 的增量字段都叫 text,都允许流式累加;
  // 否则 reasoning 卡片在 part.updated 后立刻出现标题,但 text 一直为空,
  // 直到下一个 part.updated 才一次性填入完整内容,失去流式效果。
  if (part.type !== "text" && part.type !== "reasoning") return current;
  const updatedPart = { ...part, text: (part.text ?? "") + delta };
  const next = current.slice();
  next[idx] = applyPart(entry, updatedPart);
  return next;
}

export const useMessagesStore = create<MessagesState>((set) => ({
  bySession: {},
  loading: {},

  setMessages: (sessionID, messages, partsByMessage) =>
    set((state) => {
      const list = ensureParentBeforeAssistant(
        messages.map((message) => toEntry(message, partsByMessage[message.id] ?? [])),
      );
      return { bySession: { ...state.bySession, [sessionID]: list } };
    }),

  mergeMessages: (sessionID, messages, partsByMessage) =>
    set((state) => {
      const current = state.bySession[sessionID] ?? [];
      const incoming = messages.map((message) =>
        toEntry(message, partsByMessage[message.id] ?? []),
      );
      const next = mergeLatestPage(current, incoming);
      if (next === current) return state;
      return { bySession: { ...state.bySession, [sessionID]: next } };
    }),

  prependMessages: (sessionID, messages, partsByMessage) =>
    set((state) => {
      const current = state.bySession[sessionID] ?? [];
      const seen = new Set(current.map((e) => e.message.id));
      const head: MessageWithParts[] = [];
      for (const m of messages) {
        if (seen.has(m.id)) continue;
        head.push(toEntry(m, partsByMessage[m.id] ?? []));
      }
      if (head.length === 0) return state;
      const next = ensureParentBeforeAssistant([...head, ...current]);
      return {
        bySession: { ...state.bySession, [sessionID]: next },
      };
    }),

  upsertMessage: (sessionID, message, deltas = []) =>
    set((state) => {
      const current = state.bySession[sessionID] ?? [];
      let { list } = getOrCreateMessage(current, message);
      for (const pending of deltas) {
        if (pending.sessionID !== sessionID || pending.messageID !== message.id) continue;
        list = appendDeltaToList(
          list,
          pending.sessionID,
          pending.messageID,
          pending.partID,
          pending.delta,
        );
      }
      return { bySession: { ...state.bySession, [sessionID]: list } };
    }),

  upsertPart: (sessionID, part) =>
    set((state) => {
      const current = state.bySession[sessionID] ?? [];
      const idx = current.findIndex((m) => m.message.id === part.messageID);
      if (idx === -1) {
        // No message yet — stash the part on a stub. message.updated will
        // arrive shortly after to fill it in.
        // 补 time 兜底：ChatScreen 渲染时直接读 message.time.created,
        // stub 缺 time 会触发 "Cannot read property 'created' of undefined"。
        const now = Date.now();
        const stubMessage = {
          id: part.messageID,
          sessionID: part.sessionID,
          role: "assistant",
          time: { created: now, completed: null },
        } as unknown as Message;
        const stub: MessageWithParts = {
          message: stubMessage,
          partOrder: [part.id],
          partsById: { [part.id]: part },
        };
        return {
          bySession: { ...state.bySession, [sessionID]: [...current, stub] },
        };
      }
      const next = current.slice();
      next[idx] = applyPart(current[idx], part);
      return { bySession: { ...state.bySession, [sessionID]: next } };
    }),

  removePart: (sessionID, partID) =>
    set((state) => {
      const current = state.bySession[sessionID] ?? [];
      const next = current.map((entry) => {
        if (entry.partsById[partID] === undefined) return entry;
        const partsById = { ...entry.partsById };
        delete partsById[partID];
        return {
          message: entry.message,
          partOrder: entry.partOrder.filter((id) => id !== partID),
          partsById,
        };
      });
      return { bySession: { ...state.bySession, [sessionID]: next } };
    }),

  removeMessage: (sessionID, messageID) =>
    set((state) => {
      const current = state.bySession[sessionID] ?? [];
      return {
        bySession: {
          ...state.bySession,
          [sessionID]: current.filter((m) => m.message.id !== messageID),
        },
      };
    }),

  appendDelta: (sessionID, messageID, partID, delta) =>
    set((state) => {
      const current = state.bySession[sessionID] ?? [];
      // 若 part 还没到（part.delta 早于 part.updated），先建一个 text 存根。
      // 之后到达的 part.updated 会通过 upsertPart 整体覆盖,但累计的 delta
      // 不再被默默丢弃。非 text 类型的 part 不缓存,避免类型混淆。
      const next = appendDeltaToList(current, sessionID, messageID, partID, delta);
      if (next === current) return state;
      return { bySession: { ...state.bySession, [sessionID]: next } };
    }),

  appendDeltas: (deltas) =>
    set((state) => {
      if (deltas.length === 0) return state;

      let changed = false;
      const nextBySession = { ...state.bySession };
      const workingLists = new Map<string, MessageWithParts[]>();

      for (const { sessionID, messageID, partID, delta } of deltas) {
        if (!delta) continue;
        const current = workingLists.get(sessionID) ?? state.bySession[sessionID] ?? [];
        const next = appendDeltaToList(current, sessionID, messageID, partID, delta);
        if (next === current) continue;
        changed = true;
        workingLists.set(sessionID, next);
        nextBySession[sessionID] = next;
      }

      return changed ? { bySession: nextBySession } : state;
    }),

  setLoading: (sessionID, loading) =>
    set((state) => ({
      loading: { ...state.loading, [sessionID]: loading },
    })),

  reset: () => set({ bySession: {}, loading: {} }),
}));
