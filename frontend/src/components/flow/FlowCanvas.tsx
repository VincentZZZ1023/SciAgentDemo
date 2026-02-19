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
import type { AgentId, AgentStatus } from "../../types/events";

interface FlowCanvasProps {
  agentsStatus: Record<AgentId, AgentStatus>;
  onSelectAgent: (agentId: AgentId) => void;
}

const NODE_POSITIONS: Record<AgentId, { x: number; y: number }> = {
  review: { x: 40, y: 140 },
  ideation: { x: 330, y: 40 },
  experiment: { x: 620, y: 140 },
};

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
const normalizeStatus = (status: string): "idle" | "running" | "completed" | "other" => {
  if (status === "idle" || status === "running" || status === "completed") {
    return status;
  }
  return "other";
};

export const FlowCanvas = ({ agentsStatus, onSelectAgent }: FlowCanvasProps) => {
  const { theme } = useTheme();

  const flowContainerRef = useRef<HTMLDivElement | null>(null);
  const flowInstanceRef = useRef<ReactFlowInstance | null>(null);

  const nodes = useMemo<Node[]>(() => {
    return (Object.keys(NODE_POSITIONS) as AgentId[]).map((agentId) => {
      const agent = agentsStatus[agentId];
      const statusClass = `status-badge status-${normalizeStatus(agent.status)}`;
      return {
        id: agentId,
        position: NODE_POSITIONS[agentId],
        data: {
          label: (
            <div className="flow-node-label">
              <div className="flow-node-title-row">
                <strong>{agentId}</strong>
                <span className={statusClass}>{agent.status}</span>
              </div>
              <span className="flow-node-progress">Progress: {progressText(agent.progress)}</span>
            </div>
          ),
        },
        style: {
          borderRadius: 14,
          border: "1px solid var(--border)",
          background: "var(--panel)",
          color: "var(--text)",
          width: 220,
          padding: 12,
          boxShadow: "var(--shadow-sm)",
        },
      };
    });
  }, [agentsStatus]);

  const edges = useMemo<Edge[]>(() => {
    return EDGES.map((edge) => ({
      ...edge,
      style: {
        ...(edge.style ?? {}),
        stroke: "var(--flow-edge)",
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
    onSelectAgent(node.id as AgentId);
  };

  return (
    <div className="flow-canvas" ref={flowContainerRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        minZoom={0.4}
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
