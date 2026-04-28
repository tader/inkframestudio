import { describe, expect, it } from "vitest";
import { inspectLayoutDefinition, renderAssignedDisplay, renderLayoutDefinition } from "./designer-renderer.js";
import { layoutText } from "./text-layout.js";
import { normalizeProject } from "./themes.js";
import { SAMPLE_DATA, SAMPLE_PROJECT } from "./sample-project.js";
import { registerFixtureFonts } from "./test-font-fixture.js";
import type { LayoutDefinition, Project } from "./types.js";
import { installProjectScriptingRuntime } from "../../addon-backend/src/script-runtime.js";

installProjectScriptingRuntime();
registerFixtureFonts();

function pixelBounds(rendered: { width: number; height: number; pixels: Uint8Array }, x0: number, y0: number, w: number, h: number) {
  let minX = x0 + w;
  let minY = y0 + h;
  let maxX = -1;
  let maxY = -1;
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const pixel = rendered.pixels[y * rendered.width + x];
      if (pixel === 0) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX >= 0
    ? { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 }
    : null;
}

function regionPixels(rendered: { width: number; pixels: Uint8Array }, x0: number, y0: number, w: number, h: number): number[] {
  const pixels: number[] = [];
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      pixels.push(rendered.pixels[y * rendered.width + x] ?? 0);
    }
  }
  return pixels;
}

