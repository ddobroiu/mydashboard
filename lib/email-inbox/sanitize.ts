// HTML-ul e-mailurilor, curățat înainte de salvare: fără scripturi, formulare, iframe-uri sau stiluri cu url().
// Imaginile externe (pixeli de urmărire) se blochează: src → data-remote-src; butonul „Încarcă imaginile”
// din pagina E-mail le pune înapoi. (Portat din print/shopprint-main.) Imaginile din mesaj (cid:) se înlocuiesc la afișare cu ruta de atașamente.
// Afișarea se face oricum într-un iframe sandbox, fără scripturi, cu Content-Security-Policy.
import sanitizeHtml from "sanitize-html";

const BAD_STYLE = /url\s*\(|expression\s*\(|@import|javascript:|behavior\s*:|-moz-binding/i;

export function sanitizeEmailHtml(input: string): { html: string; hasRemoteImages: boolean } {
    let hasRemoteImages = false;
    const html = sanitizeHtml(String(input || "").slice(0, 1_500_000), {
        allowedTags: [
            ...sanitizeHtml.defaults.allowedTags, "img", "font", "center", "span", "div", "u", "s", "strike", "small", "big",
            "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "col", "colgroup", "caption",
        ],
        disallowedTagsMode: "discard",
        allowedAttributes: {
            "*": ["style", "align", "valign", "width", "height", "bgcolor", "border", "cellpadding", "cellspacing", "colspan", "rowspan", "color", "dir", "lang", "title", "face", "size"],
            a: ["href", "name", "target", "rel"],
            img: ["src", "alt", "data-remote-src"],
        },
        allowedSchemes: ["http", "https", "mailto", "tel"],
        allowedSchemesByTag: { img: ["data", "cid"] },
        allowProtocolRelative: false,
        transformTags: {
            "*": (tagName, attribs) => {
                if (attribs.style && BAD_STYLE.test(attribs.style)) delete attribs.style;
                return { tagName, attribs };
            },
            a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" } }),
            img: (tagName, attribs) => {
                const src = String(attribs.src || "").trim();
                if (/^(https?:)?\/\//i.test(src)) {
                    hasRemoteImages = true;
                    const { src: _drop, ...rest } = attribs;
                    void _drop;
                    return { tagName, attribs: { ...rest, "data-remote-src": src.startsWith("//") ? `https:${src}` : src } };
                }
                return { tagName, attribs };
            },
        },
    });
    return { html, hasRemoteImages };
}

/** Text simplu → HTML minimal (pentru mesajele fără parte HTML și pentru răspunsurile din admin). */
export function textToHtml(text: string): string {
    const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<div style="white-space:pre-wrap;font-family:Arial,sans-serif;font-size:14px">${esc}</div>`;
}
