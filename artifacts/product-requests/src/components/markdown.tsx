import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownProps {
  content: string;
  className?: string;
}

export function Markdown({ content, className = "" }: MarkdownProps) {
  return (
    <div className={`prose prose-sm md:prose-base prose-indigo max-w-none dark:prose-invert ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ node: _node, alt, ...props }) => (
            <a
              href={props.src as string}
              target="_blank"
              rel="noopener noreferrer"
            >
              <img
                {...props}
                alt={alt ?? ""}
                loading="lazy"
                className="max-h-96 w-auto rounded-lg border border-gray-200 dark:border-gray-700"
              />
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}