import { cache } from "react";

import { apiJson } from "@/lib/api/server";

export type ApiCourse = {
  id: string;
  userId: string;
  name: string;
  code: string | null;
  color: string | null;
  icon?: string | null;
  description: string | null;
  createdAt: string | Date;
  deletedAt: string | Date | null;
};

export type CourseResult = { course?: ApiCourse; error?: string };

/**
 * Course detail shared between `generateMetadata` and the page so the
 * `/api/v1/courses/:id` hop happens once per request (I-09/F-09). React
 * `cache()` memoizes per render pass; the underlying fetch stays
 * `no-store` (HI-1: no global cache change).
 */
export const getCourse = cache(
  async (
    id: string,
    fetchJson: typeof apiJson = apiJson,
  ): Promise<CourseResult> => {
    return fetchJson<CourseResult>(`/api/v1/courses/${id}`);
  },
);
