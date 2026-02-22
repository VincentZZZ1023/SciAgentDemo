import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type ReactFlowInstance,
} from "@xyflow/react";
import { fetchArtifactContent } from "../../api/client";
import { ArtifactContentView } from "../artifact/ArtifactContentView";
import { useTheme } from "../../theme/ThemeProvider";
import {
  AGENT_IDS,
  isArtifact,
  isMessage,
  type AgentId,
  type Artifact,
  type Message,
  type TraceItem,
} from "../../types/events";

interface TraceFlowCanvasProps {
  items: TraceItem[];
  artifacts: Artifact[];
  loading: boolean;
  error: string;
}

const LANE_X: Record<AgentId, number> = {
  review: 0,
  ideation: 450,
  experiment: 900,
};

const LANE_LABELS: Record<AgentId, string> = {
  review: "Review",
  ideation: "Ideation",
  experiment: "Experiment",
};

const ROW_HEIGHT = 120;
const NODE_WIDTH = 320;

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed";
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const trimSingleLine = (text: string, max = 92): string => {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= max) {
    return singleLine;
  }
  return `${singleLine.slice(0, max)}...`;
};

const formatTime = (ts: number): string => {
  return new Date(ts).toLocaleTimeString();
};

const parseArtifactNameFromSummary = (summary: string): string | null => {
  const prefix = "artifact: ";
  if (!summary.startsWith(prefix)) {
    return null;
  }
  const value = summary.slice(prefix.length).trim();
  return value || null;
};

const getTraceMessage = (item: TraceItem): Message | null => {
  if (!isObject(item.payload)) {
    return null;
  }
  return isMessage(item.payload.message) ? item.payload.message : null;
};

const getTraceArtifact = (item: TraceItem): Artifact | null => {
  if (!isObject(item.payload)) {
    return null;
  }
  return isArtifact(item.payload.artifact) ? item.payload.artifact : null;
};

const getHandoffTo = (item: TraceItem): AgentId | null => {
  if (!isObject(item.payload)) {
    return null;
  }
  const candidate = item.payload.handoffTo;
  if (typeof candidate !== "string") {
    return null;
  }
  return AGENT_IDS.includes(candidate as AgentId) ? (candidate as AgentId) : null;
};

const resolveArtifactForItem = (item: TraceItem, artifacts: Artifact[]): Artifact | null => {
  const fromPayload = getTraceArtifact(item);
  if (fromPayload) {
    return fromPayload;
  }

  const parsedName = parseArtifactNameFromSummary(item.summary);
  if (!parsedName) {
    return null;
  }

  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    if (artifacts[index].name === parsedName) {
      return artifacts[index];
    }
  }

  return null;
};

interface GraphModel {
  nodes: Node[];
  edges: Edge[];
  nodeItemMap: Map<string, TraceItem>;
}

