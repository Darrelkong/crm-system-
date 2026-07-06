"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

type IdleExemptContextValue = {
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  /** Client-side expiry in ms (Date.now() scale). null = no active exemption. */
  exemptUntil: number | null;
  setExemptUntil: (ms: number) => void;
};

const IdleExemptContext = createContext<IdleExemptContextValue | null>(null);

export function IdleExemptProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [exemptUntil, setExemptUntilState] = useState<number | null>(null);

  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => setModalOpen(false), []);
  const setExemptUntil = useCallback(
    (ms: number) => setExemptUntilState(ms),
    [],
  );

  const value = useMemo<IdleExemptContextValue>(
    () => ({ modalOpen, openModal, closeModal, exemptUntil, setExemptUntil }),
    [modalOpen, openModal, closeModal, exemptUntil, setExemptUntil],
  );

  return (
    <IdleExemptContext.Provider value={value}>
      {children}
    </IdleExemptContext.Provider>
  );
}

export function useIdleExempt(): IdleExemptContextValue {
  const ctx = useContext(IdleExemptContext);
  if (!ctx) {
    throw new Error("useIdleExempt must be used inside IdleExemptProvider");
  }
  return ctx;
}
