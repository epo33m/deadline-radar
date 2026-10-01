"use client";

import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";

import { Plus, X } from "lucide-react";

import {
  addAttachment,
  getAttachmentSignedUrl,
  removeAttachment,
  type AttachmentActionState,
} from "@/app/actions/attachments";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  dialogActionsClassName,
  dialogPrimaryActionClassName,
  dialogSecondaryActionClassName,
} from "@/components/ui/dialog";
import {
  dialogFormListClassName,
  dialogInputClassName,
  formSectionGapClassName,
} from "@/components/ui/dialog-form";
import { Input } from "@/components/ui/input";
import { LoadingDialog } from "@/components/ui/loading-dialog";
import { cn } from "@/lib/utils";
import { generateIdempotencyKey } from "@/lib/api/idempotency";
import { isSafeExternalHttpUrl } from "@deadline-radar/validation";
import type { Attachment } from "@/types/task";

const initialState: AttachmentActionState = {};

type AddFormProps = {
  taskId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
};

function AddAttachmentForm({ taskId, onSuccess, onCancel }: AddFormProps) {
  const formId = useId();
  const [idempotencyKey] = useState(() => generateIdempotencyKey());
  const [state, formAction, pending] = useActionState(
    addAttachment,
    initialState,
  );
  const [notes, setNotes] = useState("");
  const [url, setUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dataTransferRef = useRef<DataTransfer | null>(null);
  const wasPending = useRef(false);

  function syncPickedFiles(transfer: DataTransfer) {
    dataTransferRef.current = transfer;
    if (fileInputRef.current) fileInputRef.current.files = transfer.files;
    setFiles(Array.from(transfer.files));
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    const transfer = dataTransferRef.current ?? new DataTransfer();
    for (const file of picked) {
      const exists = Array.from(transfer.files).some(
        (current) =>
          current.name === file.name &&
          current.size === file.size &&
          current.lastModified === file.lastModified,
      );
      if (!exists) transfer.items.add(file);
    }
    syncPickedFiles(transfer);
  }

  function removePickedFile(index: number) {
    const transfer = new DataTransfer();
    Array.from(dataTransferRef.current?.files ?? []).forEach((file, current) => {
      if (current !== index) transfer.items.add(file);
    });
    syncPickedFiles(transfer);
  }

  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      onSuccess?.();
    }
    wasPending.current = pending;
  }, [pending, state.error, onSuccess]);

  const notesId = `${formId}-notes`;
  const urlId = `${formId}-url`;
  const fileId = `${formId}-file`;

  return (
    <>
      <LoadingDialog
        open={pending}
        title={files.length > 0 ? "Uploading files…" : "Saving attachment…"}
        description="Please wait a moment"
      />
      <form
        action={formAction}
        className="flex w-full flex-col"
        aria-busy={pending}
      >
        <input type="hidden" name="task_id" value={taskId} />
        <input type="hidden" name="idempotency_key" value={idempotencyKey} />
        <div className={cn("w-full", formSectionGapClassName)}>
          <div className="space-y-2">
            <ul className={dialogFormListClassName}>
              {files.length > 0 ? (
                <li className="py-1">
                  <ul className="flex list-none flex-col gap-2">
                    {files.map((file, index) => (
                      <li key={`${file.name}-${file.size}-${file.lastModified}`}>
                        <div className="flex items-center gap-2">
                          <p className="min-w-0 flex-1 truncate text-left font-sans text-[15px] font-normal leading-normal tracking-[-0.2px] text-ink">
                            {file.name}
                          </p>
                          <button
                            type="button"
                            onClick={() => removePickedFile(index)}
                            disabled={pending}
                            aria-label={`Remove ${file.name}`}
                            className="shrink-0 text-destructive disabled:opacity-50"
                          >
                            <X className="size-4" aria-hidden="true" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </li>
              ) : null}
              <li className="pt-1 pb-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={pending}
                  className="h-11 w-full justify-start border-0 bg-transparent px-0 shadow-none"
                >
                  Add file...
                </Button>
              </li>
            </ul>
            <input
              ref={fileInputRef}
              id={fileId}
              name="file"
              type="file"
              multiple
              aria-invalid={Boolean(state.fieldErrors?.file)}
              aria-describedby={
                state.fieldErrors?.file ? `${fileId}-error` : undefined
              }
              className="sr-only"
              onChange={handleFileChange}
            />
            {state.fieldErrors?.file ? (
              <p
                id={`${fileId}-error`}
                className="text-sm text-destructive"
                role="alert"
              >
                {state.fieldErrors.file.join(" ")}
              </p>
            ) : null}
          </div>
          <ul className={dialogFormListClassName}>
            <li className="py-1.5">
              <div className="space-y-2">
                <Input
                  id={urlId}
                  name="url"
                  type="url"
                  inputMode="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="URL"
                  aria-invalid={Boolean(state.fieldErrors?.url)}
                  aria-describedby={
                    state.fieldErrors?.url ? `${urlId}-error` : undefined
                  }
                  className={cn(dialogInputClassName, "text-left")}
                />
                {state.fieldErrors?.url ? (
                  <p
                    id={`${urlId}-error`}
                    className="text-sm text-destructive"
                    role="alert"
                  >
                    {state.fieldErrors.url.join(" ")}
                  </p>
                ) : null}
              </div>
            </li>
            <li className="py-1.5">
              <div className="space-y-2">
                <textarea
                  id={notesId}
                  name="notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Notes"
                  rows={3}
                  aria-invalid={Boolean(state.fieldErrors?.notes)}
                  aria-describedby={
                    state.fieldErrors?.notes ? `${notesId}-error` : undefined
                  }
                  className="w-full rounded-none border-0 bg-transparent px-0 py-1 font-sans text-[15px] font-normal leading-normal tracking-[-0.2px] text-ink shadow-none outline-none placeholder:text-ink-muted-48 focus-visible:border-0 focus-visible:ring-0 focus-visible:outline-none aria-invalid:text-destructive"
                />
                {state.fieldErrors?.notes ? (
                  <p
                    id={`${notesId}-error`}
                    className="text-sm text-destructive"
                    role="alert"
                  >
                    {state.fieldErrors.notes.join(" ")}
                  </p>
                ) : null}
              </div>
            </li>
          </ul>
        </div>

        {state.error ? (
          <p className="pt-4 text-center text-sm text-destructive" role="alert">
            {state.error}
          </p>
        ) : null}

        <div className={dialogActionsClassName}>
          <Button
            type="submit"
            disabled={pending}
            className={dialogPrimaryActionClassName}
          >
            {pending ? "Saving…" : "Save"}
          </Button>
          {onCancel ? (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={pending}
              className={dialogSecondaryActionClassName}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    </>
  );
}

function AddAttachmentDialog({
  taskId,
  open,
  onOpenChange,
}: {
  taskId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [formKey, setFormKey] = useState(0);
  const close = () => onOpenChange(false);
  const handleSuccess = () => {
    setFormKey((current) => current + 1);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New">
      <div className="flex w-full flex-col">
        <AddAttachmentForm
          key={`attachment-${formKey}`}
          taskId={taskId}
          onSuccess={handleSuccess}
          onCancel={close}
        />
      </div>
    </Dialog>
  );
}

function FileOpenButton({
  storagePath,
  label,
}: {
  storagePath: string;
  label: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <LoadingDialog
        open={pending}
        title="Opening file…"
        description="Please wait a moment"
      />
      <span className="inline-flex flex-col gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await getAttachmentSignedUrl(storagePath);
              if (result.error || !result.url) {
                setError(result.error ?? "Could not open file.");
                return;
              }
              window.open(result.url, "_blank", "noopener,noreferrer");
            });
          }}
        >
          {pending ? "Opening…" : label}
        </Button>
        {error ? (
          <span className="text-sm text-destructive" role="alert">
            {error}
          </span>
        ) : null}
      </span>
    </>
  );
}

function attachmentTitle(attachment: Attachment): string {
  if (attachment.notes?.trim()) return attachment.notes;
  if (attachment.type === "link" && attachment.url) return attachment.url;
  if (attachment.storage_path) {
    const segment = attachment.storage_path.split("/").filter(Boolean).at(-1);
    if (segment) return segment;
  }
  return attachment.type === "link" ? "Link" : "File";
}

function AttachmentRow({
  taskId,
  attachment,
}: {
  taskId: string;
  attachment: Attachment;
}) {
  const [removeState, removeAction, removePending] = useActionState(
    removeAttachment,
    initialState,
  );

  return (
    <>
      <LoadingDialog
        open={removePending}
        title="Removing attachment…"
        description="Please wait a moment"
      />
      <li className="border-b border-hairline py-3 last:border-b-0">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{attachmentTitle(attachment)}</p>
            <p className="text-sm text-ink-muted-48">
              {attachment.type === "link" ? "Link" : "File"}
              {attachment.type === "link" && attachment.url
                ? ` · ${attachment.url}`
                : null}
            </p>
          </div>
          {attachment.type === "link" &&
          attachment.url &&
          // SEC-006: scheme allow-list at the renderer. Unsafe values stay
          // visible as plain text above, but never become a clickable href.
          isSafeExternalHttpUrl(attachment.url) ? (
            <a
              href={attachment.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
            >
              Open
            </a>
          ) : null}
          {attachment.type === "file" && attachment.storage_path ? (
            <FileOpenButton
              storagePath={attachment.storage_path}
              label="Open"
            />
          ) : null}
          <form action={removeAction}>
            <input type="hidden" name="id" value={attachment.id} />
            <input type="hidden" name="task_id" value={taskId} />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={removePending}
              className="text-destructive"
            >
              {removePending ? "Removing…" : "Remove"}
            </Button>
          </form>
        </div>
        {removeState.error ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {removeState.error}
          </p>
        ) : null}
      </li>
    </>
  );
}

type AttachmentManagerProps = {
  taskId: string;
  attachments: Attachment[];
};

function AttachmentsEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center px-2 py-10 text-center sm:px-4 sm:py-14">
      <h3 className="font-display text-xl font-semibold text-ink sm:text-[22px]">
        No attachments yet
      </h3>
      <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-ink-muted-48">
        Add your first file or link to keep everything in one place.
      </p>
      <Button
        type="button"
        onClick={onAdd}
        className="mt-6 min-h-11 w-full max-w-xs rounded-full px-5 sm:w-auto"
      >
        New attachment
      </Button>
    </div>
  );
}

export function AttachmentManager({
  taskId,
  attachments,
}: AttachmentManagerProps) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">
          Attachments
        </h2>
        {attachments.length > 0 ? (
          <Button
            type="button"
            onClick={() => setAddOpen(true)}
            aria-label="Add attachment"
            size="icon"
            className="shrink-0 rounded-full"
          >
            <Plus className="size-5" strokeWidth={2} aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-[15px] leading-[1.47] tracking-[-0.374px] text-ink-muted-64 sm:text-[17px]">
        Add files and links to this task.
      </p>
      <div className="mt-6 space-y-4 sm:mt-8">
        {attachments.length === 0 ? (
          <AttachmentsEmptyState onAdd={() => setAddOpen(true)} />
        ) : (
          <ul className="border-t border-hairline">
            {attachments.map((attachment) => (
              <AttachmentRow
                key={attachment.id}
                taskId={taskId}
                attachment={attachment}
              />
            ))}
          </ul>
        )}
      </div>

      <AddAttachmentDialog
        taskId={taskId}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
    </div>
  );
}
