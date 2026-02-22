import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ArtifactContentViewProps {
  contentType: string;
  content: string;
  artifactName?: string;
  emptyText?: string;
}

const normalize = (value: string): string => value.trim().toLowerCase();

const isMarkdownContent = (contentType: string, artifactName?: string): boolean => {
  const normalizedType = normalize(contentType);
  const normalizedName = normalize(artifactName ?? "");
  return (
    normalizedType.includes("markdown") ||
    normalizedName.endsWith(".md") ||
    normalizedName.endsWith(".markdown")
  );
};

const isJsonContent = (contentType: string, artifactName?: string): boolean => {
  const normalizedType = normalize(contentType);
  const normalizedName = normalize(artifactName ?? "");
  return normalizedType.includes("json") || normalizedName.endsWith(".json");
};

const formatJson = (raw: string): string => {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
};

export const ArtifactContentView = ({
  contentType,
  content,
  artifactName,
  emptyText = "(empty)",
}: ArtifactContentViewProps) => {
  const value = content ?? "";
  if (!value.trim()) {
    return (
      <pre className="artifact-renderer artifact-renderer-pre">{emptyText}</pre>
    );
  }

  if (isMarkdownContent(contentType, artifactName)) {
    return (
      <div className="artifact-renderer artifact-renderer-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
      </div>
    );
  }

  if (isJsonContent(contentType, artifactName)) {
    return (
      <pre className="artifact-renderer artifact-renderer-pre">{formatJson(value)}</pre>
    );
  }

  return (
    <pre className="artifact-renderer artifact-renderer-pre">{value}</pre>
  );
};
