/**
 * Generated OpenAPI types for the Deadline Radar API.
 * Regenerate with: `bun run openapi:generate` (API must be running on :4025).
 */
export interface paths {
  "/health": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": { ok: boolean; service: string };
          };
        };
      };
    };
  };
  "/api/auth/session": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": {
              authenticated: boolean;
              user?: {
                id: string;
                email?: string;
                timezone: string;
                name: string | null;
              };
            };
          };
        };
        401: {
          content: {
            "application/json": { authenticated: false };
          };
        };
      };
    };
  };
  "/api/auth/login": {
    post: {
      requestBody: {
        content: {
          "application/json": { email: string; password: string };
        };
      };
      responses: {
        200: {
          content: {
            "application/json": {
              user: { id: string; email?: string };
              redirectTo: string;
            };
          };
        };
      };
    };
  };
  "/api/courses": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": { courses: Record<string, unknown>[] };
          };
        };
      };
    };
    post: {
      requestBody: {
        content: {
          "application/json": {
            name: string;
            code?: string | null;
            color?: string | null;
          };
        };
      };
      responses: {
        200: {
          content: {
            "application/json": { course: Record<string, unknown> };
          };
        };
      };
    };
  };
  "/api/tasks": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": { tasks: Record<string, unknown>[] };
          };
        };
      };
    };
  };
  "/api/notifications": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": { notifications: Record<string, unknown>[] };
          };
        };
      };
    };
  };
  "/api/cron/evaluate-reminders": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": {
              ok: boolean;
              evaluatedTasks: number;
              created: number;
              retried: number;
              emailsSent: number;
              emailsFailed: number;
            };
          };
        };
      };
    };
  };
}

export type webhooks = Record<string, never>;
export interface components {
  schemas: Record<string, never>;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
