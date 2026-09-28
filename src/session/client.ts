import { validateQuestionReply } from "./questions.js";
import { buildApprovalResponseOperation } from "./approval.js";
import {
  buildStartSessionPayload,
  permissionModeToAnte,
  resolveOptions,
  type ResolvedOptions,
} from "./options.js";
import { createTransport } from "../transport/factory.js";
import type { AnteTransport } from "../transport/transport.js";
import type {
  ApprovalDecision,
  ApprovalRequest,
  GoalCommand,
  Options,
  ProtocolModelSpec,
  QuestionReply,
  QuestionRequest,
  SDKMessage,
  SessionUpdate,
} from "../types.js";
import {
  buildProcessLaneFromToolPayload,
  extractAmbient,
  extractContextBreakdown,
  extractErrorMessage,
  extractExtensionRefreshed,
  extractInfoBlock,
  extractInfoMessage,
  extractSessionModelSpec,
  extractSessionProviderSpec,
  extractShellOutput,
  extractSessionId,
  extractText,
  extractToolCall,
  extractTurnPauseApproval,
  extractTurnPauseQuestion,
  extractTurnStatus,
  extractUsage,
  getVariant,
} from "../protocol/events.js";
import {
  generateOpId,
  parseEnvelope,
  serializeOperation,
  type AnteOperation,
  type AnteEventEnvelope,
} from "../protocol/wire.js";

