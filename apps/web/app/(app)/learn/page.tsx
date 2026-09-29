import { redirect } from "next/navigation";

/**
 * The "Get Started" page moved out of the authenticated app to the public
 * landing page (`/`). The Learn group now starts at Courses, so `/learn` is
 * kept only as an entry point for the "Learn" item in the primary nav and
 * forwards there. The route stays behind the `(app)` layout, so it is still
 * session-gated by `requireSession` in that layout.
 */
export default function LearnPage() {
  redirect("/courses");
}
