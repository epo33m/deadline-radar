import { describe, expect, test } from "bun:test";

import {
  evaluateReminders,
  isThresholdDue,
  MAX_EMAIL_DELIVERY_RETRIES,
  thresholdTriggerAt,
  type ReminderTaskInput,
} from "./evaluate";

describe("isThresholdDue", () => {
  // Deadline: Friday 2026-09-11 23:59 Asia/Makassar (UTC+8) = 15:59 UTC
  const deadline = "2026-09-11T15:59:00.000Z";
  const timeZone = "Asia/Makassar";

  test("H-3 is not due before Tuesday 23:59 Makassar", () => {
    const now = new Date("2026-09-08T15:58:59.000Z"); // Tue 23:58:59 Makassar
    expect(isThresholdDue(deadline, 3, now, timeZone)).toBe(false);
  });

  test("H-3 is due at Tuesday 23:59 Makassar", () => {
    const now = new Date("2026-09-08T15:59:00.000Z"); // Tue 23:59 Makassar
    expect(isThresholdDue(deadline, 3, now, timeZone)).toBe(true);
  });

  test("H-0 is due at the deadline instant", () => {
    expect(isThresholdDue(deadline, 0, new Date(deadline), timeZone)).toBe(
      true,
    );
  });

  test("H-7 is already due when now is past the deadline", () => {
    const now = new Date("2026-09-12T00:00:00.000Z");
    expect(isThresholdDue(deadline, 7, now, timeZone)).toBe(true);
  });
});

