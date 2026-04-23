import type { DataQueryLayoutNode, LayoutNode } from "./types.js";

export type ScopeValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ScopeValue[]
  | { [key: string]: ScopeValue };

export type ScopeContext = Record<string, ScopeValue>;

export interface ScopeTemplateOptions {
  locale?: string;
}

export interface ArrayExpressionOptions extends ScopeTemplateOptions {
  itemAlias?: string;
  indexAlias?: string;
}

export interface DataQueryNodeRef {
  ownerId: string;
  ownerKind: "layout" | "compound";
  node: DataQueryLayoutNode;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatDatePart(date: Date, locale: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options }).format(date);
}

function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let quote: "'" | "\"" | undefined;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";
    if (quote) {
      current += char;
      if (char === "\\" && index + 1 < input.length) {
        current += input[index + 1] ?? "";
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(") {
      parenDepth += 1;
      current += char;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      current += char;
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      current += char;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += char;
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      current += char;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      current += char;
      continue;
    }
    if (char === separator && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current.trim());
  return parts;
}

function parseFilterArgument(argument: string): string | number | boolean {
  const trimmed = argument.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\(["'])/g, "$1");
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  const numeric = Number(trimmed);
  if (trimmed && Number.isFinite(numeric)) {
    return numeric;
  }
  return trimmed;
}

class ScopeValueParser {
  private index = 0;

  constructor(private readonly input: string) {}

  parse(): ScopeValue {
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.index < this.input.length) {
      throw new Error("Unexpected trailing input");
    }
    return value;
  }

  private current(): string {
    return this.input[this.index] ?? "";
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.current())) {
      this.index += 1;
    }
  }

  private parseValue(): ScopeValue {
    this.skipWhitespace();
    const char = this.current();
    if (char === "[") {
      return this.parseArray();
    }
    if (char === "{") {
      return this.parseObject();
    }
    if (char === "'" || char === "\"") {
      return this.parseString();
    }
    if (char === "-" || /[0-9]/.test(char)) {
      return this.parseNumber();
    }
    const identifier = this.parseIdentifier();
    if (identifier === "true") {
      return true;
    }
    if (identifier === "false") {
      return false;
    }
    if (identifier === "null") {
      return null;
    }
    throw new Error(`Unsupported literal "${identifier}"`);
  }

  private parseArray(): ScopeValue[] {
    const values: ScopeValue[] = [];
    this.expect("[");
    this.skipWhitespace();
    if (this.current() === "]") {
      this.index += 1;
      return values;
    }
    while (this.index < this.input.length) {
      values.push(this.parseValue());
      this.skipWhitespace();
      if (this.current() === ",") {
        this.index += 1;
        this.skipWhitespace();
        continue;
      }
      this.expect("]");
      return values;
    }
    throw new Error("Unterminated array literal");
  }

  private parseObject(): { [key: string]: ScopeValue } {
    const value: Record<string, ScopeValue> = {};
    this.expect("{");
    this.skipWhitespace();
    if (this.current() === "}") {
      this.index += 1;
      return value;
    }
    while (this.index < this.input.length) {
      const key = this.parseObjectKey();
      this.skipWhitespace();
      this.expect(":");
      value[key] = this.parseValue();
      this.skipWhitespace();
      if (this.current() === ",") {
        this.index += 1;
        this.skipWhitespace();
        continue;
      }
      this.expect("}");
      return value;
    }
    throw new Error("Unterminated object literal");
  }

  private parseObjectKey(): string {
    this.skipWhitespace();
    const char = this.current();
    if (char === "'" || char === "\"") {
      return this.parseString();
    }
    return this.parseIdentifier();
  }

  private parseString(): string {
    const quote = this.current();
    if (quote !== "'" && quote !== "\"") {
      throw new Error("Expected string literal");
    }
    this.index += 1;
    let value = "";
    while (this.index < this.input.length) {
      const char = this.current();
      this.index += 1;
      if (char === "\\") {
        value += this.current();
        this.index += 1;
        continue;
      }
      if (char === quote) {
        return value;
      }
      value += char;
    }
    throw new Error("Unterminated string literal");
  }

  private parseNumber(): number {
    const start = this.index;
    if (this.current() === "-") {
      this.index += 1;
    }
    while (/[0-9]/.test(this.current())) {
      this.index += 1;
    }
    if (this.current() === ".") {
      this.index += 1;
      while (/[0-9]/.test(this.current())) {
        this.index += 1;
      }
    }
    const numeric = Number(this.input.slice(start, this.index));
    if (!Number.isFinite(numeric)) {
      throw new Error("Invalid number literal");
    }
    return numeric;
  }

  private parseIdentifier(): string {
    this.skipWhitespace();
    const start = this.index;
    const first = this.current();
    if (!/[A-Za-z_$@]/.test(first)) {
      throw new Error(`Unexpected token "${first}"`);
    }
    this.index += 1;
    while (/[A-Za-z0-9_$@-]/.test(this.current())) {
      this.index += 1;
    }
    return this.input.slice(start, this.index);
  }

  private expect(value: string): void {
    this.skipWhitespace();
    if (this.input.slice(this.index, this.index + value.length) !== value) {
      throw new Error(`Expected "${value}"`);
    }
    this.index += value.length;
  }
}

