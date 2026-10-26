import { afterAll, afterEach, describe, expect, test } from "bun:test";
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

afterAll(() => {
  GlobalRegistrator.unregister();
});

function renderOpenPicker() {
  const changes: string[] = [];
  const view = render(
    <IconPicker value="" onChange={(value) => changes.push(value)} />,
  );

  fireEvent.click(view.getByRole("button", { name: "None" }));

  return { changes, view };
}

describe("IconPicker search", () => {
  test("finds an icon by its displayed label", async () => {
    const { changes, view } = renderOpenPicker();
    const search = await view.findByRole("searchbox", { name: "Search icons" });

    fireEvent.input(search, { target: { value: "lab" } });
    fireEvent.click(await view.findByRole("option", { name: "Lab" }));

    expect(changes).toEqual(["flask-conical"]);
  });

  test("selects the top result on Enter", async () => {
    const { changes, view } = renderOpenPicker();
    const search = await view.findByRole("searchbox", { name: "Search icons" });

    fireEvent.input(search, { target: { value: "math" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(changes).toEqual(["calculator"]);
  });

  test("clears the query when the menu closes", async () => {
    const { view } = renderOpenPicker();
    const search = await view.findByRole("searchbox", { name: "Search icons" });

    fireEvent.input(search, { target: { value: "lab" } });
    expect(await view.findByRole("option", { name: "Lab" })).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "None" }));
    await waitFor(() => expect(view.queryByRole("listbox")).toBeNull());

    fireEvent.click(view.getByRole("button", { name: "None" }));
    const reopened = await view.findByRole("searchbox", {
      name: "Search icons",
    });

    expect((reopened as HTMLInputElement).value).toBe("");
  });

  test("announces empty results to screen readers", async () => {
    const { view } = renderOpenPicker();
    const search = await view.findByRole("searchbox", { name: "Search icons" });

    fireEvent.input(search, { target: { value: "zzzzzz" } });

    await waitFor(() =>
      expect(view.getByRole("status").textContent).toContain(
        'No icons match "zzzzzz"',
      ),
    );
  });
});
