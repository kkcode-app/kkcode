import { create } from "zustand";

export type QuestionOption = {
  label: string;
  description: string;
};

export type QuestionInfo = {
  question: string;
  header: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
};

export type QuestionRequest = {
  id: string;
  sessionID: string;
  questions: QuestionInfo[];
};

type QuestionState = {
  pending: QuestionRequest[];
  add: (req: QuestionRequest) => void;
  remove: (id: string) => void;
  reset: () => void;
};

export const useQuestionStore = create<QuestionState>((set) => ({
  pending: [],
  add: (req) =>
    set((state) => {
      if (state.pending.some((p) => p.id === req.id)) return state;
      return { pending: [...state.pending, req] };
    }),
  remove: (id) => set((state) => ({ pending: state.pending.filter((p) => p.id !== id) })),
  reset: () => set({ pending: [] }),
}));
