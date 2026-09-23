export type User = {
  id: string;
  name: string;
  capacity_hours: number | null;
  active: boolean;
};

export type Project = { id: string; name: string; color: string | null };

/** A person's capacity for one specific sprint. */
export type Capacity = {
  user_id: string;
  name: string;
  active: boolean;
  /** The user's default value; only a suggestion. */
  default_hours: number | null;
  /** Value stored for this sprint (null = falls back to the default). */
  sprint_hours: number | null;
  /** The value the metrics actually use. */
  effective_hours: number;
  is_override: boolean;
  note: string | null;
};

export type SprintStatus = 'planned' | 'active' | 'closed';

export type Sprint = {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  goal: string | null;
  status: SprintStatus;
  /** Share of capacity reserved for discovery (0–1). Defaults to 1/3. */
  discovery_ratio: number;
  /** Confidence factor for sizing next sprint's commitment from this one. */
  commit_factor: number;
  task_count?: number;
};

export type TaskStatus =
  | 'todo'
  | 'in_progress'
  | 'peer_review'
  | 'ready_ephemeral'
  | 'ready_acc'
  | 'uat'
  | 'done';
export type TaskType = 'story' | 'bug' | 'tech' | 'support';
export type TaskTrack = 'delivery' | 'discovery';

export type Dedication = {
  id: string;
  task_uid: string;
  user_id: string;
  hours: number;
  date: string;
  note: string | null;
};

export type Task = {
  uid: string;
  key: string;
  sprint_id: string;
  project_id: string;
  title: string | null;
  type: TaskType;
  track: TaskTrack;
  status: TaskStatus;
  estimate_points: number | null;
  estimate_hours: number | null;
  assignee_id: string | null;
  comment: string | null;
  added_after_start: boolean;
  remaining_hours: number | null;
  /** Independent of status: a blocked task still sits at its point in the flow. */
  blocked: boolean;
  completed_at: string | null;
  logged_hours: number;
  dedications: Dedication[];
};

export type TrackRow = {
  track: TaskTrack;
  capacity: number | null;
  tasks: number;
  tasksDone: number;
  points: number;
  pointsDone: number;
  estimateHours: number;
  loggedHours: number;
  plannedLoad: number | null;
  remainingHours: number | null;
  shareOfLogged: number | null;
};

export type DeviationRow = {
  key: string;
  title: string | null;
  project_id: string;
  status: TaskStatus;
  assignee_id: string | null;
  estimate_hours: number;
  logged_hours: number;
  delta: number;
  ratio: number | null;
};

