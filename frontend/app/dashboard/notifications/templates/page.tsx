'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FileText, TriangleAlert } from 'lucide-react';
import { api, type EmailTemplatePreview } from '@/lib/api';
import { QueryStateCard } from '../../query-state-card';

// A minimal reset matching how an unstyled HTML email typically renders in
// an inbox (plain sans-serif, black-on-white, default link blue) — NOT this
// dashboard's own theme. EmailProcessor sends a template's body HTML to
// Resend completely as-is (`html: job.data.body`, see
// src/notifications/processors/email.processor.ts), with no dashboard CSS
// anywhere near it, so previewing it inside the dashboard's own styled DOM
// would show something recipients never actually see.
function buildEmailPreviewDocument(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; padding: 0; overflow: hidden; }
      body {
        font-family: -apple-system, Helvetica, Arial, sans-serif;
        font-size: 14px;
        line-height: 1.5;
        color: #1a1a1a;
        background: #ffffff;
        padding: 16px;
      }
      a { color: #1a73e8; }
      p { margin: 0 0 12px; }
      p:last-child { margin-bottom: 0; }
    </style>
  </head>
  <body>${bodyHtml}</body>
</html>`;
}

/**
 * Renders a template's rendered HTML body inside a sandboxed iframe so it's
 * fully isolated from the dashboard's own CSS (Tailwind classes, dark mode,
 * accent colors) — an inline div would inherit all of that and misrepresent
 * what the email actually looks like on delivery. Auto-grows to the
 * content's real height so it reads like part of the page, not a
 * scrollable embed.
 * `sandbox="allow-same-origin"` still blocks scripts/forms/popups/top-nav —
 * it's needed only so the onLoad handler below can read contentDocument to
 * measure height; `sandbox=""` (no origin access at all) would silently
 * leave the iframe stuck at its initial height, since a cross-origin
 * contentDocument read returns null instead of throwing.
 */
function EmailPreviewFrame({ html }: { html: string }) {
  const [height, setHeight] = useState(60);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  return (
    <iframe
      ref={iframeRef}
      title="Email preview"
      srcDoc={buildEmailPreviewDocument(html)}
      sandbox="allow-same-origin"
      onLoad={() => {
        const doc = iframeRef.current?.contentDocument;
        if (doc) setHeight(doc.documentElement.scrollHeight);
      }}
      style={{ height }}
      className="block w-full border-0 bg-white"
    />
  );
}

function VariableBadges({
  label,
  variables,
  className,
}: {
  label: string;
  variables: string[];
  className: string;
}) {
  if (variables.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-semibold tracking-wide text-fg-3">
        {label}
      </span>
      {variables.map((name) => (
        <span
          key={name}
          className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-medium ${className}`}
        >
          {name}
        </span>
      ))}
    </div>
  );
}

function TemplateCard({ template }: { template: EmailTemplatePreview }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <FileText className="h-5 w-5" />
        </span>
        <span className="rounded-full bg-surface-2 px-2.5 py-0.5 font-mono text-xs font-semibold text-fg-2">
          {template.key}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <VariableBadges
          label="REQUIRES"
          variables={template.requiredVariables}
          className="bg-surface-2 text-fg-2"
        />
        <VariableBadges
          label="URL"
          variables={template.urlVariables}
          className="bg-accent-soft text-accent"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="border-b border-border bg-surface-2 px-3 py-2">
          <span className="text-[11px] font-semibold tracking-wide text-fg-3">
            SUBJECT
          </span>
          <p className="mt-0.5 text-sm font-medium text-fg">
            {template.subject}
          </p>
        </div>
        {/* Template bodies are code-defined HTML
            (src/notifications/templates/templates.ts), not user input, so
            rendering them is safe — the sandbox is for visual isolation
            (see EmailPreviewFrame), not an XSS concern. */}
        <EmailPreviewFrame html={template.body} />
      </div>
    </div>
  );
}

function TemplateCardSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <div className="h-10 w-10 animate-pulse rounded-lg bg-surface-2" />
      <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" />
      <div className="h-20 animate-pulse rounded-lg bg-surface-2" />
    </div>
  );
}

export default function EmailTemplatesPage() {
  const templatesQuery = useQuery({
    queryKey: ['email-templates'],
    queryFn: api.listEmailTemplates,
  });

  const templates = templatesQuery.data ?? [];
  const isLoading = templatesQuery.isLoading;
  const isError = templatesQuery.isError;
  const isEmpty = !isLoading && !isError && templates.length === 0;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          href="/dashboard/notifications"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-3 hover:text-fg"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Notifications
        </Link>
        <h1 className="mt-2 font-display text-[22px] font-semibold tracking-tight text-fg">
          Email templates
        </h1>
        <p className="mt-1 text-sm text-fg-2">
          Predefined templates available to the notifications service,
          rendered here with example values.
        </p>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TemplateCardSkeleton />
          <TemplateCardSkeleton />
        </div>
      )}

      {isError && (
        <QueryStateCard
          icon={TriangleAlert}
          iconClassName="bg-danger-soft text-danger"
          title="Couldn't load email templates"
          description="The notifications service didn't respond. Nothing was changed."
          onRetry={() => void templatesQuery.refetch()}
        />
      )}

      {isEmpty && (
        <QueryStateCard
          icon={FileText}
          title="No templates available"
          description="No predefined email templates are registered yet."
        />
      )}

      {!isLoading && !isError && !isEmpty && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {templates.map((template) => (
            <TemplateCard key={template.key} template={template} />
          ))}
        </div>
      )}
    </div>
  );
}
