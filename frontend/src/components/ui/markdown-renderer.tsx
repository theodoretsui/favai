import React from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { Components } from "react-markdown"

import { cn } from "@/lib/utils"
import { CopyButton } from "@/components/ui/copy-button"

interface MarkdownRendererProps {
  children: string
}

export function MarkdownRenderer({ children }: MarkdownRendererProps) {
  return (
    <div className="space-y-3">
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </Markdown>
    </div>
  )
}

interface CodeBlockProps extends React.HTMLAttributes<HTMLPreElement> {
  children: React.ReactNode
  className?: string
  language: string
}

const CodeBlock = ({
  children,
  className,
  language,
  ...restProps
}: CodeBlockProps) => {
  const code =
    typeof children === "string"
      ? children
      : childrenTakeAllStringContents(children)

  const preClass = cn(
    "overflow-x-scroll rounded-md border bg-background/50 p-4 font-mono text-sm [scrollbar-width:none]",
    className,
  )

  return (
    <div className="group/code relative mb-4">
      <pre className={preClass} {...restProps}>
        <code>{code}</code>
      </pre>

      <div className="invisible absolute right-2 top-2 flex space-x-1 rounded-lg p-1 opacity-0 transition-all duration-200 group-hover/code:visible group-hover/code:opacity-100">
        <CopyButton content={code} copyMessage="Copied code to clipboard" />
      </div>
    </div>
  )
}

function childrenTakeAllStringContents(element: any): string {
  if (typeof element === "string") {
    return element
  }

  if (element?.props?.children) {
    let children = element.props.children

    if (Array.isArray(children)) {
      return children
        .map((child) => childrenTakeAllStringContents(child))
        .join("")
    } else {
      return childrenTakeAllStringContents(children)
    }
  }

  return ""
}

const withClass = (Tag: string, classes: string) => {
  const Component = ({ node, ...props }: any) =>
    React.createElement(Tag, { className: classes, ...props })
  Component.displayName = Tag
  return Component
}

const COMPONENTS: Partial<Components> = {
  h1: withClass("h1", "text-2xl font-semibold text-inherit") as any,
  h2: withClass("h2", "font-semibold text-xl text-inherit") as any,
  h3: withClass("h3", "font-semibold text-lg text-inherit") as any,
  h4: withClass("h4", "font-semibold text-base text-inherit") as any,
  h5: withClass("h5", "font-medium text-inherit") as any,
  strong: withClass("strong", "font-semibold") as any,
  a: withClass("a", "text-primary underline underline-offset-2") as any,
  blockquote: withClass("blockquote", "border-l-2 border-primary pl-4") as any,
  code: ({ children, className, node, ...rest }: any) => {
    const match = /language-(\w+)/.exec(className || "")
    return match ? (
      <CodeBlock className={className} language={match[1]} {...rest}>
        {children}
      </CodeBlock>
    ) : (
      <code
        className={cn(
          "font-mono [:not(pre)>&]:rounded-md [:not(pre)>&]:bg-background/50 [:not(pre)>&]:px-1 [:not(pre)>&]:py-0.5",
        )}
        {...rest}
      >
        {children}
      </code>
    )
  },
  pre: ({ children }: any) => children,
  ol: withClass("ol", "list-decimal space-y-2 pl-6") as any,
  ul: withClass("ul", "list-disc space-y-2 pl-6") as any,
  li: withClass("li", "my-1.5") as any,
  table: withClass(
    "table",
    "w-full border-collapse overflow-y-auto rounded-md border border-foreground/20",
  ) as any,
  th: withClass(
    "th",
    "border border-foreground/20 px-4 py-2 text-left font-bold [&[align=center]]:text-center [&[align=right]]:text-right",
  ) as any,
  td: withClass(
    "td",
    "border border-foreground/20 px-4 py-2 text-left [&[align=center]]:text-center [&[align=right]]:text-right",
  ) as any,
  tr: withClass("tr", "m-0 border-t p-0 even:bg-muted") as any,
  p: withClass("p", "whitespace-pre-wrap") as any,
  hr: withClass("hr", "border-foreground/20") as any,
}

export default MarkdownRenderer
