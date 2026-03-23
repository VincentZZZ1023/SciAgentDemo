import { useEffect, useMemo, useRef } from "react";
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
import { useTheme } from "../../theme/ThemeProvider";
import { AGENT_IDS, type AgentId, type AgentStatus, type AgentSubtask } from "../../types/events";
import { APP_COPY, formatAgentLabel, formatModuleStatusLabel } from "../../lib/copy";

interface FlowCanvasProps {
  agentsStatus: Record<AgentId, AgentStatus>;
  agentSubtasks: Record<AgentId, AgentSubtask[]>;
  enabledAgents?: AgentId[];
  onSelectAgent: (agentId: AgentId) => void;
}

const DEFAULT_AGENT_STATUS: AgentStatus = {
  agentId: "review",
  status: "idle",
  progress: 0,
  lastUpdate: 0,
  runId: null,
  lastSummary: "idle",
};

const PARENT_NODE_WIDTH = 332;
const SUBTASK_TOP_OFFSET = 96;
const SUBTASK_X_OFFSET = 12;
const SUBTASK_HEIGHT = 32;
const SUBTASK_GAP = 8;
const NODE_X_GAP = 72;

const progressText = (value: number): string => `${Math.round(value * 100)}%`;

const normalizeStatus = (status: string): "idle" | "running" | "completed" | "failed" | "other" => {
  if (status === "idle" || status === "running" || status === "completed" || status === "failed") {
    return status;
  }
  return "other";
};

const normalizeSubtaskStatus = (
  status: string,
): "pending" | "running" | "completed" | "failed" | "other" => {
  if (status === "pending" || status === "running" || status === "completed" || status === "failed") {
    return status;
  }
  return "other";
};

const calcParentHeight = (subtaskCount: number): number => {
  if (subtaskCount <= 0) {
    return 168;
  }
  const contentHeight = subtaskCount * SUBTASK_HEIGHT + (subtaskCount - 1) * SUBTASK_GAP;
  return SUBTASK_TOP_OFFSET + contentHeight + 14;
};

const buildNodePositions = (visibleAgents: AgentId[]): Record<AgentId, { x: number; y: number }> => {
  const positions = {} as Record<AgentId, { x: number; y: number }>;
  const isFullPipeline =
    visibleAgents.length === 3 &&
    visibleAgents[0] === "review" &&
    visibleAgents[1] === "ideation" &&
    visibleAgents[2] === "experiment";

  visibleAgents.forEach((agentId, index) => {
    if (isFullPipeline) {
      positions[agentId] =
        agentId === "ideation"
          ? { x: 396, y: 32 }
          : agentId === "review"
            ? { x: 24, y: 144 }
            : { x: 768, y: 144 };
      return;
    }

    positions[agentId] = {
      x: 24 + index * (PARENT_NODE_WIDTH + NODE_X_GAP),
      y: 104,
    };
  });

  return positions;
};

const buildEdges = (visibleAgents: AgentId[]): Edge[] => {
  const edges: Edge[] = [];

  for (let index = 0; index < visibleAgents.length - 1; index += 1) {
    edges.push({
      id: `${visibleAgents[index]}-${visibleAgents[index + 1]}`,
      source: visibleAgents[index],
      target: visibleAgents[index + 1],
      markerEnd: {
        type: MarkerType.ArrowClosed,
      },
    });
  }

  if (visibleAgents.includes("experiment") && visibleAgents.includes("ideation")) {
    edges.push({
      id: "experiment-ideation-feedback",
      source: "experiment",
      target: "ideation",
      animated: true,
      markerEnd: {
        type: MarkerType.ArrowClosed,
      },
      style: {
        strokeDasharray: "4 4",
      },
    });
  }

  return edges;
};

