import { BRAND } from "../../brand";

export default function SiteFooter() {
  return (
    <footer>
      {BRAND.name}'s Precision engine picks colors on a 2× enlarged copy of your image, traces every
      boundary between two colors once so neighbouring shapes meet without gaps, and fits smooth curves
      with sharp corners where the outline really turns. It is a free, in-browser tool and won't match
      commercial server-side vectorizers on very detailed art. For those, export your best result here and
      touch up the remaining spots in a vector editor, or use a dedicated service.{" "}
      {BRAND.credits.map(c => `The ${c.role} uses ${c.name} (${c.licence}).`).join(" ")}
    </footer>
  );
}
