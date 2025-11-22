import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@/components/ui/hover-card";
import { Button } from "@/components/ui/button";

interface MarkdownProps {
  children: string;
  className?: string;
}

export interface ReadingListItem {
  name: string;
  link: string;
}

// Helper functions for reading list localStorage
export const getReadingList = (): ReadingListItem[] => {
  if (typeof window === "undefined") return [];
  const stored = localStorage.getItem("readingList");
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return [];
    }
  }
  return [];
};

export const saveToReadingList = (item: ReadingListItem) => {
  if (typeof window === "undefined") return;
  const list = getReadingList();
  // Check if already exists
  const exists = list.some((i) => i.link === item.link);
  if (!exists) {
    list.push(item);
    localStorage.setItem("readingList", JSON.stringify(list));
    // Dispatch custom event to notify other components
    window.dispatchEvent(new CustomEvent("readingListUpdated"));
  }
};

export const removeFromReadingList = (link: string) => {
  if (typeof window === "undefined") return;
  const list = getReadingList();
  const filtered = list.filter((i) => i.link !== link);
  localStorage.setItem("readingList", JSON.stringify(filtered));
  // Dispatch custom event to notify other components
  window.dispatchEvent(new CustomEvent("readingListUpdated"));
};

export function Markdown({ children, className = "" }: MarkdownProps) {
  const components: Components = {
    // Headings
    h1: ({ children }) => (
      <h1 className="text-2xl font-bold mt-6 mb-4 pb-2 border-b">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-xl font-bold mt-5 mb-3 pb-1 border-b">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-lg font-semibold mt-4 mb-2">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="text-base font-semibold mt-3 mb-2">{children}</h4>
    ),
    h5: ({ children }) => (
      <h5 className="text-sm font-semibold mt-2 mb-1">{children}</h5>
    ),
    h6: ({ children }) => (
      <h6 className="text-xs font-semibold mt-2 mb-1">{children}</h6>
    ),

    // Paragraphs
    p: ({ children }) => <p className="mb-4 leading-7 last:mb-0">{children}</p>,

    // Lists
    ul: ({ children }) => (
      <ul className="mb-4 ml-6 list-disc space-y-2 [&>li]:mt-2">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="mb-4 ml-6 list-decimal space-y-2 [&>li]:mt-2">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="leading-7">{children}</li>,

    // Blockquote
    blockquote: ({ children }) => (
      <blockquote className="mb-4 border-l-4 border-gray-300 dark:border-gray-700 pl-4 italic text-gray-700 dark:text-gray-300">
        {children}
      </blockquote>
    ),

    // Code blocks
    code: ({ className, children, ...props }) => {
      const isInline = !className;
      if (isInline) {
        return (
          <code
            className="rounded bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 font-mono text-sm"
            {...props}
          >
            {children}
          </code>
        );
      }
      return (
        <code
          className={`block rounded-lg bg-gray-900 dark:bg-gray-950 p-4 font-mono text-sm text-gray-100 overflow-x-auto mb-4 ${className || ""}`}
          {...props}
        >
          {children}
        </code>
      );
    },
    pre: ({ children }) => <pre className="mb-4">{children}</pre>,

    // Links - custom renderer for paper citations
    a: ({ href, children }) => {
      // Check if this looks like a paper citation (paper_id as text, link as href)
      const childText =
        typeof children === "string"
          ? children
          : Array.isArray(children) &&
              children.length === 1 &&
              typeof children[0] === "string"
            ? children[0]
            : null;

      // Pattern to detect paper IDs (e.g., "2511.06901v1", "1234.5678", etc.)
      const isPaperCitation =
        childText && href && /^\d{4}\.\d{4,5}(v\d+)?$/.test(childText.trim());

      if (isPaperCitation && href) {
        const paperId = childText!.trim();

        return (
          <HoverCard>
            <HoverCardTrigger asChild>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors">
                {paperId}
              </span>
            </HoverCardTrigger>
            <HoverCardContent className="w-auto p-2">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    saveToReadingList({ name: paperId, link: href });
                  }}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    window.open(href, "_blank", "noopener,noreferrer");
                  }}
                >
                  Open
                </Button>
              </div>
            </HoverCardContent>
          </HoverCard>
        );
      }

      // Regular link
      return (
        <a
          href={href}
          className="text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300"
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      );
    },

    // Horizontal rule
    hr: () => <hr className="my-6 border-gray-300 dark:border-gray-700" />,

    // Tables
    table: ({ children }) => (
      <div className="mb-4 overflow-x-auto">
        <table className="min-w-full border-collapse border border-gray-300 dark:border-gray-700">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => <thead>{children}</thead>,
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => (
      <tr className="border-b border-gray-300 dark:border-gray-700">
        {children}
      </tr>
    ),
    th: ({ children }) => (
      <th className="border border-gray-300 dark:border-gray-700 px-4 py-2 text-left font-semibold">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-gray-300 dark:border-gray-700 px-4 py-2">
        {children}
      </td>
    ),

    // Strong and emphasis
    strong: ({ children }) => <strong className="font-bold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,

    // Images
    img: ({ src, alt }) => (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={alt} className="mb-4 max-w-full h-auto rounded-lg" />
    ),
  };

  return (
    <div className={`prose prose-sm max-w-none dark:prose-invert ${className}`}>
      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
