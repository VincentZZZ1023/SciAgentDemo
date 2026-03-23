import type { AgentId } from "../types/events";

export type RunModeKey = "quick" | "deep" | "pro";
export type DrawerTabKey = "log" | "artifacts" | "context";
export type ResultStatus = "running" | "done" | "coming soon";

const AGENT_LABELS: Record<AgentId, string> = {
  review: "review",
  ideation: "ideation",
  experiment: "experiment",
};

const AGENT_TITLES: Record<AgentId, string> = {
  review: "Review",
  ideation: "Ideation",
  experiment: "Experiment",
};

const RUN_STATUS_LABELS: Record<string, string> = {
  idle: "空闲",
  queued: "排队中",
  running: "运行中",
  paused: "已暂停",
  succeeded: "已完成",
  completed: "已完成",
  done: "已完成",
  success: "已完成",
  failed: "失败",
  canceled: "已取消",
  stopped: "已停止",
  unknown: "未知",
};

const MODULE_STATUS_LABELS: Record<string, string> = {
  idle: "空闲",
  pending: "待开始",
  running: "进行中",
  completed: "已完成",
  succeeded: "已完成",
  failed: "失败",
  skipped: "已跳过",
  other: "处理中",
};

const TOPIC_STATUS_LABELS: Record<string, string> = {
  active: "进行中",
  archived: "已归档",
  unknown: "未知",
};

const SEVERITY_LABELS: Record<string, string> = {
  info: "提示",
  warn: "警告",
  error: "错误",
};

const TRACE_KIND_LABELS: Record<string, string> = {
  message: "消息",
  artifact: "产物",
  status: "状态",
  event: "事件",
};

const EVENT_KIND_LABELS: Record<string, string> = {
  module_started: "模块开始",
  module_finished: "模块结束",
  module_failed: "模块失败",
  module_skipped: "模块跳过",
  approval_required: "等待审批",
  approval_resolved: "审批完成",
  artifact_created: "产物生成",
  message_created: "消息创建",
  event_emitted: "过程事件",
  agent_status_updated: "状态更新",
  agent_subtasks_updated: "子任务更新",
};

const MESSAGE_ROLE_LABELS: Record<string, string> = {
  user: "用户",
  assistant: "助手",
  system: "系统",
};

const WS_STATUS_LABELS: Record<string, string> = {
  connected: "已连接",
  connecting: "连接中",
  reconnecting: "重连中",
  disconnected: "未连接",
  closed: "未连接",
};

const DRAWER_TAB_LABELS: Record<DrawerTabKey, string> = {
  log: "日志",
  artifacts: "产物",
  context: "上下文",
};

export const MODE_LABELS: Record<RunModeKey, string> = {
  quick: "Quick",
  deep: "Deep",
  pro: "Pro",
};

export const MODE_HINTS: Record<RunModeKey, string> = {
  quick: "快速模式，适合快速验证当前任务。",
  deep: "深度模式，覆盖完整分析链路。",
  pro: "专业模式，保留完整流程与更强控制。",
};