const assertUnsignedInteger = (value: number, maximum: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${field} must be an integer between 0 and ${maximum}`);
  }
};

export interface AnteClient {
  connect(): Promise<void>;
  startSession(): Promise<string>;
  resumeSession(sessionId: string, options?: { unattended?: boolean }): Promise<string>;
  updateSession(update: SessionUpdate): void;
  sendUserInput(prompt: string): string;
  sendShellInput(input: string): string;
  sendSteer(prompt: string): string;
  compact(instructions?: string): void;
  respondToApproval(approval: ApprovalRequest, decision: ApprovalDecision, message?: string): void;
  respondToQuestion(question: QuestionRequest, reply: QuestionReply): void;
  sendSlashCommand(name: string, args?: string): string;
  registerLocalProvider(port: number, model?: ProtocolModelSpec): string;
  restoreLocalProvider(): string;
  requestContextReport(): string;
  setGoal(command: GoalCommand): string;
  requestAmbientPhrase(draft: string, requestId: number): string;
  requestAmbientSuggestion(recentUser: string, recentAgent: string, requestId: number): string;
  interrupt(): void;
  shutdown(): void;
  close(): void;
  setMessageHandler(handler: (message: SDKMessage) => void): void;
  setDoneHandler(
    handler: (result: { status: "completed" | "failed" | "cancelled"; error?: string }) => void,
  ): void;
  getSessionId(): string | null;
}

export class AnteProtocolClient implements AnteClient {
  private readonly options: ResolvedOptions;
  private readonly transport: AnteTransport;
  private onMessage: (message: SDKMessage) => void = () => {};
  private onDone: (result: {
    status: "completed" | "failed" | "cancelled";
    error?: string;
  }) => void = () => {};
  private sessionId: string | null = null;
  private onNativeEvent: (event: AnteEventEnvelope) => void = () => {};
  private suppressReplay = false;
  private replaying = false;
  private startupOperationId: string | null = null;
  private readonly liveOperations = new Set<string>();
  private readonly pendingQuestions = new Map<string, QuestionRequest>();
  private finalText = "";
  private activeInputOpId: string | null = null;
  private pendingSession: {
    targetSessionId?: string;
    resolve: (sessionId: string) => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(
    options: Options = {},
    transportFactory: (options: ResolvedOptions) => AnteTransport = createTransport,
  ) {
    this.options = resolveOptions(options);
    this.transport = transportFactory(this.options);
  }

  async connect(): Promise<void> {
    this.transport.setMessageHandler((line) => {
      try { this.handleTransportMessage(line); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.pendingQuestions.clear();
        this.rejectPendingSession(new Error(message));
        this.emitDone({ status: "failed", error: message });
      }
    });
    this.transport.setDiagnosticHandler((event) => {
      this.options.stderr?.(event.text);
      this.emit({
        type: "system",
        subtype: "diagnostic",
        stream: event.stream,
        text: event.text,
        session_id: this.sessionId ?? undefined,
      });
    });
    this.transport.setErrorHandler((error) => {
      this.pendingQuestions.clear();
      this.rejectPendingSession(error);
      this.emitDone({ status: "failed", error: error.message });
    });
    this.transport.setCloseHandler((info) => {
      this.pendingQuestions.clear();
      if (info?.reason === "SIGTERM") {
        this.rejectPendingSession(new Error("Ante server exited after SIGTERM"));
        this.emitDone({ status: "cancelled" });
        return;
      }
      const error = new Error(`Ante server exited with code ${info?.code ?? "unknown"}`);
      this.rejectPendingSession(error);
      this.emitDone({ status: "failed", error: error.message });
    });
    await this.transport.connect();
  }

  setNativeEventHandler(handler: (event: AnteEventEnvelope) => void, options: { suppressReplay?: boolean } = {}): void {
    this.onNativeEvent = handler;
    this.suppressReplay = options.suppressReplay === true;
  }

  getPendingQuestion(turnId: string, toolUseId: string): QuestionRequest | null {
    return this.pendingQuestions.get(`${turnId}:${toolUseId}`) ?? null;
  }

  startSession(): Promise<string> {
    return this.beginSession({ StartSession: buildStartSessionPayload(this.options) });
  }

  resumeSession(sessionId: string, options?: { unattended?: boolean }): Promise<string> {
    return this.beginSession({ ResumeSession: { session_id: sessionId, unattended: options?.unattended } }, sessionId);
  }

  private beginSession(operation: AnteOperation, sessionId?: string): Promise<string> {
    this.pendingQuestions.clear();
    this.liveOperations.clear();
    this.activeInputOpId = null;
    this.finalText = "";
    this.replaying = this.suppressReplay && sessionId !== undefined;
    this.startupOperationId = generateOpId();
    const result = this.createPendingSession(sessionId);
    try { this.transport.send(serializeOperation(operation, this.startupOperationId)); }
    catch (error) { this.rejectPendingSession(error instanceof Error ? error : new Error(String(error))); }
    return result;
  }

  updateSession(update: SessionUpdate): void {
    if (update.permissionMode) {
      this.options.permissionMode = update.permissionMode;
    }
    if (update.model) {
      this.options.model = typeof update.model === "string" ? update.model : update.model.id;
    }
    if (update.effort) {
      this.options.effort = update.effort;
    }
    this.sendOperation({
      UpdateSession: {
        model: update.model
          ? {
              ...(typeof update.model === "string" ? { id: update.model } : update.model),
              effort:
                update.effort ?? (typeof update.model === "string" ? undefined : update.model.effort),
            }
          : undefined,
        permission_mode: update.permissionMode ? permissionModeToAnte(update.permissionMode) : undefined,
        title: update.title,
      },
    });
  }

  sendUserInput(prompt: string): string {
    this.finalText = "";
    const opId = generateOpId();
    this.activeInputOpId = opId;
    this.liveOperations.add(opId);
    this.transport.send(serializeOperation({ UserInput: prompt }, opId));
    return opId;
  }

  sendShellInput(input: string): string {
    return this.sendOperation({ ShellInput: input });
  }

  sendSteer(prompt: string): string {
    return this.sendOperation({ Steer: prompt });
  }

  respondToApproval(approval: ApprovalRequest, decision: ApprovalDecision, message?: string): void {
    this.sendOperation(buildApprovalResponseOperation(approval, decision, message));
  }

  respondToQuestion(question: QuestionRequest, reply: QuestionReply): void {
    const key = `${question.turnId}:${question.toolUseId}`;
    const pending = this.pendingQuestions.get(key);
    if (!pending) throw new Error("Ante question is no longer pending");
    validateQuestionReply(pending, reply);
    this.pendingQuestions.delete(key);
    try { this.sendOperation({
      QuestionResponse: { turn_id: question.turnId, tool_use_id: question.toolUseId, reply },
    }); } catch (error) { this.pendingQuestions.set(key, pending); throw error; }
  }

  respondToToolApprovals(turnId: string, decisions: Array<{ toolUseId: string; decision: ApprovalDecision; message?: string }>): void {
    if (!turnId.trim() || decisions.length === 0 || new Set(decisions.map((item) => item.toolUseId)).size !== decisions.length) {
      throw new Error("Invalid Ante approval decisions");
    }
    this.sendOperation({ ApprovalResponse: { turn_id: turnId, responses: decisions.map((item) => ({
      tool_use_id: item.toolUseId, decision: item.decision, ...(item.message !== undefined ? { message: item.message } : {}),
    })) } });
  }

  sendSlashCommand(name: string, args = ""): string {
    return this.sendOperation({ SlashCommand: { name, args } });
  }

  registerLocalProvider(port: number, model?: ProtocolModelSpec): string {
    assertUnsignedInteger(port, 65_535, "port");
    return this.sendOperation({ RegisterLocalProvider: { port, model } });
  }

  restoreLocalProvider(): string {
    return this.sendOperation("RestoreLocalProvider");
  }

  requestContextReport(): string {
    return this.sendOperation("ContextReport");
  }

  setGoal(command: GoalCommand): string {
    return this.sendOperation({ Goal: command });
  }

  requestAmbientPhrase(draft: string, requestId: number): string {
    assertUnsignedInteger(requestId, Number.MAX_SAFE_INTEGER, "requestId");
    return this.sendOperation({ AmbientPhrase: { draft, req_id: requestId } });
  }

  requestAmbientSuggestion(recentUser: string, recentAgent: string, requestId: number): string {
    assertUnsignedInteger(requestId, Number.MAX_SAFE_INTEGER, "requestId");
    return this.sendOperation({
      AmbientSuggestion: { recent_user: recentUser, recent_agent: recentAgent, req_id: requestId },
    });
  }

  interrupt(): void {
    this.pendingQuestions.clear();
    this.sendOperation("Interrupt");
  }

  compact(instructions?: string): void {
    this.sendOperation({ Compact: { instructions } });
  }

  shutdown(): void {
    this.pendingQuestions.clear();
    this.sendOperation("Shutdown");
  }

  close(): void {
    this.pendingQuestions.clear();
    this.rejectPendingSession(new Error("Ante client closed"));
    this.transport.disconnect();
  }

  setMessageHandler(handler: (message: SDKMessage) => void): void {
    this.onMessage = handler;
  }

  setDoneHandler(
    handler: (result: { status: "completed" | "failed" | "cancelled"; error?: string }) => void,
  ): void {
    this.onDone = handler;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  private sendOperation(op: AnteOperation): string {
    const opId = generateOpId();
    this.liveOperations.add(opId);
    this.transport.send(serializeOperation(op, opId));
    return opId;
  }

  private handleTransportMessage(line: string): void {
    const envelope = parseEnvelope(line);
    if (!envelope) {
      this.emit({
        type: "system",
        subtype: "diagnostic",
        stream: "stdout",
        text: line,
        session_id: this.sessionId ?? undefined,
      });
      return;
    }

    const variant = getVariant(envelope.event);
    if (!variant) {
      return;
    }
    if (this.replaying) {
      if (envelope.parent && this.liveOperations.has(envelope.parent)) this.replaying = false;
      else if (envelope.parent !== this.startupOperationId) return;
    }
    if (variant.name === "TurnResume" || variant.name === "TurnEnd" || variant.name === "SessionEnd") {
      this.pendingQuestions.clear();
    }
    if (variant.name === "TurnPause") {
      const question = extractTurnPauseQuestion(variant.payload);
      if (question) this.pendingQuestions.set(`${question.turnId}:${question.toolUseId}`, question);
    }
    this.onNativeEvent(envelope);
    if (
      !this.isLifecycleVariant(variant.name) &&
      this.activeInputOpId &&
      envelope.parent &&
      envelope.parent !== this.activeInputOpId
    ) {
      return;
    }
    this.handleVariant(variant.name, variant.payload);
  }

  private handleVariant(name: string, payload: unknown): void {
    switch (name) {
      case "SessionStart": {
        this.sessionId = extractSessionId(payload) ?? this.sessionId;
        const modelSpec = extractSessionModelSpec(payload);
        const providerSpec = extractSessionProviderSpec(payload);
        this.resolvePendingSession(this.sessionId);
        this.emit({
          type: "system",
          subtype: "init",
          session_id: this.sessionId ?? "",
          cwd: this.options.cwd,
          model: modelSpec?.name ?? this.options.model,
          provider: providerSpec?.name ?? this.options.provider,
          modelSpec: modelSpec ?? undefined,
          providerSpec: providerSpec ?? undefined,
          permissionMode: this.options.permissionMode,
        });
        return;
      }
      case "SessionUpdated": {
        // Fired after `UpdateSession` (or another mid-session config change)
        // confirms the daemon's new model/provider/permission state.
        const modelSpec = extractSessionModelSpec(payload);
        const providerSpec = extractSessionProviderSpec(payload);
        this.emit({
          type: "system",
          subtype: "init",
          session_id: this.sessionId ?? "",
          cwd: this.options.cwd,
          model: modelSpec?.name ?? this.options.model,
          provider: providerSpec?.name ?? this.options.provider,
          modelSpec: modelSpec ?? undefined,
          providerSpec: providerSpec ?? undefined,
          permissionMode: this.options.permissionMode,
        });
        return;
      }
      case "TurnResume": {
        const turnId =
          payload && typeof payload === "object" && !Array.isArray(payload)
            ? (payload as Record<string, unknown>).turn_id
            : undefined;
        this.emit({
          type: "turn",
          phase: "resume",
          turnId: typeof turnId === "string" && turnId.trim() ? turnId.trim() : undefined,
          session_id: this.sessionId ?? undefined,
        });
        return;
      }
      case "UserInput": {
        const message = extractText(payload);
        if (message) this.emit({ type: "user", message, session_id: this.sessionId ?? undefined });
        return;
      }
      case "ShellOutput": {
        const output = extractShellOutput(payload);
        if (output) this.emit({ type: "shell_output", output, session_id: this.sessionId ?? undefined });
        return;
      }
      case "MessageDelta": {
        const text = extractText(payload);
        if (text) {
          this.finalText += text;
          this.emit({
            type: "stream_event",
            event: { type: "text_delta", text },
            session_id: this.sessionId ?? undefined,
          });
        }
        return;
      }
      case "ThinkingDelta": {
        const text = extractText(payload);
        if (text) {
          this.emit({
            type: "stream_event",
            event: { type: "thinking_delta", text },
            session_id: this.sessionId ?? undefined,
          });
        }
        return;
      }
      case "Thinking": {
        const text = extractText(payload);
        if (text.trim()) {
          this.emit({
            type: "stream_event",
            event: { type: "thinking_delta", text },
            session_id: this.sessionId ?? undefined,
          });
        }
        return;
      }
      case "AgentMessage": {
        const text = extractText(payload);
        if (text) {
          this.finalText = text;
          this.emit({
            type: "assistant",
            message: { content: [{ type: "text", text }] },
            session_id: this.sessionId ?? undefined,
          });
        }
        return;
      }
      case "TurnStart": {
        const turnId =
          payload && typeof payload === "object" && !Array.isArray(payload)
            ? (payload as Record<string, unknown>).turn_id
            : undefined;
        this.emit({
          type: "turn",
          phase: "start",
          turnId: typeof turnId === "string" && turnId.trim() ? turnId.trim() : undefined,
          session_id: this.sessionId ?? undefined,
        });
        return;
      }
      case "TaskEnd": {
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
          const task = payload as Record<string, unknown>;
          if (typeof task.tool_use_id === "string" && (task.exit_code == null || Number.isInteger(task.exit_code))) {
            this.emit({ type: "task_end", toolUseId: task.tool_use_id, exitCode: typeof task.exit_code === "number" ? task.exit_code : null, session_id: this.sessionId ?? undefined });
          }
        }
        return;
      }
      case "ToolUpdate": {
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
          const update = payload as Record<string, unknown>;
          if (
            typeof update.tool_use_id === "string" &&
            typeof update.seq === "number" &&
            typeof update.message === "string"
          ) {
            this.emit({
              type: "tool_update",
              toolUseId: update.tool_use_id,
              seq: update.seq,
              message: update.message,
              session_id: this.sessionId ?? undefined,
            });
          }
        }
        return;
      }
      case "ToolStart":
      case "ToolEnd": {
        const tool = extractToolCall(name, payload);
        if (tool) {
          this.emit({
            type: "tool",
            phase: name === "ToolStart" ? "start" : "end",
            tool,
            session_id: this.sessionId ?? undefined,
          });
          return;
        }
        const process = buildProcessLaneFromToolPayload(name, payload, undefined);
        this.emit({
          type: "system",
          subtype: "diagnostic",
          stream: "system",
          text: process?.label ?? `Ante ${name}`,
          session_id: this.sessionId ?? undefined,
        });
        return;
      }
      case "TurnPause": {
        const approval = extractTurnPauseApproval(payload);
        if (approval) {
          this.emit({ type: "approval", approval, session_id: this.sessionId ?? undefined });
          return;
        }
        const question = extractTurnPauseQuestion(payload);
        if (question) this.emit({ type: "question", question, session_id: this.sessionId ?? undefined });
        return;
      }
      case "ExtensionRefreshed": {
        const { skills, subagents, mcpServers } = extractExtensionRefreshed(payload);
        this.emit({
          type: "extensions",
          skills,
          subagents,
          mcpServers,
          session_id: this.sessionId ?? undefined,
        });
        return;
      }
      case "UsageUpdate":
        this.emit({
          type: "usage",
          usage: extractUsage(payload),
          session_id: this.sessionId ?? undefined,
        });
        return;
      case "CompactStart":
        this.emit({
          type: "system",
          subtype: "status",
          status: "compacting",
          session_id: this.sessionId ?? undefined,
        });
        return;
      case "CompactEnd": {
          const summary =
            payload && typeof payload === "object" && !Array.isArray(payload)
              ? (payload as Record<string, unknown>).summary
              : undefined;
          this.emit({
            type: "system",
            subtype: "status",
            status: null,
            summary: typeof summary === "string" ? summary : undefined,
            session_id: this.sessionId ?? undefined,
          });
          return;
      }
      case "InfoBlockStart": {
        const block = extractInfoBlock(payload, "start");
        if (block) this.emit({ type: "info_block", phase: "start", block, session_id: this.sessionId ?? undefined });
        return;
      }
      case "InfoBlockAppend": {
        const block = extractInfoBlock(payload, "append");
        if (block) this.emit({ type: "info_block", phase: "append", block, session_id: this.sessionId ?? undefined });
        return;
      }
      case "ContextReport": {
        const context = extractContextBreakdown(payload);
        if (context) this.emit({ type: "context", context, session_id: this.sessionId ?? undefined });
        return;
      }
      case "Ambient": {
        const ambient = extractAmbient(payload);
        if (ambient) this.emit({ type: "ambient", ...ambient, session_id: this.sessionId ?? undefined });
        return;
      }
      case "Info":
      case "Goodbye":
        this.emit({
          type: "system",
          subtype: "diagnostic",
          stream: "system",
          text: extractInfoMessage(payload) ?? name,
          session_id: this.sessionId ?? undefined,
        });
        return;
      case "Error": {
        const error = extractErrorMessage(payload);
        this.emit({
          type: "result",
          subtype: "error",
          error,
          session_id: this.sessionId ?? undefined,
        });
        this.rejectPendingSession(new Error(error));
        this.finalText = "";
        this.activeInputOpId = null;
        this.emitDone({ status: "failed", error });
        return;
      }
      case "TurnEnd": {
        const status = extractTurnStatus(payload)?.toLowerCase();
        const interrupted = Boolean(
          status && ["interrupted", "cancelled", "canceled", "aborted"].includes(status),
        );
        const failed = Boolean(status && ["error", "failed", "failure"].includes(status));
        if (interrupted) {
          this.emit({
            type: "result",
            subtype: "cancelled",
            session_id: this.sessionId ?? undefined,
          });
          this.finalText = "";
          this.activeInputOpId = null;
          this.emitDone({ status: "cancelled" });
          return;
        }
        if (failed) {
          const error = extractErrorMessage(payload);
          this.emit({
            type: "result",
            subtype: "error",
            error,
            session_id: this.sessionId ?? undefined,
          });
          this.finalText = "";
          this.activeInputOpId = null;
          this.emitDone({ status: "failed", error });
          return;
        }
        this.emit({
          type: "result",
          subtype: "success",
          result: this.finalText,
          session_id: this.sessionId ?? undefined,
        });
        this.finalText = "";
        this.activeInputOpId = null;
        this.emitDone({ status: "completed" });
        return;
      }
      case "SessionEnd": {
        // `SessionEnd { reason: "Replaced" }` fires for the *previous* session
        // whenever `ResumeSession`/`StartSession` swaps in a new one — it is
        // not terminal. Only `"Shutdown"` means the daemon is going away.
        const reason =
          payload && typeof payload === "object" && !Array.isArray(payload)
            ? (payload as Record<string, unknown>).reason
            : undefined;
        const sessionId =
          payload && typeof payload === "object" && !Array.isArray(payload)
            ? (payload as Record<string, unknown>).session_id
            : undefined;
        if (typeof sessionId === "string" && typeof reason === "string") {
          this.emit({
            type: "session_end",
            sessionId,
            reason,
            usage: extractUsage(payload),
            session_id: this.sessionId ?? undefined,
          });
        }
        if (reason === "Shutdown") {
          this.close();
        }
        return;
      }
      default:
        return;
    }
  }

  private emit(message: SDKMessage): void {
    this.onMessage(message);
  }

  private emitDone(result: { status: "completed" | "failed" | "cancelled"; error?: string }): void {
    this.onDone(result);
  }

  private createPendingSession(targetSessionId?: string): Promise<string> {
    if (this.pendingSession) {
      this.pendingSession.reject(new Error("Ante session transition was superseded"));
    }
    return new Promise((resolve, reject) => {
      this.pendingSession = {
        targetSessionId,
        resolve,
        reject,
      };
    });
  }

  private resolvePendingSession(sessionId: string | null): void {
    const pending = this.pendingSession;
    if (!pending || !sessionId) {
      return;
    }
    if (pending.targetSessionId && pending.targetSessionId !== sessionId) {
      return;
    }
    this.pendingSession = null;
    pending.resolve(sessionId);
  }

  private rejectPendingSession(error: Error): void {
    const pending = this.pendingSession;
    if (!pending) {
      return;
    }
    this.pendingSession = null;
    pending.reject(error);
  }

  private isLifecycleVariant(name: string): boolean {
    // ExtensionRefreshed fires a second time in the background once MCP
    // warm-up completes (see docs.antigma.ai/reference/protocol-reference),
    // often after the caller has already started the next turn — it must
    // not be dropped by the active-turn `parent` filter below.
    return (
      name === "SessionStart" ||
      name === "SessionUpdated" ||
      name === "Error" ||
      name === "SessionEnd" ||
      name === "ExtensionRefreshed" ||
      name === "UserInput" ||
      name === "ShellOutput" ||
      name === "ToolUpdate" ||
      name === "InfoBlockStart" ||
      name === "InfoBlockAppend" ||
      name === "ContextReport" ||
      name === "Ambient"
    );
  }
}

export const createAnteClient = (options?: Options): AnteClient => new AnteProtocolClient(options);
