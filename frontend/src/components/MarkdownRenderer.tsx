import React from "react";
import { CheckOutlined, CopyOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { t } from "@/i18n";

function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = React.useState(false);

  return (
    <Tooltip title={copied ? t("chat.copied") : t("chat.copy")}>
      <Button
        type="text"
        size="small"
        icon={copied ? <CheckOutlined /> : <CopyOutlined />}
        onClick={() => {
          void navigator.clipboard.writeText(content).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      />
    </Tooltip>
  );
}

function collectText(element: unknown): string {
  if (typeof element === "string" || typeof element === "number") {
    return String(element);
  }
  if (!React.isValidElement<{ children?: React.ReactNode }>(element)) return "";
  return React.Children.toArray(element.props.children).map(collectText).join("");
}

const withClass = (tag: keyof React.JSX.IntrinsicElements, className: string) => {
  const Component = ({ node: _node, ...props }: { node?: unknown }) =>
    React.createElement(tag, { className, ...props });
  Component.displayName = tag;
  return Component;
};

const COMPONENTS: Partial<Components> = {
  h1: withClass("h1", "text-2xl font-semibold") as Components["h1"],
  h2: withClass("h2", "text-xl font-semibold") as Components["h2"],
  h3: withClass("h3", "text-lg font-semibold") as Components["h3"],
  h4: withClass("h4", "text-base font-semibold") as Components["h4"],
  strong: withClass("strong", "font-semibold") as Components["strong"],
  a: withClass("a", "text-primary underline underline-offset-2") as Components["a"],
  blockquote: withClass("blockquote", "border-l-2 border-primary pl-3") as Components["blockquote"],
  code: ({ children, className, node: _node, ...props }) => {
    const isBlock = /language-(\w+)/.test(className ?? "");
    const code = collectText(children);
    return isBlock ? (
      <div className="group/code relative">
        <pre className="overflow-x-auto rounded border bg-background/50 p-3 font-mono text-xs">
          <code className={className} {...props}>{code}</code>
        </pre>
        <div className="absolute right-1 top-1 opacity-0 transition-opacity group-hover/code:opacity-100">
          <CopyButton content={code} />
        </div>
      </div>
    ) : (
      <code className="rounded bg-background/50 px-1 py-0.5 font-mono" {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => <>{children}</>,
  ol: withClass("ol", "list-decimal space-y-1 pl-5") as Components["ol"],
  ul: withClass("ul", "list-disc space-y-1 pl-5") as Components["ul"],
  table: withClass("table", "w-full border-collapse") as Components["table"],
  th: withClass("th", "border px-2 py-1 text-left font-semibold") as Components["th"],
  td: withClass("td", "border px-2 py-1 text-left") as Components["td"],
  p: ({ node: _node, ...props }) => (
    <p className="whitespace-pre-wrap" style={{ margin: 0 }} {...props} />
  ),
};

export function MarkdownRenderer({ children }: { children: string }) {
  return (
    <div className="favai-markdown flex flex-col gap-3 break-words">
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </Markdown>
    </div>
  );
}
