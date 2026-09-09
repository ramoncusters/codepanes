import {
  BoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import type { Theme } from "../services/themes.js";
import type {
  CollaborationProvider,
  PipelineAction,
  Pipeline,
  PipelineDetails,
  PipelineJob,
  PullRequest,
  PullRequestAction,
  PullRequestComment,
  PullRequestCommentInput,
  PullRequestDetails,
  PullRequestDiff,
  Issue,
  IssueDetails,
} from "../services/collaboration/types.js";
import { isAuthenticationError } from "../services/collaboration/providers.js";

const resources = [
  { name: "Pull requests", description: "Code review and merge requests" },
  { name: "Pipelines", description: "Builds, jobs, and logs" },
  { name: "Issues / Work items", description: "Tracked work and discussions" },
];
type DiffMode = "summary" | "inline" | "side-by-side";
type PullRequestGroupStatus = "open" | "draft" | "merged" | "closed";
type PullRequestGroupOption =
  | { kind: "group"; status: PullRequestGroupStatus }
  | PullRequest;

export type CollaborationPromptRequest =
  | { kind: "comment"; pullRequest: PullRequest; commentType: "file" | "line" }
  | { kind: "action"; pullRequest: PullRequest; action: PullRequestAction }
  | { kind: "resolve-comment"; pullRequest: PullRequest; comment: PullRequestComment }
  | { kind: "pipeline-action"; pipeline: Pipeline; action: PipelineAction };

function renderDiff(diff: PullRequestDiff, mode: DiffMode): string {
  if (mode === "summary") {
    return diff.files.length === 0
      ? "No changed files."
      : diff.files
        .map((file) => `${file.path}  +${file.additions}  -${file.deletions}`)
        .join("\n");
  }
  const lines: string[] = [];
  for (const file of diff.files) {
    lines.push(`--- ${file.path}`);
    for (const hunk of file.hunks) {
      lines.push(hunk.header);
      if (mode === "inline") {
        for (const line of hunk.lines) {
          lines.push(`${line.kind === "addition" ? "+" : line.kind === "deletion" ? "-" : " "} ${line.content}`);
        }
      } else {
        const pending = [...hunk.lines];
        while (pending.length > 0) {
          const left = pending[0]?.kind === "deletion" ? pending.shift() : undefined;
          const right = pending[0]?.kind === "addition" ? pending.shift() : undefined;
          if (left || right) {
            lines.push(`${left?.content ?? ""}`.padEnd(42) + " │ " + (right?.content ?? ""));
          } else {
            const context = pending.shift();
            lines.push(`${context?.content ?? ""}`.padEnd(42) + " │ " + (context?.content ?? ""));
          }
        }
      }
    }
  }
  return lines.join("\n") || "No diff content.";
}

export class CollaborationPanel {
  readonly panel: BoxRenderable;
  readonly resourceSelect: SelectRenderable;
  private readonly pullRequestSelect: SelectRenderable;
  private readonly pipelineSelect: SelectRenderable;
  private readonly issueSelect: SelectRenderable;
  private readonly pipelineJobSelect: SelectRenderable;
  private readonly pipelineActionSelect: SelectRenderable;
  private readonly diffModeSelect: SelectRenderable;
  private readonly commentSelect: SelectRenderable;
  private readonly actionSelect: SelectRenderable;
  private readonly listPanel: BoxRenderable;
  private readonly detailPanel: BoxRenderable;
  private readonly detailTitle: TextRenderable;
  private readonly detailText: TextRenderable;
  private readonly diffText: TextRenderable;
  private readonly pipelineLogText: TextRenderable;
  private readonly renderer: CliRenderer;
  private theme: Theme;
  private readonly provider: CollaborationProvider | undefined;
  private selectedPullRequest: PullRequest | undefined;
  private selectedPullRequestDetails: PullRequestDetails | undefined;
  private selectedPipeline: Pipeline | undefined;
  private selectedPipelineDetails: PipelineDetails | undefined;
  private selectedIssue: Issue | undefined;
  private selectedIssueDetails: IssueDetails | undefined;
  private pipelineJobs: PipelineJob[] = [];
  private selectedComment: PullRequestComment | undefined;
  private comments: PullRequestComment[] = [];
  private selectedResourceIndex = 0;
  private pullRequests: PullRequest[] = [];
  private resourceLoadId = 0;
  private readonly loadedResources = new Set<number>();
  private readonly collapsedPullRequestGroups = new Set<PullRequestGroupStatus>([
    "draft",
    "merged",
    "closed",
  ]);
  private focusedSection:
    | "resources"
    | "pull-requests"
    | "pipelines"
    | "issues"
    | "pipeline-jobs"
    | "pipeline-actions"
    | "comments"
    | "actions" = "resources";
  private readonly onAuthenticationRequired: (provider: "github" | "azure") => void;
  private readonly onPromptRequested: (request: CollaborationPromptRequest) => void;
  private readonly handleResize = (): void => {
    const compact = this.renderer.width < 100;
    this.panel.flexDirection = compact ? "column" : "row";
    this.listPanel.flexBasis = compact ? "auto" : 0;
    this.listPanel.flexGrow = compact ? 0 : 1;
    this.listPanel.minHeight = compact ? 6 : null;
    this.detailPanel.flexGrow = 1;
  };

  constructor(
    renderer: CliRenderer,
    backgroundColor: string,
    provider?: CollaborationProvider,
    onAuthenticationRequired: (provider: "github" | "azure") => void = () => {},
    onPromptRequested: (request: CollaborationPromptRequest) => void = () => {},
  ) {
    this.renderer = renderer;
    this.provider = provider;
    this.onAuthenticationRequired = onAuthenticationRequired;
    this.onPromptRequested = onPromptRequested;
    this.theme = {
      id: "initial",
      name: "Initial",
      mode: "dark",
      background: backgroundColor,
      panelBackground: backgroundColor,
      inputBackground: backgroundColor,
      focusedBackground: backgroundColor,
      border: "#2b3c68",
      accent: "#7dd3fc",
      text: "#ffffff",
      muted: "#aab7d8",
    };
    this.panel = new BoxRenderable(renderer, {
      flexGrow: 1,
      flexDirection: "row",
      paddingTop: 1,
      border: true,
      borderStyle: "rounded",
      backgroundColor,
      visible: false,
    });
    this.listPanel = new BoxRenderable(renderer, {
      flexGrow: 1,
      flexBasis: 0,
      flexDirection: "column",
      padding: 1,
      border: true,
      borderStyle: "rounded",
      title: "collaboration",
    });
    this.resourceSelect = new SelectRenderable(renderer, {
      flexGrow: 1,
      width: "100%",
      options: resources.map((resource) => ({
        name: resource.name,
        description: resource.description,
        value: resource.name,
      })),
      showDescription: true,
      itemSpacing: 1,
      wrapSelection: true,
    });
    this.detailPanel = new BoxRenderable(renderer, {
      flexGrow: 1,
      flexBasis: 0,
      flexDirection: "column",
      padding: 2,
      border: true,
      borderStyle: "rounded",
      title: "details",
    });
    this.detailTitle = new TextRenderable(renderer, { content: "Collaboration" });
    this.detailText = new TextRenderable(renderer, {
      content: "Select a resource to get started.",
    });
    this.pullRequestSelect = new SelectRenderable(renderer, {
      width: "100%",
      flexGrow: 1,
      visible: false,
      options: [],
      showDescription: true,
      showSelectionIndicator: false,
      itemSpacing: 1,
    });
    this.pipelineSelect = new SelectRenderable(renderer, {
      width: "100%",
      flexGrow: 1,
      visible: false,
      options: [],
      showDescription: true,
      itemSpacing: 1,
    });
    this.issueSelect = new SelectRenderable(renderer, {
      width: "100%",
      flexGrow: 1,
      visible: false,
      options: [],
      showDescription: true,
      itemSpacing: 1,
    });
    this.pipelineJobSelect = new SelectRenderable(renderer, {
      width: "100%",
      height: 8,
      visible: false,
      options: [],
      showDescription: true,
      itemSpacing: 1,
    });
    this.pipelineActionSelect = new SelectRenderable(renderer, {
      width: "100%",
      height: 6,
      visible: false,
      options: [],
      showDescription: true,
      itemSpacing: 1,
    });
    this.diffModeSelect = new SelectRenderable(renderer, {
      width: "100%",
      height: 1,
      visible: false,
      options: [
        { name: "summary", description: "", value: "summary" },
        { name: "inline", description: "", value: "inline" },
        { name: "side-by-side", description: "", value: "side-by-side" },
      ],
      showDescription: false,
    });
    this.commentSelect = new SelectRenderable(renderer, {
      width: "100%",
      height: 7,
      visible: false,
      options: [],
      showDescription: true,
      itemSpacing: 1,
    });
    this.actionSelect = new SelectRenderable(renderer, {
      width: "100%",
      height: 6,
      visible: false,
      options: [],
      showDescription: true,
      itemSpacing: 1,
    });
    this.diffText = new TextRenderable(renderer, { visible: false, content: "" });
    this.pipelineLogText = new TextRenderable(renderer, { visible: false, content: "" });
    this.detailPanel.add(this.detailTitle);
    this.detailPanel.add(this.pullRequestSelect);
    this.detailPanel.add(this.pipelineSelect);
    this.detailPanel.add(this.issueSelect);
    this.detailPanel.add(this.detailText);
    this.detailPanel.add(this.pipelineJobSelect);
    this.detailPanel.add(this.pipelineActionSelect);
    this.detailPanel.add(this.commentSelect);
    this.detailPanel.add(this.actionSelect);
    this.detailPanel.add(this.diffModeSelect);
    this.detailPanel.add(this.diffText);
    this.detailPanel.add(this.pipelineLogText);
    this.listPanel.add(this.resourceSelect);
    this.panel.add(this.listPanel);
    this.panel.add(this.detailPanel);
    this.resourceSelect.on(SelectRenderableEvents.SELECTION_CHANGED, (index) => {
      const resource = resources[index];
      if (resource) void this.showResource(resource.name, index);
    });
    this.pullRequestSelect.on(SelectRenderableEvents.ITEM_SELECTED, (index) => {
      this.activatePullRequestOption(index);
    });
    this.pipelineSelect.on(SelectRenderableEvents.ITEM_SELECTED, (index) => {
      const pipeline = this.pipelineSelect.options[index]?.value as Pipeline | undefined;
      if (pipeline) void this.showPipeline(pipeline);
    });
    this.issueSelect.on(SelectRenderableEvents.ITEM_SELECTED, (index) => {
      const issue = this.issueSelect.options[index]?.value as Issue | undefined;
      if (issue) void this.showIssue(issue);
    });
    this.pipelineJobSelect.on(SelectRenderableEvents.ITEM_SELECTED, (index) => {
      const job = this.pipelineJobs[index];
      if (job) void this.showPipelineJob(job);
    });
    this.pipelineActionSelect.on(SelectRenderableEvents.ITEM_SELECTED, (index) => {
      const action = this.pipelineActionSelect.options[index]?.value as PipelineAction | undefined;
      if (action && this.selectedPipeline) {
        this.onPromptRequested({
          kind: "pipeline-action",
          pipeline: this.selectedPipeline,
          action,
        });
      }
    });
    this.diffModeSelect.on(SelectRenderableEvents.ITEM_SELECTED, (index) => {
      const mode = this.diffModeSelect.options[index]?.value as DiffMode | undefined;
      if (mode && this.selectedPullRequest) void this.showDiff(this.selectedPullRequest, mode);
    });
    this.commentSelect.on(SelectRenderableEvents.ITEM_SELECTED, (index) => {
      this.selectedComment = this.comments[index];
      if (this.selectedComment) {
        this.detailText.content = this.renderPullRequestSummary(
          this.selectedPullRequestDetails,
          `Selected comment: ${this.selectedComment.body}`,
        );
        this.updateActionOptions();
      }
    });
    this.actionSelect.on(SelectRenderableEvents.ITEM_SELECTED, (index) => {
      const action = this.actionSelect.options[index]?.value as
        | PullRequestAction
        | "file-comment"
        | "line-comment"
        | "resolve-comment"
        | "refresh-comments"
        | undefined;
      if (!action || !this.selectedPullRequest) return;
      if (action === "file-comment" || action === "line-comment") {
        this.onPromptRequested({
          kind: "comment",
          pullRequest: this.selectedPullRequest,
          commentType: action === "file-comment" ? "file" : "line",
        });
      } else if (action === "refresh-comments") {
        void this.loadComments(this.selectedPullRequest);
      } else if (action === "resolve-comment" && this.selectedComment) {
        this.onPromptRequested({
          kind: "resolve-comment",
          pullRequest: this.selectedPullRequest,
          comment: this.selectedComment,
        });
      } else if (action === "resolve-comment") {
        return;
      } else {
        this.onPromptRequested({
          kind: "action",
          pullRequest: this.selectedPullRequest,
          action,
        });
      }
    });
    renderer.on("resize", this.handleResize);
    this.handleResize();
    this.applyTheme(this.theme);
  }

  focusResource(): void {
    this.focusedSection = "resources";
    this.resourceSelect.focus();
  }

  focusNext(): void {
    if (this.focusedSection === "resources" && this.pullRequestSelect.visible) {
      this.focusedSection = "pull-requests";
      this.pullRequestSelect.focus();
    } else if (this.focusedSection === "resources" && this.pipelineSelect.visible) {
      this.focusedSection = "pipelines";
      this.pipelineSelect.focus();
    } else if (this.focusedSection === "resources" && this.issueSelect.visible) {
      this.focusedSection = "issues";
      this.issueSelect.focus();
    } else if (this.focusedSection === "pipelines" && this.pipelineJobSelect.visible) {
      this.focusedSection = "pipeline-jobs";
      this.pipelineJobSelect.focus();
    } else if (this.focusedSection === "pipelines" && this.pipelineActionSelect.visible) {
      this.focusedSection = "pipeline-actions";
      this.pipelineActionSelect.focus();
    } else if (this.focusedSection === "pipeline-jobs" && this.pipelineActionSelect.visible) {
      this.focusedSection = "pipeline-actions";
      this.pipelineActionSelect.focus();
    } else if (this.focusedSection === "pull-requests" && this.commentSelect.visible) {
      this.focusedSection = "comments";
      this.commentSelect.focus();
    } else if (
      (this.focusedSection === "pull-requests" || this.focusedSection === "comments")
      && this.actionSelect.visible
    ) {
      this.focusedSection = "actions";
      this.actionSelect.focus();
    } else {
      this.focusResource();
    }
  }

  focusPrevious(): void {
    if (this.focusedSection === "pipeline-jobs") {
      if (this.pipelineActionSelect.visible) {
        this.focusedSection = "pipeline-actions";
        this.pipelineActionSelect.focus();
      } else {
        this.focusedSection = "pipelines";
        this.pipelineSelect.focus();
      }
    } else if (this.focusedSection === "pipeline-actions") {
      if (this.pipelineJobSelect.visible) {
        this.focusedSection = "pipeline-jobs";
        this.pipelineJobSelect.focus();
      } else {
        this.focusedSection = "pipelines";
        this.pipelineSelect.focus();
      }
    } else if (this.focusedSection === "actions" && this.commentSelect.visible) {
      this.focusedSection = "comments";
      this.commentSelect.focus();
    } else if (
      (this.focusedSection === "actions" || this.focusedSection === "comments")
      && this.pullRequestSelect.visible
    ) {
      this.focusedSection = "pull-requests";
      this.pullRequestSelect.focus();
    } else if (this.focusedSection === "pipelines") {
      this.focusResource();
    } else if (this.focusedSection === "issues") {
      this.focusResource();
    } else if (this.focusedSection === "pull-requests") {
      this.focusResource();
    } else {
      this.focusResource();
    }
  }

  retryCurrentResource(): void {
    void this.showResource(
      resources[this.selectedResourceIndex]?.name ?? "Pull requests",
      this.selectedResourceIndex,
      true,
    );
  }

  activateSelectedPullRequest(): void {
    if (this.selectedResourceIndex === 2) {
      const issue = this.issueSelect.options[this.issueSelect.getSelectedIndex()]?.value as Issue | undefined;
      if (issue) void this.showIssue(issue);
      return;
    }
    this.activatePullRequestOption(this.pullRequestSelect.getSelectedIndex());
  }

  async createPullRequestComment(comment: PullRequestCommentInput): Promise<void> {
    if (!this.provider || !this.selectedPullRequest) return;
    await this.provider.createPullRequestComment(this.selectedPullRequest.id, comment);
    await this.loadComments(this.selectedPullRequest);
  }

  async updateSelectedCommentStatus(): Promise<void> {
    if (!this.provider || !this.selectedPullRequest || !this.selectedComment) return;
    await this.provider.updatePullRequestCommentStatus(
      this.selectedPullRequest.id,
      this.selectedComment.threadId ?? this.selectedComment.id,
      "resolved",
    );
    await this.loadComments(this.selectedPullRequest);
  }

  async executePullRequestAction(action: PullRequestAction): Promise<void> {
    if (!this.provider || !this.selectedPullRequest) return;
    const id = this.selectedPullRequest.id;
    const details = action === "merge"
      ? await this.provider.mergePullRequest(id)
      : action === "complete"
        ? await this.provider.completePullRequest(id)
        : await this.provider.abandonPullRequest(id);
    this.selectedPullRequest = details;
    this.selectedPullRequestDetails = details;
    this.detailText.content = this.renderPullRequestSummary(details);
    this.updateActionOptions();
  }

  async executePipelineAction(action: PipelineAction): Promise<void> {
    if (!this.provider || !this.selectedPipeline) return;
    const pipelineId = this.selectedPipeline.id;
    try {
      if (action === "run") {
        await this.provider.runPipeline(pipelineId);
      } else if (action === "cancel") {
        await this.provider.cancelPipeline(pipelineId);
      } else if (action === "retry") {
        await this.provider.retryPipeline(pipelineId);
      } else if (action === "approve") {
        await this.provider.approvePipeline(pipelineId);
      } else {
        await this.provider.resumePipeline(pipelineId);
      }
      await this.showPipeline(this.selectedPipeline, true);
    } catch (error) {
      if (isAuthenticationError(error)) this.onAuthenticationRequired(this.provider.id);
      throw error;
    }
  }

  applyTheme(theme: Theme): void {
    this.theme = theme;
    this.panel.backgroundColor = theme.background;
    for (const pane of [this.listPanel, this.detailPanel]) {
      pane.backgroundColor = theme.panelBackground;
      pane.borderColor = theme.border;
    }
    this.listPanel.titleColor = theme.accent;
    this.detailPanel.titleColor = theme.accent;
    this.resourceSelect.backgroundColor = theme.panelBackground;
    this.resourceSelect.focusedBackgroundColor = theme.focusedBackground;
    this.resourceSelect.selectedBackgroundColor = theme.focusedBackground;
    this.resourceSelect.textColor = theme.text;
    this.resourceSelect.focusedTextColor = theme.text;
    this.resourceSelect.selectedTextColor = theme.text;
    this.resourceSelect.descriptionColor = theme.muted;
    this.resourceSelect.selectedDescriptionColor = theme.text;
    this.pullRequestSelect.backgroundColor = theme.panelBackground;
    this.pullRequestSelect.focusedBackgroundColor = theme.focusedBackground;
    this.pullRequestSelect.selectedBackgroundColor = theme.focusedBackground;
    this.pullRequestSelect.textColor = theme.text;
    this.pullRequestSelect.focusedTextColor = theme.text;
    this.pullRequestSelect.selectedTextColor = theme.text;
    this.pullRequestSelect.descriptionColor = theme.muted;
    this.pullRequestSelect.selectedDescriptionColor = theme.text;
    for (const select of [this.pipelineSelect, this.pipelineJobSelect, this.pipelineActionSelect]) {
      select.backgroundColor = theme.panelBackground;
      select.focusedBackgroundColor = theme.focusedBackground;
      select.selectedBackgroundColor = theme.focusedBackground;
      select.textColor = theme.text;
      select.focusedTextColor = theme.text;
      select.selectedTextColor = theme.text;
      select.descriptionColor = theme.muted;
      select.selectedDescriptionColor = theme.text;
    }
    for (const select of [this.issueSelect]) {
      select.backgroundColor = theme.panelBackground;
      select.focusedBackgroundColor = theme.focusedBackground;
      select.selectedBackgroundColor = theme.focusedBackground;
      select.textColor = theme.text;
      select.focusedTextColor = theme.text;
      select.selectedTextColor = theme.text;
      select.descriptionColor = theme.muted;
      select.selectedDescriptionColor = theme.text;
    }
    this.diffModeSelect.backgroundColor = theme.panelBackground;
    this.diffModeSelect.focusedBackgroundColor = theme.focusedBackground;
    this.diffModeSelect.selectedBackgroundColor = theme.focusedBackground;
    this.diffModeSelect.textColor = theme.text;
    this.diffModeSelect.focusedTextColor = theme.text;
    this.diffModeSelect.selectedTextColor = theme.text;
    for (const select of [this.commentSelect, this.actionSelect]) {
      select.backgroundColor = theme.panelBackground;
      select.focusedBackgroundColor = theme.focusedBackground;
      select.selectedBackgroundColor = theme.focusedBackground;
      select.textColor = theme.text;
      select.focusedTextColor = theme.text;
      select.selectedTextColor = theme.text;
      select.descriptionColor = theme.muted;
      select.selectedDescriptionColor = theme.text;
    }
    this.detailTitle.fg = theme.accent;
    this.detailText.fg = theme.muted;
    this.pipelineLogText.fg = theme.muted;
  }

  private async showResource(name: string, index: number, force = false): Promise<void> {
    const loadId = ++this.resourceLoadId;
    this.selectedResourceIndex = index;
    this.detailTitle.content = name;
    this.pullRequestSelect.visible = false;
    this.pipelineSelect.visible = false;
    this.issueSelect.visible = false;
    this.pipelineJobSelect.visible = false;
    this.pipelineActionSelect.visible = false;
    this.commentSelect.visible = false;
    this.actionSelect.visible = false;
    this.diffModeSelect.visible = false;
    this.diffText.visible = false;
    this.pipelineLogText.visible = false;
    this.detailText.visible = true;
    this.selectedPullRequest = undefined;
    this.selectedPullRequestDetails = undefined;
    this.selectedPipeline = undefined;
    this.selectedPipelineDetails = undefined;
    this.selectedIssue = undefined;
    this.selectedIssueDetails = undefined;
    this.pipelineJobs = [];
    this.selectedComment = undefined;
    this.comments = [];
    if (index === 1) {
      if (!this.provider) {
        this.detailText.content = "No supported GitHub or Azure remote was detected.";
        return;
      }
      if (!this.provider.capabilities.pipelines) {
        this.detailText.content = `Pipelines are not available for ${this.provider.id}.`;
        return;
      }
      if (!force && this.loadedResources.has(index)) {
        this.pipelineSelect.visible = true;
        this.detailText.content = this.pipelineSelect.options.length > 0
          ? "Select a pipeline run to view stages, jobs, and logs."
          : "No pipeline runs found.";
        return;
      }
      this.detailText.content = "Loading pipeline runs...";
      try {
        const page = await this.provider.listPipelines({});
        if (loadId !== this.resourceLoadId) return;
        this.loadedResources.add(index);
        this.pipelineSelect.options = page.items.map((pipeline) => ({
          name: `${pipeline.status}  ${pipeline.name}`,
          description: `${pipeline.branch ?? "unknown branch"} · ${pipeline.commit?.slice(0, 8) ?? "no commit"}`,
          value: pipeline,
        }));
        this.pipelineSelect.visible = true;
        this.detailText.content = page.items.length > 0
          ? "Select a pipeline run to view stages, jobs, and logs."
          : "No pipeline runs found.";
      } catch (error) {
        if (loadId !== this.resourceLoadId) return;
        const authenticationError = isAuthenticationError(error);
        this.detailText.content = authenticationError
          ? `Authentication required for ${this.provider.id}.`
          : `Unable to load pipelines: ${String(error)}`;
        if (authenticationError) this.onAuthenticationRequired(this.provider.id);
      }
      return;
    }
    if (index === 2) {
      if (!this.provider) {
        this.detailText.content = "No supported GitHub or Azure remote was detected.";
        return;
      }
      if (!this.provider.capabilities.issues) {
        this.detailText.content = `Issues / work items are not available for ${this.provider.id}.`;
        return;
      }
      if (!force && this.loadedResources.has(index)) {
        this.issueSelect.visible = true;
        this.detailText.content = this.issueSelect.options.length > 0
          ? "Select an issue or work item to view its details."
          : "No issues or work items found.";
        return;
      }
      this.detailText.content = "Loading issues / work items...";
      try {
        const page = await this.provider.listIssues({});
        if (loadId !== this.resourceLoadId) return;
        this.loadedResources.add(index);
        this.issueSelect.options = page.items.map((issue) => ({
          name: `#${issue.number}  ${issue.title}`,
          description: `${issue.status} · ${issue.author}`,
          value: issue,
        }));
        this.issueSelect.visible = true;
        this.detailText.content = page.items.length > 0
          ? "Select an issue or work item to view its details."
          : "No issues or work items found.";
      } catch (error) {
        if (loadId !== this.resourceLoadId) return;
        const authenticationError = isAuthenticationError(error);
        this.detailText.content = authenticationError
          ? `Authentication required for ${this.provider.id}.`
          : `Unable to load issues / work items: ${String(error)}`;
        if (authenticationError) this.onAuthenticationRequired(this.provider.id);
      }
      return;
    }
    if (index !== 0) {
      this.detailText.content = this.provider
        ? "This resource is planned for a later implementation step."
        : "No supported GitHub or Azure remote was detected.";
      return;
    }
    if (!this.provider) {
      this.detailText.content = "No supported GitHub or Azure remote was detected.";
      return;
    }
    if (!force && this.loadedResources.has(index)) {
      this.renderPullRequestGroups();
      this.pullRequestSelect.visible = true;
      this.detailText.content = this.pullRequestSelect.options.length > 0
        ? "Select a pull request to view its details."
        : "No pull requests found.";
      return;
    }
    this.detailText.content = "Loading pull requests...";
    try {
      const page = await this.provider.listPullRequests({});
      if (loadId !== this.resourceLoadId) return;
      this.loadedResources.add(index);
      this.pullRequests = page.items.filter((pullRequest) => pullRequest.status !== "unknown");
      this.renderPullRequestGroups();
      this.pullRequestSelect.visible = true;
      this.detailText.content = page.items.length > 0
        ? "Select a pull request to view its details."
        : "No pull requests found.";
    } catch (error) {
      if (loadId !== this.resourceLoadId) return;
      this.detailText.content = isAuthenticationError(error)
        ? `Authentication required for ${this.provider.id}.`
        : `Unable to load pull requests: ${String(error)}`;
      if (isAuthenticationError(error)) this.onAuthenticationRequired(this.provider.id);
    }
  }

  private renderPullRequestGroups(): void {
      const groups: PullRequestGroupStatus[] = ["open", "draft", "merged", "closed"];
      this.pullRequestSelect.options = groups.flatMap((status) => {
        const pullRequests = this.pullRequests
          .filter((pullRequest) => pullRequest.status === status)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        if (pullRequests.length === 0) return [];
        const collapsed = this.collapsedPullRequestGroups.has(status);
        const label = status[0].toUpperCase() + status.slice(1);
        const options: Array<{ name: string; description: string; value: PullRequestGroupOption }> = [{
          name: `${collapsed ? "▶" : "▼"} ${label} (${pullRequests.length})`,
          description: "",
          value: { kind: "group", status },
        }];
        if (!collapsed) {
          options.push(...pullRequests.map((pullRequest) => ({
            name: `  #${pullRequest.number}  ${pullRequest.title}`,
            description: `  ${pullRequest.sourceBranch} → ${pullRequest.targetBranch}`,
            value: pullRequest,
          })));
        }
        return options;
      });
  }

  private activatePullRequestOption(index: number): void {
    const option = this.pullRequestSelect.options[index]?.value as PullRequestGroupOption | undefined;
    if (!option) return;
    if ("kind" in option && option.kind === "group") {
      if (this.collapsedPullRequestGroups.has(option.status)) {
        this.collapsedPullRequestGroups.delete(option.status);
      } else {
        this.collapsedPullRequestGroups.add(option.status);
      }
      this.renderPullRequestGroups();
      return;
    }
    void this.showPullRequest(option as PullRequest);
  }

  private async showPullRequest(pullRequest: PullRequest): Promise<void> {
    if (!this.provider) return;
    this.selectedPullRequest = pullRequest;
    this.selectedComment = undefined;
    this.detailText.content = "Loading pull request details...";
    try {
      const details: PullRequestDetails = await this.provider.getPullRequest(pullRequest.id);
      this.selectedPullRequestDetails = details;
      this.detailText.content = this.renderPullRequestSummary(details);
      this.updateActionOptions();
      await this.loadComments(pullRequest);
      this.diffModeSelect.visible = true;
      this.diffText.visible = true;
      await this.showDiff(pullRequest, "summary");
    } catch (error) {
      this.detailText.content = isAuthenticationError(error)
        ? `Authentication required for ${this.provider.id}.`
        : `Unable to load pull request details: ${String(error)}`;
      if (isAuthenticationError(error)) this.onAuthenticationRequired(this.provider.id);
    }
  }

  private async showPipeline(pipeline: Pipeline, propagateError = false): Promise<void> {
    if (!this.provider) return;
    this.selectedPipeline = pipeline;
    this.pipelineLogText.visible = false;
    this.detailText.content = "Loading pipeline details...";
    try {
      const details = await this.provider.getPipeline(pipeline.id);
      this.selectedPipeline = details;
      this.selectedPipelineDetails = details;
      const pipelineIndex = this.pipelineSelect.options.findIndex(
        (option) => (option.value as Pipeline | undefined)?.id === details.id,
      );
      if (pipelineIndex >= 0) {
        this.pipelineSelect.options = this.pipelineSelect.options.map((option, index) =>
          index === pipelineIndex
            ? {
              ...option,
              name: `${details.status}  ${details.name}`,
              description: `${details.branch ?? "unknown branch"} · ${details.commit?.slice(0, 8) ?? "no commit"}`,
              value: details,
            }
            : option);
      }
      this.pipelineJobs = details.jobs;
      this.detailText.content = this.renderPipelineSummary(details);
      this.pipelineJobSelect.options = details.jobs.map((job) => ({
        name: `${job.status}  ${job.name}`,
        description: job.logAvailable ? "log available · select to view" : "logs unavailable for this job",
        value: job,
      }));
      this.pipelineJobSelect.visible = details.jobs.length > 0;
      this.updatePipelineActionOptions(details);
    } catch (error) {
      const authenticationError = isAuthenticationError(error);
      this.detailText.content = authenticationError
        ? `Authentication required for ${this.provider.id}.`
        : `Unable to load pipeline details: ${String(error)}`;
      this.pipelineJobSelect.visible = false;
      this.pipelineActionSelect.visible = false;
      if (authenticationError && !propagateError) this.onAuthenticationRequired(this.provider.id);
      if (propagateError) throw error;
    }
  }

  private async showPipelineJob(job: PipelineJob): Promise<void> {
    const details = this.selectedPipelineDetails;
    if (!details || !this.provider) return;
    if (!details.capabilities.logs || !job.logAvailable) {
      this.pipelineLogText.visible = true;
      this.pipelineLogText.content = "Logs are not available for this job.";
      return;
    }
    this.pipelineLogText.visible = true;
    this.pipelineLogText.content = `Loading log for ${job.name}...`;
    try {
      this.pipelineLogText.content = await this.provider.getPipelineLog(job.id);
    } catch (error) {
      const authenticationError = isAuthenticationError(error);
      this.pipelineLogText.content = authenticationError
        ? `Authentication required for ${this.provider.id}.`
        : `Unable to load job log: ${String(error)}`;
      if (authenticationError) this.onAuthenticationRequired(this.provider.id);
    }
  }

  private async showDiff(pullRequest: PullRequest, mode: DiffMode): Promise<void> {
    if (!this.provider) return;
    this.diffText.content = "Loading diff...";
    try {
      const diff = await this.provider.getPullRequestDiff(pullRequest.id);
      this.diffText.content = renderDiff(diff, mode);
    } catch (error) {
      this.diffText.content = `Unable to load diff: ${String(error)}`;
    }
  }

  private async loadComments(pullRequest: PullRequest): Promise<void> {
    if (!this.provider) return;
    try {
      const selectedCommentId = this.selectedComment?.id;
      const page = await this.provider.listPullRequestComments(pullRequest.id);
      this.comments = page.items;
      this.selectedComment = this.comments.find((comment) => comment.id === selectedCommentId);
      this.commentSelect.options = this.comments.map((comment) => ({
        name: `${comment.filePath ?? "General comment"}${comment.line === undefined ? "" : `:${comment.line}`}`,
        description: `${comment.status} · ${comment.author}: ${comment.body}`,
        value: comment,
      }));
      this.commentSelect.visible = this.comments.length > 0;
      this.updateActionOptions();
    } catch (error) {
      this.comments = [];
      this.commentSelect.options = [];
      this.commentSelect.visible = false;
      this.detailText.content = `${this.renderPullRequestSummary(this.selectedPullRequestDetails)}\n\nUnable to load comments: ${String(error)}`;
    }
  }

  private updateActionOptions(): void {
    const details = this.selectedPullRequestDetails;
    if (!details) {
      this.actionSelect.options = [];
      this.actionSelect.visible = false;
      return;
    }
    const options: Array<{
      name: string;
      description: string;
      value: PullRequestAction | "file-comment" | "line-comment" | "resolve-comment" | "refresh-comments";
    }> = details.capabilities.canComment
      ? [
        { name: "Add file comment", description: "path | comment", value: "file-comment" },
        { name: "Add line comment", description: "path:line | comment", value: "line-comment" },
        { name: "Refresh comments", description: "Reload review comments", value: "refresh-comments" },
      ]
      : [];
    if (details.capabilities.canChangeCommentStatus && this.selectedComment?.status === "active") {
      options.push({
        name: "Resolve selected comment",
        description: "Mark the selected comment as resolved",
        value: "resolve-comment",
      });
    }
    if (details.capabilities.canMerge) {
      options.push({ name: "Merge pull request", description: "Merge with the provider default", value: "merge" });
    }
    if (details.capabilities.canComplete) {
      options.push({ name: "Complete pull request", description: "Complete the pull request", value: "complete" });
    }
    if (details.capabilities.canAbandon) {
      options.push({ name: "Abandon pull request", description: "Close or abandon the pull request", value: "abandon" });
    }
    this.actionSelect.options = options;
    this.actionSelect.visible = true;
  }

  private updatePipelineActionOptions(details: PipelineDetails): void {
    const controls = details.capabilities.controls;
    const labels: Record<PipelineAction, string> = {
      run: "Run pipeline",
      cancel: "Cancel pipeline",
      retry: "Retry pipeline",
      approve: "Approve pipeline",
      resume: "Resume pipeline",
    };
    const descriptions: Record<PipelineAction, string> = {
      run: "Start a new run for this pipeline",
      cancel: "Cancel the active run",
      retry: "Retry the failed or canceled run",
      approve: "Approve a pending run",
      resume: "Resume a paused run",
    };
    const actions: PipelineAction[] = ["run", "cancel", "retry", "approve", "resume"];
    this.pipelineActionSelect.options = actions
      .filter((action) => controls[action])
      .map((action) => ({
        name: labels[action],
        description: descriptions[action],
        value: action,
      }));
    this.pipelineActionSelect.visible = this.pipelineActionSelect.options.length > 0;
  }

  private renderPullRequestSummary(
    details: PullRequestDetails | undefined,
    suffix?: string,
  ): string {
    if (!details) return suffix ?? "No pull request selected.";
    return [
      `#${details.number} ${details.title}`,
      `${details.status} · ${details.author}`,
      `${details.sourceBranch} → ${details.targetBranch}`,
      `${details.additions} additions · ${details.deletions} deletions · ${details.changedFiles} files`,
      details.description ?? "No description.",
      ...(suffix ? ["", suffix] : []),
    ].join("\n");
  }

  private renderPipelineSummary(details: PipelineDetails): string {
    const lines = [
      details.name,
      `${details.status} · ${details.branch ?? "unknown branch"} · ${details.commit?.slice(0, 8) ?? "no commit"}`,
      details.startedAt ? `started ${details.startedAt}` : "start time unavailable",
      details.finishedAt ? `finished ${details.finishedAt}` : "not finished",
      "",
      details.capabilities.stages
        ? `Stages: ${details.stages.length}`
        : "Stages: unavailable from this provider",
      details.capabilities.jobs ? `Jobs: ${details.jobs.length}` : "Jobs: unavailable from this provider",
    ];
    if (details.stages.length > 0) {
      lines.push(...details.stages.map((stage) => `  ${stage.status}  ${stage.name} (${stage.jobs.length} jobs)`));
    }
    if (details.capabilities.limitations.length > 0) {
      lines.push("", "Limitations:", ...details.capabilities.limitations.map((limitation) => `- ${limitation}`));
    }
    return lines.join("\n");
  }

  private async showIssue(issue: Issue): Promise<void> {
    if (!this.provider) return;
    const loadId = this.resourceLoadId;
    this.selectedIssue = issue;
    this.detailText.content = "Loading issue / work item details...";
    try {
      const details = await this.provider.getIssue(issue.id);
      if (loadId !== this.resourceLoadId || this.selectedIssue?.id !== issue.id) return;
      this.selectedIssueDetails = details;
      this.detailText.content = [
        `#${details.number} ${details.title}`,
        `${details.status} · ${details.author}`,
        details.updatedAt ? `updated ${details.updatedAt}` : "update time unavailable",
        details.assignees.length > 0 ? `Assignees: ${details.assignees.join(", ")}` : "Unassigned",
        details.labels.length > 0 ? `Labels: ${details.labels.join(", ")}` : "No labels",
        "",
        details.description ?? "No description.",
      ].join("\n");
    } catch (error) {
      if (loadId !== this.resourceLoadId || this.selectedIssue?.id !== issue.id) return;
      const authenticationError = isAuthenticationError(error);
      this.detailText.content = authenticationError
        ? `Authentication required for ${this.provider.id}.`
        : `Unable to load issue / work item details: ${String(error)}`;
      if (authenticationError) this.onAuthenticationRequired(this.provider.id);
    }
  }
}
