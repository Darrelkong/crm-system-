"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/form";
import { PageIntro } from "@/components/ui/page-intro";
import {
  DataTable,
  TableBody,
  TableHead,
  TableShell,
  Td,
  Th,
  Tr,
} from "@/components/ui/table";
import { useTranslation } from "@/i18n/provider";
import {
  activateSignatureVersion,
  createSignatureVersion,
  fetchAdminUsersForMailAccess,
  fetchSenderIdentities,
  fetchSignatureVersions,
} from "@/lib/mail/client/api";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import type { SenderIdentityApiItem } from "@/lib/mail/client/sender-identity-management";
import {
  buildSignaturePreviewHtml,
  buildSignatureVersionRows,
  canManageSignatures,
  draftFromSignatureVersion,
  emptySignatureEditorDraft,
  filterManageableSignatureSenderIdentities,
  isSignatureEditorDraftValid,
  resolveSignatureVersionRowActions,
  type SignatureEditorDraft,
  type SignatureEditorMode,
  type SignatureVersionRow,
} from "@/lib/mail/client/signature-management";
import { formatHongKongDateTime } from "@/lib/timezone";
import {
  MailAdminEmptyState,
  MailAdminErrorState,
  MailAdminLoadingState,
  MAIL_ADMIN_CARD_STACK_CLASS,
  MAIL_ADMIN_SECTION_CLASS,
} from "./mail-admin-states";

function SignatureDefaultBadge({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  if (!isActive) {
    return (
      <span className="text-sm crm-text-secondary">
        {t("mail.adminCenter.signature.notDefault")}
      </span>
    );
  }
  return (
    <Badge variant="accent">
      {t("mail.adminCenter.signature.defaultSignature")}
    </Badge>
  );
}

function SignaturePreviewPane({ html }: { html: string | null }) {
  const { t } = useTranslation();
  if (!html) {
    return (
      <div className="rounded-xl border border-dashed crm-border px-4 py-8 text-center text-sm crm-text-secondary">
        {t("mail.adminCenter.signature.previewEmpty")}
      </div>
    );
  }
  return (
    <div
      className="mail-signature-preview min-h-[8rem] rounded-xl bg-black/[0.02] px-4 py-3 text-sm crm-text dark:bg-white/[0.03]"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function SignatureVersionRowActions({
  row,
  canManage,
  pending,
  onEdit,
  onSetDefault,
}: {
  row: SignatureVersionRow;
  canManage: boolean;
  pending: boolean;
  onEdit: (versionId: string) => void;
  onSetDefault: (versionId: string) => void;
}) {
  const { t } = useTranslation();
  const actions = resolveSignatureVersionRowActions(row, canManage);

  if (!actions.showEdit && !actions.showSetDefault) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {actions.showEdit ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => onEdit(row.id)}
        >
          {t("mail.adminCenter.signature.edit")}
        </Button>
      ) : null}
      {actions.showSetDefault ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => onSetDefault(row.id)}
        >
          {t("mail.adminCenter.signature.setDefault")}
        </Button>
      ) : null}
    </div>
  );
}