export type Metrics = {
  sprint: Sprint;
  totals: {
    tasks: number;
    tasksDone: number;
    completionRate: number;
    committedPoints: number;
    addedPoints: number;
    totalPoints: number;
    completedPoints: number;
    velocityRate: number;
    estimateHours: number;
    loggedHours: number;
    hoursDelta: number;
    estimateAccuracy: number | null;
    hoursPerPoint: number | null;
    scopeAddedTasks: number;
    scopeChangeRate: number;
    spilloverTasks: number;
    spilloverPoints: number;
    blockedTasks: number;
    unestimatedTasks: number;
    unassignedTasks: number;
    tasksWithRemaining: number;
    remainingHours: number | null;
    progressPct: number | null;
    readyToCloseCount: number;
    atRiskCount: number;
    stalledCount: number;
    tasksWithJira: number;
    carriedOverCount: number;
    impedimentCount: number;
    jiraLifetimeHours: number | null;
    peopleInvolved: number;
    teamCapacity: number | null;
    plannedLoad: number | null;
    teamUtilization: number | null;
    discoveryRatio: number;
    deliveryCapacity: number | null;
    discoveryCapacity: number | null;
    deliveryOverflow: number;
    discoveryLeftover: number | null;
    actualDiscoveryShare: number | null;
  };
  byTrack: TrackRow[];
  byStatus: { status: TaskStatus; tasks: number; points: number; hours: number }[];
  byType: { type: TaskType; tasks: number; points: number; hours: number; pctHours: number }[];
  byProject: {
    project_id: string;
    tasks: number;
    tasksDone: number;
    points: number;
    pointsDone: number;
    estimateHours: number;
    loggedHours: number;
  }[];
  byUser: {
    user_id: string;
    name: string;
    hours: number;
    capacity: number | null;
    utilization: number | null;
    distinctTasks: number;
    tasksAssigned: number;
    tasksDone: number;
    tasksInProgress: number;
    tasksBlocked: number;
    ownedEstimate: number;
    ownedLogged: number;
    ownDoneTasks: number;
    ownEstimateDone: number;
    ownLoggedDone: number;
    ownDelta: number;
    ownDeviationPct: number | null;
    ownHours: number;
    supportHours: number;
    supportPct: number | null;
    daysWorked: number;
    avgPerDay: number;
    maxDay: number;
    firstDay: string | null;
    lastDay: string | null;
    idleDays: number | null;
    topTaskKey: string | null;
    topTaskHours: number;
    focusPct: number | null;
    pointsDone: number;
  }[];
  doneByEstimate: {
    estimate: number; total: number; done: number; open: number;
    deliveredHours: number; pctDone: number;
  }[];
  velocity: {
    tasksDone: number; tasksTotal: number;
    committedEstimate: number; deliveredEstimate: number; deliveryRatio: number | null;
    avgEstimateDone: number | null; medianEstimateDone: number | null;
    estimateFactor: number | null; loggedOnDone: number;
  };
  forecast: {
    commitFactor: number;
    deliveryCapacity: number | null;
    utilisation: number | null;
    estimateFactor: number | null;
    byVelocity: number;
    byExpectedHours: number | null;
    capacityCeiling: number | null;
    recommended: number;
    equivalentTasks: number | null;
  };
  deviation: {
    tasksCompared: number;
    estimateDone: number;
    loggedDone: number;
    deltaDone: number;
    deviationPct: number | null;
    overrunHours: number;
    underrunHours: number;
    overrunTasks: number;
    underrunTasks: number;
    onTargetTasks: number;
    openOverrunHours: number;
    openOverrunTasks: number;
    worstOverrun: DeviationRow[];
    worstUnderrun: DeviationRow[];
    openOverrun: DeviationRow[];
  };
  heatmap: { user_id: string; name: string; project_id: string; hours: number }[];
  burndown: {
    date: string;
    weekend: boolean;
    idealHours: number;
    remainingEstimate: number | null;
    completedEstimate: number | null;
    tasksDone: number | null;
    ideal: number | null;
    remainingPoints: number | null;
    completedPoints: number | null;
    loggedHours: number | null;
    cumulativeHours: number | null;
    remainingHours: number | null;
  }[];
  daily: { date: string; hours: number }[];
  readyToClose: { key: string; title: string | null; project_id: string; status: TaskStatus; estimate_hours: number; logged_hours: number }[];
  atRisk: { key: string; title: string | null; project_id: string; estimate_hours: number; logged_hours: number; remaining_hours: number | null; consumed: number }[];
  stalled: { key: string; title: string | null; project_id: string; lastDate: string; idleDays: number; logged_hours: number }[];
  burn: { key: string; project_id: string; estimate_hours: number; logged_hours: number; remaining_hours: number | null; consumed: number }[];
  statusDivergence: { key: string; title: string | null; project_id: string; appStatus: TaskStatus; jiraStatus: string; resolved: string | null }[];
  carried: { key: string; title: string | null; project_id: string; sprints: number; estimate_hours: number; logged_hours: number }[];
  impediments: { key: string; title: string | null; project_id: string; flagged: boolean; blockedBy: string[] }[];
  oldest: { key: string; title: string | null; project_id: string; created: string; ageDays: number }[];
  byComponent: { key: string; tasks: number; estimate: number; hours: number }[];
  byPriority: { key: string; tasks: number; estimate: number; hours: number }[];
  byEpic: { key: string; tasks: number; estimate: number; hours: number }[];
  estimateOutliers: {
    key: string;
    title: string | null;
    project_id: string;
    estimate_hours: number;
    logged_hours: number;
    delta: number;
    ratio: number;
  }[];
};

export type VelocityRow = {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: SprintStatus;
  tasks: number;
  tasks_done: number;
  total_points: number;
  completed_points: number;
  estimate_hours: number;
  /** Horas estimadas de lo que se cerró: la velocidad de quien no usa puntos. */
  completed_estimate_hours: number;
  logged_hours: number;
};

