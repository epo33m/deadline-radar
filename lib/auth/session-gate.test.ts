import { describe, expect, test } from "bun:test";
import { resolveSessionGate } from "./session-gate";

describe("resolveSessionGate", () => {
  test("redirects unauthenticated users away from protected routes to /login", () => {
    expect(
      resolveSessionGate({ hasSession: false, pathname: "/dashboard" }),
    ).toEqual({ action: "redirect", to: "/login" });
    expect(
      resolveSessionGate({ hasSession: false, pathname: "/preferences" }),
    ).toEqual({ action: "redirect", to: "/login" });
    expect(
      resolveSessionGate({ hasSession: false, pathname: "/tasks/abc" }),
    ).toEqual({ action: "redirect", to: "/login" });
  });

  test("allows unauthenticated users on public and auth routes", () => {
    expect(resolveSessionGate({ hasSession: false, pathname: "/" })).toEqual({
      action: "allow",
    });
    expect(
      resolveSessionGate({ hasSession: false, pathname: "/login" }),
    ).toEqual({ action: "allow" });
    expect(
      resolveSessionGate({ hasSession: false, pathname: "/register" }),
    ).toEqual({ action: "allow" });
    expect(
      resolveSessionGate({ hasSession: false, pathname: "/forgot-password" }),
    ).toEqual({ action: "allow" });
  });

  test("redirects authenticated users away from auth pages to /dashboard", () => {
    expect(
      resolveSessionGate({ hasSession: true, pathname: "/login" }),
    ).toEqual({ action: "redirect", to: "/dashboard" });
    expect(
      resolveSessionGate({ hasSession: true, pathname: "/register" }),
    ).toEqual({ action: "redirect", to: "/dashboard" });
  });

  test("allows authenticated users on protected and home routes", () => {
    expect(
      resolveSessionGate({ hasSession: true, pathname: "/dashboard" }),
    ).toEqual({ action: "allow" });
    expect(
      resolveSessionGate({ hasSession: true, pathname: "/courses" }),
    ).toEqual({ action: "allow" });
    expect(resolveSessionGate({ hasSession: true, pathname: "/" })).toEqual({
      action: "allow",
    });
  });
});
