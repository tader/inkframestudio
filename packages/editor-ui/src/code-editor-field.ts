import { LitElement, css, html } from "lit";

export class CodeEditorField extends LitElement {
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
      width: 100%;
    }

    input,
    textarea {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #c8c8c8;
      border-radius: 10px;
      background: #fff;
      color: #111;
      font: inherit;
      padding: 8px 10px;
    }

    textarea {
      min-height: calc(var(--code-editor-lines, 4) * 20px + 18px);
      resize: vertical;
    }
  `;

  declare value: string;
  declare language: string;
  declare placeholder: string;
  declare singleLine: boolean;
  declare minLines: number;
  declare readOnly: boolean;

  constructor() {
    super();
    this.value = "";
    this.language = "plaintext";
    this.placeholder = "";
    this.singleLine = false;
    this.minLines = 1;
    this.readOnly = false;
  }

  createRenderRoot(): this {
    return this;
  }

  render() {
    if (this.singleLine) {
      return html`<input
        .value=${this.value}
        ?readonly=${this.readOnly}
        placeholder=${this.placeholder}
        @input=${(event: Event) => this.onInputValue((event.target as HTMLInputElement).value)}
        @change=${(event: Event) => this.onChangeValue((event.target as HTMLInputElement).value)}
      />`;
    }
    return html`<textarea
      rows=${Math.max(1, this.minLines)}
      .value=${this.value}
      ?readonly=${this.readOnly}
      placeholder=${this.placeholder}
      style=${`min-height:calc(${Math.max(1, this.minLines)} * 20px + 18px);`}
      @input=${(event: Event) => this.onInputValue((event.target as HTMLTextAreaElement).value)}
      @change=${(event: Event) => this.onChangeValue((event.target as HTMLTextAreaElement).value)}
    ></textarea>`;
  }

  private onInputValue(value: string): void {
    this.value = value;
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }

  private onChangeValue(value: string): void {
    this.value = value;
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }
}

customElements.define("code-editor-field", CodeEditorField);
