import type { MetadataRoute } from "next";

const webOrigin = (
  process.env.WEB_ORIGIN ?? "https://dr.rapm.space"
).replace(/\/$/, "");

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/privacy",
  "/terms",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({
    url: `${webOrigin}${path}`,
    lastModified: new Date(),
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : 0.5,
  }));
}
