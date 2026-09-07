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
  PullRequest,
  PullRequestAction,
  PullRequestComment,
  PullRequestCommentInput,
  PullRequestDetails,
  PullRequestDiff,
} from "../services/collaboration/types.js";

const resources = [
  { name: "Pull requests", description: "Code review and merge requests" },
  { name: "Pipelines", description: "Builds, jobs, and logs" },
  { name: "Issues / Work items", description: "Tracked work and discussions" },
];
type DiffMode = "summary" | "inline" | "side-by-side";

export type CollaborationPromptRequest =
  | { kind: "comment"; pullRequest: PullRequest; commentType: "file" | "line" }
  | { kind: "action"; pullRequest: PullRequest; action: PullRequestAction }
  | { kind: "resolve-comment"; pullRequest: PullRequest; comment: PullRequestComment };

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
  private readonly diffModeSelect: SelectRenderable;
  private readonly commentSelect: SelectRenderable;
  private readonly actionSelect: SelectRenderable;
  private readonly listPanel: BoxRenderable;
  private readonly detailPanel: BoxRenderable;
  private readonly detailTitle: TextRenderable;
  private readonly detailText: TextRenderable;
  private readonly diffText: TextRenderable;
  private readonly renderer: CliRenderer;
  private theme: Theme;
  private readonly provider: CollaborationProvider | undefined;
  private selectedPullRequest: PullRequest | undefined;
  private selectedPullRequestDetails: PullRequestDetails | undefined;
  private selectedComment: PullRequestComment | undefined;
  private comments: PullRequestComment[] = [];
  private selectedResourceIndex = 0;
  private focusedSection: "resources" | "pull-requests" | "comments" | "actions" = "resources";
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
    this.detailPanel.add(this.detailTitle);
    this.detailPanel.add(this.pullRequestSelect);
    this.detailPanel.add(this.detailText);
    this.detailPanel.add(this.commentSelect);
    this.detailPanel.add(this.actionSelect);
    this.detailPanel.add(this.diffModeSelect);
    this.detailPanel.add(this.diffText);
    this.listPanel.add(this.resourceSelect);
    this.panel.add(this.listPanel);
    this.panel.add(this.detailPanel);
    this.resourceSelect.on(SelectRenderableEvents.SELECTION_CHANGED, (index) => {
      const resource = resources[index];
      if (resource) void this.showResource(resource.name, index);
    });
    this.pullRequestSelect.on(SelectRenderableEvents.ITEM_SELECTED, (index) => {
      const pullRequest = this.pullRequestSelect.options[index]?.value as PullRequest | undefined;
      if (pullRequest) void this.showPullRequest(pullRequest);
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
    if (this.focusedSection === "actions" && this.commentSelect.visible) {
      this.focusedSection = "comments";
      this.commentSelect.focus();
    } else if (
      (this.focusedSection === "actions" || this.focusedSection === "comments")
      && this.pullRequestSelect.visible
    ) {
      this.focusedSection = "pull-requests";
      this.pullRequestSelect.focus();
    } else if (this.focusedSection === "pull-requests") {
      this.focusResource();
    } else {
      this.focusResource();
    }
  }

  retryCurrentResource(): void {
    void this.showResource(resources[this.selectedResourceIndex]?.name ?? "Pull requests", this.selectedResourceIndex);
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
  }

  private async showResource(name: string, index: number): Promise<void> {
    this.selectedResourceIndex = index;
    this.detailTitle.content = name;
    this.pullRequestSelect.visible = false;
    this.commentSelect.visible = false;
    this.actionSelect.visible = false;
    this.diffModeSelect.visible = false;
    this.diffText.visible = false;
    this.detailText.visible = true;
    this.selectedPullRequest = undefined;
    this.selectedPullRequestDetails = undefined;
    this.selectedComment = undefined;
    this.comments = [];
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
    this.detailText.content = "Loading pull requests...";
    try {
      const page = await this.provider.listPullRequests({});
      this.pullRequestSelect.options = page.items.map((pullRequest) => ({
        name: `#${pullRequest.number}  ${pullRequest.title}`,
        description: `${pullRequest.status}  ${pullRequest.sourceBranch} → ${pullRequest.targetBranch}`,
        value: pullRequest,
      }));
      this.pullRequestSelect.visible = true;
      this.detailText.content = page.items.length > 0
        ? "Select a pull request to view its details."
        : "No pull requests found.";
    } catch (error) {
      this.detailText.content = `Authentication required for ${this.provider.id}.`;
      this.onAuthenticationRequired(this.provider.id);
    }
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
      this.detailText.content = `Authentication required for ${this.provider.id}.`;
      this.onAuthenticationRequired(this.provider.id);
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
}
