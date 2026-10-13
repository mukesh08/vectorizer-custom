import { BRAND } from "../../brand";
import Logo from "./Logo";

/* On the landing page the hero headline is the page's h1, so the wordmark stays a plain div.
   In the workbench there is no hero, and the wordmark becomes the heading instead. */
export default function SiteHeader({ asHeading = false }: { asHeading?: boolean }) {
  const mark = <><Logo />{BRAND.name}</>;
  return (
    <header className="top">
      {asHeading ? <h1 className="brand">{mark}</h1> : <div className="brand">{mark}</div>}
      <div className="tag">{BRAND.tagline}</div>
    </header>
  );
}