describe("evaluateReminders", () => {
  const timeZone = "Asia/Makassar";
  // Created when only H-1 and H-0 are still ahead; H-7/H-3 already past.
  const createdAt = "2026-09-09T08:00:00.000Z";
  const deadline = "2026-09-11T15:59:00.000Z";
  const nowAtH1 = new Date("2026-09-10T15:59:00.000Z");

  function baseTask(
    overrides: Partial<ReminderTaskInput> = {},
  ): ReminderTaskInput {
    return {
      id: "task-1",
      status: "todo",
      deadline,
      created_at: createdAt,
      timeZone,
      thresholds: [
        { id: "th-7", days_before: 7 },
        { id: "th-3", days_before: 3 },
        { id: "th-1", days_before: 1 },
        { id: "th-0", days_before: 0 },
      ],
      deliveries: [],
      ...overrides,
    };
  }

  test("skips done tasks entirely", () => {
    const actions = evaluateReminders(
      [baseTask({ status: "done" })],
      nowAtH1,
    );
    expect(actions).toEqual([]);
  });

  test("terminal Done: completing before a threshold fires silences it forever (no reopen path)", () => {
    // Task completed via Mark as done while H-1 is still in the future.
    // H-1 later becomes due, but the terminal done state means the
    // evaluator never produces actions for it — and since reopen does not
    // exist in v1, no future evaluation can revive it either.
    const completed: ReminderTaskInput = {
      ...baseTask({ status: "done" }),
      deadline_updated_at: "2026-09-09T08:00:00.000Z",
    };
    const afterTrigger = new Date("2026-09-10T16:00:00.000Z");
    expect(isThresholdDue(completed.deadline, 1, afterTrigger, "Asia/Makassar")).toBe(true);
    expect(evaluateReminders([completed], afterTrigger)).toEqual([]);
  });

  test("does not create deliveries for thresholds already past at task creation", () => {
    const actions = evaluateReminders([baseTask()], nowAtH1);
    const thresholdIds = actions.map((a) => a.threshold_id);
    expect(thresholdIds).not.toContain("th-7");
    expect(thresholdIds).not.toContain("th-3");
  });

  test("creates email and in_app deliveries for a newly due threshold", () => {
    const actions = evaluateReminders([baseTask()], nowAtH1);
    expect(actions).toEqual([
      {
        action: "create",
        task_id: "task-1",
        threshold_id: "th-1",
        channel: "email",
        days_before: 1,
        late: false,
      },
      {
        action: "create",
        task_id: "task-1",
        threshold_id: "th-1",
        channel: "in_app",
        days_before: 1,
        late: false,
      },
    ]);
  });

  test("does not create when pending or sent delivery already exists for a channel", () => {
    const actions = evaluateReminders(
      [
        baseTask({
          deliveries: [
            {
              id: "del-email",
              threshold_id: "th-1",
              days_before: 1,
              channel: "email",
              status: "pending",
              retry_count: 0,
            },
            {
              id: "del-inapp",
              threshold_id: "th-1",
              days_before: 1,
              channel: "in_app",
              status: "sent",
              retry_count: 0,
            },
          ],
        }),
      ],
      nowAtH1,
    );
    expect(actions).toEqual([]);
  });

  test("does not create when a sending (claimed) delivery exists — F-10", () => {
    const actions = evaluateReminders(
      [
        baseTask({
          deliveries: [
            {
              id: "del-email",
              threshold_id: "th-1",
              days_before: 1,
              channel: "email",
              status: "sending",
              retry_count: 0,
            },
          ],
        }),
      ],
      nowAtH1,
    );
    // Email suppressed by the claim; in_app has no delivery yet so it is
    // still created.
    expect(actions).toEqual([
      {
        action: "create",
        task_id: "task-1",
        threshold_id: "th-1",
        channel: "in_app",
        days_before: 1,
        late: false,
      },
    ]);
  });

  test("retries a failed email by updating the existing delivery, not creating a duplicate", () => {
    const actions = evaluateReminders(
      [
        baseTask({
          deliveries: [
            {
              id: "del-email-failed",
              threshold_id: "th-1",
              days_before: 1,
              channel: "email",
              status: "failed",
              retry_count: 1,
            },
            {
              id: "del-inapp",
              threshold_id: "th-1",
              days_before: 1,
              channel: "in_app",
              status: "sent",
              retry_count: 0,
            },
          ],
        }),
      ],
      nowAtH1,
    );
    expect(actions).toEqual([
      {
        action: "retry",
        delivery_id: "del-email-failed",
        task_id: "task-1",
        threshold_id: "th-1",
        channel: "email",
        days_before: 1,
        retry_count: 1,
      },
    ]);
    expect(actions.every((a) => a.action !== "create")).toBe(true);
  });

  test("does not create a second email row when a failed delivery already exists", () => {
    const actions = evaluateReminders(
      [
        baseTask({
          deliveries: [
            {
              id: "del-email-failed",
              threshold_id: "th-1",
              days_before: 1,
              channel: "email",
              status: "failed",
              retry_count: 0,
            },
          ],
        }),
      ],
      nowAtH1,
    );
    const emailCreates = actions.filter(
      (a) => a.action === "create" && a.channel === "email",
    );
    const emailRetries = actions.filter(
      (a) => a.action === "retry" && a.channel === "email",
    );
    expect(emailCreates).toHaveLength(0);
    expect(emailRetries).toHaveLength(1);
    expect(emailRetries[0]).toMatchObject({
      delivery_id: "del-email-failed",
    });
  });

  describe("M-4: threshold offset mutation and historical delivery snapshots", () => {
    // Task created 10 days before deadline, so H-5 and H-3 are both valid future triggers
    const taskCreatedAt = "2026-09-01T08:00:00.000Z";
    const nowAtH5 = new Date("2026-09-06T15:59:00.000Z");

    test("existing H-3 sent delivery does not suppress newly configured H-5 threshold", () => {
      // Threshold th-1 was originally H-3 and was sent. Then user patched th-1 to H-5.
      const task: ReminderTaskInput = {
        id: "task-1",
        status: "todo",
        deadline,
        created_at: taskCreatedAt,
        timeZone,
        thresholds: [
          { id: "th-1", days_before: 5 }, // th-1 is now H-5
        ],
        deliveries: [
          {
            id: "del-h3-email",
            threshold_id: "th-1",
            days_before: 3, // sent when th-1 was H-3
            channel: "email",
            status: "sent",
            retry_count: 0,
          },
          {
            id: "del-h3-inapp",
            threshold_id: "th-1",
            days_before: 3,
            channel: "in_app",
            status: "sent",
            retry_count: 0,
          },
        ],
      };

      const actions = evaluateReminders([task], nowAtH5);
      expect(actions).toEqual([
        {
          action: "create",
          task_id: "task-1",
          threshold_id: "th-1",
          channel: "email",
          days_before: 5,
          late: false,
        },
        {
          action: "create",
          task_id: "task-1",
          threshold_id: "th-1",
          channel: "in_app",
          days_before: 5,
          late: false,
        },
      ]);
    });

    test("does not create duplicate H-3 if threshold is set back to H-3 after H-3 was sent", () => {
      const task: ReminderTaskInput = {
        id: "task-1",
        status: "todo",
        deadline,
        created_at: taskCreatedAt,
        timeZone,
        thresholds: [
          { id: "th-1", days_before: 3 },
        ],
        deliveries: [
          {
            id: "del-h3-email",
            threshold_id: "th-1",
            days_before: 3,
            channel: "email",
            status: "sent",
            retry_count: 0,
          },
        ],
      };

      const actions = evaluateReminders([task], new Date("2026-09-08T16:00:00.000Z"));
      const emailActions = actions.filter((a) => a.channel === "email");
      expect(emailActions).toHaveLength(0);
    });

    test("failed H-3 delivery does not retry as H-5 when threshold offset is changed", () => {
      const task: ReminderTaskInput = {
        id: "task-1",
        status: "todo",
        deadline,
        created_at: taskCreatedAt,
        timeZone,
        thresholds: [
          { id: "th-1", days_before: 5 }, // th-1 changed to H-5
        ],
        deliveries: [
          {
            id: "del-h3-failed",
            threshold_id: "th-1",
            days_before: 3, // failed when it was H-3
            channel: "email",
            status: "failed",
            retry_count: 1,
          },
        ],
      };

      const actions = evaluateReminders([task], nowAtH5);
      // H-5 should be created as a new delivery, not a retry of the H-3 delivery
      const retries = actions.filter((a) => a.action === "retry");
      const creates = actions.filter((a) => a.action === "create" && a.channel === "email");
      expect(retries).toHaveLength(0);
      expect(creates).toHaveLength(1);
      expect(creates[0]).toMatchObject({
        threshold_id: "th-1",
        days_before: 5,
        channel: "email",
      });
    });

    test("pending H-3 delivery allows H-5 delivery to be created for new offset", () => {
      const task: ReminderTaskInput = {
        id: "task-1",
        status: "todo",
        deadline,
        created_at: taskCreatedAt,
        timeZone,
        thresholds: [
          { id: "th-1", days_before: 5 },
        ],
        deliveries: [
          {
            id: "del-h3-pending",
            threshold_id: "th-1",
            days_before: 3,
            channel: "email",
            status: "pending",
            retry_count: 0,
          },
        ],
      };

      const actions = evaluateReminders([task], nowAtH5);
      const emailCreates = actions.filter(
        (a) => a.action === "create" && a.channel === "email",
      );
      expect(emailCreates).toHaveLength(1);
      expect(emailCreates[0].days_before).toBe(5);
    });
  });

  describe("F-01: deadline / threshold edits never fire newly-past triggers", () => {
    const timeZone = "UTC";
    // Audit repro: created 1 Sep, deadline moved forward to 12 Sep on 10 Sep.
    // New H-7 trigger (5 Sep) is past at edit time but after creation, so the
    // old creation-only guard would let it through.
    const editedTask: ReminderTaskInput = {
      id: "task-f01",
      status: "todo",
      deadline: "2026-09-12T12:00:00.000Z",
      created_at: "2026-09-01T08:00:00.000Z",
      deadline_updated_at: "2026-09-10T00:00:00.000Z",
      timeZone,
      thresholds: [{ id: "th-7", days_before: 7 }],
      deliveries: [],
    };

    test("moved-forward deadline does not fire a newly-past threshold", () => {
      const actions = evaluateReminders(
        [editedTask],
        new Date("2026-09-10T00:00:00.000Z"),
      );
      expect(actions).toEqual([]);
    });

    test("edited trigger that is still ahead of the edit fires normally", () => {
      // Same edit, but H-1 (trigger 11 Sep) is still ahead of the 10 Sep edit.
      const actions = evaluateReminders(
        [
          {
            ...editedTask,
            thresholds: [{ id: "th-1", days_before: 1 }],
          },
        ],
        new Date("2026-09-11T12:00:00.000Z"),
      );
      expect(actions).toHaveLength(2);
      expect(actions.map((a) => a.channel).sort()).toEqual([
        "email",
        "in_app",
      ]);
    });

    test("legacy input without deadline_updated_at keeps creation-only behavior", () => {
      const { deadline_updated_at: _omit, ...legacy } = editedTask;
      const actions = evaluateReminders(
        [{ ...legacy, thresholds: [{ id: "th-1", days_before: 1 }] }],
        new Date("2026-09-11T12:00:00.000Z"),
      );
      expect(actions).toHaveLength(2);
    });

    test("threshold offset edit does not fire a newly-past default threshold", () => {
      // Deadline unchanged (deadline_updated_at == created_at), but the
      // threshold offset was edited on 10 Sep while its new trigger (5 Sep)
      // was already past.
      const task: ReminderTaskInput = {
        id: "task-f01-th",
        status: "todo",
        deadline: "2026-09-12T12:00:00.000Z",
        created_at: "2026-09-01T08:00:00.000Z",
        deadline_updated_at: "2026-09-01T08:00:00.000Z",
        timeZone,
        thresholds: [
          {
            id: "th-7",
            days_before: 7,
            updated_at: "2026-09-10T00:00:00.000Z",
            created_at: "2026-09-01T08:00:00.000Z",
          },
        ],
        deliveries: [],
      };
      const actions = evaluateReminders(
        [task],
        new Date("2026-09-10T00:00:00.000Z"),
      );
      expect(actions).toEqual([]);
    });

    test("threshold edited before its trigger still fires", () => {
      const task: ReminderTaskInput = {
        id: "task-f01-th-ok",
        status: "todo",
        deadline: "2026-09-12T12:00:00.000Z",
        created_at: "2026-09-01T08:00:00.000Z",
        deadline_updated_at: "2026-09-01T08:00:00.000Z",
        timeZone,
        thresholds: [
          {
            id: "th-1",
            days_before: 1,
            updated_at: "2026-09-05T00:00:00.000Z",
            created_at: "2026-09-01T08:00:00.000Z",
          },
        ],
        deliveries: [],
      };
      const actions = evaluateReminders(
        [task],
        new Date("2026-09-11T12:00:00.000Z"),
      );
      expect(actions).toHaveLength(2);
    });
  });

  describe("F-03: scheduler-activation cutoff silences pre-cutoff triggers", () => {
    const timeZone = "UTC";
    // Audit repro: task created 60 days ago, H-1 trigger long before the
    // scheduler-activation cutoff. The deadline is just past (inside the RF-11
    // 1h grace) so the deadline-suppression rule does not mask the cutoff test.
    const staleTask: ReminderTaskInput = {
      id: "task-f03",
      status: "todo",
      deadline: "2026-09-19T12:00:00.000Z",
      created_at: "2026-07-21T08:00:00.000Z",
      deadline_updated_at: "2026-07-21T08:00:00.000Z",
      timeZone,
      thresholds: [{ id: "th-1", days_before: 1 }],
      deliveries: [],
    };
    const now = new Date("2026-09-19T12:30:00.000Z");
    // Scheduler activated 19 Sep — after the stale H-1 trigger (18 Sep),
    // before the fresh one (20 Sep).
    const cutoff = new Date("2026-09-19T00:00:00.000Z");

    test("first run after activation creates nothing for pre-cutoff triggers", () => {
      expect(evaluateReminders([staleTask], now, { cutoff })).toEqual([]);
    });

    test("no cutoff preserves the pre-existing burst behavior", () => {
      const actions = evaluateReminders([staleTask], now);
      expect(actions).toHaveLength(2);
    });

    test("post-cutoff triggers on old tasks still fire normally", () => {
      const freshDeadlineTask: ReminderTaskInput = {
        ...staleTask,
        deadline: "2026-09-21T12:00:00.000Z", // H-1 trigger = 20 Sep, after cutoff
      };
      const actions = evaluateReminders(
        [freshDeadlineTask],
        new Date("2026-09-20T12:00:00.000Z"),
        { cutoff },
      );
      expect(actions).toHaveLength(2);
    });

    test("a trigger exactly at the cutoff still fires (strict <)", () => {
      const edgeTask: ReminderTaskInput = {
        ...staleTask,
        deadline: "2026-09-20T00:00:00.000Z", // H-1 trigger = 19 Sep = cutoff
      };
      const atCutoff = new Date("2026-09-19T00:00:00.000Z");
      const actions = evaluateReminders([edgeTask], atCutoff, { cutoff });
      expect(actions).toHaveLength(2);
    });

    test("retries of pre-cutoff failed deliveries are also suppressed", () => {
      const failedTask: ReminderTaskInput = {
        ...staleTask,
        deadline: "2026-09-10T12:00:00.000Z", // H-1 trigger = 9 Sep, before cutoff
        deliveries: [
          {
            id: "del-old-failed",
            threshold_id: "th-1",
            days_before: 1,
            channel: "email",
            status: "failed",
            retry_count: 1,
          },
        ],
      };
      expect(evaluateReminders([failedTask], now, { cutoff })).toEqual([]);
    });
  });

  describe("M-5: email delivery retry cap (MAX_EMAIL_DELIVERY_RETRIES = 3)", () => {
    test("MAX_EMAIL_DELIVERY_RETRIES constant is 3", () => {
      expect(MAX_EMAIL_DELIVERY_RETRIES).toBe(3);
    });

    test("Case A: failed delivery with retry_count = 0 produces retry action", () => {
      const actions = evaluateReminders(
        [
          baseTask({
            deliveries: [
              {
                id: "del-retry-0",
                threshold_id: "th-1",
                days_before: 1,
                channel: "email",
                status: "failed",
                retry_count: 0,
              },
              {
                id: "del-inapp",
                threshold_id: "th-1",
                days_before: 1,
                channel: "in_app",
                status: "sent",
                retry_count: 0,
              },
            ],
          }),
        ],
        nowAtH1,
      );
      expect(actions).toEqual([
        {
          action: "retry",
          delivery_id: "del-retry-0",
          task_id: "task-1",
          threshold_id: "th-1",
          channel: "email",
          days_before: 1,
          retry_count: 0,
        },
      ]);
    });

    test("Case B: failed delivery with retry_count = 1 produces retry action", () => {
      const actions = evaluateReminders(
        [
          baseTask({
            deliveries: [
              {
                id: "del-retry-1",
                threshold_id: "th-1",
                days_before: 1,
                channel: "email",
                status: "failed",
                retry_count: 1,
              },
              {
                id: "del-inapp",
                threshold_id: "th-1",
                days_before: 1,
                channel: "in_app",
                status: "sent",
                retry_count: 0,
              },
            ],
          }),
        ],
        nowAtH1,
      );
      expect(actions).toEqual([
        {
          action: "retry",
          delivery_id: "del-retry-1",
          task_id: "task-1",
          threshold_id: "th-1",
          channel: "email",
          days_before: 1,
          retry_count: 1,
        },
      ]);
    });

    test("Case C: failed delivery with retry_count = 2 produces retry action", () => {
      const actions = evaluateReminders(
        [
          baseTask({
            deliveries: [
              {
                id: "del-retry-2",
                threshold_id: "th-1",
                days_before: 1,
                channel: "email",
                status: "failed",
                retry_count: 2,
              },
              {
                id: "del-inapp",
                threshold_id: "th-1",
                days_before: 1,
                channel: "in_app",
                status: "sent",
                retry_count: 0,
              },
            ],
          }),
        ],
        nowAtH1,
      );
      expect(actions).toEqual([
        {
          action: "retry",
          delivery_id: "del-retry-2",
          task_id: "task-1",
          threshold_id: "th-1",
          channel: "email",
          days_before: 1,
          retry_count: 2,
        },
      ]);
    });

    test("Case D: failed delivery with retry_count = 3 (cap reached) produces NO retry and NO duplicate create", () => {
      const actions = evaluateReminders(
        [
          baseTask({
            deliveries: [
              {
                id: "del-retry-3",
                threshold_id: "th-1",
                days_before: 1,
                channel: "email",
                status: "failed",
                retry_count: 3,
              },
              {
                id: "del-inapp",
                threshold_id: "th-1",
                days_before: 1,
                channel: "in_app",
                status: "sent",
                retry_count: 0,
              },
            ],
          }),
        ],
        nowAtH1,
      );
      // Terminal state: neither retry nor create should be scheduled
      expect(actions).toEqual([]);
    });

    test("Case E: failed delivery with retry_count = 4 (above cap) produces NO retry and NO duplicate create", () => {
      const actions = evaluateReminders(
        [
          baseTask({
            deliveries: [
              {
                id: "del-retry-4",
                threshold_id: "th-1",
                days_before: 1,
                channel: "email",
                status: "failed",
                retry_count: 4,
              },
              {
                id: "del-inapp",
                threshold_id: "th-1",
                days_before: 1,
                channel: "in_app",
                status: "sent",
                retry_count: 0,
              },
            ],
          }),
        ],
        nowAtH1,
      );
      expect(actions).toEqual([]);
    });
  });

  describe("F-2: DST transitions (America/New_York)", () => {
    // US DST 2026: spring forward Mar 8 (02:00 -> 03:00, EST -> EDT),
    // fall back Nov 1 (02:00 -> 01:00, EDT -> EST). Asia/Makassar never
    // observes DST, so these vectors are the only ones that exercise the
    // 3-iteration settle loop in fromZonedTime.
    const timeZone = "America/New_York";

    test("spring-forward gap resolves forward to an exact instant", () => {
      // Deadline Mon Mar 9 02:30 EDT (valid). H-1 targets Sun Mar 8 02:30,
      // which never existed -> resolves forward to 03:30 EDT wall-clock.
      const trigger = thresholdTriggerAt(
        "2026-03-09T06:30:00.000Z",
        1,
        timeZone,
      );
      expect(trigger.toISOString()).toBe("2026-03-08T07:30:00.000Z");
      expect(
        isThresholdDue(
          "2026-03-09T06:30:00.000Z",
          1,
          new Date("2026-03-08T07:30:00.000Z"),
          timeZone,
        ),
      ).toBe(true);
      expect(
        isThresholdDue(
          "2026-03-09T06:30:00.000Z",
          1,
          new Date("2026-03-08T07:29:59.000Z"),
          timeZone,
        ),
      ).toBe(false);
    });

    test("spring-forward Sunday trigger settles to the true offset (not single-pass)", () => {
      // Deadline Sun Mar 8 03:30 EDT. A single-pass offset guess lands an
      // hour late (08:30Z = 04:30 wall); the settle loop converges to 07:30Z.
      const trigger = thresholdTriggerAt(
        "2026-03-08T07:30:00.000Z",
        0,
        timeZone,
      );
      expect(trigger.toISOString()).toBe("2026-03-08T07:30:00.000Z");
    });

    test("fall-back Sunday trigger settles to the true offset (not single-pass)", () => {
      // Deadline Sun Nov 1 02:30 EST (unambiguous, occurs once). Single-pass
      // lands an hour early (06:30Z = 01:30 EST wall); settle gives 07:30Z.
      const trigger = thresholdTriggerAt(
        "2026-11-01T07:30:00.000Z",
        0,
        timeZone,
      );
      expect(trigger.toISOString()).toBe("2026-11-01T07:30:00.000Z");
    });

    test("fall-back overlap resolves deterministically and fires exactly once", () => {
      // 01:30 occurs twice on Nov 1 (EDT then EST). Both occurrences map to
      // the same first-occurrence trigger instant, so two scheduler runs can
      // never compute two different instants for one threshold.
      const first = thresholdTriggerAt(
        "2026-11-01T05:30:00.000Z", // 01:30 EDT (first occurrence)
        0,
        timeZone,
      );
      const second = thresholdTriggerAt(
        "2026-11-01T06:30:00.000Z", // 01:30 EST (second occurrence)
        0,
        timeZone,
      );
      expect(first.toISOString()).toBe("2026-11-01T05:30:00.000Z");
      expect(second.toISOString()).toBe(first.toISOString());

      // Run 1 at the trigger creates email + in_app; run 2 with those rows
      // recorded as sent creates nothing for the threshold (fires once).
      const task: ReminderTaskInput = {
        id: "task-dst",
        status: "todo",
        deadline: "2026-11-01T07:30:00.000Z", // H-0 trigger = 07:30Z
        created_at: "2026-10-20T08:00:00.000Z",
        timeZone,
        thresholds: [{ id: "th-0", days_before: 0 }],
        deliveries: [],
      };
      const atTrigger = new Date("2026-11-01T07:30:00.000Z");
      const run1 = evaluateReminders([task], atTrigger);
      expect(run1).toHaveLength(2);
      expect(run1.map((a) => a.channel).sort()).toEqual([
        "email",
        "in_app",
      ]);

      const run2 = evaluateReminders(
        [
          {
            ...task,
            deliveries: run1
              .filter((a) => a.action === "create")
              .map((a, i) => ({
                id: `del-dst-${i}`,
                threshold_id: "th-0",
                days_before: 0,
                channel: a.channel,
                status: "sent" as const,
                retry_count: 0,
              })),
          },
        ],
        new Date("2026-11-01T08:30:00.000Z"),
      );
      expect(run2).toEqual([]);
    });

    test("H-3 day arithmetic keeps wall-clock across the spring boundary", () => {
      // Deadline Wed Mar 11 09:00 EDT. H-3 -> Sun Mar 8 09:00 EDT: same
      // wall-clock, exact UTC, despite the DST transition in between.
      const trigger = thresholdTriggerAt(
        "2026-03-11T13:00:00.000Z",
        3,
        timeZone,
      );
      expect(trigger.toISOString()).toBe("2026-03-08T13:00:00.000Z");
    });

    test("H-3 day arithmetic keeps wall-clock across the fall boundary", () => {
      // Deadline Wed Nov 4 09:00 EST. H-3 -> Sun Nov 1 09:00 EST.
      const trigger = thresholdTriggerAt(
        "2026-11-04T14:00:00.000Z",
        3,
        timeZone,
      );
      expect(trigger.toISOString()).toBe("2026-11-01T14:00:00.000Z");
    });
  });
});