export const TraceFlowCanvas = ({ items, artifacts, loading, error }: TraceFlowCanvasProps) => {
  const { theme } = useTheme();

  const flowContainerRef = useRef<HTMLDivElement | null>(null);
  const flowInstanceRef = useRef<ReactFlowInstance | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewContent, setPreviewContent] = useState("");
  const [previewContentType, setPreviewContentType] = useState("text/plain");

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => a.ts - b.ts);
  }, [items]);

  const graphModel = useMemo<GraphModel>(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const nodeItemMap = new Map<string, TraceItem>();

    const laneNodes: Record<AgentId, Array<{ nodeId: string; ts: number }>> = {
      review: [],
      ideation: [],
      experiment: [],
    };

    sortedItems.forEach((item, index) => {
      const nodeId = `trace-${item.id}`;
      const y = 30 + index * ROW_HEIGHT;
      const message = item.kind === "message" ? getTraceMessage(item) : null;
      const artifact = item.kind === "artifact" ? getTraceArtifact(item) : null;

      const header = item.kind === "message" ? `${message?.role ?? "assistant"} message` : item.kind;
      const body =
        item.kind === "message"
          ? trimSingleLine(message?.content ?? item.summary)
          : item.kind === "artifact"
            ? artifact?.name ?? parseArtifactNameFromSummary(item.summary) ?? item.summary
            : trimSingleLine(item.summary);

      const footer = item.kind === "artifact" ? "Preview available" : trimSingleLine(item.summary, 72);

      nodes.push({
        id: nodeId,
        position: { x: LANE_X[item.agentId], y },
        data: {
          label: (
            <div className={`trace-flow-node trace-kind-${item.kind}`}>
              <div className="trace-flow-node-head">
                <span className="event-badge">{item.agentId}</span>
                <span className="event-badge event-badge-kind">{item.kind}</span>
                <span className="trace-flow-node-time">{formatTime(item.ts)}</span>
              </div>
              <strong>{header}</strong>
              <p>{body}</p>
              <small>{footer}</small>
            </div>
          ),
        },
        style: {
          width: NODE_WIDTH,
          borderRadius: 12,
          border: "1px solid var(--border)",
          background: "var(--panel)",
          color: "var(--text)",
          boxShadow: "var(--shadow-sm)",
          padding: 10,
        },
      });

      laneNodes[item.agentId].push({ nodeId, ts: item.ts });
      nodeItemMap.set(nodeId, item);
    });

    const anchorY = Math.max(180, 60 + sortedItems.length * ROW_HEIGHT);

    for (const agentId of AGENT_IDS) {
      const anchorId = `anchor-${agentId}`;
      nodes.push({
        id: anchorId,
        position: { x: LANE_X[agentId], y: anchorY },
        selectable: false,
        draggable: false,
        data: {
          label: (
            <div className="trace-flow-anchor">
              <span>{LANE_LABELS[agentId]} anchor</span>
            </div>
          ),
        },
        style: {
          width: NODE_WIDTH,
          borderRadius: 10,
          border: "1px dashed var(--border)",
          background: "var(--panel-soft)",
          color: "var(--muted)",
          padding: 8,
        },
      });
    }

    for (const agentId of AGENT_IDS) {
      const chain = [...laneNodes[agentId]].sort((a, b) => a.ts - b.ts);
      for (let index = 0; index < chain.length - 1; index += 1) {
        edges.push({
          id: `seq-${agentId}-${chain[index].nodeId}-${chain[index + 1].nodeId}`,
          source: chain[index].nodeId,
          target: chain[index + 1].nodeId,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "var(--flow-edge)",
          },
          style: {
            stroke: "var(--flow-edge)",
            strokeDasharray: "5 4",
            opacity: 0.7,
          },
        });
      }
    }

    for (const item of sortedItems) {
      if (item.kind !== "artifact") {
        continue;
      }

      const handoffTo = getHandoffTo(item);
      if (!handoffTo) {
        continue;
      }

      const source = `trace-${item.id}`;
      const nextTarget =
        laneNodes[handoffTo]
          .filter((entry) => entry.ts > item.ts)
          .sort((a, b) => a.ts - b.ts)[0]?.nodeId ?? `anchor-${handoffTo}`;

      edges.push({
        id: `handoff-${item.id}-${handoffTo}`,
        source,
        target: nextTarget,
        animated: true,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "var(--primary)",
        },
        style: {
          stroke: "var(--primary)",
          strokeWidth: 1.8,
        },
      });
    }

    return {
      nodes,
      edges,
      nodeItemMap,
    };
  }, [sortedItems]);

  const selectedItem = useMemo(() => {
    if (!selectedNodeId) {
      return null;
    }
    return graphModel.nodeItemMap.get(selectedNodeId) ?? null;
  }, [graphModel.nodeItemMap, selectedNodeId]);

  const selectedMessage = useMemo(() => {
    if (!selectedItem || selectedItem.kind !== "message") {
      return null;
    }
    return getTraceMessage(selectedItem);
  }, [selectedItem]);

  const selectedArtifact = useMemo(() => {
    if (!selectedItem || selectedItem.kind !== "artifact") {
      return null;
    }
    return resolveArtifactForItem(selectedItem, artifacts);
  }, [artifacts, selectedItem]);

  useEffect(() => {
    if (!selectedNodeId) {
      return;
    }
    if (graphModel.nodeItemMap.has(selectedNodeId)) {
      return;
    }
    setSelectedNodeId(null);
  }, [graphModel.nodeItemMap, selectedNodeId]);

  useEffect(() => {
    setPreviewLoading(false);
    setPreviewError("");
    setPreviewContent("");
    setPreviewContentType(selectedArtifact?.contentType ?? "text/plain");
  }, [selectedItem?.id, selectedArtifact?.contentType]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      flowInstanceRef.current?.fitView({ padding: 0.2, duration: 180 });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [theme, graphModel.nodes.length]);

  useEffect(() => {
    const container = flowContainerRef.current;
    if (!container) {
      return;
    }

    const observer = new ResizeObserver(() => {
      flowInstanceRef.current?.fitView({ padding: 0.2, duration: 0 });
    });

    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, []);

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    if (!graphModel.nodeItemMap.has(node.id)) {
      return;
    }
    setSelectedNodeId(node.id);
  };

  const handleLoadPreview = async () => {
    if (!selectedArtifact) {
      return;
    }

    setPreviewLoading(true);
    setPreviewError("");
    setPreviewContent("");
    setPreviewContentType(selectedArtifact.contentType);

    try {
      const loaded = await fetchArtifactContent(selectedArtifact.uri);
      setPreviewContentType(loaded.contentType);
      setPreviewContent(loaded.content);
    } catch (loadError) {
      setPreviewError(getErrorMessage(loadError));
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div className="trace-flow-shell">
      <div className="trace-flow-canvas" ref={flowContainerRef}>
        <ReactFlow
          nodes={graphModel.nodes}
          edges={graphModel.edges}
          minZoom={0.25}
          maxZoom={1.8}
          fitView
          onInit={(instance) => {
            flowInstanceRef.current = instance;
          }}
          onNodeClick={handleNodeClick}
        >
          <Background gap={16} size={1} color="var(--flow-grid)" bgColor="var(--flow-bg)" />
          <Controls />
        </ReactFlow>

        {loading ? <div className="trace-flow-overlay muted">Loading trace...</div> : null}
        {!loading && error ? <div className="trace-flow-overlay form-error">{error}</div> : null}
      </div>

      {selectedItem ? (
        <>
          <button
            type="button"
            className="trace-flow-drawer-backdrop"
            onClick={() => setSelectedNodeId(null)}
            aria-label="Close trace drawer"
          />
          <aside className="trace-flow-drawer" role="dialog" aria-label="Trace item detail">
            <header className="trace-flow-drawer-header">
              <div>
                <h4>{selectedItem.agentId} detail</h4>
                <p className="muted">
                  {selectedItem.kind} at {new Date(selectedItem.ts).toLocaleString()}
                </p>
              </div>
              <button type="button" onClick={() => setSelectedNodeId(null)}>
                Close
              </button>
            </header>

            <div className="trace-flow-drawer-body">
              {selectedItem.kind === "message" ? (
                <section className="trace-flow-detail-block">
                  <h5>Message</h5>
                  <p>
                    <strong>role:</strong> {selectedMessage?.role ?? "assistant"}
                  </p>
                  <pre>{selectedMessage?.content ?? selectedItem.summary}</pre>
                </section>
              ) : null}

              {selectedItem.kind === "artifact" ? (
                <section className="trace-flow-detail-block">
                  <h5>Artifact</h5>
                  <p>
                    <strong>name:</strong> {selectedArtifact?.name ?? "unknown"}
                  </p>
                  <p>
                    <strong>type:</strong> {selectedArtifact?.contentType ?? "unknown"}
                  </p>
                  {selectedArtifact ? (
                    <button
                      type="button"
                      className="trace-link-button"
                      onClick={() => void handleLoadPreview()}
                      disabled={previewLoading}
                    >
                      {previewLoading ? "Loading..." : "Preview"}
                    </button>
                  ) : null}
                  {previewError ? <p className="form-error">{previewError}</p> : null}
                  {previewContent ? (
                    <ArtifactContentView
                      contentType={previewContentType}
                      content={previewContent}
                      artifactName={selectedArtifact?.name}
                    />
                  ) : null}
                </section>
              ) : null}

              {selectedItem.kind !== "message" && selectedItem.kind !== "artifact" ? (
                <section className="trace-flow-detail-block">
                  <h5>Summary</h5>
                  <p>{selectedItem.summary}</p>
                </section>
              ) : null}

              <section className="trace-flow-detail-block">
                <h5>Payload</h5>
                <pre>
                  {selectedItem.payload
                    ? JSON.stringify(selectedItem.payload, null, 2)
                    : "(no payload)"}
                </pre>
              </section>
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
};
