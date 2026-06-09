// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutomationEvolutionProposal } from "@open-design/contracts";

import { TasksView } from "../../src/components/TasksView";
import { I18nProvider } from "../../src/i18n";

const originalFetch = globalThis.fetch;

const memoryProposal: AutomationEvolutionProposal = {
  id: "proposal-memory-1",
  title: "Project memory from connector digest",
  summary: "Preserve a durable project decision found by an automation.",
  targetKind: "memory-node",
  action: "create",
  status: "pending-review",
  reviewPolicy: "always",
  createdAt: "2026-05-18T00:00:00.000Z",
  updatedAt: "2026-05-18T00:00:00.000Z",
  sourcePacketIds: ["packet-1"],
  patch: {
    format: "markdown",
    after: "- Decision: keep design-system extraction behind review.",
    diffSummary: "Adds one project memory node."
  }
};

describe("TasksView automation templates", () => {
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("shows video workflow templates and seeds the create modal", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/routines" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url === "/api/projects" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url === "/api/plugins" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ plugins: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url === "/api/mcp/servers" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ servers: [], templates: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    render(<TasksView />);

    expect(await screen.findByRole("heading", { name: "Automations" })).toBeTruthy();
    const templateCard = await screen.findByRole("button", { name: /Category video crawler/i });
    fireEvent.click(templateCard);

    await waitFor(() => {
      expect((screen.getByLabelText("Automation title") as HTMLInputElement).value).toBe("Category video crawler");
    });
    const prompt = screen.getByTestId("automation-modal-prompt") as HTMLTextAreaElement;
    expect(prompt.value).toContain("skill or DESIGN.md");
    fireEvent.click(screen.getByLabelText("Close (Esc)"));

    fireEvent.click(screen.getByRole("button", { name: /Crawl videos into asset library/i }));
    await waitFor(() => {
      expect((screen.getByLabelText("Automation title") as HTMLInputElement).value).toBe(
        "Crawl videos into asset library"
      );
    });
    const assetPrompt = screen.getByTestId("automation-modal-prompt") as HTMLTextAreaElement;
    expect(assetPrompt.value).toContain("od assets commerce-videos search");
    expect(assetPrompt.value).toContain("od assets commerce-videos import ");
    expect(assetPrompt.value).toContain("od assets commerce-videos import-crawler");
    expect(assetPrompt.value).toContain("od assets commerce-videos list");
    expect(screen.queryByText("Extract design system")).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => input.toString() === "/api/automation-templates")).toBe(false);
  });

  it("localizes video workflow cards in zh-CN and hides old templates", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/routines" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url === "/api/projects" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url === "/api/plugins" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ plugins: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url === "/api/mcp/servers" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ servers: [], templates: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    render(
      <I18nProvider initial="zh-CN">
        <TasksView
          designTemplates={[
            {
              id: "orbit-github",
              name: "orbit-github",
              description: "Create refreshable, auditable Open Design artifacts backed by connector or local data.",
              triggers: [],
              mode: "template",
              scenario: "orbit",
              source: "built-in",
              previewType: "html",
              designSystemRequired: false,
              defaultFor: [],
              upstream: null,
              hasBody: true,
              examplePrompt: "Run the template.",
              aggregatesExamples: false
            },
            {
              id: "Baby Health Live",
              name: "Baby Health Live",
              description: "Create refreshable, auditable Open Design artifacts backed by connector or local data.",
              triggers: [],
              mode: "template",
              scenario: "live",
              source: "built-in",
              previewType: "html",
              designSystemRequired: false,
              defaultFor: [],
              upstream: null,
              hasBody: true,
              examplePrompt: "Run the template.",
              aggregatesExamples: false
            }
          ]}
        />
      </I18nProvider>
    );

    expect(await screen.findByRole("heading", { name: "自动化" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /素材齐套巡检/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /类目带货视频探索/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /爬视频入素材库/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /带货脚本优化/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /生成失败诊断/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /爬虫.*2/ })).toBeTruthy();
    expect(screen.getByText("7 个中的 7 个")).toBeTruthy();
    expect(screen.queryByText("Extract design system")).toBeNull();
    expect(screen.queryByText("GitHub 活动晨报")).toBeNull();
    expect(screen.queryByText("Baby Health Live")).toBeNull();
  });
  it("shows pending evolution proposals and applies them through the review gate", async () => {
    let proposals = [memoryProposal];
    const applyCalls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/routines" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url === "/api/projects" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url === "/api/automation-templates" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ templates: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url === "/api/automation-proposals?status=pending-review" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ proposals }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url === "/api/automation-proposals/proposal-memory-1/apply" && init?.method === "POST") {
        applyCalls.push(url);
        proposals = [];
        return new Response(
          JSON.stringify({
            proposal: { ...memoryProposal, status: "applied" },
            result: { memoryId: "project_connector_decision" }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    render(<TasksView />);

    expect(await screen.findByText("Evolution proposals")).toBeTruthy();
    expect(screen.getByText("Project memory from connector digest")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Apply/i }));

    await waitFor(() => {
      expect(applyCalls).toEqual(["/api/automation-proposals/proposal-memory-1/apply"]);
      expect(screen.queryByText("Project memory from connector digest")).toBeNull();
    });
  });

  it("crystallizes a successful automation run into reviewable proposals", async () => {
    const crystallizeCalls: string[] = [];
    let proposals: AutomationEvolutionProposal[] = [];
    let packets = [] as Array<{
      id: string;
      sourceKind: string;
      title: string;
      capturedAt: string;
      tokenStats: { originalTokens: number };
    }>;
    const routine = {
      id: "routine-1",
      name: "Artifact polish loop",
      prompt: "Review generated artifacts and extract durable layout guidance.",
      schedule: { kind: "daily", time: "09:00", timezone: "UTC" },
      target: { mode: "create_each_run" },
      skillId: null,
      agentId: null,
      context: {},
      enabled: true,
      nextRunAt: null,
      lastRun: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const run = {
      id: "run-succeeded-1",
      routineId: "routine-1",
      trigger: "manual",
      status: "succeeded",
      projectId: "proj-1",
      conversationId: "conv-1",
      agentRunId: "agent-run-1",
      startedAt: Date.now() - 1_000,
      completedAt: Date.now(),
      summary: "Promote compact controls and repeatable QA steps.",
      error: null
    };

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/routines" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines: [routine] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url === "/api/projects" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url === "/api/automation-templates" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ templates: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url === "/api/automation-proposals?status=pending-review" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ proposals }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url === "/api/automation-source-packets?limit=3" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ packets }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url === "/api/routines/routine-1/runs?limit=10" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ runs: [run] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url === "/api/routines/routine-1/runs/run-succeeded-1/crystallize" && init?.method === "POST") {
        crystallizeCalls.push(url);
        const packet = {
          id: "packet-run-1",
          sourceKind: "chat",
          sourceRef: "routine-run:run-succeeded-1",
          title: "Artifact polish loop run",
          capturedAt: "2026-05-18T00:00:00.000Z",
          bodyMarkdown: "Promote compact controls and repeatable QA steps.",
          provenance: [],
          attachments: [],
          sensitivity: "workspace",
          capabilityHints: [],
          tokenStats: { originalTokens: 12 },
          candidateSinks: ["skill", "memory"]
        };
        proposals = [
          {
            ...memoryProposal,
            id: "proposal-skill-1",
            title: "Skill: Artifact polish loop run",
            targetKind: "skill",
            sourcePacketIds: ["packet-run-1"]
          }
        ];
        packets = [packet];
        return new Response(
          JSON.stringify({
            routineId: "routine-1",
            runId: "run-succeeded-1",
            packet,
            compressionReport: {
              mode: "balanced",
              status: "skipped",
              beforeTokens: 12,
              afterTokens: 12,
              summary: "Already compact",
              preservedSourcePacketId: "packet-run-1"
            },
            proposals
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    render(<TasksView />);

    fireEvent.click(await screen.findByRole("button", { name: /History/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Crystallize/i }));

    await waitFor(() => {
      expect(crystallizeCalls).toEqual(["/api/routines/routine-1/runs/run-succeeded-1/crystallize"]);
      expect(screen.getByText("Skill: Artifact polish loop run")).toBeTruthy();
    });
  });
});