export const APP_COPY = {
  common: {
    close: "关闭",
    preview: "预览",
    download: "下载",
    loading: "加载中...",
    loadingArtifact: "正在加载产物...",
    loadingTrace: "正在加载追踪...",
    submitting: "提交中...",
    refresh: "刷新",
    refreshing: "刷新中...",
    run: "运行",
    running: "运行中...",
    start: "开始",
    settings: "设置",
    backHome: "返回首页",
    openDrawer: "打开面板",
    openTrace: "查看追踪",
    workflow: "工作流",
    artifacts: "产物",
    context: "上下文",
    trace: "追踪",
    payload: "载荷",
    summary: "摘要",
    requestFailed: "请求失败",
    unexpectedError: "出现异常",
    yes: "是",
    no: "否",
    on: "开启",
    off: "关闭",
    online: "在线",
    offline: "离线",
    none: "暂无",
    unknown: "未知",
    optionalNote: "可选备注",
    approve: "通过",
    reject: "拒绝",
  },
  home: {
    updatedRecently: "刚刚更新",
    runPending: "运行待创建",
    runPrefix: "运行",
    newRunFallbackTitle: "新任务",
    newRunFallbackSummary: "新任务",
    followUpRequest: "继续本线程",
    createRunError: "创建运行失败。",
    emptyTaskError: "请输入要交给 xcientist 的任务。",
    noAgentError: "请至少选择一个模块。",
    newChatPlaceholder: "描述一个新的科研任务...",
    continuePlaceholder: "继续当前线程...",
    welcomeTitle: "今天想让 xcientist 完成什么？",
    welcomeDesc: "输入一个新的综述、创意探索或实验计划，开始一轮新的研究工作流。",
    loadingConversationTitle: "正在载入运行对话...",
    loadingConversationDesc: "正在获取所选运行的快照并重建会话视图。",
    configTitle: "运行设置",
    configEmpty: "请至少选择一个模块后再调整本次运行设置。",
    singleAgentConfig: (label: string) => `正在调整本次运行的 ${label} 设置。`,
    multiAgentConfig: (count: number) => `正在调整 ${count} 个已选模块，本次启动仅会启用这些模块。`,
    approvalWaiting: (label: string) => `${label} 正在等待审批`,
    runThreadTitleFallback: "xcientist 线程",
    closeRunConfigAria: "关闭运行设置面板",
    runConfigPanelAria: "运行设置面板",
  },
  sidebar: {
    searchTitle: "搜索",
    searchDesc: "查找历史运行。",
    searchPlaceholder: "搜索运行历史",
    newChat: "新对话",
    runs: "运行页",
    historyTitle: "运行历史",
    historyDesc: "查看最近的运行记录。",
    historyAriaLabel: "运行历史",
    historyLoading: "正在加载最近运行...",
    noMatchingTitle: "没有匹配结果",
    noMatchingDesc: "有运行记录后，会显示在这里。",
    userTitle: "账户",
    userDesc: "当前工作区身份。",
    userSubtitle: "当前工作区账户",
    switchAccount: "切换账户",
    logout: "退出登录",
    roleAdmin: "管理员",
    roleUser: "用户",
  },
  topicList: {
    brandTitle: "xcientist 控制台",
    brandSubtitle: "科研工作流中心",
    topicsTitle: "课题",
    searchPlaceholder: "搜索课题",
    activeSuffix: "进行中",
    totalSuffix: "总计",
    noMatching: "没有匹配的课题",
    noTopics: "还没有课题",
    deleteLabel: "删除",
    createTitle: "新建课题",
    createDesc: "发起一个新的研究工作流",
    topicNamePlaceholder: "课题名称",
    topicDescriptionPlaceholder: "课题描述（可选）",
    creating: "创建中...",
    createButton: "创建课题",
    guest: "访客",
    admin: "管理员",
    user: "用户",
    topicNameRequired: "请输入课题名称",
    networkHint: (apiBaseUrl: string) => `无法连接后端 API（${apiBaseUrl}），请检查后端服务、CORS 与端口配置。`,
    topicDeleteConfirm: (title: string) => `确认删除课题“${title}”吗？`,
    deleteAria: (title: string) => `删除 ${title}`,
    timeNow: "刚刚",
  },
  searchBox: {
    defaultPlaceholder: "描述你的研究目标、约束和期望输出，xcientist 会协调综述、创意与实验流程。",
    inputAriaLabel: "xcientist 任务输入",
    runModeAriaLabel: "运行模式",
    selectedAgentsAriaLabel: "已选模块",
    ideaPreference: "创意偏好",
    ideaPreferenceActive: "仅在选择 idea 模块时生效",
    ideaPreferenceInactive: "只对 idea 模块生效",
    settings: "设置",
    startRunAriaLabel: "开始运行",
    submit: "开始",
  },
  runConfig: {
    title: "运行设置",
    loadingDefault: "正在加载默认设置...",
    unavailable: "当前无法获取运行设置",
    restoreDefault: "恢复默认",
    online: "联网检索",
    enabled: "启用",
    disabled: "停用",
    model: "模型",
    requireHuman: "人工确认",
    ideaPreference: "创意偏好",
    singleAgentHint: (label: string) => `正在编辑 ${label} 的本次运行草稿，启动时仅会启用该模块。`,
    lockedModulesHint: "由启动器中的模块选择控制本次运行启用项。",
    multiAgentHint: "启动前可调整模块启用状态与模型路由。",
  },
  workflowSettings: {
    title: "运行设置",
    loading: "正在加载运行设置...",
    usingDefault: "当前使用默认设置",
    editMode: "编辑中",
    readOnly: "只读",
    thinkingMode: "思考模式",
    mode: "模式",
    network: "联网",
    preset: "预设",
    enabled: "启用",
    disabled: "停用",
    applyAndRun: "应用并运行",
    applying: "应用中...",
    cancel: "取消",
    edit: "编辑",
    restoreDefault: "恢复默认",
    model: "模型",
    requireHuman: "人工确认",
  },
  composer: {
    title: "发起新一轮运行",
    subtitle: "描述目标、约束和期望输出格式。",
    placeholder: "描述希望各模块调研和交付的内容...",
    promptRequired: "请输入任务内容",
    launching: "启动中...",
  },
  drawer: {
    closeAria: "关闭工作流侧栏",
    dialogAria: "工作流详情",
    title: "工作流详情",
    subtitle: "查看日志、产物和运行上下文",
  },
  eventFeed: {
    title: "事件流",
    subtitle: "实时更新",
    empty: "暂时没有事件",
  },
  flow: {
    progress: "进度",
    subtasksSuffix: "个子任务",
    anchorSuffix: "锚点",
  },
  runs: {
    noTopicSelectedTitle: "未选择课题",
    noTopicSelectedDesc: "请先在左侧选择或创建一个课题。",
    topbarLabel: "运行工作台",
    runPrefix: "运行",
    statusPrefix: "状态",
    wsPrefix: "连接",
    eventCountPrefix: "事件",
    artifactCountPrefix: "产物",
    currentPrefix: "当前模块",
    runChatTitle: "运行会话",
    runChatDesc: "在同一条会话流中查看任务输入、过程推进和结果产出。",
    runFeedTitle: "运行动态",
    runFeedDesc: "统一查看进度、结果和关键节点。",
    approvalRequired: "需要审批",
    approvalWaitingDesc: "当前模块正在等待人工审批。",
    chatTab: "对话",
    pipelineTab: "流程",
    traceTab: "追踪",
    eventLog: "事件日志",
    moduleField: "模块",
    kindField: "类型",
    severityField: "级别",
    all: "全部",
    filesSuffix: "个文件",
    topicPromptTitle: "课题输入",
    noPromptRecorded: "当前课题还没有记录输入。",
    runStatusTitle: "运行状态",
    currentModuleField: "当前模块",
    awaitingApprovalField: "等待审批",
    awaitingModuleField: "待审批模块",
    runConfigSummary: "运行设置摘要",
    selectedAgents: "已选模块",
    network: "联网状态",
    usingDefaultConfig: "当前使用默认设置。",
    artifactPreviewAria: "产物预览",
    artifactFallbackTitle: "产物",
    traceViewButton: "追踪视图",
    noFilteredEvents: "??????????????",
  },
  runPanel: {
    title: "运行面板",
    subtitle: "查看进度、产物与审批流程",
    noRunSelected: "还没有选中运行。",
    runId: "运行 ID",
    status: "状态",
    currentModule: "当前模块",
    modules: "模块",
    artifacts: "产物",
    recentTrace: "最近追踪",
    noArtifacts: "还没有产物。",
    noTrace: "还没有追踪记录。",
    openTrace: "查看追踪",
  },
  stream: {
    userName: "你",
    userTag: "任务",
    systemName: "xcientist",
    systemTag: "系统",
    reviewName: "Review",
    ideationName: "Ideation",
    experimentName: "Experiment",
    noPromptFailure: "运行未完成，请查看最近一条消息确认下一步。",
    runCompleted: "运行完成",
    runCompletedWithArtifacts: "本轮运行已结束，最新结果已可在当前会话中查看。",
    runCompletedWithoutArtifacts: "本轮运行已顺利完成。",
    generatingLabel: "思考中...",
    generatingHint: "正在整理下一条回复，稍后会在这里继续输出。",
    startingLabel: "准备启动...",
    startingHint: "正在准备所选模块并加载第一步任务。",
    planningLabel: "规划中...",
    planningHint: "所选模块正在把你的任务整理成第一版可执行结果。",
    runningLabel: "运行中...",
    runningAwaitingHint: "运行正在等待你的下一步决策后继续。",
    runningHint: "工作流仍在执行，新的结果会继续追加到会话中。",
    queueThinking: "正在理解任务并准备第一版回答。",
    pausedThinking: "当前运行已暂停，等待继续。",
    activeThinking: "正在整理下一条回复，并把实时运行信号转成可读输出。",
    settingUpWorkspace: "正在初始化模块工作区。",
    packagingReply: "正在整理最终回答与附件。",
    draftingMarkdown: (agent: string) => `${agent} 正在整理 Markdown 输出。`,
    generatedArtifact: (name: string) => `已生成 ${name}。`,
    preparedResponse: (agent: string) => `${agent} 已准备好回复。`,
    scanLiterature: "正在扫描并整理相关文献。",
    surveyToIdeas: "正在把综述结果转成候选研究方向。",
    testIdea: "正在验证选定创意的实验假设。",
    refineIdea: "正在根据实验结果回补创意方案。",
    invokeModel: "正在调用模型生成下一段内容。",
    condenseModel: "正在整理模型返回内容，形成可读输出。",
    recoverTransientIssue: "正在从临时问题中恢复后继续执行。",
    prepareMarkdown: (agent: string) => `正在准备 ${agent} 的最终 Markdown 结果。`,
    moduleStartedLabel: (agent: string) => `${agent} 已开始`,
    moduleStartedText: (model?: string) => (model ? `当前使用 ${model}。` : "模块已开始处理任务。"),
    moduleFailedText: (agent: string) => `${agent} 执行失败。`,
    moduleSkippedLabel: (agent: string) => `${agent} 已跳过`,
    moduleSkippedText: "当前请求未启用该模块。",
    moduleCompletedLabel: (agent: string) => `${agent} 已完成`,
    moduleCompletedWithArtifacts: (names: string[]) => `结果已生成：${names.join("、")}。`,
    moduleCompletedText: "模块已完成本轮输出。",
    approvalGranted: "审批已通过",
    approvalRejected: "审批已拒绝",
    approvalContinue: (agent: string) => `${agent} 可以继续执行。`,
    approvalStopped: (agent: string) => `${agent} 已按你的决定停止。`,
    moduleDidNotRun: "该模块本轮未执行。",
    skipReason: (reason: string) => `原因：${reason}。`,
    lifecycleUpdate: "运行状态已更新。",
    typingAria: "助手正在生成内容",
    emptyTitle: "xcientist ???????",
    emptyHint: "????????????????????????????????????",
    approvalBadge: "??",
    approvalCheckpointRecorded: "????????",
    thinkingLabel: "???",
    preparingFormattedReply: (name: string) => `???? ${name} ??????...`,
    couldNotLoadArtifact: (name: string) => `???? ${name}???????????`,
  },
  trace: {
    timeline: "时间线",
    graph: "关系图",
    result: "结果区",
    resultSubtitle: "为后续结果视图预留的轻量占位。",
    report: "报告",
    reportSubtitle: "运行总结与结构化输出。",
    graphCardTitle: "图谱",
    graphCardSubtitle: "高层关系视图预留位。",
    reportRunning: "正在汇总模块输出并组装报告内容。",
    reportDone: "报告结果已就绪，可在此处展示。",
    reportComingSoon: "报告视图将在后续版本扩展。",
    graphRunning: "正在根据当前运行信号准备图谱视角。",
    graphDone: "图谱结果位已就绪，可接入后续可视化输出。",
    graphComingSoon: "图谱渲染能力即将提供。",
    timelineTitle: "追踪时间线",
    itemsSuffix: "条",
    agentField: "模块",
    kindField: "类型",
    noTrace: "还没有追踪记录",
    expand: "展开",
    collapse: "收起",
    statusField: "状态",
    tryPreview: "尝试预览",
    traceArtifactModalAria: "追踪产物预览",
    flowLoading: "正在加载追踪...",
    flowDrawerCloseAria: "关闭追踪详情面板",
    flowDrawerAria: "追踪节点详情",
    flowDetailTitle: (agent: string) => `${agent} 详情`,
    flowDetailMeta: (kind: string, time: string) => `${kind} · ${time}`,
    message: "消息",
    artifact: "产物",
    payload: "载荷",
    nameField: "名称",
    typeField: "类型",
    roleField: "角色",
    summary: "摘要",
    noPayload: "（无载荷）",
    previewAvailable: "可预览",
  },
  theme: {
    dark: "深色",
    light: "浅色",
    switchToLight: "切换为浅色主题",
    switchToDark: "切换为深色主题",
  },
} as const;

