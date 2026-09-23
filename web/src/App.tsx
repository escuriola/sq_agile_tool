import { NavLink, Route, Routes } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';
import SprintsPage from './pages/SprintsPage';
import SprintDetailPage from './pages/SprintDetailPage';
import ProjectsPage from './pages/ProjectsPage';
import UsersPage from './pages/UsersPage';
import { cx } from './components/ui';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/sprints', label: 'Sprints' },
  { to: '/projects', label: 'Projects' },
  { to: '/users', label: 'Users' },
];

export default function App() {
  return (
    <div className="min-h-full">
      <nav className="sticky top-0 z-40 border-b border-[var(--color-ink-800)] bg-[var(--color-ink-950)]/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-1 px-4 py-2.5">
          <span className="mr-4 text-sm font-semibold tracking-tight text-slate-100">
            <span className="text-sky-400">◆</span> Sprint Board
          </span>
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cx(
                  'rounded-md px-3 py-1.5 text-sm transition',
                  isActive
                    ? 'bg-[var(--color-ink-800)] text-slate-100'
                    : 'text-slate-500 hover:text-slate-200'
                )
              }
            >
              {n.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <main className="px-4 py-6">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/sprints" element={<SprintsPage />} />
          <Route path="/sprints/:id" element={<SprintDetailPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/users" element={<UsersPage />} />
        </Routes>
      </main>
    </div>
  );
}