describe("designer renderer", () => {
  it("migrates legacy projects into display types, devices, layouts, and assignments", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    expect(normalized.displayTypes?.length).toBeGreaterThan(0);
    expect(normalized.devices?.length).toBeGreaterThan(0);
    expect(normalized.layoutDefinitions?.length).toBeGreaterThan(0);
    expect(normalized.deviceAssignments?.length).toBeGreaterThan(0);
    expect(normalized.displayTypes?.[0]?.contentPadding).toBeDefined();
  });

  it("uses display content padding for root layout while keeping root fill bleeding into padded area", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project = normalizeProject({
      ...normalized,
      themes: normalized.themes.map((theme) => (
        theme.id === "soft-fill"
          ? {
              ...theme,
              text: {
                ...theme.text,
                body: "fg"
              }
            }
          : theme
      )),
      displayTypes: [{
        id: "tri296x128-red",
        name: "Padded",
        width: 40,
        height: 24,
        rotation: 0,
        contentPadding: { top: 5, right: 6, bottom: 7, left: 8 },
        gridUnitPx: 8,
        palette: { bg: "#ffffff", fg: "#111111", accent: "#d7261b" }
      }],
      layoutDefinitions: [{
        id: "layout-padded-root",
        name: "Padded Root",
        kind: "fullscreen",
        displayTypeId: "tri296x128-red",
        rootNode: {
          id: "root",
          type: "stack",
          axis: "vertical",
          width: { mode: "fill" },
          height: { mode: "fill" },
          style: { paddingPx: 0, gapPx: 0, borderToken: "none" },
          children: [{
            id: "box",
            type: "primitive_instance",
            primitiveType: "box",
            width: { mode: "fill" },
            height: { mode: "fill" },
            props: { paddingPx: 0, borderToken: "none" }
          }]
        }
      }]
    });
    const layout = project.layoutDefinitions?.[0]!;

    const inspection = inspectLayoutDefinition(project, layout, SAMPLE_DATA, undefined, "soft-fill");
    expect(inspection.root?.frame).toEqual({ x: 0, y: 0, w: 40, h: 24 });
    expect(inspection.root?.contentFrame).toEqual({ x: 8, y: 5, w: 26, h: 12 });
    expect(inspection.root?.children[0]?.frame).toEqual({ x: 8, y: 5, w: 26, h: 12 });

    const rendered = renderLayoutDefinition(project, layout, SAMPLE_DATA, undefined, "soft-fill");
    expect(rendered.pixels[1 * rendered.width + 1]).toBe(2);
    expect(rendered.pixels[4 * rendered.width + 8]).toBe(2);
    expect(rendered.pixels[5 * rendered.width + 8]).toBe(1);
  });

  it("renders composition layouts with zstack text over graph", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [
        ...(normalized.layoutDefinitions ?? []),
        {
          id: "layout-test-zstack",
          name: "ZStack Test",
          kind: "fullscreen",
          displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
          rootNode: {
            id: "root",
            type: "zstack",
            width: { mode: "fill" },
            height: { mode: "fill" },
            children: [
              {
                id: "graph",
                type: "primitive_instance",
                primitiveType: "graph",
                bindings: { query: "garage-temp-history" },
                width: { mode: "fill" },
                height: { mode: "fill" },
                props: {}
              },
              {
                id: "number",
                type: "primitive_instance",
                primitiveType: "number",
                bindings: { entity: "sensor.office_temperature" },
                width: { mode: "fill" },
                height: { mode: "fill" },
                props: { autoFit: true, placeholderValue: "88.8", digits: 1 }
              }
            ]
          }
        }
      ]
    });

    const rendered = renderLayoutDefinition(project, project.layoutDefinitions?.find((entry) => entry.id === "layout-test-zstack")!, SAMPLE_DATA);
    expect(rendered.width).toBeGreaterThan(0);
    expect(rendered.hash.length).toBeGreaterThan(10);
  });

  it("renders assigned display from migrated virtual device", () => {
    const project = normalizeProject(SAMPLE_PROJECT);
    const displayId = project.devices?.[0]?.id;
    expect(displayId).toBeTruthy();
    const rendered = renderAssignedDisplay(project, displayId!, SAMPLE_DATA);
    expect(rendered.width).toBeGreaterThan(0);
    expect(rendered.activeScreenId).toBeTruthy();
  });

  it("repairs stale assignments missing a default fullscreen layout", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const display = normalized.devices?.[0];
    expect(display).toBeDefined();
    const project: Project = normalizeProject({
      ...normalized,
      deviceAssignments: [{
        id: "assignment-broken",
        displayId: display!.id,
        defaultThemeId: "classic-outline",
        fullscreenRules: [],
        popupRules: []
      }]
    });
    const rendered = renderAssignedDisplay(project, display!.id, SAMPLE_DATA);
    expect(rendered.width).toBeGreaterThan(0);
    expect(rendered.activeScreenId).toBeTruthy();
  });

  it("renders assigned display even when a raw project lacks an assignment", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const display = normalized.devices?.[0];
    expect(display).toBeDefined();
    const project: Project = {
      ...normalized,
      deviceAssignments: []
    };
    const rendered = renderAssignedDisplay(project, display!.id, SAMPLE_DATA);
    expect(rendered.width).toBeGreaterThan(0);
    expect(rendered.activeScreenId).toBeTruthy();
  });

  it("inspects composition layout frames with zstack children sharing same bounds", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const layout = normalized.layoutDefinitions?.find((entry) => entry.id === "layout-test-zstack");
    const targetLayout = layout ?? {
      id: "layout-inspect-zstack",
      name: "Inspect ZStack",
      kind: "fullscreen" as const,
      displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
      rootNode: {
        id: "root",
        type: "zstack" as const,
        width: { mode: "fill" as const },
        height: { mode: "fill" as const },
        children: [
          { id: "graph", type: "primitive_instance" as const, primitiveType: "graph", width: { mode: "fill" as const }, height: { mode: "fill" as const } },
          { id: "number", type: "primitive_instance" as const, primitiveType: "number", width: { mode: "fill" as const }, height: { mode: "fill" as const } }
        ]
      }
    };
    const inspection = inspectLayoutDefinition(normalized, targetLayout, SAMPLE_DATA);
    expect(inspection.root?.nodeType).toBe("zstack");
    expect(inspection.root?.children).toHaveLength(2);
    expect(inspection.root?.children[0]?.frame).toEqual(inspection.root?.children[1]?.frame);
  });

  it("inspects grid cell metadata", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [{
        id: "layout-grid-inspect",
        name: "Grid Inspect",
        kind: "fullscreen",
        displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
        rootNode: {
          id: "root",
          type: "grid",
          rows: [{ size: { mode: "fraction", value: 0.5 } }, { size: { mode: "fraction", value: 0.5 } }],
          columns: [{ size: { mode: "fraction", value: 0.5 } }, { size: { mode: "fraction", value: 0.5 } }],
          children: [{
            placement: { row: 1, column: 0 },
            node: { id: "text", type: "primitive_instance", primitiveType: "text", props: { text: "Grid" } }
          }]
        }
      }]
    });
    const inspection = inspectLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    expect(inspection.root?.gridCells).toHaveLength(4);
    expect(inspection.root?.children[0]?.gridPlacement).toEqual({ row: 1, column: 0 });
  });

  it("renders script-node derived text into child scope", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const displayTypeId = normalized.displayTypes?.[0]?.id ?? "tri296x128-red";
    const scriptProject: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [{
        id: "layout-script-derived",
        name: "Script Derived",
        kind: "fullscreen",
        displayTypeId,
        rootNode: {
          id: "script-root",
          type: "script",
          source: 'return { fuzzy: "vijf voor tien" };',
          outputMode: "merge_object",
          bindings: {},
          width: { mode: "fill" },
          height: { mode: "fill" },
          child: {
            id: "text-root",
            type: "primitive_instance",
            primitiveType: "text",
            width: { mode: "fill" },
            height: { mode: "fill" },
            props: { text: "{{ fuzzy }}", autoFit: true, paddingPx: 0 }
          }
        }
      }, {
        id: "layout-script-blank",
        name: "Blank",
        kind: "fullscreen",
        displayTypeId,
        rootNode: {
          id: "script-blank",
          type: "script",
          source: "return {};",
          outputMode: "merge_object",
          bindings: {},
          width: { mode: "fill" },
          height: { mode: "fill" },
          child: {
            id: "text-blank",
            type: "primitive_instance",
            primitiveType: "text",
            width: { mode: "fill" },
            height: { mode: "fill" },
            props: { text: "{{ fuzzy }}", autoFit: true, paddingPx: 0 }
          }
        }
      }]
    });
    const derived = renderLayoutDefinition(scriptProject, scriptProject.layoutDefinitions?.[0]!, SAMPLE_DATA);
    const blank = renderLayoutDefinition(scriptProject, scriptProject.layoutDefinitions?.[1]!, SAMPLE_DATA);
    expect(derived.hash).not.toBe(blank.hash);
    expect(derived.scriptWarnings).toBeUndefined();
  });

  it("surfaces non-fatal script warnings", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const displayTypeId = normalized.displayTypes?.[0]?.id ?? "tri296x128-red";
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [{
        id: "layout-script-warning",
        name: "Script Warning",
        kind: "fullscreen",
        displayTypeId,
        rootNode: {
          id: "script-root",
          type: "script",
          source: 'throw new Error("boom");',
          outputMode: "merge_object",
          bindings: {},
          width: { mode: "fill" },
          height: { mode: "fill" },
          child: {
            id: "text-root",
            type: "primitive_instance",
            primitiveType: "text",
            width: { mode: "fill" },
            height: { mode: "fill" },
            props: { text: "{{ derivedText }}", autoFit: true, paddingPx: 0 }
          }
        }
      }]
    });
    const rendered = renderLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    const inspected = inspectLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    expect(rendered.scriptWarnings?.join("\n")).toContain("boom");
    expect(inspected.scriptWarnings?.join("\n")).toContain("boom");
  });

  it("uses content, primitive padding, and border in fit-content sizing", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [{
        id: "layout-intrinsic-height",
        name: "Intrinsic Height",
        kind: "fullscreen",
        displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
        rootNode: {
          id: "root",
          type: "stack",
          axis: "vertical",
          width: { mode: "fill" },
          height: { mode: "fill" },
          children: [{
            id: "text",
            type: "primitive_instance",
            primitiveType: "text",
            width: { mode: "fill" },
            height: { mode: "fit_content" },
            props: {
              text: "Header",
              fontRole: "header",
              paddingPx: 4,
              borderToken: "thin"
            }
          }]
        }
      }]
    });
    const inspection = inspectLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    const child = inspection.root?.children[0];
    const theme = project.themes[0]!;
    const textMetrics = layoutText("Hg", {
      family: theme.fontRoles?.header?.family ?? "px-sans",
      weight: theme.fontRoles?.header?.weight ?? "regular",
      slope: theme.fontRoles?.header?.slope ?? "roman",
      size: "header",
      pixelSize: theme.fontRoles?.header?.pixelSize ?? project.fontPresets.header
    }, project.fontPresets);
    expect(child?.frame.h).toBe(textMetrics.lineHeight + 10);
  });

  it("applies per-side padding after per-side borders", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [{
        id: "layout-edge-box",
        name: "Edge Box",
        kind: "fullscreen",
        rootNode: {
          id: "root",
          type: "stack",
          axis: "vertical",
          width: { mode: "fill" },
          height: { mode: "fill" },
          style: { paddingPx: 0, borderToken: "none" },
          children: [{
            id: "box",
            type: "stack",
            axis: "vertical",
            width: { mode: "fixed_px", value: 40 },
            height: { mode: "fixed_px", value: 30 },
          style: {
            padding: { top: 4, right: 5, bottom: 6, left: 7 },
            border: {
              top: { size: "thin", pattern: "solid" },
              right: { size: "thick", pattern: "solid" },
              bottom: { size: "fat", pattern: "solid" },
              left: { size: "thin", pattern: "dashed" }
            }
          },
          children: []
          }]
        }
      }]
    });
    const inspection = inspectLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    const child = inspection.root?.children[0];
    expect(child?.contentFrame).toMatchObject({
      x: 12,
      y: 9,
      w: 25,
      h: 16
    });
    const rendered = renderLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    expect(rendered.pixels[4 * rendered.width + 4]).toBe(1);
    expect(rendered.pixels[4 * rendered.width + 43]).toBe(1);
    expect(rendered.pixels[33 * rendered.width + 20]).toBe(1);
    expect(regionPixels(rendered, 4, 4, 1, 12).filter((pixel) => pixel === 1).length).toBeLessThan(12);
  });

  it("draws double borders as two strokes with matching stroke and gap size", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [{
        id: "layout-double-border",
        name: "Double Border",
        kind: "fullscreen",
        rootNode: {
          id: "root",
          type: "stack",
          axis: "vertical",
          width: { mode: "fill" },
          height: { mode: "fill" },
          style: { paddingPx: 0, borderToken: "none" },
          children: [{
            id: "box",
            type: "stack",
            axis: "vertical",
            width: { mode: "fixed_px", value: 32 },
            height: { mode: "fixed_px", value: 20 },
            style: {
              border: {
                top: { size: "thick", pattern: "double" }
              }
            },
            children: []
          }]
        }
      }]
    });
    const inspection = inspectLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    expect(inspection.root?.children[0]?.contentFrame.y).toBe(10);
    const rendered = renderLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    const rowPixels = (y: number) => regionPixels(rendered, 4, y, 32, 1).filter((pixel) => pixel === 1).length;
    expect(rowPixels(4)).toBe(32);
    expect(rowPixels(5)).toBe(32);
    expect(rowPixels(6)).toBe(0);
    expect(rowPixels(7)).toBe(0);
    expect(rowPixels(8)).toBe(32);
    expect(rowPixels(9)).toBe(32);
  });

  it("keeps auto-fit disabled when width or height uses fit-content", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [{
        id: "layout-fit-content-disables-autofit",
        name: "Fit Content Disables AutoFit",
        kind: "fullscreen",
        displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
        rootNode: {
          id: "root",
          type: "stack",
          axis: "vertical",
          width: { mode: "fill" },
          height: { mode: "fill" },
          children: [{
            id: "text",
            type: "primitive_instance",
            primitiveType: "text",
            width: { mode: "fixed_px", value: 180 },
            height: { mode: "fit_content" },
            props: {
              text: "Header",
              fontRole: "header",
              autoFit: true,
              placeholderText: "THIS IS A VERY LONG PLACEHOLDER",
              paddingPx: 4
            }
          }]
        }
      }]
    });
    const inspection = inspectLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    const child = inspection.root?.children[0];
    const theme = project.themes[0]!;
    const textMetrics = layoutText("Hg", {
      family: theme.fontRoles?.header?.family ?? "px-sans",
      weight: theme.fontRoles?.header?.weight ?? "regular",
      slope: theme.fontRoles?.header?.slope ?? "roman",
      size: "header",
      pixelSize: theme.fontRoles?.header?.pixelSize ?? project.fontPresets.header
    }, project.fontPresets);
    expect(child?.frame.h).toBe(textMetrics.lineHeight + 8);
  });

  it("sizes horizontal stacks with fit-content height from tallest child", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [{
        id: "layout-hstack-fit-content-height",
        name: "HStack Fit Content Height",
        kind: "fullscreen",
        displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
        rootNode: {
          id: "root",
          type: "stack",
          axis: "vertical",
          width: { mode: "fill" },
          height: { mode: "fill" },
          children: [{
            id: "hstack",
            type: "stack",
            axis: "horizontal",
            width: { mode: "fill" },
            height: { mode: "fit_content" },
            children: [{
              id: "text",
              type: "primitive_instance",
              primitiveType: "text",
              width: { mode: "fill" },
              height: { mode: "fit_content" },
              props: {
                text: "Header",
                fontRole: "header",
                paddingPx: 4,
                borderToken: "thin"
              }
            }]
          }]
        }
      }]
    });
    const inspection = inspectLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    const hstack = inspection.root?.children[0];
    const child = hstack?.children[0];
    expect(hstack?.frame.h).toBe(child?.frame.h);
    expect(hstack?.frame.h).toBeGreaterThan(0);
  });

  it("sizes horizontal stacks with fit-content width children before fill children", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [{
        id: "layout-hstack-fit-content-width",
        name: "HStack Fit Content Width",
        kind: "fullscreen",
        displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
        rootNode: {
          id: "root",
          type: "stack",
          axis: "vertical",
          width: { mode: "fill" },
          height: { mode: "fill" },
          children: [{
            id: "hstack",
            type: "stack",
            axis: "horizontal",
            width: { mode: "fixed_px", value: 80 },
            height: { mode: "fit_content" },
            children: [{
              id: "a",
              type: "primitive_instance",
              primitiveType: "text",
              width: { mode: "fit_content" },
              height: { mode: "fit_content" },
              props: {
                text: "A",
                fixedPixelSize: 8,
                paddingPx: 0,
                borderToken: "none"
              }
            }, {
              id: "b",
              type: "primitive_instance",
              primitiveType: "text",
              width: { mode: "fit_content" },
              height: { mode: "fit_content" },
              props: {
                text: "B",
                fixedPixelSize: 8,
                paddingPx: 0,
                borderToken: "none"
              }
            }, {
              id: "c",
              type: "primitive_instance",
              primitiveType: "text",
              width: { mode: "fill" },
              height: { mode: "fit_content" },
              props: {
                text: "C",
                fixedPixelSize: 8,
                paddingPx: 0,
                borderToken: "none",
                horizontalAlign: "right"
              }
            }]
          }]
        }
      }]
    });
    const inspection = inspectLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    const hstack = inspection.root?.children[0];
    const [a, b, c] = hstack?.children ?? [];
    expect(a?.frame.w).toBeGreaterThan(0);
    expect(b?.frame.w).toBeGreaterThan(0);
    expect(c?.frame.w).toBeGreaterThan(0);
    expect(b?.frame.x).toBe((a?.frame.x ?? 0) + (a?.frame.w ?? 0));
    expect(c?.frame.x).toBe((b?.frame.x ?? 0) + (b?.frame.w ?? 0));
    expect((a?.frame.w ?? 0) + (b?.frame.w ?? 0) + (c?.frame.w ?? 0)).toBe(hstack?.frame.w);

    const rendered = renderLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    expect(pixelBounds(rendered, c?.frame.x ?? 0, c?.frame.y ?? 0, c?.frame.w ?? 0, c?.frame.h ?? 0)).not.toBeNull();
  });

  it("wraps text and grows fit-content height to include all lines", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [{
        id: "layout-text-wrap-overflow",
        name: "Text Wrap Overflow",
        kind: "fullscreen",
        displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
        rootNode: {
          id: "root",
          type: "stack",
          axis: "vertical",
          width: { mode: "fill" },
          height: { mode: "fill" },
          children: [{
            id: "text",
            type: "primitive_instance",
            primitiveType: "text",
            width: { mode: "fixed_px", value: 30 },
            height: { mode: "fit_content" },
            props: {
              text: "ALPHA BETA",
              overflow: "wrap",
              fixedPixelSize: 8,
              paddingPx: 0,
              borderToken: "none"
            }
          }]
        }
      }]
    });
    const inspection = inspectLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    const child = inspection.root?.children[0];
    const lineMetrics = layoutText("Hg", {
      family: "px-sans",
      weight: "regular",
      slope: "roman",
      size: "normal",
      pixelSize: 8
    }, project.fontPresets);
    expect(child?.frame.h).toBeGreaterThan(lineMetrics.lineHeight);
    const rendered = renderLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    expect(pixelBounds(rendered, 0, lineMetrics.lineHeight, 30, rendered.height - lineMetrics.lineHeight)).not.toBeNull();
  });

  it("wraps fill-width text and grows fit-content height inside a constrained vstack", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [{
        id: "layout-text-fill-wrap-overflow",
        name: "Text Fill Wrap Overflow",
        kind: "fullscreen",
        displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
        rootNode: {
          id: "root",
          type: "stack",
          axis: "vertical",
          width: { mode: "fill" },
          height: { mode: "fill" },
          children: [{
            id: "container",
            type: "stack",
            axis: "vertical",
            width: { mode: "fixed_px", value: 40 },
            height: { mode: "fit_content" },
            children: [{
              id: "text",
              type: "primitive_instance",
              primitiveType: "text",
              width: { mode: "fill" },
              height: { mode: "fit_content" },
              props: {
                text: "Some very long text that should wrap over multiple lines in this widget",
                overflow: "wrap",
                fixedPixelSize: 8,
                paddingPx: 0,
                borderToken: "none"
              }
            }]
          }]
        }
      }]
    });
    const inspection = inspectLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    const container = inspection.root?.children[0];
    const child = container?.children[0];
    const lineMetrics = layoutText("Hg", {
      family: "px-sans",
      weight: "regular",
      slope: "roman",
      size: "normal",
      pixelSize: 8
    }, project.fontPresets);
    expect(child?.frame.w).toBe(40);
    expect(child?.frame.h).toBeGreaterThan(lineMetrics.lineHeight);
    expect(container?.frame.h).toBe(child?.frame.h);
  });

  it("supports tighter line spacing for wrapped text", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const makeProject = (lineSpacingPx: number): Project => normalizeProject({
      ...normalized,
      themes: normalized.themes.map((theme) => (
        theme.id === "classic-outline"
          ? {
              ...theme,
              fontRoles: {
                ...theme.fontRoles,
                normal: {
                  ...theme.fontRoles?.normal,
                  lineSpacingPx
                }
              }
            }
          : theme
      )),
      layoutDefinitions: [{
        id: `layout-text-line-spacing-${lineSpacingPx}`,
        name: "Text Line Spacing",
        kind: "fullscreen",
        displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
        rootNode: {
          id: "root",
          type: "stack",
          axis: "vertical",
          width: { mode: "fill" },
          height: { mode: "fill" },
          children: [{
            id: "text",
            type: "primitive_instance",
            primitiveType: "text",
            width: { mode: "fixed_px", value: 40 },
            height: { mode: "fit_content" },
            props: {
              text: "Some very long text that should wrap",
              overflow: "wrap",
              fixedPixelSize: 8,
              paddingPx: 0,
              borderToken: "none"
            }
          }]
        }
      }]
    });
    const normal = inspectLayoutDefinition(makeProject(0), makeProject(0).layoutDefinitions?.[0]!, SAMPLE_DATA);
    const tightProject = makeProject(-2);
    const tight = inspectLayoutDefinition(tightProject, tightProject.layoutDefinitions?.[0]!, SAMPLE_DATA);
    expect(tight.root?.children[0]?.frame.h).toBeLessThan(normal.root?.children[0]?.frame.h ?? 0);
  });

  it("supports theme top padding for tighter fit-content text", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const makeProject = (topPaddingPx: number): Project => normalizeProject({
      ...normalized,
      themes: normalized.themes.map((theme) => (
        theme.id === "classic-outline"
          ? {
              ...theme,
              fontRoles: {
                ...theme.fontRoles,
                normal: {
                  ...theme.fontRoles?.normal,
                  topPaddingPx
                }
              }
            }
          : theme
      )),
      layoutDefinitions: [{
        id: `layout-text-top-padding-${topPaddingPx}`,
        name: "Text Top Padding",
        kind: "fullscreen",
        displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
        rootNode: {
          id: "root",
          type: "stack",
          axis: "vertical",
          width: { mode: "fill" },
          height: { mode: "fill" },
          children: [{
            id: "text",
            type: "primitive_instance",
            primitiveType: "text",
            width: { mode: "fixed_px", value: 80 },
            height: { mode: "fit_content" },
            props: {
              text: "Header",
              overflow: "wrap",
              fixedPixelSize: 8,
              paddingPx: 0,
              borderToken: "none"
            }
          }]
        }
      }]
    });
    const normalProject = makeProject(0);
    const tightProject = makeProject(-2);
    const normal = inspectLayoutDefinition(normalProject, normalProject.layoutDefinitions?.[0]!, SAMPLE_DATA);
    const tight = inspectLayoutDefinition(tightProject, tightProject.layoutDefinitions?.[0]!, SAMPLE_DATA);
    expect(tight.root?.children[0]?.frame.h).toBeLessThan(normal.root?.children[0]?.frame.h ?? 0);
  });

  it("measures foreach fit-content rows with each item's wrapped text", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [{
        id: "layout-foreach-wrap-overflow",
        name: "Foreach Wrap Overflow",
        kind: "fullscreen",
        displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
        rootNode: {
          id: "query-node",
          type: "data_query",
          queryKind: "calendar_events",
          variableName: "events",
          calendarEntityIds: ["calendar.family"],
          offsetDays: 0,
          width: { mode: "fill" },
          height: { mode: "fill" },
          child: {
            id: "container",
            type: "stack",
            axis: "vertical",
            width: { mode: "fill" },
            height: { mode: "fit_content" },
            children: [{
              id: "loop",
              type: "foreach",
              itemsRef: "events",
              itemAlias: "event",
              indexAlias: "index",
              axis: "vertical",
              width: { mode: "fill" },
              height: { mode: "fill" },
              child: {
                id: "row",
                type: "stack",
                axis: "horizontal",
                width: { mode: "fill" },
                height: { mode: "fit_content" },
                children: [{
                  id: "time",
                  type: "primitive_instance",
                  primitiveType: "text",
                  width: { mode: "fixed_px", value: 51 },
                  height: { mode: "fit_glyph_bounds" },
                  props: {
                    text: "{{ event.start | format(\"HH:MM\") }}",
                    fixedPixelSize: 8,
                    paddingPx: 0,
                    borderToken: "none"
                  }
                }, {
                  id: "summary",
                  type: "primitive_instance",
                  primitiveType: "text",
                  width: { mode: "fill" },
                  height: { mode: "fit_content" },
                  props: {
                    text: "{{ event.summary }}",
                    overflow: "wrap",
                    fixedPixelSize: 8,
                    paddingPx: 0,
                    borderToken: "none"
                  }
                }]
              }
            }]
          }
        }
      }]
    });
    const metaQueries = {
      "query-node": {
        kind: "calendar_events_meta",
        meta: { date: "2026-04-17", dateVariableName: "date" },
        items: [{
          summary: "Very long meeting title with extra context and even more detail to force wrapping across multiple lines in the agenda row",
          start: "2026-04-17T09:05:00.000Z",
          end: "2026-04-17T09:30:00.000Z",
          allDay: false,
          allday: false,
          calendarEntityId: "calendar.family",
          raw: {}
        }]
      }
    };
    const inspection = inspectLayoutDefinition(project, project.layoutDefinitions?.[0]!, {
      ...SAMPLE_DATA,
      metaQueries
    });
    const row = inspection.root?.children[0]?.children[0]?.children[0];
    const summary = row?.children[1];
    const lineMetrics = layoutText("Hg", {
      family: "px-sans",
      weight: "regular",
      slope: "roman",
      size: "normal",
      pixelSize: 8
    }, project.fontPresets);
    expect(summary?.frame.h).toBeGreaterThan(lineMetrics.lineHeight);
    expect(row?.frame.h).toBeGreaterThan(lineMetrics.lineHeight);
  });

  it("renders ellipsis differently from hide overflow", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const makeProject = (overflow: "hide" | "ellipsis"): Project => normalizeProject({
      ...normalized,
      layoutDefinitions: [{
        id: `layout-text-${overflow}-overflow`,
        name: `Text ${overflow} Overflow`,
        kind: "fullscreen",
        displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
        rootNode: {
          id: "root",
          type: "stack",
          axis: "vertical",
          width: { mode: "fill" },
          height: { mode: "fill" },
          children: [{
            id: "text",
            type: "primitive_instance",
            primitiveType: "text",
            width: { mode: "fixed_px", value: 28 },
            height: { mode: "fit_content" },
            props: {
              text: "WWWWWWWW",
              overflow,
              fixedPixelSize: 8,
              paddingPx: 0,
              borderToken: "none"
            }
          }]
        }
      }]
    });
    const hidden = makeProject("hide");
    const ellipsis = makeProject("ellipsis");
    const hiddenInspection = inspectLayoutDefinition(hidden, hidden.layoutDefinitions?.[0]!, SAMPLE_DATA);
    const ellipsisInspection = inspectLayoutDefinition(ellipsis, ellipsis.layoutDefinitions?.[0]!, SAMPLE_DATA);
    expect(hiddenInspection.root?.children[0]?.frame.h).toBe(ellipsisInspection.root?.children[0]?.frame.h);

    const hiddenRender = renderLayoutDefinition(hidden, hidden.layoutDefinitions?.[0]!, SAMPLE_DATA);
    const ellipsisRender = renderLayoutDefinition(ellipsis, ellipsis.layoutDefinitions?.[0]!, SAMPLE_DATA);
    expect(regionPixels(
      hiddenRender,
      hiddenInspection.root?.children[0]?.frame.x ?? 0,
      hiddenInspection.root?.children[0]?.frame.y ?? 0,
      hiddenInspection.root?.children[0]?.frame.w ?? 0,
      hiddenInspection.root?.children[0]?.frame.h ?? 0
    )).not.toEqual(regionPixels(
      ellipsisRender,
      ellipsisInspection.root?.children[0]?.frame.x ?? 0,
      ellipsisInspection.root?.children[0]?.frame.y ?? 0,
      ellipsisInspection.root?.children[0]?.frame.w ?? 0,
      ellipsisInspection.root?.children[0]?.frame.h ?? 0
    ));
  });

  it("uses tight glyph bounds for fit-glyph-bounds text sizing", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [{
        id: "layout-fit-glyph-bounds",
        name: "Fit Glyph Bounds",
        kind: "fullscreen",
        displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
        rootNode: {
          id: "root",
          type: "stack",
          axis: "vertical",
          width: { mode: "fill" },
          height: { mode: "fill" },
          children: [{
            id: "text",
            type: "primitive_instance",
            primitiveType: "text",
            width: { mode: "fixed_px", value: 160 },
            height: { mode: "fit_glyph_bounds" },
            props: {
              text: "Blocked",
              fontRole: "header",
              fixedPixelSize: 8,
              paddingPx: 0,
              borderToken: "none"
            }
          }]
        }
      }]
    });
    const inspection = inspectLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    const child = inspection.root?.children[0];
    const rendered = renderLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    const bounds = pixelBounds(rendered, child?.frame.x ?? 0, child?.frame.y ?? 0, child?.frame.w ?? 0, child?.frame.h ?? 0);
    expect(bounds).not.toBeNull();
    expect(bounds?.minY).toBe(child?.frame.y);
    expect(child?.frame.h).toBe(bounds?.height);
    const textMetrics = layoutText("Blocked", {
      family: "px-sans",
      weight: "regular",
      slope: "roman",
      size: "header",
      pixelSize: 8
    }, project.fontPresets);
    expect(child?.frame.h).toBeLessThan(textMetrics.lineHeight);
  });

  it("uses theme pixel size for non-auto-fit text widgets", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      fontPresets: { tiny: 16, normal: 16, header: 28 },
      themes: normalized.themes.map((theme) => (
        theme.id === "classic-outline"
          ? {
              ...theme,
              fontRoles: {
                ...theme.fontRoles,
                header: {
                  ...theme.fontRoles?.header,
                  family: "px-sans",
                  weight: "regular",
                  slope: "roman",
                  pixelSize: 16
                }
              }
            }
          : theme
      )),
      layoutDefinitions: [{
        id: "layout-theme-pixelsize-text",
        name: "Theme Pixel Size",
        kind: "fullscreen",
        displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
        rootNode: {
          id: "root",
          type: "stack",
          axis: "vertical",
          width: { mode: "fill" },
          height: { mode: "fill" },
          children: [{
            id: "text",
            type: "primitive_instance",
            primitiveType: "text",
            width: { mode: "fixed_px", value: 120 },
            height: { mode: "fixed_px", value: 32 },
            props: {
              text: "Title",
              fontRole: "header",
              autoFit: false,
              paddingPx: 0
            }
          }]
        }
      }]
    });
    const rendered = renderLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    const bounds = pixelBounds(rendered, 0, 0, 120, 32);
    const expected = layoutText("Title", {
      family: "px-sans",
      weight: "regular",
      slope: "roman",
      size: "header",
      pixelSize: 16
    }, project.fontPresets);
    const expectedHeight = Math.max(...expected.glyphs.filter((glyph) => glyph.height > 0).map((glyph) => glyph.height));
    expect(bounds?.height ?? 0).toBeGreaterThan(0);
    expect(bounds?.height ?? 0).toBeLessThanOrEqual(expectedHeight);
  });

  it("uses the normal emphasis font role from theme settings", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      themes: normalized.themes.map((theme) => (
        theme.id === "classic-outline"
          ? {
              ...theme,
              fontRoles: {
                ...theme.fontRoles,
                normalEmphasis: {
                  family: "px-sans",
                  weight: "bold",
                  slope: "roman",
                  size: "normal",
                  pixelSize: 16
                }
              }
            }
          : theme
      )),
      layoutDefinitions: [{
        id: "layout-theme-normal-emphasis",
        name: "Theme Normal Emphasis",
        kind: "fullscreen",
        displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
        rootNode: {
          id: "root",
          type: "stack",
          axis: "vertical",
          width: { mode: "fill" },
          height: { mode: "fill" },
          children: [{
            id: "text",
            type: "primitive_instance",
            primitiveType: "text",
            width: { mode: "fixed_px", value: 120 },
            height: { mode: "fixed_px", value: 32 },
            props: {
              text: "Title",
              fontRole: "normalEmphasis",
              autoFit: false,
              paddingPx: 0
            }
          }]
        }
      }]
    });
    const rendered = renderLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    const bounds = pixelBounds(rendered, 0, 0, 120, 32);
    const expected = layoutText("Title", {
      family: "px-sans",
      weight: "bold",
      slope: "roman",
      size: "normal",
      pixelSize: 16
    }, project.fontPresets);
    const expectedHeight = Math.max(...expected.glyphs.filter((glyph) => glyph.height > 0).map((glyph) => glyph.height));
    expect(bounds?.height ?? 0).toBeGreaterThan(0);
    expect(bounds?.height ?? 0).toBeLessThanOrEqual(expectedHeight);
  });

  it("auto-fit text can grow beyond the old 36px cap when frame allows", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [{
        id: "layout-autofit-large",
        name: "Auto Fit Large",
        kind: "fullscreen",
        displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
        rootNode: {
          id: "root",
          type: "stack",
          axis: "vertical",
          width: { mode: "fill" },
          height: { mode: "fill" },
          children: [{
            id: "text",
            type: "primitive_instance",
            primitiveType: "text",
            width: { mode: "fixed_px", value: 220 },
            height: { mode: "fixed_px", value: 96 },
            props: {
              text: "half vier",
              fontRole: "header",
              autoFit: true,
              paddingPx: 0,
              horizontalAlign: "center",
              verticalAlign: "middle"
            }
          }]
        }
      }]
    });
    const rendered = renderLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    const bounds = pixelBounds(rendered, 0, 0, 220, 96);
    expect(bounds).not.toBeNull();
    expect(bounds?.height ?? 0).toBeGreaterThan(36);
  });

  it("applies icon alignment within the content frame", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [{
        id: "layout-icon-align",
        name: "Icon Align",
        kind: "fullscreen",
        displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
        rootNode: {
          id: "root",
          type: "stack",
          axis: "vertical",
          width: { mode: "fill" },
          height: { mode: "fill" },
          children: [{
            id: "icon",
            type: "primitive_instance",
            primitiveType: "icon",
            width: { mode: "fixed_px", value: 40 },
            height: { mode: "fixed_px", value: 24 },
            props: {
              icon: "warning",
              paddingPx: 2,
              horizontalAlign: "right",
              verticalAlign: "bottom"
            }
          }]
        }
      }]
    });
    const rendered = renderLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    const leftBounds = pixelBounds(rendered, 0, 0, 12, 24);
    const rightBounds = pixelBounds(rendered, 16, 8, 24, 16);
    expect(leftBounds).toBeNull();
    expect(rightBounds).not.toBeNull();
  });

  it("applies theme surface fill inside primitive content frame", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      themes: normalized.themes.map((theme) => (
        theme.id === "classic-outline"
          ? {
              ...theme,
              surface: { fillRole: "accent" }
            }
          : theme
      )),
      layoutDefinitions: [{
        id: "layout-surface-fill",
        name: "Surface Fill",
        kind: "fullscreen",
        displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
        rootNode: {
          id: "root",
          type: "stack",
          axis: "vertical",
          width: { mode: "fill" },
          height: { mode: "fill" },
          children: [{
            id: "text",
            type: "primitive_instance",
            primitiveType: "text",
            width: { mode: "fixed_px", value: 80 },
            height: { mode: "fixed_px", value: 24 },
            props: {
              text: "Hi",
              paddingPx: 2
            }
          }]
        }
      }]
    });

    const rendered = renderLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    expect(rendered.pixels[12 * rendered.width + 40]).toBe(2);
  });

  it("applies theme surface fill to stack padding and gap areas", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      themes: normalized.themes.map((theme) => (
        theme.id === "classic-outline"
          ? {
              ...theme,
              surface: { fillRole: "accent" }
            }
          : theme
      )),
      layoutDefinitions: [{
        id: "layout-stack-fill",
        name: "Stack Fill",
        kind: "fullscreen",
        displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
        rootNode: {
          id: "root",
          type: "stack",
          axis: "vertical",
          width: { mode: "fixed_px", value: 60 },
          height: { mode: "fixed_px", value: 40 },
          style: { paddingPx: 4, gapPx: 4, borderToken: "none" },
          children: [
            {
              id: "top",
              type: "primitive_instance",
              primitiveType: "text",
              width: { mode: "fill" },
              height: { mode: "fixed_px", value: 8 },
              props: { text: "A", paddingPx: 0 }
            },
            {
              id: "bottom",
              type: "primitive_instance",
              primitiveType: "text",
              width: { mode: "fill" },
              height: { mode: "fixed_px", value: 8 },
              props: { text: "B", paddingPx: 0 }
            }
          ]
        }
      }]
    });

    const rendered = renderLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    expect(rendered.pixels[18 * rendered.width + 10]).toBe(2);
  });

  it("supports halftone gray surface fill", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      themes: normalized.themes.map((theme) => (
        theme.id === "classic-outline"
          ? {
              ...theme,
              surface: { fillRole: "gray" }
            }
          : theme
      )),
      layoutDefinitions: [{
        id: "layout-surface-halftone",
        name: "Surface Halftone",
        kind: "fullscreen",
        displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
        rootNode: {
          id: "root",
          type: "stack",
          axis: "vertical",
          width: { mode: "fixed_px", value: 24 },
          height: { mode: "fixed_px", value: 16 },
          style: { paddingPx: 0, gapPx: 0, borderToken: "none" },
          children: []
        }
      }]
    });

    const rendered = renderLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    expect(rendered.pixels[8 * rendered.width + 8]).toBe(0);
    expect(rendered.pixels[8 * rendered.width + 9]).toBe(1);
    expect(rendered.pixels[9 * rendered.width + 8]).toBe(1);
  });

  it("supports halftone graph fills", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [{
        id: "layout-graph-halftone",
        name: "Graph Halftone",
        kind: "fullscreen",
        displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
        rootNode: {
          id: "root",
          type: "stack",
          axis: "vertical",
          width: { mode: "fill" },
          height: { mode: "fill" },
          children: [{
            id: "graph",
            type: "primitive_instance",
            primitiveType: "graph",
            width: { mode: "fixed_px", value: 20 },
            height: { mode: "fixed_px", value: 12 },
            bindings: { query: "bars" },
            props: { colorRole: "light-accent", paddingPx: 0, borderToken: "none" }
          }]
        }
      }]
    });

    const inspection = inspectLayoutDefinition(project, project.layoutDefinitions?.[0]!, {
      ...SAMPLE_DATA,
      queries: {
        ...SAMPLE_DATA.queries,
        bars: {
          kind: "history_range",
          points: [
            { timestamp: "2026-04-17T09:00:00.000Z", value: 0 },
            { timestamp: "2026-04-17T10:00:00.000Z", value: 10 }
          ]
        }
      }
    });
    const graphFrame = inspection.root?.children[0]?.frame;
    const rendered = renderLayoutDefinition(project, project.layoutDefinitions?.[0]!, {
      ...SAMPLE_DATA,
      queries: {
        ...SAMPLE_DATA.queries,
        bars: {
          kind: "history_range",
          points: [
            { timestamp: "2026-04-17T09:00:00.000Z", value: 0 },
            { timestamp: "2026-04-17T10:00:00.000Z", value: 10 }
          ]
        }
      }
    });
    const first = rendered.pixels[(graphFrame!.y + graphFrame!.h - 1) * rendered.width + (graphFrame!.x + 10)];
    const second = rendered.pixels[(graphFrame!.y + graphFrame!.h - 1) * rendered.width + (graphFrame!.x + 11)];
    expect([first, second].sort()).toEqual([0, 2]);
  });

  it("resolves compound input templates in text widgets", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      widgetDefinitions: [
        ...(normalized.widgetDefinitions ?? []),
        {
          id: "compound-room-label",
          name: "Room Label",
          kind: "compound",
          inputSchema: [
            { id: "input-room", name: "Room Name", valueType: "string" }
          ],
          rootNode: {
            id: "compound-root",
            type: "primitive_instance",
            primitiveType: "text",
            width: { mode: "fill" },
            height: { mode: "fill" },
            props: { text: "{{Room Name}}", autoFit: true, placeholderText: "Office" }
          }
        }
      ],
      layoutDefinitions: [
        {
          id: "layout-input-template",
          name: "Input Template",
          kind: "fullscreen",
          displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
          rootNode: {
            id: "layout-root",
            type: "stack",
            axis: "vertical",
            width: { mode: "fill" },
            height: { mode: "fill" },
            children: [
              {
                id: "compound-instance",
                type: "compound_ref",
                definitionId: "compound-room-label",
                inputValues: { "input-room": "Garage" }
              }
            ]
          }
        }
      ]
    });

    const rendered = renderLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    expect(rendered.width).toBeGreaterThan(0);
    expect(rendered.hash.length).toBeGreaterThan(10);
  });

  it("uses compound preview values when no explicit input value is provided", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      widgetDefinitions: [
        ...(normalized.widgetDefinitions ?? []),
        {
          id: "compound-preview-label",
          name: "Preview Label",
          kind: "compound",
          inputSchema: [
            { id: "input-room", name: "Room Name", valueType: "string", previewValue: "Attic" }
          ],
          rootNode: {
            id: "compound-root",
            type: "primitive_instance",
            primitiveType: "text",
            width: { mode: "fill" },
            height: { mode: "fill" },
            props: { text: "{{Room Name}}", autoFit: true, placeholderText: "Office" }
          }
        }
      ],
      layoutDefinitions: [
        {
          id: "layout-preview-template",
          name: "Preview Template",
          kind: "fullscreen",
          displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
          rootNode: {
            id: "layout-root",
            type: "stack",
            axis: "vertical",
            width: { mode: "fill" },
            height: { mode: "fill" },
            children: [
              {
                id: "compound-instance",
                type: "compound_ref",
                definitionId: "compound-preview-label"
              }
            ]
          }
        }
      ]
    });

    const rendered = renderLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    expect(rendered.hash.length).toBeGreaterThan(10);
  });

  it("passes entity inputs through to sub-widget entity bindings", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      widgetDefinitions: [
        ...(normalized.widgetDefinitions ?? []),
        {
          id: "compound-entity-label",
          name: "Entity Label",
          kind: "compound",
          inputSchema: [
            { id: "entity-input", name: "Entity Input", valueType: "entity", previewValue: "sensor.office_temperature" }
          ],
          rootNode: {
            id: "compound-root",
            type: "primitive_instance",
            primitiveType: "text",
            width: { mode: "fill" },
            height: { mode: "fill" },
            bindings: { entity: "{{Entity Input}}" },
            props: { renderEntityState: true, paddingPx: 0 }
          }
        }
      ],
      layoutDefinitions: [
        {
          id: "layout-entity-input-template",
          name: "Entity Input Template",
          kind: "fullscreen",
          displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
          rootNode: {
            id: "layout-root",
            type: "stack",
            axis: "vertical",
            width: { mode: "fill" },
            height: { mode: "fill" },
            children: [
              {
                id: "compound-instance",
                type: "compound_ref",
                definitionId: "compound-entity-label",
                inputValues: { "entity-input": "sensor.office_temperature" }
              }
            ]
          }
        }
      ]
    });

    const rendered = renderLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    expect(rendered.hash.length).toBeGreaterThan(10);
    expect(pixelBounds(rendered, 0, 0, 120, 40)).not.toBeNull();
  });

  it("uses entity input preview value as preview state when no real entity is bound", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const baseProject: Project = normalizeProject({
      ...normalized,
      widgetDefinitions: [
        ...(normalized.widgetDefinitions ?? []),
        {
          id: "compound-entity-preview-state",
          name: "Entity Preview State",
          kind: "compound",
          inputSchema: [
            { id: "entity-input", name: "Entity Input", valueType: "entity", previewValue: "21.5" }
          ],
          rootNode: {
            id: "compound-root",
            type: "primitive_instance",
            primitiveType: "text",
            width: { mode: "fill" },
            height: { mode: "fill" },
            bindings: { entity: "{{Entity Input}}" },
            props: { renderEntityState: true, paddingPx: 0 }
          }
        }
      ],
      layoutDefinitions: [
        {
          id: "layout-entity-preview-state",
          name: "Entity Preview State",
          kind: "fullscreen",
          displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
          rootNode: {
            id: "layout-root",
            type: "stack",
            axis: "vertical",
            width: { mode: "fill" },
            height: { mode: "fill" },
            children: [
              {
                id: "compound-instance",
                type: "compound_ref",
                definitionId: "compound-entity-preview-state"
              }
            ]
          }
        }
      ]
    });

    const withNumericPreview = renderLayoutDefinition(baseProject, baseProject.layoutDefinitions?.[0]!, SAMPLE_DATA);
    const unknownProject: Project = normalizeProject({
      ...baseProject,
      widgetDefinitions: (baseProject.widgetDefinitions ?? []).map((definition) => (
        definition.id === "compound-entity-preview-state"
          ? {
              ...definition,
              inputSchema: definition.inputSchema.map((input) => (
                input.id === "entity-input" ? { ...input, previewValue: "" } : input
              ))
            }
          : definition
      ))
    });
    const withUnknownPreview = renderLayoutDefinition(unknownProject, unknownProject.layoutDefinitions?.[0]!, SAMPLE_DATA);

    expect(withNumericPreview.hash).not.toBe(withUnknownPreview.hash);
  });

  it("keeps decimals for entity input preview values in number widgets", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      widgetDefinitions: [
        ...(normalized.widgetDefinitions ?? []),
        {
          id: "compound-entity-preview-number",
          name: "Entity Preview Number",
          kind: "compound",
          inputSchema: [
            { id: "entity-input", name: "Entity Input", valueType: "entity", previewValue: "21.5" }
          ],
          rootNode: {
            id: "compound-root",
            type: "primitive_instance",
            primitiveType: "number",
            width: { mode: "fill" },
            height: { mode: "fill" },
            bindings: { entity: "{{Entity Input}}" },
            props: { digits: 1, autoFit: false, paddingPx: 0, fontRole: "header" }
          }
        }
      ],
      layoutDefinitions: [
        {
          id: "layout-entity-preview-number",
          name: "Entity Preview Number",
          kind: "fullscreen",
          displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
          rootNode: {
            id: "layout-root",
            type: "stack",
            axis: "vertical",
            width: { mode: "fill" },
            height: { mode: "fill" },
            children: [
              {
                id: "compound-instance",
                type: "compound_ref",
                definitionId: "compound-entity-preview-number"
              }
            ]
          }
        }
      ]
    });

    const withDecimal = renderLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    const withoutDecimal = normalizeProject({
      ...project,
      widgetDefinitions: (project.widgetDefinitions ?? []).map((definition) => (
        definition.id === "compound-entity-preview-number"
          ? {
              ...definition,
              inputSchema: definition.inputSchema.map((input) => (
                input.id === "entity-input" ? { ...input, previewValue: "21" } : input
              ))
            }
          : definition
      ))
    });
    const whole = renderLayoutDefinition(withoutDecimal, withoutDecimal.layoutDefinitions?.[0]!, SAMPLE_DATA);

    expect(withDecimal.hash).not.toBe(whole.hash);
  });

  it("does not quantize number widget values when quantizeStep is unset", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const baseProject: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [
        {
          id: "layout-number-no-quantize",
          name: "Number No Quantize",
          kind: "fullscreen",
          displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
          rootNode: {
            id: "layout-root",
            type: "stack",
            axis: "vertical",
            width: { mode: "fill" },
            height: { mode: "fill" },
            children: [
              {
                id: "number",
                type: "primitive_instance",
                primitiveType: "number",
                bindings: { entity: "sensor.office_temperature" },
                width: { mode: "fixed_px", value: 140 },
                height: { mode: "fixed_px", value: 32 },
                props: { digits: 1, autoFit: false, paddingPx: 0, fontRole: "header" }
              }
            ]
          }
        }
      ]
    });
    const noQuantize = renderLayoutDefinition(baseProject, baseProject.layoutDefinitions?.[0]!, {
      ...SAMPLE_DATA,
      entities: {
        ...SAMPLE_DATA.entities,
        "sensor.office_temperature": {
          entityId: "sensor.office_temperature",
          state: "21.35",
          attributes: {},
          lastChanged: "2026-04-22T00:00:00.000Z"
        }
      }
    });
    const quantizedProject = normalizeProject({
      ...baseProject,
      layoutDefinitions: (baseProject.layoutDefinitions ?? []).map((layout) => ({
        ...layout,
        rootNode: layout.rootNode
          ? {
              ...layout.rootNode,
              children: (layout.rootNode as any).children?.map((child: any) => (
                child.id === "number" && child.type === "primitive_instance"
                  ? { ...child, props: { ...child.props, quantizeStep: 1 } }
                  : child
              )) ?? []
            }
          : layout.rootNode
      })) as any
    });
    const quantized = renderLayoutDefinition(quantizedProject, quantizedProject.layoutDefinitions?.[0]!, {
      ...SAMPLE_DATA,
      entities: {
        ...SAMPLE_DATA.entities,
        "sensor.office_temperature": {
          entityId: "sensor.office_temperature",
          state: "21.35",
          attributes: {},
          lastChanged: "2026-04-22T00:00:00.000Z"
        }
      }
    });
    expect(noQuantize.hash).not.toBe(quantized.hash);
  });

  it("renders number widget prefix and suffix", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [
        {
          id: "layout-number-prefix-suffix",
          name: "Number Prefix Suffix",
          kind: "fullscreen",
          displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
          rootNode: {
            id: "layout-root",
            type: "stack",
            axis: "vertical",
            width: { mode: "fill" },
            height: { mode: "fill" },
            children: [
              {
                id: "number",
                type: "primitive_instance",
                primitiveType: "number",
                bindings: { entity: "sensor.office_temperature" },
                width: { mode: "fixed_px", value: 140 },
                height: { mode: "fixed_px", value: 32 },
                props: { digits: 1, autoFit: false, prefix: "EUR ", suffix: " C", paddingPx: 0, fontRole: "header" }
              }
            ]
          }
        }
      ]
    });
    const withAffixes = renderLayoutDefinition(project, project.layoutDefinitions?.[0]!, SAMPLE_DATA);
    const withoutAffixes = normalizeProject({
      ...project,
      layoutDefinitions: (project.layoutDefinitions ?? []).map((layout) => ({
        ...layout,
        rootNode: layout.rootNode
          ? {
              ...layout.rootNode,
              children: (layout.rootNode as any).children?.map((child: any) => (
                child.id === "number" && child.type === "primitive_instance"
                  ? { ...child, props: { ...child.props, prefix: "", suffix: "" } }
                  : child
              )) ?? []
            }
          : layout.rootNode
      })) as any
    });
    const plain = renderLayoutDefinition(withoutAffixes, withoutAffixes.layoutDefinitions?.[0]!, SAMPLE_DATA);
    expect(withAffixes.hash).not.toBe(plain.hash);
  });

  it("binds data query arrays lexically and resolves dotted templates", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const layout: LayoutDefinition = {
      id: "layout-data-scope",
      name: "Data Scope",
      kind: "fullscreen" as const,
      displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
      rootNode: {
        id: "root",
        type: "stack" as const,
        axis: "vertical" as const,
        width: { mode: "fill" as const },
        height: { mode: "fill" as const },
        children: [
          {
            id: "query-node",
            type: "data_query" as const,
            queryKind: "calendar_events" as const,
            variableName: "events",
            dateVariableName: "date",
            calendarEntityIds: ["calendar.family"],
            offsetDays: 0,
            width: { mode: "fill" as const },
            height: { mode: "fixed_px" as const, value: 20 },
            child: {
              id: "inside-text",
              type: "primitive_instance" as const,
              primitiveType: "text" as const,
              width: { mode: "fill" as const },
              height: { mode: "fill" as const },
              props: { text: "{{events.0.summary}}", autoFit: false, fixedPixelSize: 8, paddingPx: 0 }
            }
          },
          {
            id: "outside-text",
            type: "primitive_instance" as const,
            primitiveType: "text" as const,
            width: { mode: "fill" as const },
            height: { mode: "fixed_px" as const, value: 20 },
            props: { text: "{{events.0.summary}}", autoFit: false, fixedPixelSize: 8, paddingPx: 0 }
          }
        ]
      }
    };
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [layout]
    });
    const rendered = renderLayoutDefinition(project, layout, {
      ...SAMPLE_DATA,
      metaQueries: {
        "query-node": {
          kind: "calendar_events_meta",
          meta: { date: "2026-04-17", dateVariableName: "date" },
          items: [{
            summary: "Scoped Event",
            start: "2026-04-17T09:00:00.000Z",
            end: "2026-04-17T09:30:00.000Z",
            allDay: false,
            allday: false,
            calendarEntityId: "calendar.family",
            raw: {}
          }]
        }
      }
    });

    expect(pixelBounds(rendered, 0, 0, rendered.width, 20)).not.toBeNull();
    expect(pixelBounds(rendered, 0, 20, rendered.width, 20)).toBeNull();
  });

  it("limits foreach items and picks if/else branches from event data", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const layout = {
      id: "layout-foreach-if",
      name: "Foreach If",
      kind: "fullscreen" as const,
      displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
      rootNode: {
        id: "query-node",
        type: "data_query" as const,
        queryKind: "calendar_events" as const,
        variableName: "events",
        dateVariableName: "date",
        calendarEntityIds: ["calendar.family"],
        offsetDays: 0,
        width: { mode: "fill" as const },
        height: { mode: "fill" as const },
        child: {
          id: "foreach-node",
          type: "foreach" as const,
          itemsRef: "events",
          itemAlias: "event",
          indexAlias: "index",
          axis: "vertical" as const,
          maxItems: 2,
          width: { mode: "fill" as const },
          height: { mode: "fill" as const },
          child: {
            id: "if-node",
            type: "if_else" as const,
            condition: "event.allday == true",
            width: { mode: "fill" as const },
            height: { mode: "fixed_px" as const, value: 18 },
            thenChild: {
              id: "all-day-icon",
              type: "primitive_instance" as const,
              primitiveType: "icon" as const,
              width: { mode: "fill" as const },
              height: { mode: "fill" as const },
              props: { icon: "warning" }
            },
            elseChild: {
              id: "timed-text",
              type: "primitive_instance" as const,
              primitiveType: "text" as const,
              width: { mode: "fill" as const },
              height: { mode: "fill" as const },
              props: { text: "{{index}} {{event.summary}}", autoFit: false, fixedPixelSize: 8, paddingPx: 0 }
            }
          }
        }
      }
    };
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [layout]
    });
    const inspection = inspectLayoutDefinition(project, layout, {
      ...SAMPLE_DATA,
      metaQueries: {
        "query-node": {
          kind: "calendar_events_meta",
          meta: { date: "2026-04-17", dateVariableName: "date" },
          items: [
            {
              summary: "All Day",
              start: "2026-04-17T00:00:00.000Z",
              end: "2026-04-18T00:00:00.000Z",
              allDay: true,
              allday: true,
              calendarEntityId: "calendar.family",
              raw: {}
            },
            {
              summary: "Timed A",
              start: "2026-04-17T09:00:00.000Z",
              end: "2026-04-17T09:30:00.000Z",
              allDay: false,
              allday: false,
              calendarEntityId: "calendar.family",
              raw: {}
            },
            {
              summary: "Timed B",
              start: "2026-04-17T10:00:00.000Z",
              end: "2026-04-17T10:30:00.000Z",
              allDay: false,
              allday: false,
              calendarEntityId: "calendar.family",
              raw: {}
            }
          ]
        }
      }
    });

    const foreachNode = inspection.root?.children[0];
    expect(foreachNode?.nodeType).toBe("foreach");
    expect(foreachNode?.children).toHaveLength(2);
    expect(foreachNode?.children[0]?.children[0]?.label).toBe("icon");
    expect(foreachNode?.children[1]?.children[0]?.label).toBe("text");
  });

  it("filters arrays in meta nodes before foreach rendering", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const layout = {
      id: "layout-filter-meta",
      name: "Filter Meta",
      kind: "fullscreen" as const,
      displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
      rootNode: {
        id: "query-node",
        type: "data_query" as const,
        queryKind: "calendar_events" as const,
        variableName: "events",
        dateVariableName: "date",
        calendarEntityIds: ["calendar.family"],
        offsetDays: 0,
        width: { mode: "fill" as const },
        height: { mode: "fill" as const },
        child: {
          id: "filter-node",
          type: "filter" as const,
          itemsRef: "events",
          outputVariableName: "filteredEvents",
          itemAlias: "event",
          indexAlias: "index",
          condition: 'event.summary != "Blocked"',
          width: { mode: "fill" as const },
          height: { mode: "fill" as const },
          child: {
            id: "foreach-node",
            type: "foreach" as const,
            itemsRef: "filteredEvents",
            itemAlias: "event",
            indexAlias: "index",
            axis: "vertical" as const,
            width: { mode: "fill" as const },
            height: { mode: "fill" as const },
            child: {
              id: "text-node",
              type: "primitive_instance" as const,
              primitiveType: "text" as const,
              width: { mode: "fill" as const },
              height: { mode: "fit_content" as const },
              props: { text: "{{ event.summary }}", autoFit: false, fixedPixelSize: 8, paddingPx: 0, borderToken: "none" as const }
            }
          }
        }
      }
    };
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [layout]
    });
    const inspection = inspectLayoutDefinition(project, layout, {
      ...SAMPLE_DATA,
      metaQueries: {
        "query-node": {
          kind: "calendar_events_meta",
          meta: { date: "2026-04-17", dateVariableName: "date" },
          items: [
            { summary: "Blocked", start: "2026-04-17T09:00:00.000Z", end: "2026-04-17T09:30:00.000Z", allDay: false, allday: false, calendarEntityId: "calendar.family", raw: {} },
            { summary: "Standup", start: "2026-04-17T10:00:00.000Z", end: "2026-04-17T10:30:00.000Z", allDay: false, allday: false, calendarEntityId: "calendar.family", raw: {} }
          ]
        }
      }
    });
    expect(inspection.root?.children[0]?.nodeType).toBe("filter");
    expect(inspection.root?.children[0]?.children[0]?.children).toHaveLength(1);
  });

  it("deduplicates arrays by a template key in unique meta nodes", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const layout: LayoutDefinition = {
      id: "layout-unique-meta",
      name: "Unique Meta",
      kind: "fullscreen" as const,
      displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
      rootNode: {
        id: "query-node",
        type: "data_query" as const,
        queryKind: "calendar_events" as const,
        variableName: "events",
        dateVariableName: "date",
        calendarEntityIds: ["calendar.family"],
        offsetDays: 0,
        width: { mode: "fill" as const },
        height: { mode: "fill" as const },
        child: {
          id: "unique-node",
          type: "unique" as const,
          itemsRef: "events",
          outputVariableName: "uniqueEvents",
          itemAlias: "event",
          indexAlias: "index",
          keyTemplate: '{{ event.start | format("HH:MM") }}--{{ event.summary }}',
          width: { mode: "fill" as const },
          height: { mode: "fill" as const },
          child: {
            id: "foreach-node",
            type: "foreach" as const,
            itemsRef: "uniqueEvents",
            itemAlias: "event",
            indexAlias: "index",
            axis: "vertical" as const,
            width: { mode: "fill" as const },
            height: { mode: "fill" as const },
            child: {
              id: "text-node",
              type: "primitive_instance" as const,
              primitiveType: "text" as const,
              width: { mode: "fill" as const },
              height: { mode: "fit_content" as const },
              props: { text: "{{ event.summary }}", autoFit: false, fixedPixelSize: 8, paddingPx: 0, borderToken: "none" as const }
            }
          }
        }
      }
    };
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [layout]
    });
    const inspection = inspectLayoutDefinition(project, layout, {
      ...SAMPLE_DATA,
      metaQueries: {
        "query-node": {
          kind: "calendar_events_meta",
          meta: { date: "2026-04-17", dateVariableName: "date" },
          items: [
            { summary: "Standup", start: "2026-04-17T10:00:00.000Z", end: "2026-04-17T10:30:00.000Z", allDay: false, allday: false, calendarEntityId: "calendar.family", raw: {} },
            { summary: "Standup", start: "2026-04-17T10:00:00.000Z", end: "2026-04-17T10:30:00.000Z", allDay: false, allday: false, calendarEntityId: "calendar.family", raw: {} },
            { summary: "Other", start: "2026-04-17T11:00:00.000Z", end: "2026-04-17T11:30:00.000Z", allDay: false, allday: false, calendarEntityId: "calendar.family", raw: {} }
          ]
        }
      }
    });
    expect(inspection.root?.children[0]?.nodeType).toBe("unique");
    expect(inspection.root?.children[0]?.children[0]?.children).toHaveLength(2);
  });

  it("supports array pipeline expressions in foreach itemsRef", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const layout: LayoutDefinition = {
      id: "layout-foreach-array-expression",
      name: "Foreach Array Expression",
      kind: "fullscreen" as const,
      displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
      rootNode: {
        id: "query-node",
        type: "data_query" as const,
        queryKind: "calendar_events" as const,
        variableName: "events",
        dateVariableName: "date",
        calendarEntityIds: ["calendar.family"],
        offsetDays: 0,
        width: { mode: "fill" as const },
        height: { mode: "fill" as const },
        child: {
          id: "foreach-node",
          type: "foreach" as const,
          itemsRef: `events | filter($.summary != "Blocked") | unique($.start, $.summary)`,
          itemAlias: "event",
          indexAlias: "index",
          axis: "vertical" as const,
          width: { mode: "fill" as const },
          height: { mode: "fill" as const },
          child: {
            id: "text-node",
            type: "primitive_instance" as const,
            primitiveType: "text" as const,
            width: { mode: "fill" as const },
            height: { mode: "fit_content" as const },
            props: { text: "{{ event.summary }}", autoFit: false, fixedPixelSize: 8, paddingPx: 0, borderToken: "none" as const }
          }
        }
      }
    };
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [layout]
    });
    const inspection = inspectLayoutDefinition(project, layout, {
      ...SAMPLE_DATA,
      metaQueries: {
        "query-node": {
          kind: "calendar_events_meta",
          meta: { date: "2026-04-17", dateVariableName: "date" },
          items: [
            { summary: "Blocked", start: "2026-04-17T09:00:00.000Z", end: "2026-04-17T09:30:00.000Z", allDay: false, allday: false, calendarEntityId: "calendar.family", raw: {} },
            { summary: "Standup", start: "2026-04-17T10:00:00.000Z", end: "2026-04-17T10:30:00.000Z", allDay: false, allday: false, calendarEntityId: "calendar.family", raw: {} },
            { summary: "Standup", start: "2026-04-17T10:00:00.000Z", end: "2026-04-17T10:30:00.000Z", allDay: false, allday: false, calendarEntityId: "calendar.family", raw: {} },
            { summary: "Other", start: "2026-04-17T11:00:00.000Z", end: "2026-04-17T11:30:00.000Z", allDay: false, allday: false, calendarEntityId: "calendar.family", raw: {} }
          ]
        }
      }
    });
    expect(inspection.root?.children[0]?.nodeType).toBe("foreach");
    expect(inspection.root?.children[0]?.children).toHaveLength(2);
  });

  it("binds the query date into data query scope", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const layout = {
      id: "layout-date-scope",
      name: "Date Scope",
      kind: "fullscreen" as const,
      displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
      rootNode: {
        id: "query-node",
        type: "data_query" as const,
        queryKind: "calendar_events" as const,
        variableName: "events",
        dateVariableName: "date",
        calendarEntityIds: ["calendar.family"],
        offsetDays: 0,
        width: { mode: "fill" as const },
        height: { mode: "fill" as const },
        child: {
          id: "if-node",
          type: "if_else" as const,
          condition: 'date == "2026-04-17"',
          width: { mode: "fill" as const },
          height: { mode: "fill" as const },
          thenChild: {
            id: "then-text",
            type: "primitive_instance" as const,
            primitiveType: "text" as const,
            width: { mode: "fill" as const },
            height: { mode: "fill" as const },
            props: { text: '{{ date | format("dddd") }}', autoFit: false, fixedPixelSize: 8, paddingPx: 0 }
          },
          elseChild: {
            id: "else-icon",
            type: "primitive_instance" as const,
            primitiveType: "icon" as const,
            width: { mode: "fill" as const },
            height: { mode: "fill" as const },
            props: { icon: "warning" }
          }
        }
      }
    };
    const inspection = inspectLayoutDefinition(normalizeProject({
      ...normalized,
      layoutDefinitions: [layout]
    }), layout, {
      ...SAMPLE_DATA,
      metaQueries: {
        "query-node": {
          kind: "calendar_events_meta",
          meta: { date: "2026-04-17", dateVariableName: "date" },
          items: []
        }
      }
    });
    expect(inspection.root?.children[0]?.children[0]?.label).toBe("text");
  });

  it("renders formatted event start times in foreach text nodes", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const baseLayout = {
      id: "layout-foreach-format",
      name: "Foreach Format",
      kind: "fullscreen" as const,
      displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
      rootNode: {
        id: "query-node",
        type: "data_query" as const,
        queryKind: "calendar_events" as const,
        variableName: "events",
        dateVariableName: "date",
        calendarEntityIds: ["calendar.family"],
        offsetDays: 0,
        width: { mode: "fill" as const },
        height: { mode: "fill" as const },
        child: {
          id: "foreach-node",
          type: "foreach" as const,
          itemsRef: "events",
          itemAlias: "event",
          indexAlias: "index",
          axis: "vertical" as const,
          maxItems: 1,
          width: { mode: "fill" as const },
          height: { mode: "fill" as const },
          child: {
            id: "text-node",
            type: "primitive_instance" as const,
            primitiveType: "text" as const,
            width: { mode: "fill" as const },
            height: { mode: "fixed_px" as const, value: 16 },
            props: { text: '{{ event.start | format("HH:MM") }}', autoFit: false, fixedPixelSize: 8, paddingPx: 0 }
          }
        }
      }
    };
    const templateProject: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [baseLayout]
    });
    const literalProject: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [{
        id: "layout-foreach-format-literal",
        name: "Foreach Format Literal",
        kind: "fullscreen" as const,
        displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
        rootNode: {
          id: "query-node",
          type: "data_query" as const,
          queryKind: "calendar_events" as const,
          variableName: "events",
          dateVariableName: "date",
          calendarEntityIds: ["calendar.family"],
          offsetDays: 0,
          width: { mode: "fill" as const },
          height: { mode: "fill" as const },
          child: {
            id: "foreach-node",
            type: "foreach" as const,
            itemsRef: "events",
            itemAlias: "event",
            indexAlias: "index",
            axis: "vertical" as const,
            maxItems: 1,
            width: { mode: "fill" as const },
            height: { mode: "fill" as const },
            child: {
              id: "text-node",
              type: "primitive_instance" as const,
              primitiveType: "text" as const,
              width: { mode: "fill" as const },
              height: { mode: "fixed_px" as const, value: 16 },
              props: { text: "09:05", autoFit: false, fixedPixelSize: 8, paddingPx: 0 }
            }
          }
        }
      }]
    });
    const metaQueries = {
      "query-node": {
        kind: "calendar_events_meta",
        meta: { date: "2026-04-17", dateVariableName: "date" },
        items: [{
          summary: "Timed A",
          start: { dateTime: "2026-04-17T09:05:00.000Z" },
          end: "2026-04-17T09:30:00.000Z",
          allDay: false,
          allday: false,
          calendarEntityId: "calendar.family",
          raw: {}
        }]
      }
    };
    const renderedTemplate = renderLayoutDefinition(templateProject, templateProject.layoutDefinitions?.[0]!, {
      ...SAMPLE_DATA,
      metaQueries
    });
    const renderedLiteral = renderLayoutDefinition(literalProject, literalProject.layoutDefinitions?.[0]!, {
      ...SAMPLE_DATA,
      metaQueries
    });
    expect([...renderedTemplate.pixels]).toEqual([...renderedLiteral.pixels]);
  });

  it("uses project locale for formatted template output", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const project: Project = normalizeProject({
      ...normalized,
      locale: "nl-NL",
      layoutDefinitions: [{
        id: "layout-locale-format",
        name: "Locale Format",
        kind: "fullscreen",
        displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
        rootNode: {
          id: "query-node",
          type: "data_query",
          queryKind: "calendar_events",
          variableName: "events",
          dateVariableName: "date",
          calendarEntityIds: ["calendar.family"],
          offsetDays: 0,
          width: { mode: "fill" },
          height: { mode: "fill" },
          child: {
            id: "text-node",
            type: "primitive_instance",
            primitiveType: "text",
            width: { mode: "fill" },
            height: { mode: "fixed_px", value: 16 },
            props: { text: '{{ date | format("dddd") }}', autoFit: false, fixedPixelSize: 8, paddingPx: 0 }
          }
        }
      }]
    });
    const dutch = renderLayoutDefinition(project, project.layoutDefinitions?.[0]!, {
      ...SAMPLE_DATA,
      metaQueries: {
        "query-node": {
          kind: "calendar_events_meta",
          meta: { date: "2026-04-23", dateVariableName: "date" },
          items: []
        }
      }
    });
    const englishProject = normalizeProject({
      ...project,
      locale: "en-US"
    });
    const english = renderLayoutDefinition(englishProject, englishProject.layoutDefinitions?.[0]!, {
      ...SAMPLE_DATA,
      metaQueries: {
        "query-node": {
          kind: "calendar_events_meta",
          meta: { date: "2026-04-23", dateVariableName: "date" },
          items: []
        }
      }
    });
    expect([...dutch.pixels]).not.toEqual([...english.pixels]);
  });

  it("clips primitive drawing to container bounds", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    const layout = {
      id: "layout-clip-bounds",
      name: "Clip Bounds",
      kind: "fullscreen" as const,
      displayTypeId: normalized.displayTypes?.[0]?.id ?? "tri296x128-red",
      rootNode: {
        id: "root",
        type: "stack" as const,
        axis: "vertical" as const,
        width: { mode: "fill" as const },
        height: { mode: "fill" as const },
        children: [
          {
            id: "clip-container",
            type: "stack" as const,
            axis: "vertical" as const,
            width: { mode: "fill" as const },
            height: { mode: "fixed_px" as const, value: 8 },
            children: [{
              id: "clip-text",
              type: "primitive_instance" as const,
              primitiveType: "text" as const,
              width: { mode: "fill" as const },
              height: { mode: "fill" as const },
              props: {
                text: "CLIPPED",
                autoFit: false,
                fixedPixelSize: 24,
                paddingPx: 0,
                horizontalAlign: "left" as const,
                verticalAlign: "top" as const
              }
            }]
          }
        ]
      }
    };
    const project: Project = normalizeProject({
      ...normalized,
      layoutDefinitions: [layout]
    });
    const inspection = inspectLayoutDefinition(project, layout, SAMPLE_DATA);
    const clipFrame = inspection.root?.children[0]?.frame;
    const rendered = renderLayoutDefinition(project, layout, SAMPLE_DATA);

    expect(pixelBounds(rendered, clipFrame?.x ?? 0, clipFrame?.y ?? 0, clipFrame?.w ?? 0, clipFrame?.h ?? 0)).not.toBeNull();
    expect(pixelBounds(
      rendered,
      0,
      (clipFrame?.y ?? 0) + (clipFrame?.h ?? 0),
      rendered.width,
      rendered.height - ((clipFrame?.y ?? 0) + (clipFrame?.h ?? 0))
    )).toBeNull();
  });
});
