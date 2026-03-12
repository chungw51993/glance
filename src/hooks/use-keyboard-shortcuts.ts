import { useEffect, useCallback, useRef } from "react";

export interface KeyboardShortcutCallbacks {
  nextCommit: () => void;
  prevCommit: () => void;
  toggleFullPrDiff: () => void;
  toggleSidebar: () => void;
  toggleAiPanel: () => void;
  scrollToNextFile: () => void;
  scrollToPrevFile: () => void;
  runAiReview: () => void;
  openSubmitDialog: () => void;
  toggleShortcutsOverlay: () => void;
  closeOverlay: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

function getFileElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-file-path]"));
}

function findCurrentFileIndex(files: HTMLElement[]): number {
  const scrollContainer = files[0]?.closest(".overflow-auto");
  if (!scrollContainer) return -1;
  const containerTop = scrollContainer.getBoundingClientRect().top;

  for (let i = files.length - 1; i >= 0; i--) {
    const rect = files[i].getBoundingClientRect();
    if (rect.top <= containerTop + 60) return i;
  }
  return -1;
}

export function useKeyboardShortcuts(callbacks: KeyboardShortcutCallbacks) {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const cb = callbacksRef.current;
    const metaOrCtrl = e.metaKey || e.ctrlKey;

    // Cmd/Ctrl+Enter always works, even in text fields
    if (metaOrCtrl && e.key === "Enter") {
      e.preventDefault();
      cb.openSubmitDialog();
      return;
    }

    // Escape always works
    if (e.key === "Escape") {
      cb.closeOverlay();
      return;
    }

    // Don't handle other shortcuts when typing in inputs
    if (isEditableTarget(e.target)) return;

    // Don't handle shortcuts with modifier keys (except ? which needs Shift)
    if (metaOrCtrl || e.altKey) return;

    switch (e.key) {
      case "j":
        e.preventDefault();
        cb.nextCommit();
        break;
      case "k":
        e.preventDefault();
        cb.prevCommit();
        break;
      case "f":
        e.preventDefault();
        cb.toggleFullPrDiff();
        break;
      case "[":
        e.preventDefault();
        cb.toggleSidebar();
        break;
      case "]":
        e.preventDefault();
        cb.toggleAiPanel();
        break;
      case "n": {
        e.preventDefault();
        const files = getFileElements();
        if (files.length === 0) break;
        const current = findCurrentFileIndex(files);
        const next = Math.min(current + 1, files.length - 1);
        files[next].scrollIntoView({ behavior: "smooth", block: "start" });
        break;
      }
      case "p": {
        e.preventDefault();
        const files = getFileElements();
        if (files.length === 0) break;
        const current = findCurrentFileIndex(files);
        const prev = Math.max(current - 1, 0);
        files[prev].scrollIntoView({ behavior: "smooth", block: "start" });
        break;
      }
      case "r":
        e.preventDefault();
        cb.runAiReview();
        break;
      case "?":
        e.preventDefault();
        cb.toggleShortcutsOverlay();
        break;
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