/** The team's real flow, in order. Blocked is a separate flag, not a status. */
export const TASK_STATUSES: { value: TaskStatus; label: string; color: string }[] = [
  { value: 'todo', label: 'TO DO', color: '#64748b' },
  { value: 'in_progress', label: 'IN PROGRESS', color: '#38bdf8' },
  { value: 'peer_review', label: 'PEER REVIEW', color: '#fbbf24' },
  { value: 'ready_ephemeral', label: 'READY FOR EPHEMERAL', color: '#a78bfa' },
  { value: 'ready_acc', label: 'READY FOR ACC', color: '#f472b6' },
  { value: 'uat', label: 'UAT', color: '#22d3ee' },
  { value: 'done', label: 'DONE', color: '#34d399' },
];

export const BLOCKED_COLOR = '#f43f5e';

export const TASK_TYPES: { value: TaskType; label: string; color: string }[] = [
  { value: 'story', label: 'Story', color: '#38bdf8' },
  { value: 'bug', label: 'Bug', color: '#f43f5e' },
  { value: 'tech', label: 'Technical', color: '#a78bfa' },
  { value: 'support', label: 'Support', color: '#fbbf24' },
];

export const TASK_TRACKS: { value: TaskTrack; label: string; color: string }[] = [
  { value: 'delivery', label: 'Delivery', color: '#38bdf8' },
  { value: 'discovery', label: 'Discovery', color: '#c084fc' },
];

export const trackMeta = (t: string) =>
  TASK_TRACKS.find((x) => x.value === t) ?? { value: t, label: t, color: '#64748b' };

export const statusMeta = (s: string) =>
  TASK_STATUSES.find((x) => x.value === s) ?? { value: s, label: s, color: '#64748b' };
export const typeMeta = (t: string) =>
  TASK_TYPES.find((x) => x.value === t) ?? { value: t, label: t, color: '#64748b' };

export type RetroStatus = 'pending' | 'in_progress' | 'done' | 'dropped';

/** A SMART action coming out of a retrospective. */
export type RetroAction = {
  id: string;
  sprint_id: string;
  sprint_name: string;
  sprint_start: string | null;
  title: string;
  measurable: string | null;
  achievable: string | null;
  relevant: string | null;
  due_date: string | null;
  owner_id: string | null;
  owner_name: string | null;
  status: RetroStatus;
  outcome: string | null;
};

export const RETRO_STATUSES: { value: RetroStatus; label: string; color: string }[] = [
  { value: 'pending', label: 'Pending', color: '#64748b' },
  { value: 'in_progress', label: 'In progress', color: '#38bdf8' },
  { value: 'done', label: 'Done', color: '#34d399' },
  { value: 'dropped', label: 'Dropped', color: '#f43f5e' },
];

export const retroMeta = (s: string) =>
  RETRO_STATUSES.find((x) => x.value === s) ?? { value: s, label: s, color: '#64748b' };

/** Per-person detail within a sprint (drill-down from metrics). */
export type UserDetailData = {
  user: { id: string; name: string; capacity: number | null };
  totals: {
    hours: number; capacity: number | null; utilization: number | null;
    distinctTasks: number; daysWorked: number; avgPerDay: number; maxDay: number;
    entries: number; ownedTasks: number; ownedDone: number; hoursOnOthers: number;
  };
  daily: { date: string; hours: number | null; weekend: boolean; future: boolean }[];
  byProject: { key: string; hours: number; tasks: number }[];
  byType: { key: string; hours: number; tasks: number }[];
  byTrack: { key: string; hours: number; tasks: number }[];
  tasks: {
    key: string; title: string | null; project_id: string; status: TaskStatus; blocked: boolean;
    track: TaskTrack; type: TaskType; estimate_hours: number | null; remaining_hours: number | null;
    isOwner: boolean; myHours: number; taskHours: number; sharePct: number; people: number;
    firstDate: string; lastDate: string;
  }[];
  entries: { date: string; task_key: string; hours: number; note: string | null }[];
};

/** The Scrum Master's own management to-do. Not team work. */
export type SprintTodo = {
  id: string;
  sprint_id: string;
  sprint_name: string;
  title: string;
  notes: string | null;
  done: boolean;
  due_date: string | null;
  position: number;
  done_at: string | null;
};
