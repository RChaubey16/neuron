'use client';

import { useState } from 'react';
import { KeyRound, Trash2 } from 'lucide-react';
import type { WebhookEndpoint } from '@/lib/api';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export type EndpointAction = 'delete' | 'rotate';

const COPY: Record<
  EndpointAction,
  { title: string; body: string; confirm: string; pending: string }
> = {
  delete: {
    title: 'Delete webhook endpoint?',
    body: 'It stops receiving events immediately, and deliveries still waiting to retry will fail. Its delivery history is kept. This can’t be undone.',
    confirm: 'Delete endpoint',
    pending: 'Deleting…',
  },
  rotate: {
    title: 'Rotate signing secret?',
    body: 'The current secret stops working immediately — deliveries will fail verification until your receiver is updated with the new one.',
    confirm: 'Rotate secret',
    pending: 'Rotating…',
  },
};

/** Confirmation for the two endpoint actions that can break a live receiver. */
export function EndpointActionDialog({
  target,
  pending,
  onConfirm,
  onOpenChange,
}: {
  target: { endpoint: WebhookEndpoint; action: EndpointAction } | null;
  pending: boolean;
  onConfirm: (endpointId: string, action: EndpointAction) => void;
  onOpenChange: (open: boolean) => void;
}) {
  // Keep showing the last target while the close animation plays, instead
  // of its text blanking out the moment `target` resets to null.
  const [shown, setShown] = useState(target);
  if (target && target !== shown) setShown(target);
  const copy = COPY[shown?.action ?? 'delete'];
  const Icon = shown?.action === 'rotate' ? KeyRound : Trash2;

  return (
    <AlertDialog open={target !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="break-all font-medium text-fg">
              {shown?.endpoint.url}
            </span>{' '}
            — {copy.body}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(e) => {
              // Radix closes the dialog on Action click by default; keep it
              // open while the request is in flight so the user sees progress.
              e.preventDefault();
              if (target) onConfirm(target.endpoint.id, target.action);
            }}
          >
            <Icon />
            {pending ? copy.pending : copy.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
