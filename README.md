# GedcomSlice

Cut a part of a family tree out of a GEDCOM file and save it as a new GEDCOM.

1. Open a `.ged` file (or drop it on the page, or try the built-in sample).
2. Pick people in either view; both share one selection:
   - **List:** tick checkboxes, search by name or ID, or click a name and use
     **+ Ancestors**, **+ Descendants** (optionally with spouses) or **+ Family**
     (parents, partners, children, siblings).
   - **Tree:** drag with the left mouse button to draw a selection rectangle.
     Shift+drag adds to the selection, Ctrl/Cmd+drag removes from it, a click
     toggles one person. Right-drag or Space+drag pans, the wheel zooms.
3. Press **Create GEDCOM**, check the preview of the new tree, and download it.

Everything runs in the browser. The file is never uploaded anywhere.

## What the new file contains

- The selected people (`INDI`), with all their own data.
- Families (`FAM`) that still contain a selected partner, or at least two
  selected people. Links to people and families that were left out are removed.
- Every source, repository, note, media object and submitter that the kept
  records point to, directly or through each other.
- A new `HEAD` (same GEDCOM version as the input, `CHAR UTF-8`) and `TRLR`.

Input files may be UTF-8, UTF-16, ANSI (Windows-1252), Macintosh or ANSEL.
The output is always UTF-8.

## Development

```sh
npm install
npm run dev     # local server with hot reload
npm test        # unit tests (Vitest)
npm run build   # production build in dist/
```

Stack: [Vite](https://vite.dev), plain JavaScript, [Cytoscape.js](https://js.cytoscape.org)
with the dagre layout for the tree.

## Deployment

`.github/workflows/deploy.yml` tests, builds and publishes `dist/` to GitHub
Pages on every push to `main`. In the repository, set **Settings → Pages →
Source** to **GitHub Actions** once.
