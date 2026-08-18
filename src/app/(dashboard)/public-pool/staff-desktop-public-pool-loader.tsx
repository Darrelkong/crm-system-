"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n/provider";
import { resolveApiError } from "@/i18n/resolve-api-error";
import type { PublicPoolCustomerView } from "@/lib/public-pool/queries";
import { PublicPoolClient } from "./public-pool-client";

const DESKTOP_MQ = "(min-width: 768px)";
const CUSTOMERS_API = "/api/public-pool/customers";

export type StaffDesktopListControls = {
  removeCustomer: (customerId: string) => void;
  refreshList: () => void;
};

type Props = {
  onControlsReady?: (controls: StaffDesktopListControls) => void;
};

export function StaffDesktopPublicPoolLoader({ onControlsReady }: Props) {
  const { t } = useTranslation();
  const [isDesktop, setIsDesktop] = useState(false);
  const [items, setItems] = useState<PublicPoolCustomerView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const onControlsReadyRef = useRef(onControlsReady);

  useEffect(() => {
    onControlsReadyRef.current = onControlsReady;
  }, [onControlsReady]);

  const fetchList = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(CUSTOMERS_API, {
        headers: { Accept: "application/json" },
      });
      const data = (await res.json()) as {
        items?: PublicPoolCustomerView[];
        error?: string;
        errorCode?: string;
        code?: string;
      };
      if (fetchId !== fetchIdRef.current) return;
      if (!res.ok) {
        setError(resolveApiError(t, data));
        return;
      }
      setItems(data.items ?? []);
    } catch {
      if (fetchId !== fetchIdRef.current) return;
      setError(t("common.networkError"));
    } finally {
      inFlightRef.current = false;
      if (fetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [t]);

  const removeCustomer = useCallback((customerId: string) => {
    setItems((prev) => prev.filter((c) => c.id !== customerId));
  }, []);

  const refreshList = useCallback(() => {
    if (window.matchMedia(DESKTOP_MQ).matches) {
      void fetchList();
    }
  }, [fetchList]);

  useEffect(() => {
    onControlsReadyRef.current?.({ removeCustomer, refreshList });
  }, [removeCustomer, refreshList]);

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MQ);

    function syncViewport() {
      const desktop = mq.matches;
      setIsDesktop(desktop);
      if (!desktop) {
        fetchIdRef.current += 1;
        setItems([]);
        setLoading(false);
        setError(null);
        return;
      }
      void fetchList();
    }

    syncViewport();
    mq.addEventListener("change", syncViewport);
    return () => mq.removeEventListener("change", syncViewport);
  }, [fetchList]);

  if (!isDesktop) {
    return null;
  }

  if (loading && items.length === 0) {
    return (
      <p className="mb-4 text-sm crm-text-secondary">
        {t("publicPool.loadingList")}
      </p>
    );
  }

  return (
    <>
      {error && (
        <div className="alert-error mb-4 px-4 py-3 text-sm" role="alert">
          {error}
        </div>
      )}
      <PublicPoolClient initialItems={items} isAdmin={false} />
    </>
  );
}
