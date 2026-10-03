import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SDAK Church Manager",
    short_name: "SDAK Members",
    description: "Membership records for the Seventh-day Adventist Church Kanyanya.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f4f6f6",
    theme_color: "#174b55",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
