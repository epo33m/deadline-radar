"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { AddCourseForm } from "@/components/courses/course-form";
import { CourseList } from "@/components/courses/course-list";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { CourseListItem } from "@/types/course";

type CoursesManagementProps = {
  courses: CourseListItem[];
};

export function CoursesManagement({ courses }: CoursesManagementProps) {
  const [addOpen, setAddOpen] = useState(false);
  const hasCourses = courses.length > 0;
  const openAdd = () => setAddOpen(true);

  return (
    <section className="space-y-6 sm:space-y-8">
      <header className="flex items-start justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1 space-y-2 sm:space-y-3">
          <h1 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">
            Courses
          </h1>
          <p className="max-w-xl text-[15px] font-normal leading-[1.47] tracking-[-0.374px] text-ink-muted-48 sm:text-[17px]">
            Organize your tasks by course.
          </p>
        </div>

        {hasCourses ? (
          <Button
            type="button"
            onClick={openAdd}
            aria-label="New Course"
            className="mt-0.5 hidden size-11 shrink-0 rounded-full p-0 lg:inline-flex"
          >
            <Plus className="size-5" strokeWidth={2} aria-hidden="true" />
          </Button>
        ) : null}
      </header>

      <div className={hasCourses ? "space-y-3 pb-20 sm:space-y-4 lg:pb-0" : undefined}>
        {hasCourses ? (
          <h2 className="font-display text-[19px] font-semibold tracking-[-0.2px] text-ink sm:text-[21px]">
            My Courses
          </h2>
        ) : null}
        <CourseList courses={courses} onAddCourse={openAdd} />
      </div>

      {hasCourses ? (
        <Button
          type="button"
          onClick={openAdd}
          aria-label="New Course"
          className="fixed right-4 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-40 size-14 rounded-full p-0 shadow-lg lg:hidden"
        >
          <Plus className="size-5" strokeWidth={2} aria-hidden="true" />
        </Button>
      ) : null}

      <Dialog open={addOpen} onOpenChange={setAddOpen} title="New">
        <AddCourseForm
          onCancel={() => setAddOpen(false)}
          onSuccess={() => setAddOpen(false)}
        />
      </Dialog>
    </section>
  );
}
