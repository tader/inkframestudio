import { LitElement, css, html, nothing } from "lit";
import "monaco-editor/esm/vs/editor/browser/controller/editContext/native/nativeEditContext.css";
import "monaco-editor/esm/vs/editor/browser/controller/editContext/textArea/textAreaEditContext.css";

type MonacoModule = typeof import("monaco-editor/esm/vs/editor/editor.main.js");

function shouldUseFallbackEditor(): boolean {
  return /jsdom/i.test(globalThis.navigator?.userAgent ?? "");
}

async function loadMonaco(): Promise<MonacoModule | undefined> {
  if (shouldUseFallbackEditor()) {
    return undefined;
  }
  const globalScope = globalThis as typeof globalThis & {
    MonacoEnvironment?: { getWorker?: () => Worker };
  };
  if (!globalScope.MonacoEnvironment) {
    globalScope.MonacoEnvironment = {
      getWorker: () => {
        const blob = new Blob(["self.onmessage = function () {};"], { type: "text/javascript" });
        return new Worker(URL.createObjectURL(blob), { type: "classic" });
      }
    };
  }
  return import("monaco-editor/esm/vs/editor/editor.main.js").catch(() => undefined);
}

export class CodeEditorField extends LitElement {
  private static monacoThemeDefined = false;

  static properties = {
    value: { type: String },
    language: { type: String },
    placeholder: { type: String },
    singleLine: { type: Boolean, attribute: "single-line" },
    minLines: { type: Number, attribute: "min-lines" },
    readOnly: { type: Boolean, attribute: "read-only" }
  };

  static styles = css`
    :host {
      display: block;
    }

    .host,
    input,
    textarea {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #c8c8c8;
      border-radius: 10px;
      background: #fff;
      color: #111;
      font: inherit;
    }

    .host {
      min-height: 38px;
      overflow: hidden;
    }

    .host.multiline {
      min-height: calc(var(--code-editor-lines, 4) * 20px + 18px);
    }

    input,
    textarea {
      padding: 8px 10px;
    }

    textarea {
      min-height: calc(var(--code-editor-lines, 4) * 20px + 18px);
      resize: vertical;
    }
  `;

  private static readonly MONACO_RUNTIME_CSS = `
    .monaco-editor {
      position: relative;
      overflow: visible;
      -webkit-text-size-adjust: 100%;
      overflow-wrap: initial;
    }

    .monaco-editor .overflow-guard {
      position: relative;
      overflow: hidden;
    }

    .monaco-editor .editorCanvas {
      position: absolute;
      width: 100%;
      height: 100%;
      z-index: 0;
      pointer-events: none;
    }

    .monaco-editor .view-overlays,
    .monaco-editor .cursors-layer {
      position: absolute;
      top: 0;
    }

    .monaco-editor .view-overlays > div,
    .monaco-editor .margin-view-overlays > div,
    .monaco-editor .cursors-layer > .cursor {
      position: absolute;
      width: 100%;
      box-sizing: border-box;
    }

    .monaco-editor .view-lines {
      white-space: nowrap;
    }

    .monaco-editor .view-line {
      box-sizing: border-box;
      position: absolute;
      width: 100%;
    }

    .monaco-editor .lines-content > .view-lines > .view-line > span {
      top: 0;
      bottom: 0;
      position: absolute;
    }

    .monaco-editor .native-edit-context {
      margin: 0;
      padding: 0;
      position: absolute;
      overflow-y: scroll;
      scrollbar-width: none;
      z-index: -10;
      white-space: pre-wrap;
      pointer-events: none;
    }

    .monaco-editor .ime-text-area,
    .monaco-editor .inputarea {
      min-width: 0;
      min-height: 0;
      margin: 0;
      padding: 0;
      position: absolute;
      outline: none !important;
      resize: none;
      border: none;
      overflow: hidden;
      color: transparent;
      background-color: transparent;
      z-index: -10;
      pointer-events: none;
    }

    .monaco-editor .inputarea.ime-input {
      z-index: 10;
      caret-color: var(--vscode-editorCursor-foreground);
      color: var(--vscode-editor-foreground);
    }
  `;

  declare value: string;
  declare language: string;
  declare placeholder: string;
  declare singleLine: boolean;
  declare minLines: number;
  declare readOnly: boolean;

  private monaco?: MonacoModule;
  private editor?: import("monaco-editor").editor.IStandaloneCodeEditor;
  private model?: import("monaco-editor").editor.ITextModel;
  private resizeObserver?: ResizeObserver;
  private usingFallback = false;
  private suppressModelSync = false;

  constructor() {
    super();
    this.value = "";
    this.language = "plaintext";
    this.placeholder = "";
    this.singleLine = false;
    this.minLines = 1;
    this.readOnly = false;
    this.usingFallback = shouldUseFallbackEditor();
  }

  createRenderRoot(): this {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.style.display = "block";
    this.style.width = "100%";
    this.style.position = "relative";
  }

