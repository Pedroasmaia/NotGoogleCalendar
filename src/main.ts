import { App, MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf, ItemView, Modal } from "obsidian";
import { Calendar } from "@fullcalendar/core";
import interactionPlugin from "@fullcalendar/interaction";
import timeGridPlugin from "@fullcalendar/timegrid";

const VIEW_TYPE = "tasks-calendar-view";
const SESSION_RE = /^\s*- 🗓️\s+(\d{4}-\d{2}-\d{2})(?:\s+⏰\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2}))?\s*$/;

interface TaskStatus { symbol: string; name: string; type: string }
interface Session { line?: number; date: string; start?: string; end?: string }
interface TaskItem {
  file: TFile; line: number; text: string; due: string; dueTime?: string;
  status: string; sessions: Session[]; hours: number; marker: string;
}

class TasksCalendarView extends ItemView {
  calendar?: Calendar;
  constructor(leaf: WorkspaceLeaf, private plugin: TasksCalendarPlugin) { super(leaf); }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Tasks Calendar"; }
  getIcon(): string { return "calendar-days"; }
  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("tasks-calendar-host");
    this.calendar = new Calendar(this.contentEl, {
      plugins: [timeGridPlugin, interactionPlugin], initialView: "timeGridWeek",
      firstDay: 1, height: "100%", nowIndicator: true, editable: true,
      selectable: true, selectMirror: true, dayMaxEvents: true,
      slotDuration: "00:30:00", snapDuration: "00:15:00", slotLabelInterval: "01:00",
      slotMinTime: "06:00:00", slotMaxTime: "24:00:00", allDaySlot: true,
      eventDurationEditable: true, eventStartEditable: true,
      headerToolbar: { left: "prev,next today", center: "title", right: "timeGridWeek" },
      buttonText: { today: "Today", week: "Week" },
      events: async (_info, success) => success(await this.plugin.getCalendarEvents()),
      eventClick: (info) => this.plugin.openTask(info.event.extendedProps.task as TaskItem),
      select: (info) => this.plugin.promptNewTask(info.start, info.end),
      eventDrop: async (info) => { if (!(await this.plugin.moveSession(info.event.extendedProps.task as TaskItem, info.event.extendedProps.session as Session, info.event.start!, info.event.end!))) info.revert(); },
      eventResize: async (info) => { if (!(await this.plugin.moveSession(info.event.extendedProps.task as TaskItem, info.event.extendedProps.session as Session, info.event.start!, info.event.end!))) info.revert(); },
      eventContent: (arg) => ({ html: `<div class="tc-event-title">${this.plugin.escape(arg.event.title)}</div>` })
    });
    this.calendar.render();
    this.registerEvent(this.app.vault.on("modify", () => this.calendar?.refetchEvents()));
    this.registerEvent(this.app.vault.on("create", () => this.calendar?.refetchEvents()));
    this.registerEvent(this.app.vault.on("delete", () => this.calendar?.refetchEvents()));
  }
  async onClose(): Promise<void> { this.calendar?.destroy(); }
}

export default class TasksCalendarPlugin extends Plugin {
  statuses: TaskStatus[] = [];
  async onload(): Promise<void> {
    await this.loadTaskStatuses();
    this.registerView(VIEW_TYPE, (leaf) => new TasksCalendarView(leaf, this));
    this.addRibbonIcon("calendar-days", "Open Tasks Calendar", () => this.activateView());
    this.addCommand({ id: "open-calendar", name: "Open Tasks Calendar", callback: () => this.activateView() });
    this.addCommand({ id: "add-session-to-task", name: "Add work session to task under cursor", callback: () => this.addSessionUnderCursor() });
  }
  async onunload(): Promise<void> { this.app.workspace.detachLeavesOfType(VIEW_TYPE); }

