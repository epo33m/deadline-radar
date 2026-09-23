process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { beforeEach, describe, expect, mock, test } from "bun:test";

import { resetRateLimitBuckets } from "../plugins/rate-limit";
import { setVerifyAccessTokenOverride } from "../lib/auth-tokens";
import {
  createAuthorizationContext,
  setLoadAuthorizationContextOverride,
  setOwnershipOverrides,
} from "../lib/authorization";
import { DOMAIN_CAPABILITIES } from "../lib/authorization/capabilities";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COURSE_ACTIVE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const COURSE_DELETED = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TASK_WITH_ACTIVE_COURSE = "11111111-1111-4111-8111-111111111111";
const TASK_WITH_DELETED_COURSE = "22222222-2222-4222-8222-222222222222";
const TASK_DELETED = "33333333-3333-4333-8333-333333333333";

type MockCourse = {
  id: string;
  name: string;
  color: string;
  deletedAt: Date | null;
};

type MockTask = {
  id: string;
  userId: string;
  courseId: string;
  title: string;
  deadline: Date;
  status: "todo" | "in_progress" | "done";
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

let coursesStore: MockCourse[] = [];
let tasksStore: MockTask[] = [];

mock.module("../lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        leftJoin: (_table: any, joinCondition: any) => ({
          where: (whereCondition: any) => ({
            orderBy: () => ({
              limit: async () => {
                // Evaluate left join:
                // tasks where userId = USER_A and isNull(tasks.deletedAt)
                const activeTasks = tasksStore.filter(
                  (t) => t.userId === USER_A && t.deletedAt === null,
                );
                return activeTasks.map((t) => {
                  const course = coursesStore.find((c) => c.id === t.courseId);
                  // course is only joined if course.deletedAt is null
                  const joinedCourse = course && course.deletedAt === null ? course : null;
                  return {
                    id: t.id,
                    userId: t.userId,
                    courseId: t.courseId,
                    title: t.title,
                    description: null,
                    deadline: t.deadline,
                    status: t.status,
                    createdAt: t.createdAt,
                    updatedAt: t.updatedAt,
                    courseName: joinedCourse ? joinedCourse.name : null,
                    courseColor: joinedCourse ? joinedCourse.color : null,
                  };
                });
              },
            }),
          }),
        }),
        where: (whereCondition: any) => {
          const res = {
            limit: async () => {
              // Single task detail lookup for course
              const targetTask = tasksStore.find((t) => t.id === currentDetailTaskId);
              if (!targetTask) return [];
              const course = coursesStore.find(
                (c) => c.id === targetTask.courseId && c.deletedAt === null,
              );
              return course ? [course] : [];
            },
            orderBy: async () => [],
            then: (resolve: (v: any) => any) => Promise.resolve([]).then(resolve),
          };
          return res;
        },
      }),
    }),
  }),
}));

let currentDetailTaskId = TASK_WITH_ACTIVE_COURSE;

const { app } = await import("../app");

describe("Finding L-7: Soft-deleted course behavior in task list and detail", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    coursesStore = [
      {
        id: COURSE_ACTIVE,
        name: "Math 101",
        color: "#0066cc",
        deletedAt: null,
      },
      {
        id: COURSE_DELETED,
        name: "Physics 201",
        color: "#cc0000",
        deletedAt: new Date("2026-09-01T00:00:00Z"),
      },
    ];

    tasksStore = [
      {
        id: TASK_WITH_ACTIVE_COURSE,
        userId: USER_A,
        courseId: COURSE_ACTIVE,
        title: "Active task with active course",
        deadline: new Date(Date.now() + 86400000),
        status: "todo",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
      {
        id: TASK_WITH_DELETED_COURSE,
        userId: USER_A,
        courseId: COURSE_DELETED,
        title: "Active task with deleted course",
        deadline: new Date(Date.now() + 2 * 86400000),
        status: "todo",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
      {
        id: TASK_DELETED,
        userId: USER_A,
        courseId: COURSE_ACTIVE,
        title: "Deleted task",
        deadline: new Date(Date.now() + 3 * 86400000),
        status: "todo",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: new Date("2026-09-10T00:00:00Z"),
      },
    ];

    setVerifyAccessTokenOverride(async (token) => {
      if (token === "token-user-a") {
        return { id: USER_A, email: "user_a@example.com", sessionId: "sa" };
      }
      return null;
    });

    setLoadAuthorizationContextOverride(async (subject) =>
      createAuthorizationContext({
        subject,
        roles: ["user"],
        capabilities: [...DOMAIN_CAPABILITIES],
      }),
    );

    setOwnershipOverrides({
      ownedTask: async (userId, id) => {
        const found = tasksStore.find(
          (t) => t.id === id && t.userId === userId && t.deletedAt === null,
        );
        return found ? (found as any) : null;
      },
    });
  });

  test("GET /api/v1/tasks returns active tasks; course is null when soft-deleted, populated when active", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/tasks", {
        method: "GET",
        headers: {
          authorization: "Bearer token-user-a",
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.tasks.length).toBe(2);

    const activeCourseTask = body.tasks.find((t: any) => t.id === TASK_WITH_ACTIVE_COURSE);
    expect(activeCourseTask).toBeDefined();
    expect(activeCourseTask.courseName).toBe("Math 101");
    expect(activeCourseTask.courseColor).toBe("#0066cc");

    const deletedCourseTask = body.tasks.find((t: any) => t.id === TASK_WITH_DELETED_COURSE);
    expect(deletedCourseTask).toBeDefined();
    expect(deletedCourseTask.courseName).toBeNull();
    expect(deletedCourseTask.courseColor).toBeNull();

    const deletedTask = body.tasks.find((t: any) => t.id === TASK_DELETED);
    expect(deletedTask).toBeUndefined();
  });

  test("GET /api/v1/tasks/:id detail returns course=null when course is soft-deleted", async () => {
    currentDetailTaskId = TASK_WITH_DELETED_COURSE;
    const res = await app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_WITH_DELETED_COURSE}`, {
        method: "GET",
        headers: {
          authorization: "Bearer token-user-a",
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.task.id).toBe(TASK_WITH_DELETED_COURSE);
    expect(body.course).toBeNull();
  });

  test("GET /api/v1/tasks/:id detail returns full course when course is active", async () => {
    currentDetailTaskId = TASK_WITH_ACTIVE_COURSE;
    const res = await app.handle(
      new Request(`http://localhost/api/v1/tasks/${TASK_WITH_ACTIVE_COURSE}`, {
        method: "GET",
        headers: {
          authorization: "Bearer token-user-a",
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.task.id).toBe(TASK_WITH_ACTIVE_COURSE);
    expect(body.course).toBeDefined();
    expect(body.course.name).toBe("Math 101");
  });
});
