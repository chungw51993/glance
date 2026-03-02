import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { AssignedPage } from "@/pages/assigned";
import { ReposPage } from "@/pages/repos";
import { ReviewPage } from "@/pages/review";
import { SettingsPage } from "@/pages/settings";
import { Toaster } from "@/components/ui/sonner";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<ReposPage />} />
          <Route path="/assigned" element={<AssignedPage />} />
          <Route path="/repo/:owner/:name" element={<ReposPage />} />
          <Route
            path="/review/:owner/:name/:prNumber"
            element={<ReviewPage />}
          />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}

export default App;