  render() {
    if (this.usingFallback) {
      return this.singleLine
        ? html`<input
            style="width:100%;box-sizing:border-box;border:1px solid #c8c8c8;border-radius:10px;background:#fff;color:#111;font:inherit;padding:8px 10px;"
            .value=${this.value}
            ?readonly=${this.readOnly}
            placeholder=${this.placeholder}
            @input=${(event: Event) => this.onFallbackInput((event.target as HTMLInputElement).value)}
            @change=${(event: Event) => this.onFallbackChange((event.target as HTMLInputElement).value)}
          />`
        : html`<textarea
            rows=${Math.max(1, this.minLines)}
            .value=${this.value}
            ?readonly=${this.readOnly}
            placeholder=${this.placeholder}
            style=${`width:100%;box-sizing:border-box;border:1px solid #c8c8c8;border-radius:10px;background:#fff;color:#111;font:inherit;padding:8px 10px;min-height:calc(${Math.max(1, this.minLines)} * 20px + 18px);resize:vertical;`}
            @input=${(event: Event) => this.onFallbackInput((event.target as HTMLTextAreaElement).value)}
            @change=${(event: Event) => this.onFallbackChange((event.target as HTMLTextAreaElement).value)}
          ></textarea>`;
    }
    return html`<style>${CodeEditorField.MONACO_RUNTIME_CSS}</style><div
      class="host ${this.singleLine ? "single-line" : "multiline"}"
      style=${`width:100%;box-sizing:border-box;border:1px solid #c8c8c8;border-radius:10px;background:#fff;color:#111;overflow:hidden;position:relative;min-height:${this.singleLine ? 38 : Math.max(1, this.minLines) * 20 + 18}px;`}
    ></div>`;
  }

  async firstUpdated(): Promise<void> {
    if (this.usingFallback) {
      return;
    }
    this.monaco = await loadMonaco();
    if (!this.monaco) {
      this.usingFallback = true;
      this.requestUpdate();
      return;
    }
    this.usingFallback = false;
    const host = this.querySelector(".host");
    if (!(host instanceof HTMLElement)) {
      this.usingFallback = true;
      this.requestUpdate();
      return;
    }
    if (!CodeEditorField.monacoThemeDefined) {
      this.monaco.editor.defineTheme("epaper-editor-light", {
        base: "vs",
        inherit: true,
        rules: [],
        colors: {
          "editor.background": "#ffffff",
          "editor.foreground": "#111111",
          "editorLineNumber.foreground": "#777777",
          "editorLineNumber.activeForeground": "#111111",
          "editorCursor.foreground": "#111111",
          "editor.selectionBackground": "#b7d4ff",
          "editor.inactiveSelectionBackground": "#dbeafe",
          "editor.selectionHighlightBackground": "#dbeafe88",
          "editor.wordHighlightBackground": "#dbeafe66",
          "editor.wordHighlightStrongBackground": "#bfdbfe88",
          "editorWhitespace.foreground": "#9ca3af",
          "editorIndentGuide.background1": "#d1d5db",
          "editorIndentGuide.activeBackground1": "#9ca3af"
        }
      });
      CodeEditorField.monacoThemeDefined = true;
    }
    const lineNumbers = this.singleLine ? "off" : "on";
    this.model = this.monaco.editor.createModel(this.value, this.language);
    this.editor = this.monaco.editor.create(host, {
      theme: "epaper-editor-light",
      model: this.model,
      language: this.language,
      value: this.value,
      readOnly: this.readOnly,
      editContext: false,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: this.singleLine ? "off" : "on",
      lineNumbers,
      overviewRulerLanes: 0,
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: this.singleLine ? 0 : 10,
      lineNumbersMinChars: this.singleLine ? 0 : 2,
      renderLineHighlight: "none",
      guides: { indentation: false },
      contextmenu: true,
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      parameterHints: { enabled: false },
      renderWhitespace: "all",
      renderControlCharacters: true,
      scrollbar: this.singleLine
        ? { horizontal: "hidden", vertical: "hidden", alwaysConsumeMouseWheel: false }
        : undefined,
      padding: { top: 8, bottom: 8 },
      fontSize: 12,
      tabSize: 2
    });
    this.editor.onDidChangeModelContent(() => {
      if (!this.editor || this.suppressModelSync) {
        return;
      }
      this.value = this.editor.getValue();
      this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      this.adjustHeight();
    });
    this.editor.onDidBlurEditorText(() => {
      this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    });
    this.resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => this.editor?.layout())
      : undefined;
    this.resizeObserver?.observe(host);
    this.adjustHeight();
  }

  updated(changed: Map<string, unknown>): void {
    if (this.monaco && this.model && changed.has("language")) {
      this.monaco.editor.setModelLanguage(this.model, this.language);
    }
    if (this.editor && changed.has("readOnly")) {
      this.editor.updateOptions({ readOnly: this.readOnly });
    }
    if (this.editor && changed.has("value") && this.editor.getValue() !== this.value) {
      this.suppressModelSync = true;
      this.editor.setValue(this.value);
      this.suppressModelSync = false;
      this.adjustHeight();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.editor?.dispose();
    this.model?.dispose();
  }

  private adjustHeight(): void {
    if (!this.editor) {
      return;
    }
    const host = this.querySelector(".host");
    if (!(host instanceof HTMLElement)) {
      return;
    }
    if (this.singleLine) {
      host.style.height = "38px";
      this.editor.layout();
      return;
    }
    const lineHeight = this.editor.getOption(this.monaco!.editor.EditorOption.lineHeight);
    const lineCount = Math.max(this.minLines, this.model?.getLineCount() ?? this.minLines);
    host.style.height = `${lineCount * lineHeight + 18}px`;
    this.editor.layout();
  }

  private onFallbackInput(value: string): void {
    this.value = value;
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }

  private onFallbackChange(value: string): void {
    this.value = value;
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }
}

customElements.define("code-editor-field", CodeEditorField);
