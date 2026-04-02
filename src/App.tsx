import { AppShell } from "./components/tunaflow/AppShell";
import { ErrorBoundary } from "./components/tunaflow/ErrorBoundary";

export default function App() {
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  );
}