  async activateView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  private async loadTaskStatuses(): Promise<void> {
    try {
      const raw = await this.app.vault.adapter.read(".obsidian/plugins/obsidian-tasks-plugin/data.json");
      const data = JSON.parse(raw);
      this.statuses = (data.statuses ?? data.globalFilter ?? []).filter((s: any) => s && s.symbol).map((s: any) => ({ symbol: String(s.symbol), name: String(s.name ?? ""), type: String(s.type ?? "TODO").toUpperCase() }));
    } catch { this.statuses = []; }
  }

  async getCalendarEvents(): Promise<any[]> {
    await this.loadTaskStatuses();
    const tasks: TaskItem[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const content = await this.app.vault.cachedRead(file);
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^(\s*)- \[([^\]])\]\s+(.*)$/);
        if (!match) continue;
        const marker = match[2];
        const status = this.statusType(marker);
        if (status === "CANCELLED") continue;
        const due = match[3].match(/📅\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/);
        if (!due) continue;
        const sessions: Session[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() && !/^\s+/.test(lines[j])) break;
          const sm = lines[j].match(SESSION_RE);
          if (sm) sessions.push({ line: j, date: sm[1], start: sm[2], end: sm[3] });
        }
        const hours = sessions.reduce((sum, s) => sum + this.sessionHours(s), 0);
        tasks.push({ file, line: i, text: match[3].replace(/\s*📅\s+\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?/, "").trim(), due: due[1], dueTime: due[2], status, sessions, hours, marker });
      }
    }
    return tasks.flatMap((task) => {
      const events: any[] = [];
      const total = task.hours ? ` · ${this.formatHours(task.hours)} logged` : "";
      if (task.sessions.length === 0 && task.dueTime) {
        const start = `${task.due}T${this.normalizeTime(task.dueTime)}:00`;
        const end = this.localDateTime(new Date(new Date(start).getTime() + 30 * 60000));
        events.push({ id: `due-${task.file.path}-${task.line}`, title: `Due: ${task.text}${total}`, start, end, editable: false, classNames: ["tc-due", task.status === "DONE" ? "tc-done" : ""], extendedProps: { task } });
      } else if (task.sessions.length === 0) {
        events.push({ id: `due-${task.file.path}-${task.line}`, title: `Due: ${task.text}${total}`, start: task.due, allDay: true, editable: false, classNames: ["tc-due", task.status === "DONE" ? "tc-done" : ""], extendedProps: { task } });
      }
      task.sessions.forEach((session, index) => {
        if (!session.start || !session.end) return;
        events.push({ id: `session-${task.file.path}-${session.line}-${index}`, title: `${task.text}${total}`, start: `${session.date}T${this.normalizeTime(session.start)}:00`, end: `${session.date}T${this.normalizeTime(session.end)}:00`, classNames: ["tc-session", task.status === "DONE" ? "tc-done" : ""], extendedProps: { task, session } });
      });
      return events;
    });
  }

  promptNewTask(date: Date, selectedEnd?: Date): void {
    new NewTaskModal(this.app, async (title) => {
      const cleanTitle = title.trim();
      if (!cleanTitle) return;
      const path = this.dailyNotePath(date);
      const start = new Date(date);
      start.setSeconds(0, 0);
      const end = selectedEnd && selectedEnd > start
        ? new Date(selectedEnd)
        : new Date(start.getTime() + 60 * 60000);
      const due = `${this.dateString(start)} ${this.timeString(start)}`;
      const line = `- [ ] ${cleanTitle} 📅 ${due}`;
      const sessionLine = `  - 🗓️ ${this.dateString(start)} ⏰${this.timeString(start)} - ${this.timeString(end)}`;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        const content = await this.app.vault.read(file);
        await this.app.vault.modify(file, `${content}${content.endsWith("\n") || !content ? "" : "\n"}${line}\n${sessionLine}\n`);
      } else {
        await this.ensureFolder(path.substring(0, path.lastIndexOf("/")));
        const template = await this.readDailyNoteTemplate(path, date);
        const content = template ? `${template}${template.endsWith("\n") ? "" : "\n"}${line}\n${sessionLine}\n` : `${line}\n${sessionLine}\n`;
        await this.app.vault.create(path, content);
        await this.processTemplaterTemplate(path);
      }
    }).open();
  }

  private dailyNotePath(date: Date): string {
    const internalPlugins = (this.app as any).internalPlugins;
    const dailyNotes = internalPlugins?.getEnabledPluginById?.("daily-notes")
      ?? internalPlugins?.plugins?.["daily-notes"]?.instance;
    const options = dailyNotes?.options ?? {};
    const format = options.format || "YYYY-MM-DD";
    const filename = (window as any).moment
      ? (window as any).moment(date).format(format)
      : this.dateString(date);
    const folder = String(options.folder ?? "").replace(/^\/+|\/+$/g, "");
    return `${folder ? `${folder}/` : ""}${filename}.md`;
  }

  private async readDailyNoteTemplate(dailyNotePath: string, date: Date): Promise<string> {
    const internalPlugins = (this.app as any).internalPlugins;
    const dailyNotes = internalPlugins?.getEnabledPluginById?.("daily-notes")
      ?? internalPlugins?.plugins?.["daily-notes"]?.instance;
    const templatePath = dailyNotes?.options?.template;
    if (!templatePath) return "";
    const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
    if (!(templateFile instanceof TFile)) return "";

    const templatePlugin = internalPlugins?.getEnabledPluginById?.("templates")
      ?? internalPlugins?.plugins?.templates?.instance;
    const dateFormat = templatePlugin?.options?.dateFormat || "YYYY-MM-DD";
    const timeFormat = templatePlugin?.options?.timeFormat || "HH:mm";
    const moment = (window as any).moment;
    const noteTitle = dailyNotePath.substring(dailyNotePath.lastIndexOf("/") + 1).replace(/\.md$/i, "");
    return (await this.app.vault.read(templateFile)).replace(/\{\{\s*(date|time|title)(?::([^}]+))?\s*\}\}/gi, (_match, variable: string, format: string | undefined) => {
      if (variable.toLowerCase() === "title") return noteTitle;
      if (!moment) return variable.toLowerCase() === "date" ? this.dateString(date) : this.timeString(date);
      const value = variable.toLowerCase() === "date" ? date : new Date();
      return moment(value).format(format || (variable.toLowerCase() === "date" ? dateFormat : timeFormat));
    });
  }

  private async processTemplaterTemplate(path: string): Promise<void> {
    const internalPlugins = (this.app as any).internalPlugins;
    const templater = internalPlugins?.getEnabledPluginById?.("templater-obsidian")
      ?? internalPlugins?.plugins?.["templater-obsidian"]?.instance;
    if (!templater?.templater?.overwrite_file_commands) {
      new Notice("Ative o Templater para processar os comandos do template da nota diária.");
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await templater.templater.overwrite_file_commands(file);
  }

  private async ensureFolder(folder: string): Promise<void> {
    if (!folder || this.app.vault.getAbstractFileByPath(folder)) return;
    const parent = folder.substring(0, folder.lastIndexOf("/"));
    if (parent) await this.ensureFolder(parent);
    await this.app.vault.createFolder(folder);
  }

  async moveSession(task: TaskItem, session: Session, start: Date, end: Date): Promise<boolean> {
    if (!start || !end || end <= start) return false;
    const content = await this.app.vault.read(task.file);
    const lines = content.split("\n");
    const current = lines[session.line]?.match(SESSION_RE);
    if (!current) { new Notice("Session line changed; reload the calendar and try again."); return false; }
    lines[session.line] = `  - 🗓️ ${this.dateString(start)} ⏰${this.timeString(start)} - ${this.timeString(end)}`;
    await this.app.vault.modify(task.file, lines.join("\n"));
    return true;
  }

  async openTask(task: TaskItem): Promise<void> {
    if (!task) return;
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(task.file);
    const view = leaf.view;
    if (view instanceof MarkdownView) view.editor.setCursor({ line: task.line, ch: 0 });
  }

  private async addSessionUnderCursor(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;
    const line = view.editor.getCursor().line;
    const content = await this.app.vault.cachedRead(view.file!);
    const lines = content.split("\n");
    let taskLine = line;
    while (taskLine >= 0 && !/^\s*- \[[^\]]\]/.test(lines[taskLine])) taskLine--;
    const match = lines[taskLine]?.match(/^\s*- \[([^\]])\]\s+(.*)$/);
    if (!match) { new Notice("Place the cursor on a Tasks item first."); return; }
    const task = (await this.getTasks()).find(t => t.file.path === view.file!.path && t.line === taskLine);
    if (!task) { new Notice("This task needs a 📅 due date to appear in the calendar."); return; }
    const start = new Date(); start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0);
    const end = new Date(start.getTime() + 60 * 60000);
    await this.writeSession(task, { date: this.dateString(start), start: this.timeString(start), end: this.timeString(end) });
    await this.activateView();
  }

  private async writeSession(task: TaskItem, session: Session): Promise<void> {
    const content = await this.app.vault.read(task.file);
    const lines = content.split("\n");
    let insert = task.line + 1;
    while (insert < lines.length && (!lines[insert].trim() || /^\s+/.test(lines[insert]))) {
      if (/^\s*- \[/.test(lines[insert])) break;
      insert++;
    }
    lines.splice(insert, 0, `  - 🗓️ ${session.date} ⏰${session.start} - ${session.end}`);
    await this.app.vault.modify(task.file, lines.join("\n"));
  }

  private async getTasks(): Promise<TaskItem[]> {
    const events = await this.getCalendarEvents();
    const byKey = new Map<string, TaskItem>();
    for (const e of events) { const t = e.extendedProps.task as TaskItem; byKey.set(`${t.file.path}:${t.line}`, t); }
    return [...byKey.values()];
  }
  private statusType(marker: string): string { return this.statuses.find(s => s.symbol === marker)?.type ?? (marker.toLowerCase() === "x" ? "DONE" : marker === "-" ? "CANCELLED" : "TODO"); }
  private sessionHours(s: Session): number { if (!s.start || !s.end) return 0; const [sh, sm] = s.start.split(":").map(Number); const [eh, em] = s.end.split(":").map(Number); return Math.max(0, (eh * 60 + em - sh * 60 - sm) / 60); }
  private formatHours(hours: number): string { return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`; }
  private normalizeTime(t: string): string { return t.length === 4 ? `0${t}` : t; }
  private localDateTime(d: Date): string { return `${this.dateString(d)}T${this.timeString(d)}:00`; }
  private dateString(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  private timeString(d: Date): string { return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
  escape(value: string): string { const div = document.createElement("div"); div.textContent = value; return div.innerHTML; }
}

class NewTaskModal extends Modal {
  constructor(app: App, private onSave: (title: string) => Promise<void>) { super(app); }

  onOpen(): void {
    this.setTitle("Nova tarefa");
    const input = this.contentEl.createEl("input", { type: "text", placeholder: "Digite o nome da tarefa" });
    input.addClass("tc-new-task-input");
    const actions = this.contentEl.createDiv({ cls: "tc-new-task-actions" });
    const cancel = actions.createEl("button", { text: "Cancelar" });
    cancel.addEventListener("click", () => this.close());
    const save = actions.createEl("button", { text: "Criar tarefa", cls: "mod-cta" });
    const submit = async () => {
      if (!input.value.trim()) { input.focus(); return; }
      save.disabled = true;
      try {
        await this.onSave(input.value);
        this.close();
      } catch (error) {
        console.error("Tasks Calendar: could not create task", error);
        new Notice("Não foi possível criar a tarefa.");
        save.disabled = false;
      }
    };
    save.addEventListener("click", () => void submit());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); void submit(); }
    });
    window.setTimeout(() => input.focus(), 0);
  }
}
