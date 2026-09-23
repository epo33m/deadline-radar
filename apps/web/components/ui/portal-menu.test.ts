import { describe, expect, test } from "bun:test";

import { measureMenuPosition } from "./portal-menu";

function triggerFor(
  top: number,
  height = 44,
  width = 44,
  left = 300,
): HTMLElement {
  return {
    getBoundingClientRect: () => ({
      top,
      height,
      width,
      bottom: top + height,
      left,
      right: left + width,
    }),
  } as unknown as HTMLElement;
}

function setViewport(width: number, height: number): void {
  globalThis.window = {
    innerWidth: width,
    innerHeight: height,
  } as unknown as Window & typeof globalThis;
}

const fullWidth = { fullWidth: true };

describe("measureMenuPosition", () => {
  test("anchors below a top-of-viewport trigger and uses the space below (390x844)", () => {
    setViewport(390, 844);
    const position = measureMenuPosition(
      triggerFor(4),
      { ...fullWidth, disableSheet: true },
    );

    expect(position.variant).toBe("dropdown");
    expect(position.top).toBe(4 + 44 + 6);
    expect(position.width).toBe(390 - 16 * 2);
    expect(position.maxHeight).toBe(380);
  });

  test("clamps to the available space on a short viewport", () => {
    setViewport(320, 320);
    const position = measureMenuPosition(
      triggerFor(4),
      { ...fullWidth, disableSheet: true },
    );

    expect(position.variant).toBe("dropdown");
    expect(position.maxHeight).toBe(320 - 48 - 6 - 16);
  });

  test("flips above and clamps by the space above when there is more room above", () => {
    setViewport(390, 844);
    const position = measureMenuPosition(
      triggerFor(800),
      { ...fullWidth, disableSheet: true },
    );

    expect(position.variant).toBe("dropdown");
    expect(position.maxHeight).toBe(380);
    expect(position.top).toBe(Math.max(16, 800 - 6 - 380));
  });

  test("respects the minSpace floor when space is scarce", () => {
    setViewport(200, 200);
    const position = measureMenuPosition(
      triggerFor(4),
      { ...fullWidth, disableSheet: true },
    );

    expect(position.variant).toBe("dropdown");
    expect(position.maxHeight).toBe(160);
  });

  test("falls back to a bottom sheet below 640px unless disableSheet is set", () => {
    setViewport(375, 667);
    const sheet = measureMenuPosition(triggerFor(4), fullWidth);
    expect(sheet.variant).toBe("sheet");
    expect(sheet.maxHeight).toBe(380);

    const dropdown = measureMenuPosition(triggerFor(4), {
      ...fullWidth,
      disableSheet: true,
    });
    expect(dropdown.variant).toBe("dropdown");
  });

  test("align end right-anchors the menu to the trigger's right edge (1440px)", () => {
    setViewport(1440, 900);
    const position = measureMenuPosition(
      triggerFor(4, 44, 44, 1104),
      { minWidth: 192, align: "end", disableSheet: true },
    );

    expect(position.variant).toBe("dropdown");
    expect(position.width).toBe(192);
    expect(position.left).toBe(1104 + 44 - 192);
  });

  test("align end keeps the menu on-screen and clear of a right-side trigger on small phones", () => {
    setViewport(375, 844);
    // Trigger sits next to the 44px utility cluster + 4px gap + 16px gutter.
    const trigger = triggerFor(4, 44, 64, 375 - 16 - 44 - 4 - 64);
    const position = measureMenuPosition(trigger, {
      minWidth: 192,
      align: "end",
      disableSheet: true,
    });

    expect(position.variant).toBe("dropdown");
    expect(position.width).toBe(192);
    // Menu's right edge aligns to the trigger's right edge (inside viewport).
    expect(position.left + position.width).toBe(
      375 - 16 - 44 - 4,
    );
    expect(position.left).toBeGreaterThanOrEqual(16);
  });

  test("align end clamps to the viewport margin when the trigger hugs the left edge", () => {
    setViewport(375, 844);
    const position = measureMenuPosition(
      triggerFor(4, 44, 44, 10),
      { minWidth: 192, align: "end", disableSheet: true },
    );

    expect(position.left).toBe(16);
    expect(position.left + position.width).toBe(16 + 192);
  });
});