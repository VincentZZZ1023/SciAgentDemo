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

interface FlowCanvasProps {
  agentsStatus: Record<AgentId, AgentStatus>;
  agentSubtasks: Record<AgentId, AgentSubtask[]>;
  onSelectAgent: (agentId: AgentId) => void;
}

const NODE_POSITIONS: Record<AgentId, { x: number; y: number }> = {
  review: { x: 24, y: 144 },
  ideation: { x: 396, y: 32 },
  experiment: { x: 768, y: 144 },
};

const PARENT_NODE_WIDTH = 332;
const SUBTASK_TOP_OFFSET = 96;
const SUBTASK_X_OFFSET = 12;
const SUBTASK_HEIGHT = 32;
const SUBTASK_GAP = 8;

const EDGES: Edge[] = [
  {
    id: "review-ideation",
    source: "review",
    target: "ideation",
    markerEnd: {
      type: MarkerType.ArrowClosed,
    },
  },
  {
    id: "ideation-experiment",
    source: "ideation",
    target: "experiment",
    markerEnd: {
      type: MarkerType.ArrowClosed,
    },
  },
  {
    id: "experiment-ideation",
    source: "experiment",
    target: "ideation",
    animated: true,
    markerEnd: {
      type: MarkerType.ArrowClosed,
    },
    style: {
      strokeDasharray: "4 4",
    },
  },
];

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

export const FlowCanvas = ({ agentsStatus, agentSubtasks, onSelectAgent }: FlowCanvasProps) => {
  const { theme } = useTheme();

  const flowContainerRef = useRef<HTMLDivElement | null>(null);
  const flowInstanceRef = useRef<ReactFlowInstance | null>(null);

  const nodes = useMemo<Node[]>(() => {
    const nextNodes: Node[] = [];

    (Object.keys(NODE_POSITIONS) as AgentId[]).forEach((agentId) => {
      const agent = agentsStatus[agentId];
      const subtasks = agentSubtasks[agentId] ?? [];
      const statusClass = `status-badge status-${normalizeStatus(agent.status)}`;
      const parentHeight = calcParentHeight(subtasks.length);

      nextNodes.push({
        id: agentId,
        position: NODE_POSITIONS[agentId],
        className: "flow-agent-node",
        data: {
          label: (
            <div className="flow-node-shell">
              <div className="flow-node-accent" />
              <div className="flow-node-title-row">
                <strong className="flow-node-title">{agentId}</strong>
                <span className={statusClass}>{agent.status}</span>
              </div>
              <div className="flow-node-meta-row">
                <span className="flow-node-progress">Progress: {progressText(agent.progress)}</span>
                <span className="flow-node-subtask-count">{subtasks.length} subtasks</span>
              </div>
            </div>
          ),
        },
        style: {
          borderRadius: 16,
          border: "1px solid var(--card-border)",
          background: "var(--card-bg)",
          color: "var(--text)",
          width: PARENT_NODE_WIDTH,
          height: parentHeight,
          padding: 12,
          boxShadow: "var(--shadow-card)",
        },
      });

      subtasks.forEach((subtask, index) => {
        const subtaskStatus = normalizeSubtaskStatus(subtask.status);
        nextNodes.push({
          id: `${agentId}:subtask:${subtask.id}`,
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
                  {subtask.status} {Math.round(subtask.progress * 100)}%
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
  }, [agentSubtasks, agentsStatus]);

  const edges = useMemo<Edge[]>(() => {
    return EDGES.map((edge) => ({
      ...edge,
      className: "flow-edge",
      style: {
        ...(edge.style ?? {}),
        stroke: "var(--flow-edge)",
        strokeWidth: 1.8,
      },
    }));
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      flowInstanceRef.current?.fitView({ padding: 0.2, duration: 180 });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [theme, nodes.length]);

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
    if (node.parentId && AGENT_IDS.includes(node.parentId as AgentId)) {
      onSelectAgent(node.parentId as AgentId);
      return;
    }

    if (AGENT_IDS.includes(node.id as AgentId)) {
      onSelectAgent(node.id as AgentId);
    }
  };

  return (
    <div className="flow-canvas" ref={flowContainerRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        minZoom={0.35}
        maxZoom={1.8}
        onInit={(instance) => {
          flowInstanceRef.current = instance;
        }}
        onNodeClick={handleNodeClick}
      >
        <Background gap={16} size={1} color="var(--flow-grid)" bgColor="var(--flow-bg)" />
        <Controls />
      </ReactFlow>
    </div>
  );
};
