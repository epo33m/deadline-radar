import type { MetadataRoute } from "next";

const webOrigin = (
  process.env.WEB_ORIGIN ?? "https://dr.rapm.space"
).replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/settings", "/notifications", "/calendar", "/courses", "/tasks", "/summary", "/learn"],
    },
    sitemap: `${webOrigin}/sitemap.xml`,
  };
}
