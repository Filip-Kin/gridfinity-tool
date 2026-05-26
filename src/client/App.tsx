import { useStore } from "./lib/store";
import { Scene } from "./components/Scene";
import { Sidebar } from "./components/Sidebar";

export default function App() {
  const lastError = useStore((s) => s.lastError);
  const clearError = useStore((s) => s.clearError);
  return (
    <div className="app">
      <Sidebar />
      <div className="canvas-wrap">
        <Scene />
        {lastError && (
          <div className="error-banner" onClick={clearError} title="click to dismiss">
            {lastError}
          </div>
        )}
      </div>
    </div>
  );
}
