import type { Capacity, Metrics, Project, RetroAction, Sprint, SprintTodo, Task, User, UserDetailData, VelocityRow } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // El content-type sólo se manda si hay cuerpo. Un DELETE sin cuerpo pero con
  // 'application/json' hace que Fastify lo rechace con "Body cannot be empty".
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body == null ? {} : { 'Content-Type': 'application/json' }),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body?.error ?? `Error ${res.status}`;
    const detail = body?.issues?.map((i: any) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(detail ? `${msg} (${detail})` : msg);
  }
  return body as T;
}

const get = <T>(p: string) => request<T>(p);
const post = <T>(p: string, body: unknown) =>
  request<T>(p, { method: 'POST', body: JSON.stringify(body) });
const put = <T>(p: string, body: unknown) =>
  request<T>(p, { method: 'PUT', body: JSON.stringify(body) });
const del = (p: string) => request<void>(p, { method: 'DELETE' });

export const api = {
  users: {
    list: () => get<User[]>('/api/users'),
    create: (b: Partial<User>) => post<User>('/api/users', b),
    update: (id: string, b: Partial<User>) => put<User>(`/api/users/${id}`, b),
    remove: (id: string) => del(`/api/users/${id}`),
  },
  projects: {
    list: () => get<Project[]>('/api/projects'),
    create: (b: Partial<Project>) => post<Project>('/api/projects', b),
    update: (id: string, b: Partial<Project>) => put<Project>(`/api/projects/${id}`, b),
    remove: (id: string) => del(`/api/projects/${id}`),
  },
  sprints: {
    list: () => get<Sprint[]>('/api/sprints'),
    get: (id: string) => get<Sprint>(`/api/sprints/${id}`),
    create: (b: Partial<Sprint>) => post<Sprint>('/api/sprints', b),
    update: (id: string, b: Partial<Sprint>) => put<Sprint>(`/api/sprints/${id}`, b),
    remove: (id: string) => del(`/api/sprints/${id}`),
    tasks: (id: string) => get<Task[]>(`/api/sprints/${id}/tasks`),
    metrics: (id: string) => get<Metrics>(`/api/sprints/${id}/metrics`),
    report: (id: string) => get<any>(`/api/sprints/${id}/report`),
    carryOver: (id: string, from: string) =>
      post<Task[]>(`/api/sprints/${id}/carry-over`, { from_sprint_id: from }),
    capacities: (id: string) => get<Capacity[]>(`/api/sprints/${id}/capacities`),
    userDetail: (id: string, userId: string) =>
      get<UserDetailData>(`/api/sprints/${id}/users/${userId}`),
    saveCapacities: (id: string, capacities: { user_id: string; capacity_hours: number | null }[]) =>
      put<Capacity[]>(`/api/sprints/${id}/capacities`, { capacities }),
    copyCapacities: (id: string, from: string) =>
      post<Capacity[]>(`/api/sprints/${id}/capacities/copy`, { from_sprint_id: from }),
    importTickets: (id: string, body: { dry_run: boolean; rows: any[]; apply_blocked?: boolean; apply_track?: boolean; apply_type?: boolean; apply_status?: boolean; create_missing?: boolean; estimate_overrides?: Record<string, number> }) =>
      post<any>(`/api/sprints/${id}/import/tickets`, body),
    importWorklogs: (
      id: string,
      body: {
        dry_run: boolean;
        rows: {
          issue_key: string;
          parent_key: string | null;
          issue_summary: string | null;
          original_estimate: number | null;
          remaining_estimate: number | null;
          author: string;
          date: string;
          hours: number;
          comment: string | null;
          external_id: string | null;
          source_ts: string | null;
        }[];
        user_map: Record<string, string>;
        fill_titles?: boolean;
        fill_estimates?: boolean;
        sync_remaining?: boolean;
      }
    ) => post<any>(`/api/sprints/${id}/import/worklogs`, body),
  },
  tasks: {
    create: (b: any) => post<Task>('/api/tasks', b),
    update: (uid: string, b: any) => put<Task>(`/api/tasks/${uid}`, b),
    remove: (uid: string) => del(`/api/tasks/${uid}`),
  },
  velocity: () => get<VelocityRow[]>('/api/metrics/velocity'),
  statusMap: {
    list: () => get<{ jira_status: string; app_status: string }[]>('/api/status-mappings'),
    save: (mappings: { jira_status: string; app_status: string }[]) =>
      put<{ jira_status: string; app_status: string }[]>('/api/status-mappings', { mappings }),
  },
  projectMap: {
    list: () => get<{ jira_project: string; project_id: string }[]>('/api/project-mappings'),
    save: (mappings: { jira_project: string; project_id: string }[]) =>
      put<{ jira_project: string; project_id: string }[]>('/api/project-mappings', { mappings }),
  },
  todos: {
    forSprint: (id: string) =>
      get<{ own: SprintTodo[]; pendingElsewhere: SprintTodo[] }>(`/api/sprints/${id}/todos`),
    create: (id: string, b: Partial<SprintTodo>) => post<SprintTodo>(`/api/sprints/${id}/todos`, b),
    update: (todoId: string, b: Partial<SprintTodo>) => put<SprintTodo>(`/api/todos/${todoId}`, b),
    remove: (todoId: string) => del(`/api/todos/${todoId}`),
  },
  retro: {
    forSprint: (id: string) =>
      get<{ own: RetroAction[]; carriedOver: RetroAction[] }>(`/api/sprints/${id}/retro`),
    create: (id: string, b: Partial<RetroAction>) =>
      post<RetroAction>(`/api/sprints/${id}/retro`, b),
    update: (actionId: string, b: Partial<RetroAction>) =>
      put<RetroAction>(`/api/retro/${actionId}`, b),
    remove: (actionId: string) => del(`/api/retro/${actionId}`),
  },
};
