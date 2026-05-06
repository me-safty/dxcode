export type KanbanConsoleLocale = "en" | "ar";

export type KanbanColumnId = "backlog" | "ready" | "in-progress" | "review" | "blocked" | "done";

export type ConsoleStateId = "empty" | "loading" | "permission" | "missing-auth" | "error";

export type ConsoleViewId =
  | "board"
  | "git"
  | "artifacts"
  | "prs"
  | "timeline"
  | "cli"
  | "gitops"
  | "settings"
  | "states";

export interface KanbanTaskMock {
  id: string;
  issue: string;
  title: string;
  titleAr: string;
  repo: string;
  column: KanbanColumnId;
  priority: "P0" | "P1" | "P2";
  assignee: string;
  pr?: string;
  checks: {
    passing: number;
    pending: number;
    failing: number;
  };
  agent: "Codex" | "Claude" | "Human";
  updated: string;
  comments: number;
}

export interface MonorepoMock {
  name: string;
  path: string;
  branch: string;
  ahead: number;
  behind: number;
  openPrs: number;
  activeTasks: number;
  status: "healthy" | "attention" | "blocked";
}

export const kanbanColumns: Array<{
  id: KanbanColumnId;
  labelKey: keyof typeof kanbanConsoleMessages.en;
}> = [
  { id: "backlog", labelKey: "columnBacklog" },
  { id: "ready", labelKey: "columnReady" },
  { id: "in-progress", labelKey: "columnProgress" },
  { id: "review", labelKey: "columnReview" },
  { id: "blocked", labelKey: "columnBlocked" },
  { id: "done", labelKey: "columnDone" },
];

export const consoleViews: Array<{
  id: ConsoleViewId;
  labelKey: keyof typeof kanbanConsoleMessages.en;
}> = [
  { id: "board", labelKey: "viewBoard" },
  { id: "git", labelKey: "viewGit" },
  { id: "artifacts", labelKey: "viewArtifacts" },
  { id: "prs", labelKey: "viewPrs" },
  { id: "timeline", labelKey: "viewTimeline" },
  { id: "cli", labelKey: "viewCli" },
  { id: "gitops", labelKey: "viewGitops" },
  { id: "settings", labelKey: "viewSettings" },
  { id: "states", labelKey: "viewStates" },
];

export const consoleStateIds: ConsoleStateId[] = [
  "empty",
  "loading",
  "permission",
  "missing-auth",
  "error",
];

export const kanbanConsoleMessages = {
  en: {
    actionQueueCommand: "Queue mock command",
    actionMove: "Move",
    actionOpenSheet: "Open move sheet",
    actionPreview: "Preview",
    actionSaveDraft: "Save draft",
    actionSimulate: "Simulate",
    actionWatch: "Watch",
    agentActions: "Agent actions",
    artifactsHeading: "Product artifacts",
    boardHeading: "GitHub Projects board",
    checks: "Checks",
    cliHeading: "CLI command console",
    columnBacklog: "Backlog",
    columnBlocked: "Blocked",
    columnDone: "Done",
    columnProgress: "In progress",
    columnReady: "Ready",
    columnReview: "In review",
    comments: "Comments",
    consoleTitle: "Kanban Project Console",
    detailHeading: "Task detail",
    emptyState: "No tasks match this workspace filter.",
    errorState: "Project sync failed. Retry uses mock data only.",
    gitHeading: "Lazygit-style git status",
    gitopsHeading: "GitOps and release dashboard",
    issueFields: "Issue and project fields",
    loadingState: "Loading project snapshots.",
    missingAuthState: "Connect GitHub before live sync.",
    moveSheetTitle: "Move card",
    permissionState: "Project write permission required.",
    prsHeading: "PR watcher",
    settingsHeading: "Console settings",
    sidebarHeading: "Registered monorepos",
    statesHeading: "State previews",
    timelineHeading: "Issue and PR timeline",
    viewArtifacts: "Artifacts",
    viewBoard: "Board",
    viewCli: "CLI",
    viewGit: "Git",
    viewGitops: "GitOps",
    viewPrs: "PRs",
    viewSettings: "Settings",
    viewStates: "States",
    viewTimeline: "Timeline",
  },
  ar: {
    actionQueueCommand: "إضافة أمر تجريبي",
    actionMove: "نقل",
    actionOpenSheet: "فتح لوحة النقل",
    actionPreview: "معاينة",
    actionSaveDraft: "حفظ مسودة",
    actionSimulate: "محاكاة",
    actionWatch: "مراقبة",
    agentActions: "إجراءات الوكيل",
    artifactsHeading: "مستندات المنتج",
    boardHeading: "لوحة مشاريع GitHub",
    checks: "الفحوصات",
    cliHeading: "وحدة أوامر CLI",
    columnBacklog: "المهام المؤجلة",
    columnBlocked: "محظور",
    columnDone: "منجز",
    columnProgress: "قيد التنفيذ",
    columnReady: "جاهز",
    columnReview: "قيد المراجعة",
    comments: "التعليقات",
    consoleTitle: "وحدة تحكم مشروع كانبان",
    detailHeading: "تفاصيل المهمة",
    emptyState: "لا توجد مهام تطابق فلتر مساحة العمل.",
    errorState: "فشلت مزامنة المشروع. إعادة المحاولة تستخدم بيانات تجريبية فقط.",
    gitHeading: "حالة Git بنمط Lazygit",
    gitopsHeading: "لوحة GitOps والإصدارات",
    issueFields: "حقول المشكلة والمشروع",
    loadingState: "جار تحميل لقطات المشروع.",
    missingAuthState: "اربط GitHub قبل المزامنة الحية.",
    moveSheetTitle: "نقل البطاقة",
    permissionState: "صلاحية الكتابة على المشروع مطلوبة.",
    prsHeading: "مراقب طلبات السحب",
    settingsHeading: "إعدادات وحدة التحكم",
    sidebarHeading: "مستودعات Monorepo المسجلة",
    statesHeading: "معاينات الحالات",
    timelineHeading: "خط زمني للمشاكل وطلبات السحب",
    viewArtifacts: "المستندات",
    viewBoard: "اللوحة",
    viewCli: "CLI",
    viewGit: "Git",
    viewGitops: "GitOps",
    viewPrs: "طلبات السحب",
    viewSettings: "الإعدادات",
    viewStates: "الحالات",
    viewTimeline: "الخط الزمني",
  },
} as const;

