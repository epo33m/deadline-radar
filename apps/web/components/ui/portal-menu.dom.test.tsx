import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";

import { PortalMenu } from "./portal-menu";

// Register DOM globals before react-dom is evaluated.
GlobalRegistrator.register();

afterEach(() => {
  cleanup();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

beforeEach(() => {
  if (typeof window !== "undefined") {
    window.localStorage.clear();
  }
});

function MenuHarness({
  open = true,
  arrowNav = true,
}: {
  open?: boolean;
  arrowNav?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button ref={triggerRef} type="button">
        trigger
      </button>
      <PortalMenu
        open={open}
        onClose={() => undefined}
        triggerRef={triggerRef}
        menuId="pm-test"
        label="Test menu"
        arrowNav={arrowNav}
        searchRef={searchRef}
      >
        <input
          ref={searchRef}
          type="search"
          placeholder="Search"
          aria-label="Search"
        />
        <button type="button" role="option">
          Option A
        </button>
        <button type="button" role="option">
          Option B
        </button>
      </PortalMenu>
    </>
  );
}

describe("PortalMenu arrow navigation", () => {
  test("ArrowDown cycles among options excluding the search field", async () => {
    const view = render(<MenuHarness arrowNav={true} />);
    const search = await view.findByRole("searchbox");
    const options = await view.findAllByRole("option");

    act(() => {
      options[0].focus();
    });
    expect(document.activeElement).toBe(options[0]);

    act(() => {
      fireEvent.keyDown(document, { key: "ArrowDown" });
    });
    expect(document.activeElement).toBe(options[1]);

    act(() => {
      fireEvent.keyDown(document, { key: "ArrowDown" });
    });
    // Wraps back to the first option.
    expect(document.activeElement).toBe(options[0]);
  });

  test("ArrowUp from the first option returns focus to the search field", async () => {
    const view = render(<MenuHarness arrowNav={true} />);
    const search = await view.findByRole("searchbox");
    const options = await view.findAllByRole("option");

    act(() => {
      options[0].focus();
    });
    expect(document.activeElement).toBe(options[0]);

    act(() => {
      fireEvent.keyDown(document, { key: "ArrowUp" });
    });
    // Combobox pattern: back to the search field, not the last option.
    expect(document.activeElement).toBe(search);
  });

  test("ArrowUp from a non-first option goes to the previous option", async () => {
    const view = render(<MenuHarness arrowNav={true} />);
    const options = await view.findAllByRole("option");

    act(() => {
      options[1].focus();
    });
    act(() => {
      fireEvent.keyDown(document, { key: "ArrowUp" });
    });
    expect(document.activeElement).toBe(options[0]);
  });

  test("Home focuses the first option, End focuses the last", async () => {
    const view = render(<MenuHarness arrowNav={true} />);
    const options = await view.findAllByRole("option");

    act(() => {
      options[1].focus();
      fireEvent.keyDown(document, { key: "Home" });
    });
    expect(document.activeElement).toBe(options[0]);

    act(() => {
      fireEvent.keyDown(document, { key: "End" });
    });
    expect(document.activeElement).toBe(options[options.length - 1]);
  });

  test("arrow keys do not move focus while the search field is focused", async () => {
    const view = render(<MenuHarness arrowNav={true} />);
    const search = await view.findByRole("searchbox");
    const options = await view.findAllByRole("option");

    act(() => {
      search.focus();
    });
    expect(document.activeElement).toBe(search);

    act(() => {
      fireEvent.keyDown(document, { key: "ArrowDown" });
    });
    expect(document.activeElement).toBe(search);
  });

  test("without arrowNav, arrow keys do not cycle options", async () => {
    const view = render(<MenuHarness arrowNav={false} />);
    const options = await view.findAllByRole("option");

    act(() => {
      options[0].focus();
    });
    act(() => {
      fireEvent.keyDown(document, { key: "ArrowDown" });
    });
    // No arrow nav: focus stays where it was.
    expect(document.activeElement).toBe(options[0]);
  });
});