export const FlowCanvas = ({ agentsStatus, agentSubtasks, enabledAgents, onSelectAgent }: FlowCanvasProps) => {
  const { theme } = useTheme();

  const flowContainerRef = useRef<HTMLDivElement | null>(null);
  const flowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const safeAgentStatus = useMemo<Record<AgentId, AgentStatus>>(
    () => ({
      review: agentsStatus.review ?? { ...DEFAULT_AGENT_STATUS, agentId: "review" },
      ideation: agentsStatus.ideation ?? { ...DEFAULT_AGENT_STATUS, agentId: "ideation" },
      experiment: agentsStatus.experiment ?? { ...DEFAULT_AGENT_STATUS, agentId: "experiment" },
    }),
    [agentsStatus],
  );
  const visibleAgents = useMemo(
    () => (enabledAgents && enabledAgents.length > 0 ? enabledAgents : [...AGENT_IDS]),
    [enabledAgents],
  );
  const nodePositions = useMemo(() => buildNodePositions(visibleAgents), [visibleAgents]);

  const nodes = useMemo<Node[]>(() => {
    const nextNodes: Node[] = [];

    visibleAgents.forEach((agentId) => {
      const agent = safeAgentStatus[agentId];
      const subtasks = agentSubtasks[agentId] ?? [];
      const statusClass = `status-badge status-${normalizeStatus(agent.status)}`;
      const parentHeight = calcParentHeight(subtasks.length);

      nextNodes.push({
        id: agentId,
        type: "default",
        position: nodePositions[agentId],
        className: "flow-agent-node",
        data: {
          label: (
            <div className="flow-node-shell">
              <div className="flow-node-accent" />
              <div className="flow-node-title-row">
                <strong className="flow-node-title">{formatAgentLabel(agentId)}</strong>
                <span className={statusClass}>{formatModuleStatusLabel(agent.status)}</span>
              </div>
              <div className="flow-node-meta-row">
                <span className="flow-node-progress">{APP_COPY.flow.progress}: {progressText(agent.progress)}</span>
                <span className="flow-node-subtask-count">{subtasks.length} {APP_COPY.flow.subtasksSuffix}</span>
              </div>
            </div>
          ),
        },
        style: {
          borderRadius: 16,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--text)",
          width: PARENT_NODE_WIDTH,
          height: parentHeight,
          padding: 12,
          boxShadow: "var(--shadow-sm)",
        },
      });

      subtasks.forEach((subtask, index) => {
        const subtaskStatus = normalizeSubtaskStatus(subtask.status);
        const progress = Number.isFinite(subtask.progress)
          ? Math.max(0, Math.min(1, subtask.progress))
          : 0;
        nextNodes.push({
          id: `${agentId}:subtask:${subtask.id}`,
          type: "default",
          parentId: agentId,
          extent: "parent",
          draggable: false,
          selectable: false,
          focusable: false,
          className: "flow-subtask-node",
          position: {
            x: SUBTASK_X_OFFSET,
            y: SUBTASK_TOP_OFFSET + index * (SUBTASK_HEIGHT + SUBTASK_GAP),
          },
          data: {
            label: (
              <div className="flow-subtask-row">
                <span className="flow-subtask-name">{subtask.name}</span>
                <span className={`flow-subtask-badge subtask-${subtaskStatus}`}>
                  {formatModuleStatusLabel(subtask.status)} {Math.round(progress * 100)}%
                </span>
              </div>
            ),
          },
          style: {
            width: PARENT_NODE_WIDTH - SUBTASK_X_OFFSET * 2,
            height: SUBTASK_HEIGHT,
            borderRadius: 10,
            border: "1px solid var(--card-border)",
            background: "var(--panel-soft)",
            padding: 7,
            boxShadow: "none",
          },
        });
      });
    });

    return nextNodes;
  }, [agentSubtasks, nodePositions, safeAgentStatus, visibleAgents]);

  const edges = useMemo<Edge[]>(() => {
    return buildEdges(visibleAgents).map((edge) => ({
      ...edge,
      className: "flow-edge",
      style: {
        ...(edge.style ?? {}),
        stroke: "var(--flow-edge)",
        strokeWidth: 1.8,
      },
    }));
  }, [visibleAgents]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      flowInstanceRef.current?.fitView({ padding: 0.18, duration: 180 });
    });
    const timer = window.setTimeout(() => {
      flowInstanceRef.current?.fitView({ padding: 0.18, duration: 0 });
    }, 300);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [theme, nodes.length]);

  useEffect(() => {
    const container = flowContainerRef.current;
    if (!container) {
      return;
    }

    const observer = new ResizeObserver(() => {
      flowInstanceRef.current?.fitView({ padding: 0.18, duration: 0 });
    });

    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, []);

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    if (!visibleAgents.includes(node.id as AgentId)) {
      return;
    }
    onSelectAgent(node.id as AgentId);
  };

  return (
    <div className="topic-flow-shell flow-canvas" ref={flowContainerRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        minZoom={0.35}
        maxZoom={1.45}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        panOnDrag
        panOnScroll
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onInit={(instance) => {
          flowInstanceRef.current = instance;
        }}
        onNodeClick={handleNodeClick}
      >
        <Background gap={20} size={1} color="var(--flow-grid)" bgColor="var(--flow-bg)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
};