describe("RF-09/RF-10: archived threshold removal + offset-keyed delivery identity", () => {
  const timeZone = "Asia/Makassar";
  const deadline = "2026-09-11T15:59:00.000Z";
  const taskCreatedAt = "2026-09-01T08:00:00.000Z";
  // H-3 trigger = Tue 2026-09-08 23:59 Makassar = 15:59Z.
  const nowAtH3 = new Date("2026-09-08T16:00:00.000Z");

  test("re-adding an offset whose archived threshold already sent does not re-send", () => {
    const task: ReminderTaskInput = {
      id: "task-1",
      status: "todo",
      deadline,
      created_at: taskCreatedAt,
      timeZone,
      thresholds: [{ id: "th-readded", days_before: 3 }],
      deliveries: [
        {
          id: "del-archived-email",
          threshold_id: "th-archived",
          days_before: 3,
          channel: "email",
          status: "sent",
          retry_count: 0,
        },
        {
          id: "del-archived-inapp",
          threshold_id: "th-archived",
          days_before: 3,
          channel: "in_app",
          status: "sent",
          retry_count: 0,
        },
      ],
    };

    expect(evaluateReminders([task], nowAtH3)).toEqual([]);
  });

  test("archived threshold's failed row is not resurrected; live offset creates fresh", () => {
    const task: ReminderTaskInput = {
      id: "task-1",
      status: "todo",
      deadline,
      created_at: taskCreatedAt,
      timeZone,
      thresholds: [{ id: "th-readded", days_before: 3 }],
      deliveries: [
        {
          id: "del-archived-failed",
          threshold_id: "th-archived",
          days_before: 3,
          channel: "email",
          status: "failed",
          retry_count: 1,
        },
      ],
    };

    const actions = evaluateReminders([task], nowAtH3);
    expect(actions.filter((a) => a.action === "retry")).toHaveLength(0);
    expect(actions).toEqual([
      {
        action: "create",
        task_id: "task-1",
        threshold_id: "th-readded",
        channel: "email",
        days_before: 3,
        late: false,
      },
      {
        action: "create",
        task_id: "task-1",
        threshold_id: "th-readded",
        channel: "in_app",
        days_before: 3,
        late: false,
      },
    ]);
  });

  test("live failed email under the retry cap retries on its own delivery id", () => {
    const task: ReminderTaskInput = {
      id: "task-1",
      status: "todo",
      deadline,
      created_at: taskCreatedAt,
      timeZone,
      thresholds: [{ id: "th-live", days_before: 3 }],
      deliveries: [
        {
          id: "del-live-failed",
          threshold_id: "th-live",
          days_before: 3,
          channel: "email",
          status: "failed",
          retry_count: 1,
        },
      ],
    };

    const actions = evaluateReminders([task], nowAtH3);
    expect(actions).toEqual([
      {
        action: "retry",
        delivery_id: "del-live-failed",
        task_id: "task-1",
        threshold_id: "th-live",
        channel: "email",
        days_before: 3,
        retry_count: 1,
      },
      {
        action: "create",
        task_id: "task-1",
        threshold_id: "th-live",
        channel: "in_app",
        days_before: 3,
        late: false,
      },
    ]);
  });

  test("live failed email at the retry cap is suppressed (no create, no retry)", () => {
    const task: ReminderTaskInput = {
      id: "task-1",
      status: "todo",
      deadline,
      created_at: taskCreatedAt,
      timeZone,
      thresholds: [{ id: "th-live", days_before: 3 }],
      deliveries: [
        {
          id: "del-live-failed",
          threshold_id: "th-live",
          days_before: 3,
          channel: "email",
          status: "failed",
          retry_count: MAX_EMAIL_DELIVERY_RETRIES,
        },
        {
          id: "del-live-inapp",
          threshold_id: "th-live",
          days_before: 3,
          channel: "in_app",
          status: "sent",
          retry_count: 0,
        },
      ],
    };

    expect(evaluateReminders([task], nowAtH3)).toEqual([]);
  });
});

