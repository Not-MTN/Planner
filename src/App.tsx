import type { PlannerState } from './types';
import { PlannerProvider } from './context';
import { Shell } from './components/Shell';

export function App({ initialState }: { initialState?: PlannerState | null }) {
  return (
    <PlannerProvider initialState={initialState}>
      <Shell />
    </PlannerProvider>
  );
}