function shouldParseScopeLiteral(expression: string): boolean {
  return /^[[{\-"'0-9]/.test(expression) || expression === "true" || expression === "false" || expression === "null";
}

function parseScopeLiteral(expression: string): ScopeValue {
  return new ScopeValueParser(expression).parse();
}

function resolveScopeOrLiteralExpression(expression: string, scope: ScopeContext): ScopeValue {
  const trimmed = expression.trim();
  if (!trimmed) {
    return undefined;
  }
  if (shouldParseScopeLiteral(trimmed)) {
    try {
      return parseScopeLiteral(trimmed);
    } catch {
      return undefined;
    }
  }
  return resolveScopePath(scope, trimmed);
}

function parsePipelineInvocation(expression: string): { name: string; argumentSource: string } | undefined {
  const match = expression.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\((.*)\))?$/);
  if (!match) {
    return undefined;
  }
  return { name: match[1] ?? "", argumentSource: match[2] ?? "" };
}

function buildArrayItemScope(
  scope: ScopeContext,
  value: ScopeValue,
  index: number,
  options: ArrayExpressionOptions
): ScopeContext {
  const next: ScopeContext = {
    ...scope,
    $: value,
    item: value,
    "@index": index,
    index
  };
  if (options.itemAlias) {
    next[options.itemAlias] = value;
  }
  if (options.indexAlias) {
    next[options.indexAlias] = index;
  }
  return next;
}

function uniqueKeyPart(value: ScopeValue): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function applyArrayExpressionStage(
  values: ScopeValue[],
  stageSource: string,
  scope: ScopeContext,
  options: ArrayExpressionOptions
): ScopeValue[] {
  const invocation = parsePipelineInvocation(stageSource);
  if (!invocation) {
    return values;
  }
  const args = invocation.argumentSource.trim()
    ? splitTopLevel(invocation.argumentSource, ",").filter(Boolean)
    : [];
  if (invocation.name === "filter") {
    const condition = invocation.argumentSource.trim();
    if (!condition) {
      return values;
    }
    return values.filter((value, index) => evaluateScopeExpression(condition, buildArrayItemScope(scope, value, index, options)));
  }
  if (invocation.name === "unique") {
    const seen = new Set<string>();
    return values.filter((value, index) => {
      const itemScope = buildArrayItemScope(scope, value, index, options);
      const key = args.length
        ? args.map((argument) => uniqueKeyPart(resolveScopeOrLiteralExpression(argument, itemScope))).join("\u001f")
        : uniqueKeyPart(value);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
  if (invocation.name === "unique_by") {
    const templateValue = resolveScopeOrLiteralExpression(args[0] ?? "", scope);
    const template = typeof templateValue === "string" ? templateValue : stringifyScopeValue(templateValue);
    const seen = new Set<string>();
    return values.filter((value, index) => {
      const key = applyScopeTemplate(template, buildArrayItemScope(scope, value, index, options), options);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
  return values;
}

function zeroPad(value: string | undefined, width = 2): string {
  return String(value ?? "").padStart(width, "0");
}

function parseDateLikeParts(value: ScopeValue, locale: string): Record<string, string> | undefined {
  if (isPlainObject(value)) {
    for (const key of ["dateTime", "datetime", "date", "iso", "value", "start", "start_time"]) {
      const nested = value[key];
      if (
        typeof nested === "string" ||
        typeof nested === "number" ||
        nested instanceof Date ||
        isPlainObject(nested)
      ) {
        const parts = parseDateLikeParts(nested as ScopeValue, locale);
        if (parts) {
          return parts;
        }
      }
    }
  }
  if (typeof value === "string") {
    const match = value.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2})(?::(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?)?/
    );
    if (!match) {
      return undefined;
    }
    const [, year, month, day, hour, minute, second] = match;
    const weekdayDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return {
      dddd: formatDatePart(weekdayDate, locale, { weekday: "long" }),
      ddd: formatDatePart(weekdayDate, locale, { weekday: "short" }),
      mmmm: formatDatePart(weekdayDate, locale, { month: "long" }),
      mmm: formatDatePart(weekdayDate, locale, { month: "short" }),
      yyyy: year,
      yy: year.slice(-2),
      mm: month,
      m: String(Number(month)),
      dd: zeroPad(day),
      d: String(Number(day)),
      HH: zeroPad(hour),
      H: String(Number(hour ?? "0")),
      hh: zeroPad(String(((Number(hour ?? "0") + 11) % 12) + 1)),
      h: String(((Number(hour ?? "0") + 11) % 12) + 1),
      MM: zeroPad(minute),
      M: String(Number(minute ?? "0")),
      ss: zeroPad(second),
      s: String(Number(second ?? "0"))
    };
  }
  if (typeof value === "number" || value instanceof Date) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }
    const year = String(date.getUTCFullYear());
    const month = String(date.getUTCMonth() + 1);
    const day = String(date.getUTCDate());
    const hour = String(date.getUTCHours());
    const minute = String(date.getUTCMinutes());
    const second = String(date.getUTCSeconds());
    return {
      dddd: formatDatePart(date, locale, { weekday: "long" }),
      ddd: formatDatePart(date, locale, { weekday: "short" }),
      mmmm: formatDatePart(date, locale, { month: "long" }),
      mmm: formatDatePart(date, locale, { month: "short" }),
      yyyy: year,
      yy: year.slice(-2),
      mm: zeroPad(month),
      m: month,
      dd: zeroPad(day),
      d: day,
      HH: zeroPad(hour),
      H: hour,
      hh: zeroPad(String(((Number(hour) + 11) % 12) + 1)),
      h: String(((Number(hour) + 11) % 12) + 1),
      MM: zeroPad(minute),
      M: minute,
      ss: zeroPad(second),
      s: second
    };
  }
  return undefined;
}

function formatScopeValue(value: ScopeValue, pattern: string, locale: string): ScopeValue {
  const parts = parseDateLikeParts(value, locale);
  if (!parts) {
    return value;
  }
  return pattern.replace(/dddd|ddd|mmmm|mmm|yyyy|yy|HH|H|hh|h|MM|M|ss|s|mm|m|dd|d/g, (token) => parts[token] ?? token);
}

function applyTemplateFilter(value: ScopeValue, filterExpression: string, options: ScopeTemplateOptions): ScopeValue {
  const match = filterExpression.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\((.*)\))?$/);
  if (!match) {
    return value;
  }
  const [, filterName, rawArgs = ""] = match;
  const args = rawArgs.trim() ? splitTopLevel(rawArgs, ",").map(parseFilterArgument) : [];
  if (filterName === "format") {
    return formatScopeValue(value, String(args[0] ?? ""), options.locale ?? "en-US");
  }
  if (filterName === "keys") {
    return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : value;
  }
  if (filterName === "to_json") {
    return JSON.stringify(value);
  }
  if (filterName === "count") {
    if (value === undefined || value === null) {
      return 0;
    }
    if (Array.isArray(value) || typeof value === "string") {
      return value.length;
    }
    if (typeof value === "object") {
      return Object.keys(value).length;
    }
    return 1;
  }
  return value;
}

function resolveTemplateExpression(scope: ScopeContext, expression: string, options: ScopeTemplateOptions): ScopeValue {
  const segments = splitTopLevel(expression, "|").filter(Boolean);
  if (!segments.length) {
    return undefined;
  }
  let current = resolveScopePath(scope, segments[0]);
  for (let index = 1; index < segments.length; index += 1) {
    current = applyTemplateFilter(current, segments[index] ?? "", options);
  }
  return current;
}

export function resolveScopePath(scope: ScopeContext, path: string | undefined): ScopeValue {
  if (!path) {
    return undefined;
  }
  const segments = path.split(".").map((segment) => segment.trim()).filter(Boolean);
  if (!segments.length) {
    return undefined;
  }
  let current: unknown = scope;
  for (const segment of segments) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
      continue;
    }
    if (!isPlainObject(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current as ScopeValue;
}

export function stringifyScopeValue(value: ScopeValue): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function applyScopeTemplate(template: string, scope: ScopeContext, options: ScopeTemplateOptions = {}): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}|\$\{\s*([^}]+?)\s*\}/g, (_match, left, right) => {
    const resolved = resolveTemplateExpression(scope, String(left ?? right ?? "").trim(), options);
    return stringifyScopeValue(resolved);
  });
}

