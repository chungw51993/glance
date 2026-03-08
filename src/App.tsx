import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { Toaster } from "@/components/ui/sonner";

const ReposPage = lazy(() => import("@/pages/repos").then(m => ({ default: m.ReposPage })));
const AssignedPage = lazy(() => import("@/pages/assigned").then(m => ({ default: m.AssignedPage })));
const ReviewPage = lazy(() => import("@/pages/review").then(m => ({ default: m.ReviewPage })));
const SettingsPage = lazy(() => import("@/pages/settings").then(m => ({ default: m.SettingsPage })));

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Loading...</div>}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<ReposPage />} />
            <Route path="/assigned" element={<AssignedPage />} />
            <Route
              path="/review/:owner/:name/:prNumber"
              element={<ReviewPage />}
            />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </Suspense>
      <Toaster />
    </BrowserRouter>
  );
}

export default App;
