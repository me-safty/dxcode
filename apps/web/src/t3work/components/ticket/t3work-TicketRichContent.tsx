import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink, FileText, Image as ImageIcon, MessageSquare } from "lucide-react";
import { Card, CardContent } from "~/t3work/components/ui/t3work-card";
import { Badge } from "~/t3work/components/ui/t3work-badge";

type JiraAttachment = {
  id?: string | undefined;
  filename?: string | undefined;
  mimeType?: string | undefined;
  content?: string | undefined;
  thumbnail?: string | undefined;
  size?: number | undefined;
};

type JiraCommentItem = {
  id?: string | undefined;
  author?: string | undefined;
  created?: string | undefined;
  updated?: string | undefined;
  bodyMarkdown?: string | undefined;
  bodyHtml?: string | undefined;
};

function formatTimestamp(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function resolveUrlAgainstBase(url: string, baseUrl?: string): string {
  const trimmed = url.trim();
  if (!trimmed || !baseUrl) return trimmed;

  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return trimmed;
  }
}

function sanitizeJiraHtml(unsafeHtml: string, baseUrl?: string): string {
  if (typeof window === "undefined") return unsafeHtml;

  const parser = new DOMParser();
  const doc = parser.parseFromString(unsafeHtml, "text/html");

  doc.querySelectorAll("script,style,iframe,object,embed,link,meta").forEach((node) => {
    node.remove();
  });

  doc.querySelectorAll("*").forEach((element) => {
    for (const attr of element.attributes) {
      const name = attr.name.toLowerCase();
      const value = attr.value;

      if (name.startsWith("on")) {
        element.removeAttribute(attr.name);
        continue;
      }

      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(value)) {
        element.removeAttribute(attr.name);
        continue;
      }

      if (name === "href" || name === "src") {
        const resolved = resolveUrlAgainstBase(value, baseUrl);
        if (resolved.length > 0) {
          element.setAttribute(attr.name, resolved);
        }
      }
    }
  });

  return doc.body.innerHTML;
}

function MarkdownBlock({ content }: { content: string }) {
  return (
    <div className="chat-markdown text-sm leading-6">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function HtmlBlock({ content, baseUrl }: { content: string; baseUrl?: string }) {
  const sanitized = useMemo(() => sanitizeJiraHtml(content, baseUrl), [baseUrl, content]);
  return (
    <div
      className="chat-markdown text-sm leading-6"
      // Jira rendered HTML is sanitized before rendering.
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

function TicketAttachments({ attachments }: { attachments: JiraAttachment[] }) {
  if (attachments.length === 0) return null;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">Attachments</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {attachments.map((attachment, index) => {
            const name = attachment.filename?.trim() || `Attachment ${index + 1}`;
            const mime = attachment.mimeType ?? "file";
            const href = attachment.content ?? attachment.thumbnail ?? "";
            const isImage = mime.startsWith("image/");
            const sizeText = formatFileSize(attachment.size);

            return (
              <a
                key={`${attachment.id ?? name}-${index}`}
                href={href || undefined}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-border bg-background p-3 transition-colors hover:bg-accent/40"
              >
                <div className="mb-2 flex items-center gap-2">
                  {isImage ? (
                    <ImageIcon className="size-4 text-muted-foreground" />
                  ) : (
                    <FileText className="size-4 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                  {href && <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />}
                </div>
                {isImage && href && (
                  <img
                    src={attachment.thumbnail ?? href}
                    alt={name}
                    className="mb-2 max-h-44 w-full rounded-md border border-border object-cover"
                    loading="lazy"
                  />
                )}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{mime}</span>
                  {sizeText && (
                    <>
                      <span>•</span>
                      <span>{sizeText}</span>
                    </>
                  )}
                </div>
              </a>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function TicketComments({
  comments,
  htmlBaseUrl,
}: {
  comments: JiraCommentItem[];
  htmlBaseUrl?: string;
}) {
  if (comments.length === 0) return null;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <h3 className="text-sm font-semibold">Comments</h3>
        <div className="space-y-4">
          {comments.map((comment, index) => {
            const commentBody = comment.bodyMarkdown?.trim() ?? "";
            const commentHtml = comment.bodyHtml?.trim() ?? "";
            const timestamp = formatTimestamp(comment.updated || comment.created);

            return (
              <article
                key={`${comment.id ?? "comment"}-${index}`}
                className="rounded-lg border border-border bg-background/70 p-3"
              >
                <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <MessageSquare className="size-3.5" />
                  <span className="font-medium text-foreground">{comment.author ?? "Unknown"}</span>
                  {timestamp && (
                    <>
                      <span>•</span>
                      <time>{timestamp}</time>
                    </>
                  )}
                </div>
                {commentHtml ? (
                  <HtmlBlock
                    content={commentHtml}
                    {...(htmlBaseUrl ? { baseUrl: htmlBaseUrl } : {})}
                  />
                ) : commentBody ? (
                  <MarkdownBlock content={commentBody} />
                ) : (
                  <p className="text-sm text-muted-foreground">No comment body.</p>
                )}
              </article>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export function TicketRichContent({
  descriptionMarkdown,
  descriptionHtml,
  htmlBaseUrl,
  attachments,
  comments,
}: {
  descriptionMarkdown?: string;
  descriptionHtml?: string;
  htmlBaseUrl?: string;
  attachments: JiraAttachment[];
  comments: JiraCommentItem[];
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Description</h3>
            <Badge variant="outline" className="text-[10px]">
              Jira content
            </Badge>
          </div>
          {descriptionHtml ? (
            <HtmlBlock
              content={descriptionHtml}
              {...(htmlBaseUrl ? { baseUrl: htmlBaseUrl } : {})}
            />
          ) : descriptionMarkdown && descriptionMarkdown.trim().length > 0 ? (
            <MarkdownBlock content={descriptionMarkdown} />
          ) : (
            <p className="text-sm text-muted-foreground">No description available.</p>
          )}
        </CardContent>
      </Card>

      <TicketAttachments attachments={attachments} />
      <TicketComments comments={comments} {...(htmlBaseUrl ? { htmlBaseUrl } : {})} />
    </div>
  );
}
