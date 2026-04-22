import { describe, expect, it } from "vitest";
import { inspectLayoutDefinition, renderAssignedDisplay, renderLayoutDefinition } from "./designer-renderer.js";
import { layoutText } from "./bitmap-font.js";
import { normalizeProject } from "./themes.js";
import { SAMPLE_DATA, SAMPLE_PROJECT } from "./sample-project.js";
import type { Project } from "./types.js";

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

describe("designer renderer", () => {
  it("migrates legacy projects into display types, devices, layouts, and assignments", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
    expect(normalized.displayTypes?.length).toBeGreaterThan(0);
    expect(normalized.devices?.length).toBeGreaterThan(0);
    expect(normalized.layoutDefinitions?.length).toBeGreaterThan(0);
    expect(normalized.deviceAssignments?.length).toBeGreaterThan(0);
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
    expect(bounds?.height).toBe(expectedHeight);
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
    expect(rendered.pixels[14 * rendered.width + 10]).toBe(2);
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
});