function SignatureVersionMobileCard({
  row,
  canManage,
  pending,
  onEdit,
  onSetDefault,
}: {
  row: SignatureVersionRow;
  canManage: boolean;
  pending: boolean;
  onEdit: (versionId: string) => void;
  onSetDefault: (versionId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Card padding className="space-y-3 p-4 md:p-6">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium crm-text">{row.name}</p>
        <p className="text-sm crm-text-secondary">
          {t("mail.adminCenter.signature.ownerLabel")}: {row.ownerLabel}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SignatureDefaultBadge isActive={row.isActive} />
        <span className="text-xs crm-text-secondary">
          {formatHongKongDateTime(row.createdAt)}
        </span>
      </div>
      <SignatureVersionRowActions
        row={row}
        canManage={canManage}
        pending={pending}
        onEdit={onEdit}
        onSetDefault={onSetDefault}
      />
    </Card>
  );
}

export function SignatureManagement() {
  const { t } = useTranslation();
  const { capabilities } = useMailSession();
  const canManage = canManageSignatures(capabilities);

  const [senderIdentities, setSenderIdentities] = useState<SenderIdentityApiItem[]>(
    [],
  );
  const [selectedIdentityId, setSelectedIdentityId] = useState("");
  const [rows, setRows] = useState<SignatureVersionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingVersionId, setPendingVersionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editorMode, setEditorMode] = useState<SignatureEditorMode>("create");
  const [editorDraft, setEditorDraft] = useState<SignatureEditorDraft>(
    emptySignatureEditorDraft(),
  );
  const [showPreview, setShowPreview] = useState(true);

  const manageableIdentities = useMemo(
    () => filterManageableSignatureSenderIdentities(senderIdentities),
    [senderIdentities],
  );

  const selectedIdentity = useMemo(
    () => manageableIdentities.find((item) => item.id === selectedIdentityId) ?? null,
    [manageableIdentities, selectedIdentityId],
  );

  const previewHtml = useMemo(
    () => buildSignaturePreviewHtml(editorDraft),
    [editorDraft],
  );

  const loadIdentities = useCallback(async () => {
    if (!canManage) {
      setSenderIdentities([]);
      setSelectedIdentityId("");
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await fetchSenderIdentities();
      if (!result.ok) {
        setSenderIdentities([]);
        setError(result.error);
        return;
      }
      const filtered = filterManageableSignatureSenderIdentities(result.items);
      setSenderIdentities(filtered);
      setSelectedIdentityId((current) => {
        if (current && filtered.some((item) => item.id === current)) {
          return current;
        }
        return filtered[0]?.id ?? "";
      });
    } catch {
      setSenderIdentities([]);
      setError(t("common.networkError"));
    } finally {
      setLoading(false);
    }
  }, [canManage, t]);

  const loadVersions = useCallback(async () => {
    if (!canManage || !selectedIdentityId) {
      setRows([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [versionsResult, usersResult] = await Promise.all([
        fetchSignatureVersions(selectedIdentityId),
        fetchAdminUsersForMailAccess(),
      ]);

      if (!versionsResult.ok) {
        setRows([]);
        setError(versionsResult.error);
        return;
      }

      const users = usersResult.ok ? usersResult.items : [];
      setRows(buildSignatureVersionRows(versionsResult.items, users));
    } catch {
      setRows([]);
      setError(t("common.networkError"));
    } finally {
      setLoading(false);
    }
  }, [canManage, selectedIdentityId, t]);

  useEffect(() => {
    void loadIdentities();
  }, [loadIdentities]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  function handleNewSignature() {
    setEditorMode("create");
    setEditorDraft(emptySignatureEditorDraft());
    setActionMessage(null);
  }

  function handleEditVersion(versionId: string) {
    const version = rows.find((row) => row.id === versionId);
    if (!version) return;
    setEditorMode("edit");
    setEditorDraft(draftFromSignatureVersion(version));
    setActionMessage(null);
  }

  async function handleSaveSignature(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage || !selectedIdentityId || !isSignatureEditorDraftValid(editorDraft)) {
      return;
    }

    setBusy(true);
    setActionMessage(null);
    try {
      const result = await createSignatureVersion(selectedIdentityId, {
        bodyText: editorDraft.bodyText.trim() || undefined,
        bodyHtml: editorDraft.bodyHtml.trim() || undefined,
      });
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      setEditorMode("create");
      setEditorDraft(emptySignatureEditorDraft());
      setActionMessage(
        editorMode === "edit"
          ? t("mail.adminCenter.signature.updateSuccess")
          : t("mail.adminCenter.signature.createSuccess"),
      );
      await loadVersions();
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setBusy(false);
    }
  }

  async function handleSetDefault(versionId: string) {
    if (!canManage) return;
    setPendingVersionId(versionId);
    setActionMessage(null);
    try {
      const result = await activateSignatureVersion(versionId);
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      setActionMessage(t("mail.adminCenter.signature.setDefaultSuccess"));
      await loadVersions();
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setPendingVersionId(null);
    }
  }

  if (!canManage) {
    return (
      <div className={MAIL_ADMIN_SECTION_CLASS}>
        <PageIntro
          title={t("mail.adminCenter.sections.signature")}
          description={t("mail.adminCenter.descriptions.signature")}
        />
        <MailAdminEmptyState message={t("mail.adminCenter.signature.noPermission")} />
      </div>
    );
  }

  return (
    <div className={MAIL_ADMIN_SECTION_CLASS}>
      <PageIntro
        title={t("mail.adminCenter.sections.signature")}
        description={t("mail.adminCenter.descriptions.signature")}
      />

      <p className="text-sm crm-text-secondary">
        {t("mail.adminCenter.signature.systemSenderHint")}
      </p>

      {actionMessage ? (
        <p className="text-sm crm-text" role="status">
          {actionMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[min(100%,16rem)] flex-1">
          <Label htmlFor="signature-sender-identity">
            {t("mail.adminCenter.signature.senderIdentityLabel")}
          </Label>
          <select
            id="signature-sender-identity"
            className="mt-1 w-full rounded-md border crm-border bg-transparent px-3 py-2 text-sm crm-text"
            value={selectedIdentityId}
            onChange={(event) => {
              setSelectedIdentityId(event.target.value);
              handleNewSignature();
            }}
            disabled={loading || manageableIdentities.length === 0}
          >
            {manageableIdentities.map((identity) => (
              <option key={identity.id} value={identity.id}>
                {identity.displayName
                  ? `${identity.displayName} (${identity.address})`
                  : identity.address}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={loading}
          onClick={() => void loadVersions()}
        >
          {t("mail.adminCenter.signature.refresh")}
        </Button>
      </div>

      {loading ? (
        <MailAdminLoadingState />
      ) : error ? (
        <MailAdminErrorState message={error} onRetry={() => void loadVersions()} />
      ) : manageableIdentities.length === 0 ? (
        <MailAdminEmptyState message={t("mail.adminCenter.signature.noSenderIdentities")} />
      ) : (
        <div className={MAIL_ADMIN_CARD_STACK_CLASS}>
          <Card padding className="p-4 md:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold crm-text">
                  {t("mail.adminCenter.signature.listTitle")}
                </h3>
                {selectedIdentity ? (
                  <p className="mt-1 text-sm crm-text-secondary">
                    {selectedIdentity.address}
                  </p>
                ) : null}
              </div>
              <Button type="button" size="sm" onClick={handleNewSignature}>
                {t("mail.adminCenter.signature.createAction")}
              </Button>
            </div>

            {rows.length === 0 ? (
              <MailAdminEmptyState message={t("mail.adminCenter.signature.empty")} />
            ) : (
              <>
                <div className="hidden md:block">
                  <TableShell>
                    <DataTable>
                      <TableHead>
                        <Tr>
                          <Th>{t("mail.adminCenter.signature.columns.name")}</Th>
                          <Th>{t("mail.adminCenter.signature.columns.owner")}</Th>
                          <Th>{t("mail.adminCenter.signature.columns.default")}</Th>
                          <Th>{t("mail.adminCenter.signature.columns.updated")}</Th>
                          <Th>{t("mail.adminCenter.signature.columns.actions")}</Th>
                        </Tr>
                      </TableHead>
                      <TableBody>
                        {rows.map((row) => (
                          <Tr key={row.id}>
                            <Td>{row.name}</Td>
                            <Td>{row.ownerLabel}</Td>
                            <Td>
                              <SignatureDefaultBadge isActive={row.isActive} />
                            </Td>
                            <Td>{formatHongKongDateTime(row.createdAt)}</Td>
                            <Td>
                              <SignatureVersionRowActions
                                row={row}
                                canManage={canManage}
                                pending={pendingVersionId === row.id}
                                onEdit={handleEditVersion}
                                onSetDefault={(versionId) => void handleSetDefault(versionId)}
                              />
                            </Td>
                          </Tr>
                        ))}
                      </TableBody>
                    </DataTable>
                  </TableShell>
                </div>

                <div className="space-y-3 md:hidden">
                  {rows.map((row) => (
                    <SignatureVersionMobileCard
                      key={row.id}
                      row={row}
                      canManage={canManage}
                      pending={pendingVersionId === row.id}
                      onEdit={handleEditVersion}
                      onSetDefault={(versionId) => void handleSetDefault(versionId)}
                    />
                  ))}
                </div>
              </>
            )}
          </Card>

          <Card padding className="p-4 md:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold crm-text">
                  {editorMode === "edit"
                    ? t("mail.adminCenter.signature.editorEditTitle")
                    : t("mail.adminCenter.signature.editorCreateTitle")}
                </h3>
                <p className="mt-1 text-sm crm-text-secondary">
                  {t("mail.adminCenter.signature.editorHint")}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setShowPreview((current) => !current)}
              >
                {showPreview
                  ? t("mail.adminCenter.signature.hidePreview")
                  : t("mail.adminCenter.signature.showPreview")}
              </Button>
            </div>

            <form onSubmit={(event) => void handleSaveSignature(event)}>
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="signature-body-text">
                      {t("mail.adminCenter.signature.plainTextLabel")}
                    </Label>
                    <Textarea
                      id="signature-body-text"
                      className="mt-1 min-h-[8rem] font-mono text-sm"
                      value={editorDraft.bodyText}
                      onChange={(event) =>
                        setEditorDraft((current) => ({
                          ...current,
                          bodyText: event.target.value,
                        }))
                      }
                      placeholder={t("mail.adminCenter.signature.plainTextPlaceholder")}
                    />
                  </div>
                  <div>
                    <Label htmlFor="signature-body-html">
                      {t("mail.adminCenter.signature.htmlLabel")}
                    </Label>
                    <Textarea
                      id="signature-body-html"
                      className="mt-1 min-h-[10rem] font-mono text-sm"
                      value={editorDraft.bodyHtml}
                      onChange={(event) =>
                        setEditorDraft((current) => ({
                          ...current,
                          bodyHtml: event.target.value,
                        }))
                      }
                      placeholder={t("mail.adminCenter.signature.htmlPlaceholder")}
                    />
                    <p className="mt-1 text-xs crm-text-secondary">
                      {t("mail.adminCenter.signature.htmlHint")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="submit"
                      disabled={busy || !isSignatureEditorDraftValid(editorDraft)}
                    >
                      {editorMode === "edit"
                        ? t("mail.adminCenter.signature.saveAsNewVersion")
                        : t("mail.adminCenter.signature.createAction")}
                    </Button>
                    {editorMode === "edit" ? (
                      <Button type="button" variant="secondary" onClick={handleNewSignature}>
                        {t("mail.adminCenter.signature.cancelEdit")}
                      </Button>
                    ) : null}
                  </div>
                </div>

                {showPreview ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium crm-text">
                      {t("mail.adminCenter.signature.previewTitle")}
                    </p>
                    <SignaturePreviewPane html={previewHtml} />
                    <p className="text-xs crm-text-secondary">
                      {t("mail.adminCenter.signature.previewDisclaimer")}
                    </p>
                  </div>
                ) : null}
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