export const monorepos: MonorepoMock[] = [
  {
    name: "kanban-console",
    path: "/Users/mohanghabo/Projects/kanban-console",
    branch: "feature/t3-kanban-phase-2-mock-console",
    ahead: 1,
    behind: 0,
    openPrs: 1,
    activeTasks: 7,
    status: "healthy",
  },
  {
    name: "ai-starter-pro",
    path: "/Users/mohanghabo/Projects/ai-starter-pro",
    branch: "main",
    ahead: 0,
    behind: 0,
    openPrs: 0,
    activeTasks: 3,
    status: "attention",
  },
  {
    name: "docs-product",
    path: "/Users/mohanghabo/Projects/docs-product",
    branch: "release/product-artifacts",
    ahead: 2,
    behind: 1,
    openPrs: 2,
    activeTasks: 4,
    status: "blocked",
  },
];

export const kanbanTasks: KanbanTaskMock[] = [
  {
    id: "t3-p2-1",
    issue: "ai-starter-pro#43",
    title: "Mock GitHub Projects board and card workflow",
    titleAr: "لوحة مشاريع GitHub التجريبية وسير عمل البطاقات",
    repo: "kanban-console",
    column: "in-progress",
    priority: "P1",
    assignee: "Codex",
    pr: "kanban-console#2",
    checks: { passing: 5, pending: 2, failing: 0 },
    agent: "Codex",
    updated: "Today 14:20",
    comments: 6,
  },
  {
    id: "t3-p2-2",
    issue: "ai-starter-pro#43",
    title: "Artifact browser for docs/product",
    titleAr: "متصفح مستندات docs/product",
    repo: "kanban-console",
    column: "ready",
    priority: "P2",
    assignee: "Claude",
    checks: { passing: 3, pending: 0, failing: 0 },
    agent: "Claude",
    updated: "Today 13:05",
    comments: 2,
  },
  {
    id: "t3-p2-3",
    issue: "kanban-console#pending",
    title: "PR watcher comments and check summaries",
    titleAr: "مراقبة تعليقات طلبات السحب وملخصات الفحوصات",
    repo: "kanban-console",
    column: "review",
    priority: "P1",
    assignee: "Human",
    pr: "kanban-console#1",
    checks: { passing: 12, pending: 0, failing: 1 },
    agent: "Human",
    updated: "Yesterday 18:44",
    comments: 11,
  },
  {
    id: "t3-p2-4",
    issue: "ai-starter-pro#43",
    title: "Settings for repos, bots, rules, and polling",
    titleAr: "إعدادات المستودعات والروبوتات والقواعد والاستطلاع",
    repo: "ai-starter-pro",
    column: "backlog",
    priority: "P2",
    assignee: "Codex",
    checks: { passing: 0, pending: 0, failing: 0 },
    agent: "Codex",
    updated: "May 5",
    comments: 1,
  },
  {
    id: "t3-p2-5",
    issue: "kanban-console#mock",
    title: "GitOps release health dashboard",
    titleAr: "لوحة صحة إصدارات GitOps",
    repo: "docs-product",
    column: "blocked",
    priority: "P0",
    assignee: "Human",
    checks: { passing: 4, pending: 1, failing: 2 },
    agent: "Human",
    updated: "May 4",
    comments: 9,
  },
  {
    id: "t3-p2-6",
    issue: "kanban-console#mock",
    title: "CLI command console with dry-run queue",
    titleAr: "وحدة أوامر CLI مع طابور تنفيذ تجريبي",
    repo: "kanban-console",
    column: "done",
    priority: "P1",
    assignee: "Claude",
    checks: { passing: 8, pending: 0, failing: 0 },
    agent: "Claude",
    updated: "May 3",
    comments: 4,
  },
];

export function getLocaleDirection(locale: KanbanConsoleLocale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function getMessages(locale: KanbanConsoleLocale) {
  return kanbanConsoleMessages[locale];
}

export function getTasksByColumn(tasks: KanbanTaskMock[] = kanbanTasks) {
  return kanbanColumns.map((column) => ({
    id: column.id,
    labelKey: column.labelKey,
    tasks: tasks.filter((task) => task.column === column.id),
  }));
}

export function moveTaskToColumn(
  tasks: KanbanTaskMock[],
  taskId: string,
  nextColumn: KanbanColumnId,
): KanbanTaskMock[] {
  return tasks.map((task) => (task.id === taskId ? { ...task, column: nextColumn } : task));
}

export function getTaskTitle(task: KanbanTaskMock, locale: KanbanConsoleLocale): string {
  return locale === "ar" ? task.titleAr : task.title;
}
