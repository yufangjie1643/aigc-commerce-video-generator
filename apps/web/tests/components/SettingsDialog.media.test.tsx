// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "../../src/components/SettingsDialog";
import { DEFAULT_CONFIG } from "../../src/state/config";
import type { AgentInfo, AppConfig } from "../../src/types";

describe("SettingsDialog media providers", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows saved masked media provider keys like Composio does", () => {
    renderDialog({
      ...DEFAULT_CONFIG,
      mediaProviders: {
        minimax: {
          apiKey: "",
          apiKeyConfigured: true,
          apiKeyTail: "1234",
          baseUrl: ""
        }
      }
    });

    expect(screen.getByText("Saved · ••••1234")).toBeTruthy();
    expect(screen.getByLabelText("MiniMax API key").getAttribute("placeholder")).toBe(
      "Paste a new key to replace the saved one"
    );
  });

  it("shows only configured callable models in the workflow capability cards", () => {
    renderDialog({
      ...DEFAULT_CONFIG,
      mediaProviders: {
        minimax: {
          apiKey: "",
          apiKeyConfigured: true,
          apiKeyTail: "1234",
          baseUrl: ""
        },
        volcengine: {
          apiKey: "",
          apiKeyConfigured: true,
          apiKeyTail: "5678",
          baseUrl: ""
        }
      }
    });

    const workflowHead = screen
      .getByText("Video workstation API capabilities")
      .closest(".media-provider-workflow-head") as HTMLElement | null;
    const workflow = workflowHead?.nextElementSibling as HTMLElement | null;
    if (!workflow) throw new Error("Expected media provider workflow grid");

    expect(within(workflow).getByText("doubao-seedance-1.5-pro")).toBeTruthy();
    expect(within(workflow).getByText("image-01")).toBeTruthy();
    expect(within(workflow).getByText("image-01-live")).toBeTruthy();
    expect(within(workflow).getByText("speech-2.8-hd")).toBeTruthy();
    expect(within(workflow).getByText("speech-2.8-turbo")).toBeTruthy();
    expect(within(workflow).queryByText("AIHubMix")).toBeNull();
    expect(within(workflow).queryByText("OpenRouter")).toBeNull();
    expect(within(workflow).queryByText("Fal.ai")).toBeNull();
  });

  it("shows daemon fallback notice and reloads media providers from daemon", async () => {
    const reloadMock = vi.fn(async () => ({
      minimax: {
        apiKey: "",
        apiKeyConfigured: true,
        apiKeyTail: "9876",
        baseUrl: "https://daemon.example/v1"
      }
    }));
    renderDialog(
      {
        ...DEFAULT_CONFIG,
        mediaProviders: {}
      },
      {
        mediaProvidersNotice:
          "Could not load media provider settings from the local daemon. Using browser-saved settings for now.",
        onReloadMediaProviders: reloadMock
      }
    );

    expect(
      screen.getByText(
        "Could not load media provider settings from the local daemon. Using browser-saved settings for now."
      )
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reload from daemon" }));

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Saved · ••••9876")).toBeTruthy();
      expect(screen.getByText("Reloaded media provider settings from the local daemon.")).toBeTruthy();
    });

    expect((screen.getByLabelText("MiniMax Base URL") as HTMLInputElement).value).toBe("https://daemon.example/v1");
  });

  it("shows loading while reloading, then clears the success flash after a short delay", async () => {
    vi.useFakeTimers();
    const reloadMock = vi.fn(
      () =>
        new Promise<AppConfig["mediaProviders"]>((resolve) => {
          setTimeout(() => {
            resolve({
              minimax: {
                apiKey: "",
                apiKeyConfigured: true,
                apiKeyTail: "9876",
                baseUrl: "https://daemon.example/v1"
              }
            });
          }, 50);
        })
    );
    renderDialog(
      {
        ...DEFAULT_CONFIG,
        mediaProviders: {}
      },
      {
        mediaProvidersNotice:
          "Could not load media provider settings from the local daemon. Using browser-saved settings for now.",
        onReloadMediaProviders: reloadMock
      }
    );

    const reloadButton = screen.getByRole("button", { name: "Reload from daemon" });
    fireEvent.click(reloadButton);

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Loading…" }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(screen.getByText("Reloaded media provider settings from the local daemon.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reloaded" })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.queryByText("Reloaded media provider settings from the local daemon.")).toBeNull();
    expect(screen.getByRole("button", { name: "Reload from daemon" })).toBeTruthy();
  });

  it("shows a sticky error when reloading media providers from daemon fails", async () => {
    const reloadMock = vi.fn(async () => null);
    renderDialog(
      {
        ...DEFAULT_CONFIG,
        mediaProviders: {}
      },
      {
        mediaProvidersNotice:
          "Could not load media provider settings from the local daemon. Using browser-saved settings for now.",
        onReloadMediaProviders: reloadMock
      }
    );

    fireEvent.click(screen.getByRole("button", { name: "Reload from daemon" }));

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Could not reload media provider settings from the local daemon.")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Reload from daemon" })).toBeTruthy();
  });

  it("refreshes daemon-backed providers while keeping untouched local-only providers when daemon reload returns a partial provider set", async () => {
    const reloadMock = vi.fn(async () => ({
      minimax: {
        apiKey: "",
        apiKeyConfigured: true,
        apiKeyTail: "9876",
        baseUrl: "https://daemon.example/v1"
      }
    }));
    renderDialog(
      {
        ...DEFAULT_CONFIG,
        mediaProviders: {
          minimax: {
            apiKey: "sk-local-minimax",
            baseUrl: "https://local-minimax.example/v1"
          },
          volcengine: {
            apiKey: "ark-local",
            baseUrl: "https://local-volcengine.example/v1"
          }
        }
      },
      {
        mediaProvidersNotice:
          "Could not load media provider settings from the local daemon. Using browser-saved settings for now.",
        onReloadMediaProviders: reloadMock
      }
    );

    fireEvent.click(screen.getByRole("button", { name: "Reload from daemon" }));

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Reloaded media provider settings from the local daemon.")).toBeTruthy();
    });

    expect((screen.getByLabelText("MiniMax Base URL") as HTMLInputElement).value).toBe("https://daemon.example/v1");
    expect((screen.getByLabelText("MiniMax API key") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("Saved · ••••9876")).toBeTruthy();
    expect((screen.getByLabelText("Volcengine Ark (Doubao) Base URL") as HTMLInputElement).value).toBe(
      "https://local-volcengine.example/v1"
    );
  });

  it("preserves saved media keys when clearing only a non-secret field", async () => {
    const onPersist = vi.fn();
    renderDialog(
      {
        ...saveableConfig(),
        mediaProviders: {
          minimax: {
            apiKey: "",
            apiKeyConfigured: true,
            apiKeyTail: "1234",
            baseUrl: "https://custom.example/v1"
          }
        }
      },
      { onPersist }
    );

    fireEvent.change(screen.getByLabelText("MiniMax Base URL"), { target: { value: "" } });

    await waitFor(() => {
      expect(onPersist).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaProviders: {
            minimax: {
              apiKey: "",
              apiKeyConfigured: true,
              apiKeyTail: "1234",
              baseUrl: ""
            }
          }
        }),
        expect.objectContaining({ forceMediaProviderSync: true })
      );
    });
  });

  it("does not overwrite a local pending media-provider edit when daemon reload returns saved state", async () => {
    const reloadMock = vi.fn(async () => ({
      minimax: {
        apiKey: "",
        apiKeyConfigured: true,
        apiKeyTail: "9876",
        baseUrl: "https://daemon.example/v1"
      }
    }));
    renderDialog(
      {
        ...DEFAULT_CONFIG,
        mediaProviders: {
          minimax: {
            apiKey: "",
            apiKeyConfigured: true,
            apiKeyTail: "1234",
            baseUrl: "https://saved.example/v1"
          }
        }
      },
      {
        mediaProvidersNotice:
          "Could not load media provider settings from the local daemon. Using browser-saved settings for now.",
        onReloadMediaProviders: reloadMock
      }
    );

    fireEvent.change(screen.getByLabelText("MiniMax API key"), {
      target: { value: "sk-local-pending" }
    });
    fireEvent.change(screen.getByLabelText("MiniMax Base URL"), {
      target: { value: "https://local-pending.example/v1" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Reload from daemon" }));

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });
    expect((screen.getByLabelText("MiniMax API key") as HTMLInputElement).value).toBe("sk-local-pending");
    expect((screen.getByLabelText("MiniMax Base URL") as HTMLInputElement).value).toBe(
      "https://local-pending.example/v1"
    );
  });

  it("stops preserving a provider on reload after its media autosave succeeds", async () => {
    const reloadMock = vi.fn(async () => ({
      minimax: {
        apiKey: "",
        apiKeyConfigured: true,
        apiKeyTail: "9876",
        baseUrl: "https://daemon.example/v1"
      }
    }));
    const onPersist = vi.fn(async () => undefined);
    renderDialog(
      {
        ...saveableConfig(),
        mediaProviders: {
          minimax: {
            apiKey: "",
            apiKeyConfigured: true,
            apiKeyTail: "1234",
            baseUrl: "https://saved.example/v1"
          }
        }
      },
      {
        onPersist,
        onReloadMediaProviders: reloadMock
      }
    );

    fireEvent.change(screen.getByLabelText("MiniMax API key"), {
      target: { value: "sk-local-saved" }
    });
    fireEvent.change(screen.getByLabelText("MiniMax Base URL"), {
      target: { value: "https://local-saved.example/v1" }
    });

    await waitFor(() => {
      expect(onPersist).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaProviders: {
            minimax: {
              apiKey: "sk-local-saved",
              apiKeyConfigured: true,
              apiKeyTail: "1234",
              baseUrl: "https://local-saved.example/v1"
            }
          }
        }),
        expect.objectContaining({ forceMediaProviderSync: true })
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Reload from daemon" }));

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Reloaded media provider settings from the local daemon.")).toBeTruthy();
    });

    expect((screen.getByLabelText("MiniMax API key") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("MiniMax Base URL") as HTMLInputElement).value).toBe("https://daemon.example/v1");
    expect(screen.getByText("Saved · ••••9876")).toBeTruthy();
  });

  it("keeps newer pending provider edits during reload when an older media autosave resolves", async () => {
    vi.useFakeTimers();
    const reloadMock = vi.fn(async () => ({
      minimax: {
        apiKey: "",
        apiKeyConfigured: true,
        apiKeyTail: "9876",
        baseUrl: "https://daemon-minimax.example/v1"
      },
      volcengine: {
        apiKey: "",
        apiKeyConfigured: true,
        apiKeyTail: "4444",
        baseUrl: "https://daemon-volcengine.example/v1"
      }
    }));
    let resolveFirstPersist: (() => void) | null = null;
    const firstPersist = new Promise<void>((resolve) => {
      resolveFirstPersist = resolve;
    });
    const onPersist = vi
      .fn()
      .mockImplementationOnce(() => firstPersist)
      .mockImplementation(async () => undefined);
    renderDialog(
      {
        ...saveableConfig(),
        mediaProviders: {
          minimax: {
            apiKey: "",
            apiKeyConfigured: true,
            apiKeyTail: "1234",
            baseUrl: "https://saved-minimax.example/v1"
          },
          volcengine: {
            apiKey: "",
            apiKeyConfigured: true,
            apiKeyTail: "5555",
            baseUrl: "https://saved-volcengine.example/v1"
          }
        }
      },
      {
        onPersist,
        onReloadMediaProviders: reloadMock
      }
    );

    fireEvent.change(screen.getByLabelText("MiniMax API key"), {
      target: { value: "sk-minimax-first-save" }
    });
    fireEvent.change(screen.getByLabelText("MiniMax Base URL"), {
      target: { value: "https://local-minimax.example/v1" }
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(onPersist).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Volcengine Ark (Doubao) API key"), {
      target: { value: "ark-volcengine-pending" }
    });
    fireEvent.change(screen.getByLabelText("Volcengine Ark (Doubao) Base URL"), {
      target: { value: "https://local-volcengine.example/v1" }
    });

    await act(async () => {
      resolveFirstPersist?.();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reload from daemon" }));
      await Promise.resolve();
    });
    expect(reloadMock).toHaveBeenCalledTimes(1);

    expect((screen.getByLabelText("Volcengine Ark (Doubao) API key") as HTMLInputElement).value).toBe(
      "ark-volcengine-pending"
    );
    expect((screen.getByLabelText("Volcengine Ark (Doubao) Base URL") as HTMLInputElement).value).toBe(
      "https://local-volcengine.example/v1"
    );
  });

  it("clears saved media keys only through the explicit Clear action", async () => {
    const onPersist = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDialog(
      {
        ...saveableConfig(),
        mediaProviders: {
          minimax: {
            apiKey: "",
            apiKeyConfigured: true,
            apiKeyTail: "1234",
            baseUrl: "https://custom.example/v1"
          }
        }
      },
      { onPersist }
    );

    const minimaxRow = screen.getByLabelText("MiniMax API key").closest(".media-provider-row") as HTMLElement | null;
    if (!minimaxRow) throw new Error("Expected MiniMax media provider row");
    fireEvent.click(within(minimaxRow).getByRole("button", { name: "Clear" }));

    await waitFor(() => {
      expect(onPersist).toHaveBeenCalledWith(
        expect.objectContaining({ mediaProviders: {} }),
        expect.objectContaining({ forceMediaProviderSync: true })
      );
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it("renders workstation custom-model providers in media settings", () => {
    renderDialog({
      ...saveableConfig(),
      mediaProviders: {
        nanobanana: {
          apiKey: "",
          apiKeyConfigured: true,
          apiKeyTail: "5555",
          baseUrl: "https://gateway.example.com",
          model: "gemini-3.1-flash-image-preview"
        }
      }
    });

    expect(screen.getByLabelText("Nano Banana API key")).toBeTruthy();
    expect(screen.getByLabelText("Nano Banana Model")).toBeTruthy();
    expect(screen.getAllByText("Nano Banana").length).toBeGreaterThan(0);
  });
});

function renderDialog(
  initial: AppConfig,
  options?: {
    mediaProvidersNotice?: string | null;
    onReloadMediaProviders?: () => Promise<AppConfig["mediaProviders"] | null>;
    onPersist?: (cfg: AppConfig, options?: { forceMediaProviderSync?: boolean }) => void;
  }
) {
  return render(
    <SettingsDialog
      initial={initial}
      agents={SAVEABLE_AGENTS}
      daemonLive
      appVersionInfo={null}
      initialSection="media"
      onPersist={options?.onPersist ?? vi.fn()}
      onPersistComposioKey={vi.fn()}
      onClose={vi.fn()}
      onRefreshAgents={vi.fn()}
      mediaProvidersNotice={options?.mediaProvidersNotice}
      onReloadMediaProviders={options?.onReloadMediaProviders}
    />
  );
}

const SAVEABLE_AGENTS: AgentInfo[] = [
  {
    id: "codex",
    name: "Codex",
    bin: "codex",
    available: true
  }
];

function saveableConfig(): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    agentId: "codex"
  };
}