type Token =
  | { type: "identifier"; value: string }
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "operator"; value: string }
  | { type: "paren"; value: "(" | ")" };

function tokenizeExpression(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index] ?? "";
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const twoCharOperator = expression.slice(index, index + 2);
    if (["==", "!=", ">=", "<=", "&&", "||"].includes(twoCharOperator)) {
      tokens.push({ type: "operator", value: twoCharOperator });
      index += 2;
      continue;
    }
    if (["!", ">", "<"].includes(char)) {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }
    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char });
      index += 1;
      continue;
    }
    if (char === "'" || char === "\"") {
      const quote = char;
      let cursor = index + 1;
      let value = "";
      while (cursor < expression.length) {
        const next = expression[cursor] ?? "";
        if (next === "\\" && cursor + 1 < expression.length) {
          value += expression[cursor + 1] ?? "";
          cursor += 2;
          continue;
        }
        if (next === quote) {
          break;
        }
        value += next;
        cursor += 1;
      }
      tokens.push({ type: "string", value });
      index = cursor + 1;
      continue;
    }
    if (/[0-9]/.test(char)) {
      let cursor = index + 1;
      while (cursor < expression.length && /[0-9.]/.test(expression[cursor] ?? "")) {
        cursor += 1;
      }
      tokens.push({ type: "number", value: Number(expression.slice(index, cursor)) });
      index = cursor;
      continue;
    }
    if (/[A-Za-z_$@]/.test(char)) {
      let cursor = index + 1;
      while (cursor < expression.length && /[A-Za-z0-9_.$@]/.test(expression[cursor] ?? "")) {
        cursor += 1;
      }
      const value = expression.slice(index, cursor);
      if (value === "true" || value === "false") {
        tokens.push({ type: "boolean", value: value === "true" });
      } else {
        tokens.push({ type: "identifier", value });
      }
      index = cursor;
      continue;
    }
    throw new Error(`Unsupported token "${char}"`);
  }
  return tokens;
}

