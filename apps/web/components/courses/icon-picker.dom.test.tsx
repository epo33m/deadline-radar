import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Register DOM globals before react-dom is evaluated: it captures `canUseDOM`
// at import time, and without it controlled-input events never reach React.
GlobalRegistrator.register();

const { IconPicker } = await import("./icon-picker");
const { cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  // Keep recents localStorage isolated between tests.
  if (typeof window !== "undefined") {
    window.localStorage.clear();
  }
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

function renderOpenPicker() {
  const changes: string[] = [];
  const view = render(
    <IconPicker value="" onChange={(value) => changes.push(value)} />,
  );

  // The trigger button shows the current icon label ("None" when unset).
  fireEvent.click(view.getByRole("button", { name: "None" }));

  return { changes, view };
}

describe("IconPicker search", () => {
  test("finds an icon by its displayed label", async () => {
    const { changes, view } = renderOpenPicker();
    const search = await view.findByRole("combobox", { name: "Search icons" });

    fireEvent.input(search, { target: { value: "lab" } });
    fireEvent.click(await view.findByRole("option", { name: "Lab" }));

    expect(changes).toEqual(["flask-conical"]);
  });

  test("selects the top result on Enter", async () => {
    const { changes, view } = renderOpenPicker();
    const search = await view.findByRole("combobox", { name: "Search icons" });

    fireEvent.input(search, { target: { value: "math" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(changes).toEqual(["calculator"]);
  });

  test("clears the query when the menu closes", async () => {
    const { view } = renderOpenPicker();
    const search = await view.findByRole("combobox", { name: "Search icons" });

    fireEvent.input(search, { target: { value: "lab" } });
    expect(await view.findByRole("option", { name: "Lab" })).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "None" }));
    await waitFor(() => expect(view.queryByRole("listbox")).toBeNull());

    fireEvent.click(view.getByRole("button", { name: "None" }));
    const reopened = await view.findByRole("combobox", {
      name: "Search icons",
    });
    expect((reopened as HTMLInputElement).value).toBe("");
  });

  test("announces empty results to screen readers", async () => {
    const { view } = renderOpenPicker();
    const search = await view.findByRole("combobox", { name: "Search icons" });

    fireEvent.input(search, { target: { value: "zzzzzz" } });

    await view.findByRole("button", { name: "Reset" });
    expect(view.getByRole("status").textContent).toContain(
      'No icons match "zzzzzz"',
    );
  });
});

describe("IconPicker ARIA combobox", () => {
  test("input exposes combobox with expanded/controls/activedescendant", async () => {
    const { view } = renderOpenPicker();
    const search = await view.findByRole("combobox", { name: "Search icons" });

    expect(search.getAttribute("aria-expanded")).toBe("true");
    expect(search.getAttribute("aria-controls")).not.toBe("");
    const listbox = view.getByRole("listbox");
    expect(search.getAttribute("aria-controls")).toBe(listbox.id);
  });

  test("every option has an id and aria-selected", async () => {
    const { view } = renderOpenPicker();
    await view.findByRole("combobox", { name: "Search icons" });

    const options = view.getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.id).not.toBe("");
      expect(option.getAttribute("aria-selected")).not.toBeNull();
    }
  });

  test("aria-activedescendant tracks the focused option", async () => {
    const { view } = renderOpenPicker();
    const search = await view.findByRole("combobox", { name: "Search icons" });

    // No option focused yet.
    expect(search.getAttribute("aria-activedescendant")).toBeNull();

    // Arrow down into the first option.
    const firstOption = view.getAllByRole("option")[0];
    fireEvent.focus(firstOption);

    expect(search.getAttribute("aria-activedescendant")).toBe(firstOption.id);
  });

  test("Current block is always present at the top", async () => {
    const { view } = renderOpenPicker();
    await view.findByRole("combobox", { name: "Search icons" });

    const current = view.getByRole("option", { name: "None" });
    expect(current.getAttribute("aria-selected")).toBe("true");
  });

  test("ArrowUp from the first option returns focus to the search field", async () => {
    const { view } = renderOpenPicker();
    const search = await view.findByRole("combobox", { name: "Search icons" });

    const firstOption = view.getAllByRole("option")[0];
    fireEvent.focus(firstOption);
    expect(document.activeElement).toBe(firstOption);

    fireEvent.keyDown(firstOption, { key: "ArrowUp" });
    expect(document.activeElement).toBe(search);
  });

  test("category chips filter suggested icons", async () => {
    const { view } = renderOpenPicker();
    await view.findByRole("combobox", { name: "Search icons" });

    // All suggested visible by default.
    expect(view.getByRole("option", { name: "Book" })).toBeTruthy();
    expect(view.getByRole("option", { name: "Lab" })).toBeTruthy();

    // Click the "Science" chip: only Science suggestions remain.
    fireEvent.click(await view.findByRole("button", { name: "Science" }));
    expect(view.getByRole("option", { name: "Lab" })).toBeTruthy();
    expect(view.getByRole("option", { name: "Math" })).toBeTruthy();
    expect(view.queryByRole("option", { name: "Book" })).toBeNull();

    // "All" restores everything.
    fireEvent.click(await view.findByRole("button", { name: "All" }));
    expect(view.getByRole("option", { name: "Book" })).toBeTruthy();
  });
});
