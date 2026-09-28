import type { MetadataRoute } from "next";

// robots.txt: MyDashboard este un instrument intern, fara pagini de prezentare.
// Singura pagina publica utila este /confidentialitate (nota pentru vizitatorii
// site-urilor masurate). Panoul, login-ul si API-ul raman in afara indexului.
// /t.js si /l/[code] raman accesibile (scriptul de masurare si linkurile scurte).
// Fara sitemap: nu exista pagini publice de listat.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/login", "/api/"],
    },
  };
}
