import { describe, expect, it } from "vitest";
import { getLangFromPath } from "./use-highlighter";

describe("getLangFromPath", () => {
  it("maps common extensions", () => {
    expect(getLangFromPath("src/index.ts")).toBe("typescript");
    expect(getLangFromPath("src/App.tsx")).toBe("tsx");
    expect(getLangFromPath("script.js")).toBe("javascript");
    expect(getLangFromPath("data.json")).toBe("json");
    expect(getLangFromPath("styles.css")).toBe("css");
    expect(getLangFromPath("main.py")).toBe("python");
    expect(getLangFromPath("main.rs")).toBe("rust");
    expect(getLangFromPath("main.go")).toBe("go");
  });

  it("handles special filenames", () => {
    expect(getLangFromPath("Dockerfile")).toBe("dockerfile");
    expect(getLangFromPath("path/to/Makefile")).toBe("makefile");
    expect(getLangFromPath("CMakeLists.txt")).toBe("cmake");
  });

  it("is case-insensitive for filenames", () => {
    expect(getLangFromPath("DOCKERFILE")).toBe("dockerfile");
  });

  it("returns null for unknown extensions", () => {
    expect(getLangFromPath("file.unknown")).toBeNull();
    expect(getLangFromPath("file.xyz")).toBeNull();
  });

  it("returns null for files with no extension", () => {
    expect(getLangFromPath("README")).toBeNull();
  });
});
