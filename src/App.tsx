import { PlannerProvider } from './context';
import { Shell } from './components/Shell';

export function App() {
  return (
    <PlannerProvider>
      <Shell />
    </PlannerProvider>
  );
}