describe("RF-11: late labeling + deadline-passed suppression", () => {
  const timeZone = "UTC";
  const deadline = "2026-09-11T12:00:00.000Z";
  const taskCreatedAt = "2026-09-01T08:00:00.000Z";

  function task(overrides: Partial<ReminderTaskInput> = {}): ReminderTaskInput {
    return {
      id: "task-1",
      status: "todo",
      deadline,
      created_at: taskCreatedAt,
      timeZone,
      thresholds: [{ id: "th-1", days_before: 1 }],
      deliveries: [],
      ...overrides,
    };
  }

  test("within 1h of the trigger is not late", () => {
    // H-1 trigger = 2026-09-10T12:00Z; +31min is still on time.
    const actions = evaluateReminders(
      [task()],
      new Date("2026-09-10T12:31:00.000Z"),
    );
    expect(actions.map((a) => (a.action === "create" ? a.late : null))).toEqual([
      false,
      false,
    ]);
  });

  test("at least 1h after the trigger is late", () => {
    const actions = evaluateReminders(
      [task()],
      new Date("2026-09-10T13:00:00.000Z"),
    );
    expect(actions).toHaveLength(2);
    expect(actions.every((a) => a.action === "create" && a.late)).toBe(true);
  });

  test("suppresses creates once the deadline is past the 1h grace", () => {
    // deadline 12:00Z; +1h1m is beyond grace.
    expect(
      evaluateReminders([task()], new Date("2026-09-11T13:01:00.000Z")),
    ).toEqual([]);
  });

  test("grace boundary is inclusive: exactly deadline+1h still fires", () => {
    const actions = evaluateReminders(
      [task()],
      new Date("2026-09-11T13:00:00.000Z"),
    );
    expect(actions).toHaveLength(2);
  });

  test("suppresses retries of already-created deliveries after the deadline", () => {
    const withFailed = task({
      deliveries: [
        {
          id: "del-failed",
          threshold_id: "th-1",
          days_before: 1,
          channel: "email",
          status: "failed",
          retry_count: 0,
        },
      ],
    });
    expect(
      evaluateReminders([withFailed], new Date("2026-09-11T13:01:00.000Z")),
    ).toEqual([]);
  });

  test("H-0 still fires in the first run after the deadline (grace)", () => {
    const h0 = task({ thresholds: [{ id: "th-0", days_before: 0 }] });
    const actions = evaluateReminders(
      [h0],
      new Date("2026-09-11T12:30:00.000Z"),
    );
    expect(actions).toHaveLength(2);
    // 30min after the deadline is inside the late threshold too, so not late.
    expect(actions.every((a) => a.action === "create" && !a.late)).toBe(true);
  });
});
