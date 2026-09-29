import { describe, expect, test } from "bun:test";
import { resolveSessionGate } from "./session-gate";

describe("resolveSessionGate", () => {
  test("redirects unauthenticated users away from non-public routes to /login", () => {
    expect(
      resolveSessionGate({ hasSession: false, pathname: "/summary" }),
    ).toEqual({ action: "redirect", to: "/login" });
    expect(
      resolveSessionGate({ hasSession: false, pathname: "/settings" }),
    ).toEqual({ action: "redirect", to: "/login" });
    expect(
      resolveSessionGate({ hasSession: false, pathname: "/tasks/abc" }),
    ).toEqual({ action: "redirect", to: "/login" });
    expect(
      resolveSessionGate({ hasSession: false, pathname: "/secret-page" }),
    ).toEqual({ action: "redirect", to: "/login" });
    // The "How it works" section moved onto `/`, so this route no longer exists
    // and must not stay public — that would let a dead URL past the gate.
    expect(
      resolveSessionGate({ hasSession: false, pathname: "/get-started" }),
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
    expect(
      resolveSessionGate({ hasSession: false, pathname: "/reset-password" }),
    ).toEqual({ action: "allow" });
    expect(
      resolveSessionGate({ hasSession: false, pathname: "/auth/confirm" }),
    ).toEqual({ action: "allow" });
  });

  test("allows unauthenticated users on the legal pages", () => {
    // The footer links to both, so they must not be gated behind a session.
    expect(
      resolveSessionGate({ hasSession: false, pathname: "/privacy" }),
    ).toEqual({
      action: "allow",
    });
    expect(
      resolveSessionGate({ hasSession: false, pathname: "/terms" }),
    ).toEqual({
      action: "allow",
    });
  });

  test("redirects authenticated users away from auth pages to /summary", () => {
    expect(
      resolveSessionGate({ hasSession: true, pathname: "/login" }),
    ).toEqual({ action: "redirect", to: "/summary" });
    expect(
      resolveSessionGate({ hasSession: true, pathname: "/register" }),
    ).toEqual({ action: "redirect", to: "/summary" });
  });

  test("allows authenticated users on protected and home routes", () => {
    expect(
      resolveSessionGate({ hasSession: true, pathname: "/summary" }),
    ).toEqual({ action: "allow" });
    expect(
      resolveSessionGate({ hasSession: true, pathname: "/courses" }),
    ).toEqual({ action: "allow" });
    expect(resolveSessionGate({ hasSession: true, pathname: "/" })).toEqual({
      action: "allow",
    });
  });

  test("does not redirect authenticated users away from reset-password", () => {
    expect(
      resolveSessionGate({ hasSession: true, pathname: "/reset-password" }),
    ).toEqual({ action: "allow" });
  });
});
