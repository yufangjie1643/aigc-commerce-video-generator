// @vitest-environment jsdom

import { act } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeView } from "../../src/components/HomeView";
import { createPluginUseHandoff } from "../../src/components/home-hero/plugin-authoring";
import { setHomeHeroPrompt } from "../helpers/home-hero-lexical";

const MEDIA_PLUGIN = {
  id: "od-media-generation",
  title: "Media generation",
  version: "0.1.0",
  trust: "bundled" as const,
  sourceKind: "bundled" as const,
  source: "/tmp/media-generation",
  capabilitiesGranted: ["prompt:inject"],
  fsPath: "/tmp/media-generation",
  installedAt: 0,
  updatedAt: 0,
  manifest: {
    name: "od-media-generation",
    title: "Media generation",
    version: "0.1.0",
    description: "Generate image, video, and audio assets",
    tags: ["video", "product-promo", "ecommerce"],
    od: {
      kind: "scenario",
      taskKind: "media-generation",
      mode: "video",
      useCase: {
        query: "Create a {{mediaKind}} for {{subject}} in {{aspect}}."
      },
      inputs: [
        {
          name: "mediaKind",
          type: "string",
          required: true,
          default: "video",
          label: "Media kind"
        },
        {
          name: "subject",
          type: "string",
          required: true,
          default: "a conversion-focused ecommerce product video",
          label: "Subject"
        },
        {
          name: "aspect",
          type: "string",
          required: false,
          default: "9:16",
          label: "Aspect"
        }
      ]
    }
  }
};

const NEW_GENERATION_PLUGIN = {
  ...MEDIA_PLUGIN,
  id: "od-new-generation",
  title: "New generation",
  source: "/tmp/new-generation",
  fsPath: "/tmp/new-generation",
  manifest: {
    ...MEDIA_PLUGIN.manifest,
    name: "od-new-generation",
    title: "New generation",
    description: "Run a prompt-driven workbench task",
    tags: ["workflow"],
    od: {
      ...MEDIA_PLUGIN.manifest.od,
      taskKind: "new-generation",
      mode: "other",
      useCase: {
        query: "{{prompt}}"
      },
      inputs: []
    }
  }
};

const HIDDEN_DEFAULT_PLUGIN = {
  ...MEDIA_PLUGIN,
  id: "od-default",
  title: "Default design router",
  source: "/tmp/default-router",
  fsPath: "/tmp/default-router",
  manifest: {
    ...MEDIA_PLUGIN.manifest,
    name: "od-default",
    title: "Default design router",
    od: {
      ...MEDIA_PLUGIN.manifest.od,
      hidden: true
    }
  }
};

const REQUIRED_INPUT_PLUGIN = {
  ...MEDIA_PLUGIN,
  id: "od-required-input",
  title: "Required input plugin",
  source: "/tmp/required-input",
  fsPath: "/tmp/required-input",
  manifest: {
    ...MEDIA_PLUGIN.manifest,
    name: "od-required-input",
    title: "Required input plugin",
    od: {
      ...MEDIA_PLUGIN.manifest.od,
      useCase: {
        query: "Run with {{audience}}"
      },
      inputs: [
        {
          name: "audience",
          type: "string",
          required: true,
          default: "",
          label: "Audience"
        }
      ]
    }
  }
};

const MEDIA_APPLY_RESULT = {
  query: MEDIA_PLUGIN.manifest.od.useCase.query,
  contextItems: [],
  inputs: MEDIA_PLUGIN.manifest.od.inputs,
  assets: [],
  mcpServers: [],
  trust: "trusted",
  capabilitiesGranted: ["prompt:inject"],
  capabilitiesRequired: ["prompt:inject"],
  appliedPlugin: {
    snapshotId: "snap-media",
    pluginId: "od-media-generation",
    pluginVersion: "0.1.0",
    manifestSourceDigest: "a".repeat(64),
    inputs: {
      mediaKind: "video",
      subject: "a conversion-focused ecommerce product video",
      aspect: "9:16"
    },
    resolvedContext: { items: [] },
    capabilitiesGranted: ["prompt:inject"],
    capabilitiesRequired: ["prompt:inject"],
    assetsStaged: [],
    taskKind: "media-generation",
    appliedAt: 0,
    connectorsRequired: [],
    connectorsResolved: [],
    mcpServers: [],
    status: "fresh"
  },
  projectMetadata: {
    kind: "video"
  }
};

