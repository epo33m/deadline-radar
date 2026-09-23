"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { AddCourseForm } from "@/components/courses/course-form";
import { CourseList } from "@/components/courses/course-list";
import { LearnSecondaryNav } from "@/components/learn/learn-secondary-nav";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
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
      <LearnSecondaryNav />
      <PageHeader title="My Courses" subtitle="Everything you're learning, organized in one place." />

      <div className={hasCourses ? "space-y-3 pb-20 sm:space-y-4 md:pb-0" : undefined}>
        {hasCourses ? (
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-[19px] font-semibold tracking-[-0.2px] text-ink sm:text-[21px]">
                All Courses
            </h2>
            <Button
              type="button"
              onClick={openAdd}
              aria-label="New Course"
              size="icon"
              className="hidden rounded-full md:inline-flex"
            >
              <Plus className="size-5" strokeWidth={2} aria-hidden="true" />
            </Button>
          </div>
        ) : null}
        <CourseList courses={courses} onAddCourse={openAdd} />
      </div>

      {hasCourses ? (
        <Button
          type="button"
          onClick={openAdd}
          aria-label="New Course"
          className="fixed right-4 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-40 size-14 rounded-full p-0 shadow-lg md:hidden"
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
