import { describe, expect, test } from "bun:test";

import { markNotificationReadSchema } from "./notification";

describe("markNotificationReadSchema", () => {
  test("accepts a non-empty notification id", () => {
    const result = markNotificationReadSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("11111111-1111-1111-1111-111111111111");
    }
  });

  test("rejects empty id", () => {
    expect(markNotificationReadSchema.safeParse({ id: "" }).success).toBe(
      false,
    );
  });

  test("rejects missing id", () => {
    expect(markNotificationReadSchema.safeParse({}).success).toBe(false);
  });
});