const NEW_GENERATION_APPLY_RESULT = {
  query: NEW_GENERATION_PLUGIN.manifest.od.useCase.query,
  contextItems: [],
  inputs: [],
  assets: [],
  mcpServers: [],
  trust: "trusted",
  capabilitiesGranted: ["prompt:inject"],
  capabilitiesRequired: ["prompt:inject"],
  appliedPlugin: {
    snapshotId: "snap-new-generation",
    pluginId: "od-new-generation",
    pluginVersion: "0.1.0",
    manifestSourceDigest: "b".repeat(64),
    inputs: {},
    resolvedContext: { items: [] },
    capabilitiesGranted: ["prompt:inject"],
    capabilitiesRequired: ["prompt:inject"],
    assetsStaged: [],
    taskKind: "new-generation",
    appliedAt: 0,
    connectorsRequired: [],
    connectorsResolved: [],
    mcpServers: [],
    status: "fresh"
  },
  projectMetadata: {
    kind: "video"
  }
};

function stubAnimationFrame() {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = window.setTimeout(() => cb(window.performance.now()), 0);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    window.clearTimeout(id);
  });
}

function mockPluginFetch(plugins = [HIDDEN_DEFAULT_PLUGIN, MEDIA_PLUGIN]) {
  const fetchMock = vi.fn<typeof fetch>(async (url) => {
    if (typeof url === "string" && url === "/api/plugins") {
      return new Response(JSON.stringify({ plugins }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (typeof url === "string" && url.includes("/api/plugins/od-media-generation/apply")) {
      return new Response(JSON.stringify(MEDIA_APPLY_RESULT), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (typeof url === "string" && url.includes("/api/plugins/od-new-generation/apply")) {
      return new Response(JSON.stringify(NEW_GENERATION_APPLY_RESULT), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("HomeView prompt handoff", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("routes design-mode free-form submits through the hidden default plugin without applying a visible chip", async () => {
    mockPluginFetch();
    const onSubmit = vi.fn();

    render(
      <HomeView projects={[]} onSubmit={onSubmit} onOpenProject={() => undefined} onViewAllProjects={() => undefined} />
    );

    await screen.findByTestId("home-hero-input");
    selectDesignMode();
    await setPromptAndSettle("Create a launch video plan for a portable blender");
    fireEvent.click(screen.getByTestId("home-hero-submit"));

    expect(screen.queryByTestId("home-hero-active-plugin")).toBeNull();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Create a launch video plan for a portable blender",
        pluginId: "od-default",
        appliedPluginSnapshotId: null,
        pluginInputs: { prompt: "Create a launch video plan for a portable blender" },
        projectKind: "other"
      })
    );
  });

  it("binds the Home rail video-generation chip and applies it on submit", async () => {
    const fetchMock = mockPluginFetch([NEW_GENERATION_PLUGIN]);
    stubAnimationFrame();
    const onSubmit = vi.fn();

    render(
      <HomeView projects={[]} onSubmit={onSubmit} onOpenProject={() => undefined} onViewAllProjects={() => undefined} />
    );

    fireEvent.click(await screen.findByTestId("home-hero-rail-video-generation"));
    await waitFor(() => {
      expect(screen.getByTestId("home-hero-active-type-chip").textContent).toContain("视频生成");
    });
    selectDesignMode();
    await setPromptAndSettle("Generate a <=15s product-selling video for a portable blender with preview/export.");
    fireEvent.click(screen.getByTestId("home-hero-submit"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/plugins/od-new-generation/apply", expect.anything())
    );
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "Generate a <=15s product-selling video for a portable blender with preview/export.",
          pluginId: "od-new-generation",
          appliedPluginSnapshotId: "snap-new-generation",
          projectKind: "video",
          projectMetadata: expect.objectContaining({ kind: "video" })
        })
      )
    );
  });

  it("opens the template creation surface from the shortcut menu", async () => {
    mockPluginFetch([MEDIA_PLUGIN]);
    const onOpenNewProject = vi.fn();

    render(
      <HomeView
        projects={[]}
        onSubmit={() => undefined}
        onOpenProject={() => undefined}
        onViewAllProjects={() => undefined}
        onOpenNewProject={onOpenNewProject}
      />
    );

    await clickHomeShortcut("template");

    expect(onOpenNewProject).toHaveBeenCalledWith("template");
  });

  it("routes a plugin-use handoff as the active driver and submits it as the run driver", async () => {
    const fetchMock = mockPluginFetch([MEDIA_PLUGIN]);
    stubAnimationFrame();
    const onSubmit = vi.fn();

    render(
      <HomeView
        projects={[]}
        onSubmit={onSubmit}
        onOpenProject={() => undefined}
        onViewAllProjects={() => undefined}
        promptHandoff={createPluginUseHandoff(1, "od-media-generation")}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("home-hero-active-plugin")).toBeTruthy();
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/plugins/od-media-generation/apply", expect.anything())
    );
    selectDesignMode();

    await setPromptAndSettle("Use the selected video workflow as the driver");
    await waitFor(() => {
      expect((screen.getByTestId("home-hero-submit") as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId("home-hero-submit"));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "Use the selected video workflow as the driver",
          pluginId: "od-media-generation",
          appliedPluginSnapshotId: "snap-media",
          projectKind: "other"
        })
      )
    );
  });

  it("keeps comprehensive submits enabled when the active plugin has missing inputs", async () => {
    mockPluginFetch([REQUIRED_INPUT_PLUGIN]);
    const onSubmit = vi.fn();

    render(
      <HomeView
        projects={[]}
        onSubmit={onSubmit}
        onOpenProject={() => undefined}
        onViewAllProjects={() => undefined}
        promptHandoff={createPluginUseHandoff(1, "od-required-input")}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("home-hero-active-plugin").textContent).toContain("Required input plugin");
    });
    await setPromptAndSettle("把这几个视频加入带货视频素材库，并提取方法论，加入技能组");

    await waitFor(() => {
      expect((screen.getByTestId("home-hero-submit") as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId("home-hero-submit"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "把这几个视频加入带货视频素材库，并提取方法论，加入技能组",
        conversationMode: "comprehensive",
        pluginId: null,
        appliedPluginSnapshotId: null,
        pluginInputs: { prompt: "把这几个视频加入带货视频素材库，并提取方法论，加入技能组" }
      })
    );
  });

  it("locks the submit button while a comprehensive submit is still creating the project", async () => {
    let resolveSubmit!: () => void;
    const pendingSubmit = new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    });
    const onSubmit = vi.fn(() => pendingSubmit);

    render(
      <HomeView projects={[]} onSubmit={onSubmit} onOpenProject={() => undefined} onViewAllProjects={() => undefined} />
    );

    await setPromptAndSettle("把这几个视频加入带货视频素材库，并提取方法论，加入技能组");
    const submitButton = screen.getByTestId("home-hero-submit") as HTMLButtonElement;

    await waitFor(() => expect(submitButton.disabled).toBe(false));
    fireEvent.click(submitButton);

    await waitFor(() => expect(submitButton.disabled).toBe(true));
    fireEvent.click(submitButton);

    expect(onSubmit).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSubmit();
      await pendingSubmit;
    });
    await waitFor(() => expect(submitButton.disabled).toBe(false));
  });
});

async function clickHomeShortcut(id: string) {
  const trigger = await screen.findByTestId("home-hero-shortcuts-trigger");
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByTestId(`home-hero-rail-${id}`));
}

function selectDesignMode() {
  fireEvent.click(screen.getByTestId("session-mode-trigger"));
  fireEvent.click(screen.getByRole("menuitemradio", { name: /Design Agent mode/i }));
}

async function setPromptAndSettle(value: string): Promise<void> {
  setHomeHeroPrompt(value);
  await act(async () => {
    await Promise.resolve();
  });
}