export const formatAgentLabel = (agentId: AgentId): string => AGENT_LABELS[agentId];
export const formatAgentTitle = (agentId: AgentId): string => AGENT_TITLES[agentId];
export const formatRunStatusLabel = (status: string): string => {
  const normalized = status.trim().toLowerCase();
  return (RUN_STATUS_LABELS[normalized] ?? status) || APP_COPY.common.unknown;
};
export const formatModuleStatusLabel = (status: string): string => {
  const normalized = status.trim().toLowerCase();
  return (MODULE_STATUS_LABELS[normalized] ?? status) || APP_COPY.common.unknown;
};
export const formatTopicStatusLabel = (status: string): string => {
  const normalized = status.trim().toLowerCase();
  return (TOPIC_STATUS_LABELS[normalized] ?? status) || APP_COPY.common.unknown;
};
export const formatSeverityLabel = (severity: string): string => {
  const normalized = severity.trim().toLowerCase();
  return (SEVERITY_LABELS[normalized] ?? severity) || APP_COPY.common.unknown;
};
export const formatTraceKindLabel = (kind: string): string => {
  const normalized = kind.trim().toLowerCase();
  return (TRACE_KIND_LABELS[normalized] ?? kind) || APP_COPY.common.unknown;
};
export const formatEventKindLabel = (kind: string): string => {
  const normalized = kind.trim().toLowerCase();
  return (EVENT_KIND_LABELS[normalized] ?? kind) || APP_COPY.common.unknown;
};
export const formatMessageRoleLabel = (role: string): string => {
  const normalized = role.trim().toLowerCase();
  return (MESSAGE_ROLE_LABELS[normalized] ?? role) || APP_COPY.common.unknown;
};
export const formatWsStatusLabel = (status: string): string => {
  const normalized = status.trim().toLowerCase();
  return (WS_STATUS_LABELS[normalized] ?? status) || APP_COPY.common.unknown;
};
export const formatDrawerTabLabel = (tab: DrawerTabKey): string => DRAWER_TAB_LABELS[tab];
export const formatModeLabel = (mode: RunModeKey): string => MODE_LABELS[mode];
export const formatModeHint = (mode: RunModeKey): string => MODE_HINTS[mode];
export const formatBooleanLabel = (value: boolean): string => (value ? APP_COPY.common.yes : APP_COPY.common.no);
export const formatOnOffLabel = (value: boolean): string => (value ? APP_COPY.common.on : APP_COPY.common.off);
export const formatOnlineLabel = (value: boolean): string => (value ? APP_COPY.common.online : APP_COPY.common.offline);
export const formatResultStatusLabel = (status: ResultStatus): string => {
  if (status === "running") {
    return "进行中";
  }
  if (status === "done") {
    return "已就绪";
  }
  return "即将提供";
};
