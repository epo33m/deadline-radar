"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";

import {
  addFileAttachment,
  addLinkAttachment,
  getAttachmentSignedUrl,
  removeAttachment,
  type AttachmentActionState,
} from "@/app/actions/attachments";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/types/task";

const initialState: AttachmentActionState = {};

function AddLinkForm({ taskId }: { taskId: string }) {
  const [state, formAction, pending] = useActionState(
    addLinkAttachment,
    initialState,
  );
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      setName("");
      setUrl("");
    }
    wasPending.current = pending;
  }, [pending, state.error]);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="task_id" value={taskId} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor={`link-name-${taskId}`}>Link name</Label>
          <Input
            id={`link-name-${taskId}`}
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Syllabus"
            required
            className="w-48"
            aria-invalid={Boolean(state.fieldErrors?.name)}
          />
        </div>
        <div className="min-w-64 flex-1 space-y-2">
          <Label htmlFor={`link-url-${taskId}`}>URL</Label>
          <Input
            id={`link-url-${taskId}`}
            name="url"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://…"
            required
            aria-invalid={Boolean(state.fieldErrors?.url)}
          />
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add link"}
        </Button>
      </div>
      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function AddFileForm({ taskId }: { taskId: string }) {
  const [state, formAction, pending] = useActionState(
    addFileAttachment,
    initialState,
  );
  const [name, setName] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      setName("");
      formRef.current?.reset();
    }
    wasPending.current = pending;
  }, [pending, state.error]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-3"
      encType="multipart/form-data"
    >
      <input type="hidden" name="task_id" value={taskId} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor={`file-name-${taskId}`}>Display name (optional)</Label>
          <Input
            id={`file-name-${taskId}`}
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Defaults to filename"
            className="w-48"
            aria-invalid={Boolean(state.fieldErrors?.name)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`file-upload-${taskId}`}>File</Label>
          <Input
            id={`file-upload-${taskId}`}
            name="file"
            type="file"
            required
            className="max-w-xs"
            aria-invalid={Boolean(state.fieldErrors?.file)}
          />
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Uploading…" : "Upload file"}
        </Button>
      </div>
      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
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
  );
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
    <li className="border-b border-hairline py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{attachment.name}</p>
          <p className="text-sm text-ink-muted-48">
            {attachment.type === "link" ? "Link" : "File"}
            {attachment.type === "link" && attachment.url
              ? ` · ${attachment.url}`
              : null}
          </p>
        </div>
        {attachment.type === "link" && attachment.url ? (
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
  );
}

type AttachmentManagerProps = {
  taskId: string;
  attachments: Attachment[];
};

export function AttachmentManager({
  taskId,
  attachments,
}: AttachmentManagerProps) {
  return (
    <div className="space-y-4">
      <h2 className="font-display text-xl font-semibold">Attachments</h2>
      <p className="text-sm text-ink-muted-48">
        Add files (private storage) or external links. Links need an absolute
        http(s) URL; files upload to{" "}
        <code className="text-xs">attachments/{"{user}"}/{"{task}"}/{"{file}"}</code>
        .
      </p>
      {attachments.length === 0 ? (
        <p className="text-sm text-ink-muted-48">No attachments yet.</p>
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
      <div className="space-y-6 border-t border-hairline pt-4">
        <AddLinkForm taskId={taskId} />
        <AddFileForm taskId={taskId} />
      </div>
    </div>
  );
}
