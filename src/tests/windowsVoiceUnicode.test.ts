import { describe, expect, it } from "vitest";
import workflow from "../../.github/workflows/voice-windows.yml?raw";
import builder from "../../scripts/build_whisper_cli_windows.cmd?raw";
import patch from "../../scripts/patches/whisper-cli-win-utf8-argv.patch?raw";

describe("Windows voice paths", () => {
  it("converts wide CLI arguments into UTF-8 at the pinned whisper.cpp build boundary", () => {
    expect(builder).toContain("git -C \"%WORK%\" apply");
    expect(builder).toContain("whisper-cli-win-utf8-argv.patch");
    expect(patch).toContain("int wmain(int argc, wchar_t ** wide_argv)");
    expect(patch).toContain("WideCharToMultiByte(CP_UTF8");
  });

  it("transcribes the real model through a non-ASCII model directory in CI", () => {
    expect(workflow).toContain("Prove Unicode paths with the published model");
    expect(workflow).toContain("João Çãõ Silva");
    expect(workflow).toContain("--model $unicodeModel");
    expect(workflow).toContain("--file build/whisper-cpp/samples/jfk.wav");
  });
});
