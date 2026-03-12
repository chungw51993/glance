import { useState, useCallback, useEffect } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getVersion } from "@tauri-apps/api/app";

type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; update: Update }
  | { kind: "up-to-date" }
  | { kind: "downloading"; progress: number }
  | { kind: "ready" }
  | { kind: "error"; message: string };

export function UpdateSettings() {
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" });
  const [currentVersion, setCurrentVersion] = useState<string>("");

  useEffect(() => {
    getVersion().then(setCurrentVersion);
  }, []);

  const checkForUpdate = useCallback(async () => {
    setStatus({ kind: "checking" });
    try {
      const update = await check();
      if (update) {
        setStatus({ kind: "available", update });
      } else {
        setStatus({ kind: "up-to-date" });
      }
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const installUpdate = useCallback(async (update: Update) => {
    try {
      let contentLength = 0;
      let downloaded = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            setStatus({
              kind: "downloading",
              progress: contentLength > 0 ? (downloaded / contentLength) * 100 : 0,
            });
            break;
          case "Finished":
            setStatus({ kind: "ready" });
            break;
        }
      });

      setStatus({ kind: "ready" });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Updates</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Current version</p>
            <p className="text-sm text-muted-foreground">v{currentVersion}</p>
          </div>

          {status.kind === "idle" && (
            <Button variant="outline" size="sm" onClick={checkForUpdate}>
              Check for updates
            </Button>
          )}

          {status.kind === "checking" && (
            <Button variant="outline" size="sm" disabled>
              Checking...
            </Button>
          )}

          {status.kind === "up-to-date" && (
            <Button variant="outline" size="sm" onClick={checkForUpdate}>
              Up to date
            </Button>
          )}

          {status.kind === "error" && (
            <Button variant="outline" size="sm" onClick={checkForUpdate}>
              Retry
            </Button>
          )}
        </div>

        {status.kind === "available" && (
          <div className="rounded-md border p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">
                  v{status.update.version} available
                </p>
                {status.update.body && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-3">
                    {status.update.body}
                  </p>
                )}
              </div>
              <Button size="sm" onClick={() => installUpdate(status.update)}>
                Install & restart
              </Button>
            </div>
          </div>
        )}

        {status.kind === "downloading" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Downloading update...</span>
              <span>{Math.round(status.progress)}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-200"
                style={{ width: `${status.progress}%` }}
              />
            </div>
          </div>
        )}

        {status.kind === "ready" && (
          <div className="rounded-md border p-3 flex items-center justify-between">
            <p className="text-sm font-medium">Update installed</p>
            <Button size="sm" onClick={() => relaunch()}>
              Restart now
            </Button>
          </div>
        )}

        {status.kind === "error" && (
          <p className="text-xs text-destructive">{status.message}</p>
        )}
      </CardContent>
    </Card>
  );
}