class ExpressionParser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly scope: ScopeContext
  ) {}

  parse(): boolean {
    const value = this.parseOr();
    if (this.index < this.tokens.length) {
      throw new Error("Unexpected trailing tokens");
    }
    return Boolean(value);
  }

  private current(): Token | undefined {
    return this.tokens[this.index];
  }

  private consumeOperator(value: string): boolean {
    const token = this.current();
    if (token?.type === "operator" && token.value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private consumeParen(value: "(" | ")"): boolean {
    const token = this.current();
    if (token?.type === "paren" && token.value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private parseOr(): ScopeValue {
    let left = this.parseAnd();
    while (this.consumeOperator("||")) {
      const right = this.parseAnd();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  private parseAnd(): ScopeValue {
    let left = this.parseComparison();
    while (this.consumeOperator("&&")) {
      const right = this.parseComparison();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  private parseComparison(): ScopeValue {
    let left = this.parseUnary();
    while (true) {
      const token = this.current();
      if (token?.type !== "operator" || !["==", "!=", ">", ">=", "<", "<="].includes(token.value)) {
        break;
      }
      this.index += 1;
      const right = this.parseUnary();
      left = compareValues(left, token.value, right);
    }
    return left;
  }

  private parseUnary(): ScopeValue {
    if (this.consumeOperator("!")) {
      return !Boolean(this.parseUnary());
    }
    if (this.consumeParen("(")) {
      const inner = this.parseOr();
      if (!this.consumeParen(")")) {
        throw new Error("Missing closing parenthesis");
      }
      return inner;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ScopeValue {
    const token = this.current();
    if (!token) {
      throw new Error("Unexpected end of expression");
    }
    this.index += 1;
    if (token.type === "number" || token.type === "string" || token.type === "boolean") {
      return token.value;
    }
    if (token.type === "identifier") {
      return resolveScopePath(this.scope, token.value);
    }
    throw new Error("Expected value");
  }
}

function asComparableNumber(value: ScopeValue): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  return undefined;
}

function compareValues(left: ScopeValue, operator: string, right: ScopeValue): boolean {
  if (left === undefined || right === undefined) {
    return false;
  }
  if (operator === "==") {
    return left === right;
  }
  if (operator === "!=") {
    return left !== right;
  }
  const leftNumeric = asComparableNumber(left);
  const rightNumeric = asComparableNumber(right);
  if (leftNumeric !== undefined && rightNumeric !== undefined) {
    if (operator === ">") return leftNumeric > rightNumeric;
    if (operator === ">=") return leftNumeric >= rightNumeric;
    if (operator === "<") return leftNumeric < rightNumeric;
    if (operator === "<=") return leftNumeric <= rightNumeric;
  }
  if (typeof left === "string" && typeof right === "string") {
    if (operator === ">") return left > right;
    if (operator === ">=") return left >= right;
    if (operator === "<") return left < right;
    if (operator === "<=") return left <= right;
  }
  return false;
}

export function evaluateScopeExpression(expression: string, scope: ScopeContext): boolean {
  if (!expression.trim()) {
    return false;
  }
  try {
    return new ExpressionParser(tokenizeExpression(expression), scope).parse();
  } catch {
    return false;
  }
}

export function evaluateArrayExpression(
  expression: string | undefined,
  scope: ScopeContext,
  options: ArrayExpressionOptions = {}
): ScopeValue[] {
  const trimmed = String(expression ?? "").trim();
  if (!trimmed) {
    return [];
  }
  const segments = splitTopLevel(trimmed, "|").filter(Boolean);
  if (!segments.length) {
    return [];
  }
  let current = resolveScopeOrLiteralExpression(segments[0] ?? "", scope);
  for (let index = 1; index < segments.length; index += 1) {
    current = applyArrayExpressionStage(Array.isArray(current) ? current : [], segments[index] ?? "", scope, options);
  }
  return Array.isArray(current) ? current : [];
}

export function walkLayoutNode(
  node: LayoutNode | undefined,
  visitor: (node: LayoutNode) => void
): void {
  if (!node) {
    return;
  }
  visitor(node);
  if (node.type === "stack" || node.type === "zstack") {
    node.children.forEach((child) => walkLayoutNode(child, visitor));
    return;
  }
  if (node.type === "grid") {
    node.children.forEach((child) => walkLayoutNode(child.node, visitor));
    return;
  }
  if (node.type === "data_query" || node.type === "foreach" || node.type === "filter" || node.type === "unique") {
    walkLayoutNode(node.child, visitor);
    return;
  }
  if (node.type === "if_else") {
    walkLayoutNode(node.thenChild, visitor);
    walkLayoutNode(node.elseChild, visitor);
  }
}

export function collectDataQueryNodes(project: {
  layoutDefinitions?: Array<{ id: string; rootNode?: LayoutNode }>;
  widgetDefinitions?: Array<{ id: string; kind: string; rootNode?: LayoutNode }>;
}): DataQueryNodeRef[] {
  const refs: DataQueryNodeRef[] = [];
  for (const layout of project.layoutDefinitions ?? []) {
    walkLayoutNode(layout.rootNode, (node) => {
      if (node.type === "data_query") {
        refs.push({ ownerId: layout.id, ownerKind: "layout", node });
      }
    });
  }
  for (const definition of project.widgetDefinitions ?? []) {
    if (definition.kind !== "compound") {
      continue;
    }
    walkLayoutNode(definition.rootNode, (node) => {
      if (node.type === "data_query") {
        refs.push({ ownerId: definition.id, ownerKind: "compound", node });
      }
    });
  }
  return refs;
}
